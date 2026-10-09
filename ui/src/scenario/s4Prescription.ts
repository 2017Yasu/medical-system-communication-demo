// S4 処方調剤（docs/02-demo-scenarios.md S4、specs/004 data-model.md §3.1・§4）。外来（本線）と入院（変化形）。
// ステップ 1〜4 は患者・医師・区分を除いて同じ。最後の操作（お渡し／払出）とその結果が異なる。
import {
  PRESCRIPTION_DEFAULTS,
  medication,
  type PharmacistId,
  type PrescriberId,
} from "../fhir/builders/prescription";
import { acceptPrescription, dispenseToWard, fetchLatestPrescription, handOver, placePrescription, startAudit } from "../fhir/prescriptionActions";
import { loadPrescriptionScenarioState } from "./s4State";
import type { Scenario, ScenarioClient, ScenarioContext, ScenarioState, ScenarioStep, TrafficCondition } from "./types";

type Kind = "outpatient" | "inpatient";

const PHARMACY_DEPT = "Organization/pharmacy-dept";
const role = (id: PharmacistId) => `PractitionerRole/${id}`;

const state = (mr: string, task: NonNullable<ScenarioState["task"]>, dispense: "none" | "completed"): ScenarioState => ({
  medicationRequest: mr,
  task,
  medicationDispense: dispense,
});

const prescribed = state("active", { status: "requested", owner: PHARMACY_DEPT }, "none");
const dispensing = state("active", { status: "in-progress", businessStatus: "dispensing", owner: role("ph-c") }, "none");
const auditing = state("active", { status: "in-progress", businessStatus: "auditing", owner: role("ph-e") }, "none");

const http = (client: ScenarioClient, method: "GET" | "POST" | "PUT" | "PATCH", resourceType: string): TrafficCondition => ({ kind: "http", client, method, resourceType });
const notified = (targetClient: ScenarioClient): TrafficCondition => ({ kind: "notification", targetClient });

async function currentOf(ctx: ScenarioContext, client: ScenarioClient, doctor: PrescriberId) {
  const cur = await fetchLatestPrescription(ctx.clients[client], `Practitioner/${doctor}`);
  if (!cur) throw new Error("対象の処方が見つかりません（先のステップが完了していません）");
  return cur;
}

function steps(kind: Kind): ScenarioStep[] {
  const outpatient = kind === "outpatient";
  const doctor: PrescriberId = outpatient ? "dr-x" : "dr-y";
  const doctorClient: ScenarioClient = outpatient ? "ehr-doctor" : "ehr-doctor-y";
  const doctorName = outpatient ? "医師 X" : "医師 Y";
  const defaults = PRESCRIPTION_DEFAULTS[doctor];
  const med = medication(defaults.medication);
  const finished = outpatient
    ? state("completed", { status: "completed", owner: role("ph-e") }, "completed")
    : state("active", { status: "completed", owner: role("ph-e") }, "completed");

  return [
    {
      no: 1,
      title: outpatient ? "医師 X がデモ 太郎に処方" : "医師 Y がデモ 三郎に臨時処方",
      actor: doctorClient,
      target: { screen: "ehr", role: doctor, control: "rx-patient,rx-drug,rx-submit" },
      run: (ctx) =>
        placePrescription(
          ctx.clients[doctorClient],
          doctor,
          { patientId: defaults.patientId, medicationKey: defaults.medication, doseValue: med.doseValue, days: med.defaultDays },
          ctx.now(),
        ),
      expected: { ...prescribed, traffic: [http(doctorClient, "POST", "Bundle")] },
      explanation: {
        business: outpatient
          ? "医師 X が電子カルテで、デモ 太郎に 1 剤を処方します（外来・院内処方）。「処方（医師の指示）」と、薬剤部が行う「作業」が、一度にまとめて登録されます。"
          : "医師 Y が電子カルテで、外科病棟に入院中のデモ 三郎に 1 剤を臨時処方します（入院処方・臨時処方）。処方は患者の入院の情報に結び付けられ、「作業」と一度にまとめて登録されます。",
        fhir:
          `POST /fhir（Transaction Bundle）で MedicationRequest（status=active、intent=order、category=${outpatient ? "OHP 外来処方 + OHI 院内処方" : "IHP 入院処方 + XTR 臨時処方"}、薬剤は HOT コード、用法は JAMI 用法コード）と、` +
          `Task（status=requested、owner=薬剤部、focus → MedicationRequest）を作成します。検体検査の依頼は ServiceRequest でしたが、処方の依頼は MedicationRequest です。依頼のリソースは部門で異なっても、進捗を管理する Task は共通です。${outpatient ? "" : "入院の処方は encounter で入院の情報を参照します。"}`,
      },
    },
    {
      no: 2,
      title: "薬剤部の画面に新しい処方が届く",
      actor: "auto",
      target: { screen: "pharmacy" },
      expected: { ...prescribed, traffic: [notified("pharmacy"), http("pharmacy", "GET", "Task")] },
      explanation: {
        business: `薬剤部門システムの処方一覧に、新しい処方が自動で現れます（画面の更新操作は不要です）。患者・薬剤・用法・日数と、区分（${outpatient ? "外来" : "入院・外科病棟"}）が分かります。`,
        fhir:
          "薬剤部の Subscription（criteria: Task?owner=薬剤部,薬剤師 C,薬剤師 E）が Task の作成を検知して ping だけを送り、画面が Task を GET して中身を取りに行きます。検体検査システムと同じ仕組みで、部門システム側の作り方を揃えられます。",
      },
    },
    {
      no: 3,
      title: "薬剤師 C が受付・調剤を開始",
      actor: "pharmacy-ph-c",
      target: { screen: "pharmacy", pharmacist: "ph-c", control: "pharmacist-ph-c,rx-accept-1" },
      run: async (ctx) => acceptPrescription(ctx.clients["pharmacy-ph-c"], await currentOf(ctx, "pharmacy-ph-c", doctor), "ph-c", ctx.now()),
      expected: { ...dispensing, traffic: [http("pharmacy-ph-c", "PATCH", "Task")] },
      explanation: {
        business: `薬剤師 C が処方を受け付けて、調剤を始めます。作業は「実施中・調剤中」になり、担当者が薬剤師 C に変わります。${doctorName}の処方は「有効（依頼中）」のままです。`,
        fhir:
          "PATCH /fhir/Task/1（If-Match 付き）で status=in-progress、businessStatus=調剤中、owner=PractitionerRole/ph-c を 1 回で更新します。MedicationRequest.status は active のまま（依頼の状態と作業の状態は別）。",
      },
    },
    {
      no: 4,
      title: "薬剤師 E が監査を開始",
      actor: "pharmacy-ph-e",
      target: { screen: "pharmacy", pharmacist: "ph-e", control: "pharmacist-ph-e,rx-audit-1" },
      run: async (ctx) => startAudit(ctx.clients["pharmacy-ph-e"], await currentOf(ctx, "pharmacy-ph-e", doctor), "ph-e", ctx.now()),
      expected: { ...auditing, traffic: [http("pharmacy-ph-e", "PATCH", "Task")] },
      explanation: {
        business: "調剤した薬剤師とは別の薬剤師 E が、監査を始めます。作業は「実施中・監査中」、担当者は薬剤師 E に変わります。調剤した薬剤師は、この画面では監査を始められません。",
        fhir:
          "PATCH /fhir/Task/1（If-Match 付き）で businessStatus=監査中、owner=PractitionerRole/ph-e に更新します（status は in-progress のまま）。調剤者と監査者が別人かどうかをサーバーは判定せず、画面が制限します。調剤した薬剤師は Task の版の履歴（_history）に残っています。",
      },
    },
    {
      no: 5,
      title: outpatient ? "薬剤師 E が監査を終え、患者にお渡し" : "薬剤師 E が監査を終え、病棟へ払出",
      actor: "pharmacy-ph-e",
      target: { screen: "pharmacy", pharmacist: "ph-e", control: `pharmacist-ph-e,${outpatient ? "rx-handover-1" : "rx-ward-dispense-1"}` },
      run: async (ctx) => {
        const cur = await currentOf(ctx, "pharmacy-ph-e", doctor);
        await (outpatient ? handOver : dispenseToWard)(ctx.clients["pharmacy-ph-e"], cur, "ph-e", ctx.now());
      },
      expected: { ...finished, traffic: [http("pharmacy-ph-e", "POST", "Bundle")] },
      explanation: outpatient
        ? {
            business:
              "薬剤師 E が監査を終え、デモ 太郎に薬をお渡しします。調剤の記録（調剤者：薬剤師 C、監査者：薬剤師 E、お渡し先：患者）が登録され、作業も医師の処方も「完了」になります。指示がすべて済んだので、処方まで完了します。",
            fhir:
              "調剤した薬剤師を Task の版の履歴から読み取ったうえで、Transaction で MedicationDispense（completed、performer = packager・checker、receiver = 患者）、Task（completed、output → MedicationDispense）、MedicationRequest（completed）を、ifMatch 付きで一括登録・更新します。どれかが先に更新されていれば全体が 412 になり、調剤の記録も作られません。",
          }
        : {
            business:
              "薬剤師 E が監査を終え、外科病棟へ払い出します。調剤の記録（払出先：外科病棟）が登録され、作業は「完了」になりますが、医師の処方は「有効（依頼中）」のままです。病棟で投与が続くため、指示はまだ済んでいません。「作業が終わった」と「依頼がすべて済んだ」は別です。",
            fhir:
              "Transaction で MedicationDispense（completed、destination = 外科病棟）と Task（completed、output → MedicationDispense）だけを、ifMatch 付きで一括登録・更新します。MedicationRequest は含めず、status は active のままです（外来のお渡しとの違い）。入院の処方を完了・中止にするのは、投与期間の終了や医師の中止の時点で電子カルテが行います（このデモでは作りません）。",
          },
    },
    {
      no: 6,
      title: outpatient ? "電子カルテにお渡し済みと表示" : "看護師 F の画面に払出済みと表示",
      actor: "auto",
      target: { screen: "ehr", role: outpatient ? "dr-x" : "ns-f" },
      expected: { ...finished, traffic: [notified(outpatient ? "ehr-doctor" : "ehr-nurse-f"), http(outpatient ? "ehr-doctor" : "ehr-nurse-f", "GET", "Task")] },
      explanation: outpatient
        ? {
            business: "医師 X の電子カルテに、「お渡し済み」と、処方・作業がどちらも「完了」になったことが自動で表示されます。薬剤部に問い合わせなくても、結果が分かります。",
            fhir:
              "電子カルテの Subscription（criteria: Task?requester=Practitioner/dr-x）が Task の更新を検知して ping を送り、画面が Task・MedicationRequest・MedicationDispense を GET します。通信モニタで、処方を完了にした更新の送信元が薬剤部門システムだったことも確認できます。",
          }
        : {
            business: "病棟の看護師 F の電子カルテに、デモ 三郎の薬が「払出済み」になったことが自動で表示されます。処方は「有効（依頼中）」のまま、作業は「完了」です。受領や与薬の操作は、このデモでは扱いません。",
            fhir:
              "病棟の画面の Subscription（criteria: Task?encounter=外科病棟の入院）が Task の更新を検知して ping を送り、画面が取り直します。Task は完了で終了状態になり、これ以上更新できません。処方（MedicationRequest）が active のまま残る点が外来との違いです。",
          },
    },
  ];
}

export const s4Outpatient: Scenario = {
  id: "s4-outpatient",
  title: "処方調剤（外来：患者にお渡し）",
  stage: "pharmacy",
  loadState: loadPrescriptionScenarioState("Practitioner/dr-x"),
  steps: steps("outpatient"),
};

export const s4Inpatient: Scenario = {
  id: "s4-inpatient",
  title: "処方調剤（入院：病棟へ払出）",
  stage: "pharmacy",
  loadState: loadPrescriptionScenarioState("Practitioner/dr-y"),
  fastForward: { to: 4, label: "ステップ 4 まで進める（外来と同じ部分）" },
  steps: steps("inpatient"),
};
