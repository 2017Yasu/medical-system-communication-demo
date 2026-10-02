import { expect, test } from "@playwright/test";
import { PageBag, acceptOn } from "./pages";

let bag: PageBag;
test.afterEach(async () => bag.closeAll());

// SC-002：操作の結果は、関係する他の画面に 2 秒以内に反映される
const SYNC = { timeout: 2000 };

test("S1 を 3 つの画面で手動操作して最後まで通す", async ({ browser, request }) => {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const doctor = await bag.open("/ehr?role=doctor");
  const nurse = await bag.open("/ehr?role=nurse");
  const lis = await bag.open("/lis?tech=tech-a");
  await expect(doctor.getByRole("heading", { name: "検体検査を依頼する" })).toBeVisible();
  await expect(doctor.getByRole("button", { name: "依頼する" })).toBeDisabled(); // セット未選択

  // 1. 医師が血算・生化学を依頼
  await doctor.getByLabel(/血算/).check();
  await doctor.getByLabel(/生化学/).check();
  await doctor.getByRole("button", { name: "依頼する" }).click();
  const docRow = doctor.getByTestId("order-1");
  await expect(docRow).toContainText("有効（依頼中）");
  await expect(docRow).toContainText("依頼済み");
  await expect(docRow).toContainText("未採取");
  await expect(docRow).toContainText("デモ 太郎");
  await expect(docRow).toContainText("血算・生化学");

  // 2. 検査部の画面に、通知で新着依頼が現れる（受付はまだできない）
  const lisRow = lis.getByTestId("task-1");
  await expect(lisRow).toContainText("未採取", SYNC);
  await expect(lisRow.getByRole("button", { name: "受付", exact: true })).toBeDisabled();
  await expect(lisRow).toContainText("採血の記録後に受付できます");

  // 3. 看護師が採血を記録（作業の状態「依頼済み」と依頼の状態「有効」は変わらない）
  await expect(nurse.getByTestId("collect-1")).toBeVisible(SYNC);
  await nurse.getByRole("button", { name: "採血を記録" }).click();
  await expect(nurse.getByText("採血待ちの依頼はありません。")).toBeVisible(SYNC);
  await expect(docRow).toContainText("採取済", SYNC);
  await expect(docRow).toContainText("依頼済み");
  await expect(docRow).toContainText("有効（依頼中）");
  await expect(lisRow.getByRole("button", { name: "受付", exact: true })).toBeEnabled(SYNC);

  // 4. 技師 A が受付 → 電子カルテにも「受付済み」と担当者が出る
  await acceptOn(lisRow);
  await expect(lisRow).toContainText("受付済み");
  await expect(lisRow).toContainText("検体到着");
  await expect(docRow).toContainText("受付済み", SYNC);
  await expect(docRow).toContainText("検体到着");
  await expect(docRow).toContainText("技師 A");

  // 6. 測定開始
  await lisRow.getByRole("button", { name: "測定開始" }).click();
  await expect(docRow).toContainText("実施中", SYNC);
  await expect(docRow).toContainText("測定中");
  await expect(docRow).toContainText("有効（依頼中）"); // 結果報告までは依頼は有効のまま

  // 7. 結果を承認・報告
  await lisRow.getByRole("button", { name: "結果入力" }).click();
  await expect(lis.getByRole("button", { name: "承認・報告" })).toBeDisabled();
  await lis.getByRole("button", { name: "既定値を入れる" }).click();
  await lis.getByRole("button", { name: "承認・報告" }).click();
  await expect(lisRow).toContainText("完了");
  await expect(docRow).toContainText("報告済", SYNC);
  await expect(docRow.locator("td").nth(1)).toContainText("完了", SYNC); // 依頼の状態
  await expect(docRow.locator("td").nth(2)).toContainText("完了"); // 作業の状態

  // 8. 医師が結果を確認：8 項目、白血球数と ALT に H
  await docRow.getByRole("button", { name: "結果を見る" }).click();
  const result = doctor.getByTestId("result-view");
  await expect(result).toContainText("確定");
  await expect(result.locator("tbody tr")).toHaveCount(8);
  await expect(result.locator(".flag-H")).toHaveCount(2);
  await expect(result.locator("tr", { hasText: "白血球数" })).toContainText("9.8");
  await expect(result.locator("tr", { hasText: "白血球数" })).toContainText("3.3–8.6");
  await expect(result.locator("tr", { hasText: "ALT" }).locator(".flag-H")).toHaveCount(1);
});

test("2 つの検体検査システムの画面が、片方の受付を通知で受けて同期する", async ({ browser, request }) => {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const doctor = await bag.open("/ehr?role=doctor");
  const nurse = await bag.open("/ehr?role=nurse");
  const techA = await bag.open("/lis?tech=tech-a");
  const techB = await bag.open("/lis?tech=tech-b");
  await doctor.getByLabel(/血算/).check();
  await doctor.getByRole("button", { name: "依頼する" }).click();
  await expect(nurse.getByTestId("collect-1")).toBeVisible(SYNC);
  await nurse.getByRole("button", { name: "採血を記録" }).click();
  const rowA = techA.getByTestId("task-1");
  const rowB = techB.getByTestId("task-1");
  await expect(rowA.getByRole("button", { name: "受付", exact: true })).toBeEnabled(SYNC);
  await expect(rowB.getByRole("button", { name: "受付", exact: true })).toBeEnabled(SYNC);

  // 技師 A が受付すると、技師 B の画面も通知で更新され、受付ボタンが消える（同時操作の事故の再現は S2）
  await acceptOn(rowA);
  await expect(rowA).toContainText("受付済み");
  await expect(rowB).toContainText("受付済み", SYNC); // 技師 B の画面も通知で更新される
  await expect(rowB.getByRole("button", { name: "受付", exact: true })).toHaveCount(0);
  await expect(rowB).toContainText("技師 A");
});
