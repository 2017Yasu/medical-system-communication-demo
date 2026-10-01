// S1 検体検査ワークフロー（docs/02-demo-scenarios.md S1、contracts/ui-screens.md「ステップの判定」の表）。
import type { DiagnosticReport, Observation } from "fhir/r4";
import { fetchLatestOrder, acceptTask, placeOrder, recordCollection, startTask, submitFinalReport } from "../fhir/labActions";
import { requestShowResult } from "./events";
import type { Scenario, ScenarioContext, ScenarioState } from "./types";

const requested: ScenarioState = {
  serviceRequest: "active",
  task: { status: "requested", businessStatus: "not-collected", owner: "Organization/lab-dept" },
  specimen: "not-collected",
  diagnosticReport: "none",
};
const collected: ScenarioState = {
  serviceRequest: "active",
  task: { status: "requested", businessStatus: "collected", owner: "Organization/lab-dept" },
  specimen: "collected",
  diagnosticReport: "none",
};
const accepted: ScenarioState = {
  serviceRequest: "active",
  task: { status: "accepted", businessStatus: "received", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "none",
};
const measuring: ScenarioState = {
  serviceRequest: "active",
  task: { status: "in-progress", businessStatus: "measuring", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "none",
};
const reported: ScenarioState = {
  serviceRequest: "completed",
  task: { status: "completed", businessStatus: "reported", owner: "PractitionerRole/tech-a" },
  specimen: "collected",
  diagnosticReport: "final",
};

async function currentOrder(ctx: ScenarioContext, client: "ehr-doctor" | "ehr-nurse" | "lis-tech-a") {
  const order = await fetchLatestOrder(ctx.clients[client]);
  if (!order) throw new Error("対象の依頼が見つかりません（先のステップが完了していません）");
  return order;
}

export const s1Main: Scenario = {
  id: "s1-main",
  title: "検体検査（通常の流れ）",
  steps: [
    {
      no: 1,
      title: "医師 X が血算・生化学を依頼",
      actor: "ehr-doctor",
      target: { screen: "ehr", control: "order-set-CBC,order-set-BIO,order-submit" },
      run: (ctx) => placeOrder(ctx.clients["ehr-doctor"], "demo-taro", ["CBC", "BIO"], ctx.now()),
      expected: { ...requested, traffic: [{ kind: "http", client: "ehr-doctor", method: "POST", resourceType: "Bundle" }] },
      explanation: {
        business:
          "医師 X が電子カルテで、患者「デモ 太郎」の血算と生化学を依頼します。「検査の指示」と、検査部が行う「作業」、採取する「検体」が、一度にまとめて登録されます。",
        fhir:
          "POST /fhir（Transaction Bundle）で ServiceRequest（status=active）、Task（status=requested、owner=検査部）、Specimen を作成します。全部成功か全部失敗か（アトミック）なので、依頼だけが残ることはありません。",
      },
    },
    {
      no: 2,
      title: "検査部の画面に新着依頼が届く",
      actor: "auto",
      target: { screen: "lis" },
      expected: {
        ...requested,
        traffic: [
          { kind: "notification", targetClient: "lis-tech-a" },
          { kind: "http", client: "lis-tech-a", method: "GET", resourceType: "Task" },
        ],
      },
      explanation: {
        business:
          "検査部の画面に、新しい依頼が自動で現れます（画面の更新操作は不要です）。まだ検体が採取されていないので、受付はできません。",
        fhir:
          "サーバーが、検査部の Subscription（criteria: Task?owner=…）に合う Task の作成を検知し、ping だけを送ります。ping を受けた画面が Task を GET して中身を取りに行きます（通信モニタで確認できます）。",
      },
    },
    {
      no: 3,
      title: "看護師 D が採血を記録",
      actor: "ehr-nurse",
      target: { screen: "ehr", control: "collect-1" },
      run: async (ctx) => recordCollection(ctx.clients["ehr-nurse"], await currentOrder(ctx, "ehr-nurse"), ctx.now()),
      expected: { ...collected, traffic: [{ kind: "http", client: "ehr-nurse", method: "POST", resourceType: "Bundle" }] },
      explanation: {
        business:
          "看護師 D が採血し、電子カルテに記録します。検体に採取者と採取日時が入り、作業の業務上の状態が「採取済」になります。医師の「依頼」は有効のまま、作業の「依頼済み」も変わりません。",
        fhir:
          "Specimen（collection）と Task（businessStatus=collected）を、ifMatch 付きの Transaction で一括更新します。Task.status は requested のまま。status（インフラ的な状態）と businessStatus（業務上の細かい状態）は別です。",
      },
    },
    {
      no: 4,
      title: "技師 A が検体を受付",
      actor: "lis-tech-a",
      target: { screen: "lis", control: "accept-1" },
      run: async (ctx) => acceptTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "tech-a", ctx.now()),
      expected: { ...accepted, traffic: [{ kind: "http", client: "lis-tech-a", method: "PATCH", resourceType: "Task" }] },
      explanation: {
        business:
          "臨床検査技師 A が検体を受け付けます。作業は「受付済み」になり、担当者が技師 A に変わります。",
        fhir:
          "PATCH /Task/1 に If-Match を付け、status=accepted、businessStatus=received、owner=PractitionerRole/tech-a を 1 回で更新します。If-Match により、他の人が先に更新していれば 412 で拒否されます（Lost Update の防止）。",
      },
    },
    {
      no: 5,
      title: "電子カルテに「受付済み」と表示",
      actor: "auto",
      target: { screen: "ehr" },
      expected: {
        ...accepted,
        traffic: [
          { kind: "notification", targetClient: "ehr-doctor" },
          { kind: "http", client: "ehr-doctor", method: "GET", resourceType: "Task" },
        ],
      },
      explanation: {
        business:
          "医師の電子カルテにも、「受付済み」と担当者が自動で表示されます。医師は検査部に問い合わせなくても、進み具合が分かります。",
        fhir:
          "電子カルテの Subscription（criteria: Task?requester=Practitioner/dr-x）が Task の更新を検知して ping を送り、画面が Task を GET します。依頼（ServiceRequest）は active のまま、進んでいるのは Task だけです。",
      },
    },
    {
      no: 6,
      title: "技師 A が測定を開始",
      actor: "lis-tech-a",
      target: { screen: "lis", control: "start-1" },
      run: async (ctx) => startTask(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), ctx.now()),
      expected: { ...measuring, traffic: [{ kind: "http", client: "lis-tech-a", method: "PATCH", resourceType: "Task" }] },
      explanation: {
        business: "測定を始めます。作業は「実施中」、業務上の状態は「測定中」になります。医師の依頼は「有効（依頼中）」のままです。",
        fhir: "PATCH /Task/1 で status=in-progress、businessStatus=measuring に更新します。ServiceRequest.status は active のままです（認可の状態と履行の状態は別）。",
      },
    },
    {
      no: 7,
      title: "技師 A が結果を承認・報告",
      actor: "lis-tech-a",
      target: { screen: "lis", control: "entry-1,result-defaults,result-submit" },
      run: async (ctx) => submitFinalReport(ctx.clients["lis-tech-a"], await currentOrder(ctx, "lis-tech-a"), "tech-a", undefined, ctx.now()),
      expected: { ...reported, traffic: [{ kind: "http", client: "lis-tech-a", method: "POST", resourceType: "Bundle" }] },
      explanation: {
        business:
          "全項目の結果を承認して報告します。結果が確定すると、作業も医師の依頼も自動で「完了」になります。",
        fhir:
          "Transaction Bundle で、Observation × 8、DiagnosticReport（final）、Task（completed、output → DiagnosticReport）、ServiceRequest（completed）を一括登録・更新します。結果はあるのに依頼が未完了、といった食い違いは起きません。",
      },
    },
    {
      no: 8,
      title: "医師 X が結果を確認",
      actor: "ehr-doctor",
      target: { screen: "ehr", control: "view-result-1" },
      run: async (ctx) => {
        const order = await currentOrder(ctx, "ehr-doctor");
        const id = order.sr.resource.id!;
        await Promise.all([
          ctx.clients["ehr-doctor"].search<DiagnosticReport>("DiagnosticReport", { "based-on": `ServiceRequest/${id}` }),
          ctx.clients["ehr-doctor"].search<Observation>("Observation", { "based-on": `ServiceRequest/${id}` }),
        ]);
        requestShowResult();
      },
      expected: { ...reported, traffic: [{ kind: "http", client: "ehr-doctor", method: "GET", resourceType: "DiagnosticReport" }] },
      explanation: {
        business:
          "医師が電子カルテで結果を確認します。各項目の値・単位・基準値が表示され、基準値を外れた項目には H（高い）または L（低い）が付きます。",
        fhir:
          "電子カルテが DiagnosticReport と Observation を検索して取得します。基準値は Observation.referenceRange、判定は Observation.interpretation（H/L/N）に入っています。",
      },
    },
  ],
};
