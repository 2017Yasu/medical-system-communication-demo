// S1 のバリエーション（docs/02-demo-scenarios.md「バリエーション」、contracts/ui-screens.md のシナリオ表）。
import { acceptTask, cancelOrder, placeOrder, recordCollection, rejectTask, rerunTask, startTask, submitFinalReport, submitPartialReport } from "../fhir/labActions";
import { accepted, collected, currentOrder, measuring, reported, requested } from "./s1Main";
import type { Scenario, ScenarioState, ScenarioStep } from "./types";

type Explanation = ScenarioStep["explanation"];

const post = (client: "ehr-doctor" | "ehr-nurse" | "lis-tech-a") => ({ kind: "http", client, method: "POST", resourceType: "Bundle" }) as const;
const patch = { kind: "http", client: "lis-tech-a", method: "PATCH", resourceType: "Task" } as const;

// ---- 共通のステップ（通常の流れの前半） ----

const orderStep = (no: number, sets: string[], title: string): ScenarioStep => ({
  no,
  title,
  actor: "ehr-doctor",
  target: { screen: "ehr", role: "doctor", control: `order-patient,${sets.map((s) => `order-set-${s}`).join(",")},order-submit` },
  run: (ctx) => placeOrder(ctx.clients["ehr-doctor"], "demo-taro", sets, ctx.now()),
  expected: { ...requested, traffic: [post("ehr-doctor")] },
  explanation: {
    business: "医師 X が、患者「デモ 太郎」の検査を電子カルテから依頼します。依頼・作業・検体が一度に登録されます。",
    fhir: "POST /fhir（Transaction Bundle）で ServiceRequest（active）・Task（requested、owner=検査部）・Specimen を作成します。",
  },
});

const collectStep = (no: number): ScenarioStep => ({
  no,
  title: "看護師 D が採血を記録",
  actor: "ehr-nurse",
  target: { screen: "ehr", role: "nurse", control: "collect-1" },
  run: async (ctx) => recordCollection(ctx.clients["ehr-nurse"], await currentOrder(ctx, "ehr-nurse"), ctx.now()),
  expected: { ...collected, traffic: [post("ehr-nurse")] },
  explanation: {
    business: "看護師 D が採血して記録します。作業の業務上の状態が「採取済」になります（作業の状態は「依頼済み」のまま）。",
    fhir: "Specimen と Task（businessStatus=collected）を ifMatch 付きの Transaction で一括更新します。Task.status は requested のままです。",
  },
});

const acceptStep = (no: number): ScenarioStep => ({
  no,
  title: "技師 A が検体を受付",
  actor: "lis-tech-a",
  target: { screen: "lis", control: "accept-1" },
  run: async (ctx) => acceptTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "tech-a", ctx.now()),
  expected: { ...accepted, traffic: [patch] },
  explanation: {
    business: "臨床検査技師 A が検体を受け付けます。作業は「受付済み」、担当者は技師 A になります。",
    fhir: "PATCH /Task/1（If-Match 付き）で status=accepted、businessStatus=received、owner=PractitionerRole/tech-a を 1 回で更新します。",
  },
});

const startStep = (no: number): ScenarioStep => ({
  no,
  title: "技師 A が測定を開始",
  actor: "lis-tech-a",
  target: { screen: "lis", control: "start-1" },
  run: async (ctx) => startTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), ctx.now()),
  expected: { ...measuring, traffic: [patch] },
  explanation: {
    business: "測定を始めます。作業は「実施中」、業務上の状態は「測定中」です。依頼は「有効（依頼中）」のままです。",
    fhir: "PATCH /Task/1 で status=in-progress、businessStatus=measuring に更新します。ServiceRequest.status は active のままです。",
  },
});

const reportStep = (no: number, title: string, explanation: Explanation, control = "entry-1,result-defaults,result-submit"): ScenarioStep => ({
  no,
  title,
  actor: "lis-tech-a",
  target: { screen: "lis", control },
  run: async (ctx) => submitFinalReport(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "tech-a", undefined, ctx.now()),
  expected: { ...reported, traffic: [post("lis-tech-a")] },
  explanation,
});

// ---- 医師が依頼を取り消す ----
const cancelled: ScenarioState = {
  serviceRequest: "revoked",
  task: { status: "cancelled", businessStatus: "received", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "none",
};

export const s1Cancel: Scenario = {
  id: "s1-cancel",
  title: "検体検査（医師が依頼を取り消す）",
  steps: [
    orderStep(1, ["CBC"], "医師 X が血算を依頼"),
    collectStep(2),
    acceptStep(3),
    {
      no: 4,
      title: "医師 X が依頼を取り消す",
      actor: "ehr-doctor",
      target: { screen: "ehr", role: "doctor", control: "cancel-1" },
      run: async (ctx) => cancelOrder(ctx.clients["ehr-doctor"], await currentOrder(ctx, "ehr-doctor"), ctx.now()),
      expected: { ...cancelled, traffic: [post("ehr-doctor")] },
      explanation: {
        business:
          "結果が出る前なら、医師は依頼を取り消せます。依頼は「取消」、検査部の作業も「取消」になります。検査部の一覧にも取消として表示されます。",
        fhir:
          "ServiceRequest（status=revoked）と Task（status=cancelled）を、ifMatch 付きの 1 つの Transaction で更新します。依頼だけ取り消されて作業が残る、という食い違いは起きません。取消後の Task は終了状態なので、以後の更新は 422 で拒否されます。",
      },
    },
  ],
};

// ---- 受付不可（検体不備） ----
const rejected: ScenarioState = {
  serviceRequest: "active",
  task: { status: "rejected", businessStatus: "collected", owner: "Organization/lab-dept" },
  specimen: "collected",
  diagnosticReport: "none",
};

export const s1Reject: Scenario = {
  id: "s1-reject",
  title: "検体検査（検体不備で受付不可）",
  steps: [
    orderStep(1, ["CBC"], "医師 X が血算を依頼"),
    collectStep(2),
    {
      no: 3,
      title: "技師 A が理由を入力して受付不可にする",
      actor: "lis-tech-a",
      target: { screen: "lis", control: "reject-1,reject-reason,reject-confirm" },
      run: async (ctx) => rejectTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "溶血のため再採血が必要", ctx.now()),
      expected: { ...rejected, traffic: [patch] },
      explanation: {
        business:
          "検体に不備（例：溶血）があると、技師は理由を入力して受付不可にします。作業は「受付不可」になりますが、医師の依頼は「有効」のまま残ります。",
        fhir:
          "PATCH /Task/1 で status=rejected と statusReason（理由）を設定します。requested → rejected は許可された遷移です。rejected は終了状態なので、以後この Task は更新できません。",
      },
    },
    {
      no: 4,
      title: "電子カルテに受付不可と理由が表示される",
      actor: "auto",
      target: { screen: "ehr", role: "doctor" },
      expected: {
        ...rejected,
        traffic: [
          { kind: "notification", targetClient: "ehr-doctor" },
          { kind: "http", client: "ehr-doctor", method: "GET", resourceType: "Task" },
        ],
      },
      explanation: {
        business: "医師の電子カルテにも、受付不可と理由が自動で表示されます。再採血などの次の対応を、すぐ判断できます。",
        fhir: "電子カルテの Subscription が Task の更新を検知して ping を送り、画面が Task を GET して statusReason を表示します。",
      },
    },
  ],
};

// ---- 再検 ----
const onHold: ScenarioState = {
  serviceRequest: "active",
  task: { status: "on-hold", businessStatus: "rerun", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "none",
};

export const s1Rerun: Scenario = {
  id: "s1-rerun",
  title: "検体検査（再検）",
  steps: [
    orderStep(1, ["CBC"], "医師 X が血算を依頼"),
    collectStep(2),
    acceptStep(3),
    startStep(4),
    {
      no: 5,
      title: "技師 A が再検を指示",
      actor: "lis-tech-a",
      target: { screen: "lis", control: "rerun-1" },
      run: async (ctx) => rerunTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), ctx.now()),
      expected: { ...onHold, traffic: [patch] },
      explanation: {
        business: "測定結果に疑義があり、測り直すことにします。作業は「保留」、業務上の状態は「再検中」になります。",
        fhir: "PATCH /Task/1 で status=on-hold、businessStatus=rerun に更新します。in-progress → on-hold は許可された遷移です。",
      },
    },
    {
      ...startStep(6),
      title: "技師 A が再検を開始（再開）",
      target: { screen: "lis", control: "resume-1" },
      explanation: {
        business: "再検を始めます。作業は「実施中」、業務上の状態は「測定中」に戻ります。",
        fhir: "PATCH /Task/1 で status=in-progress、businessStatus=measuring に戻します。on-hold → in-progress も許可された遷移です。履歴には、保留を経た版が残ります。",
      },
    },
    reportStep(7, "技師 A が結果を承認・報告", {
      business: "再検の結果を承認して報告します。作業も医師の依頼も「完了」になります。",
      fhir: "Transaction で Observation・DiagnosticReport（final）・Task（completed）・ServiceRequest（completed）を一括登録・更新します。",
    }),
  ],
};

// ---- 一部の結果を先行報告 ----
const partial: ScenarioState = {
  serviceRequest: "active",
  task: { status: "in-progress", businessStatus: "partial-reported", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "partial",
};

export const s1Partial: Scenario = {
  id: "s1-partial",
  title: "検体検査（血算だけ先に報告）",
  steps: [
    orderStep(1, ["CBC", "BIO"], "医師 X が血算・生化学を依頼"),
    collectStep(2),
    acceptStep(3),
    startStep(4),
    {
      no: 5,
      title: "技師 A が血算の結果だけを先に報告",
      actor: "lis-tech-a",
      target: {
        screen: "lis",
        control: "entry-1,result-defaults,item-pick-AST,item-pick-ALT,item-pick-Cre,partial-submit",
      },
      run: async (ctx) =>
        submitPartialReport(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "tech-a", ["WBC", "RBC", "Hb", "Ht", "PLT"], undefined, ctx.now()),
      expected: { ...partial, traffic: [post("lis-tech-a")] },
      explanation: {
        business:
          "血算は先に出るので、先に報告します。医師は血算の結果をすぐ見られます。まだ生化学が残っているので、作業は「実施中」、依頼は「有効」のままです。",
        fhir:
          "Observation（血算 5 項目）と DiagnosticReport（status=partial）を登録し、Task の businessStatus を partial-reported にします。Task.status と ServiceRequest.status は変えません。",
      },
    },
    reportStep(
      6,
      "技師 A が残り（生化学）を報告",
      {
        business: "残りの生化学を報告します。すべての項目が揃ったので、検査報告は「確定」、作業と依頼は「完了」になります。",
        fhir:
          "先行の DiagnosticReport を If-Match 付きの PUT で final に更新し（結果は 8 件に）、Task（completed）と ServiceRequest（completed）も同じ Transaction で更新します。",
      },
      "entry-1,result-defaults,result-submit",
    ),
  ],
};

export const VARIATIONS: Scenario[] = [s1Cancel, s1Reject, s1Rerun, s1Partial];
