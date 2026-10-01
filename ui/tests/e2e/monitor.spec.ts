import { expect, test } from "@playwright/test";
import { PageBag } from "./pages";

const SYNC = { timeout: 2000 };

let bag: PageBag;
test.afterEach(async () => bag.closeAll());

test("通信モニタ：通信がシーケンス図に出て、詳細と版の履歴を開ける", async ({ browser, request }) => {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const monitor = await bag.open("/monitor");
  const doctor = await bag.open("/ehr?role=doctor");
  const lis = await bag.open("/lis?tech=tech-a");
  // 各画面が通知を登録して接続するまで待つ（登録の通信も図に出る）
  const diagram = monitor.getByTestId("sequence-diagram");
  await expect(diagram).toContainText("PUT Subscription/ehr-dr-x（通知の登録）", { timeout: 5000 });
  await expect(diagram).toContainText("PUT Subscription/lis-lab-dept（通知の登録）", { timeout: 5000 });
  await monitor.waitForTimeout(500); // bind の完了

  await doctor.getByLabel(/血算/).check();
  await doctor.getByRole("button", { name: "依頼する" }).click();

  // 依頼の Transaction と、検体検査システム・電子カルテへの通知が図に現れる
  await expect(diagram).toContainText("医師 X：POST Transaction（一括登録）", SYNC);
  await expect(diagram).toContainText("ping lis-lab-dept", SYNC);
  await expect(diagram).toContainText("ping ehr-dr-x", SYNC);
  await expect(diagram).toContainText("200 成功");

  // 矢印を選ぶと、要求と応答の中身が見える
  await diagram.getByRole("button", { name: /医師 X POST Transaction/ }).click();
  const detail = monitor.getByTestId("traffic-detail");
  await expect(detail).toContainText("POST /fhir");
  await expect(detail).toContainText("ServiceRequest");
  await expect(detail).toContainText("transaction-response"); // 応答の本文（長い本文は折りたたまれる）

  // 通知の矢印：合図だけで中身は含まない
  await diagram.getByRole("button", { name: /技師 A ping lis-lab-dept/ }).first().click();
  await expect(detail).toContainText("中身は含みません");

  // 自分自身の取得（版の履歴）で通信が増え続けない
  await expect(monitor.getByTestId("history-view")).toContainText("リソースの版の履歴");
  await monitor.waitForTimeout(500);
  const count = async () => (await (await request.get("/demo/traffic")).json()).records.length;
  const before = await count();
  await monitor.waitForTimeout(1500);
  expect(await count()).toBe(before);

  // 受付 → Task の版が増え、履歴から「その版を作った通信」へ辿れる
  const nurse = await bag.open("/ehr?role=nurse");
  await nurse.getByRole("button", { name: "採血を記録" }).click();
  await lis.getByRole("button", { name: "受付" }).click();
  await expect(lis.getByTestId("task-1")).toContainText("受付済み");
  const history = monitor.getByTestId("history-view");
  await expect(history.locator("tbody tr")).toHaveCount(3, SYNC); // 依頼・採血・受付
  await expect(history.locator("tbody tr").first()).toContainText("受付済み");
  await expect(history.locator("tbody tr").first()).toContainText("PractitionerRole/tech-a");
  await history.locator("tbody tr").first().getByRole("button").click();
  await expect(detail).toContainText("PATCH /fhir/Task/1");
  await expect(detail).toContainText("If-Match");

  // 初期化で図が空に戻る
  await request.post("/demo/reset");
  // （開いている他の画面は通知を登録し直すので、その通信は増える。以前の通信が消えて初期化から始まっていることを確認する）
  await expect(diagram).not.toContainText("POST Transaction（一括登録）", SYNC);
  await expect(diagram.getByTestId("seq-1")).toContainText("初期化", SYNC);
});
