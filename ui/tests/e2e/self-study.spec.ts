import { expect, test, type Page } from "@playwright/test";

const ehr = (page: Page) => page.getByRole("region", { name: "電子カルテ" });
const lis = (page: Page) => page.getByRole("region", { name: "検体検査システム" });

async function open(page: Page, request: import("@playwright/test").APIRequestContext) {
  await request.post("/demo/reset");
  await page.goto("/stage?mode=self-study");
  await expect(page.getByTestId("guide-panel")).toBeVisible();
  await expect(page.getByTestId("guide-instruction")).toContainText("医師 X が血算・生化学を依頼", { timeout: 8000 });
  await page.waitForTimeout(1200); // 各領域の通知の登録を待つ
}

/** 強調表示されている（枠が点滅している）要素のうち、操作できるものを 1 つずつ操作する。 */
async function followGuideOnce(page: Page, done: Set<string>) {
  const marked = page.locator('[data-guide-active="true"]');
  const n = await marked.count();
  for (let i = 0; i < n; i++) {
    const el = marked.nth(i);
    const key = (await el.getAttribute("data-guide")) ?? "";
    if (!key || done.has(key)) continue; // 領域の強調（自動のステップ）は操作しない／同じ要素は 1 回だけ
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    if (tag === "select") continue; // 患者は既定のまま
    if (!(await el.isEnabled())) continue;
    done.add(key);
    if (tag === "input") await el.check();
    else await el.click();
    await page.waitForTimeout(150);
  }
}

test("自習モード：強調表示された場所だけを順に操作して、最後まで完了できる", async ({ page, request }) => {
  await open(page, request);
  let step = "";
  let done = new Set<string>();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await page.getByText("最後まで完了しました").isVisible()) break;
    const current = (await page.getByTestId("guide-instruction").innerText().catch(() => "")).split("\n")[0];
    if (current !== step) {
      step = current;
      done = new Set(); // ステップが変わったら、操作済みの記録を捨てる
    }
    await followGuideOnce(page, done);
    await page.waitForTimeout(400);
  }
  await expect(page.getByText("最後まで完了しました")).toBeVisible();
  // 結果の画面まで到達している：8 項目、H が 2 つ
  const result = ehr(page).getByTestId("result-view");
  await expect(result.locator("tbody tr")).toHaveCount(8, { timeout: 5000 });
  await expect(result.locator(".flag-H")).toHaveCount(2);
  await expect(page.getByTestId("guide-done")).toContainText("できました");
  await expect(page.getByTestId("guide-done")).toContainText("FHIR 上の意味");

  // 最初から：初期状態に戻る
  await page.getByTestId("btn-restart").click();
  await expect(ehr(page).getByText("まだ依頼がありません。")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("guide-instruction")).toContainText("医師 X が血算・生化学を依頼", { timeout: 10_000 });
});

test("自習モード：案内と違う操作をすると、案内に戻るよう促される", async ({ page, request }) => {
  await open(page, request);
  // 最初のステップ（依頼）の途中で、案内の対象ではない操作を行う：看護師の画面の「採血を記録」は無いので、
  // 先に依頼を出し、ステップ 3（採血）に進んだところで、医師の画面の「結果を見る」を押す
  await ehr(page).getByLabel(/血算/).check();
  await ehr(page).getByRole("button", { name: "依頼する" }).click();
  await expect(page.getByTestId("guide-instruction")).toContainText("看護師 D が採血を記録", { timeout: 8000 });
  await expect(page.getByTestId("guide-nudge")).toHaveCount(0);
  // 看護師の画面に切り替わっている（案内が役割を指定する）
  await expect(ehr(page).getByRole("button", { name: "採血を記録" })).toHaveAttribute("data-guide-active", "true", { timeout: 3000 });
  await ehr(page).getByRole("button", { name: "医師 X" }).click();
  await ehr(page).getByRole("button", { name: "結果を見る" }).click(); // 案内の対象ではない
  await expect(page.getByTestId("guide-nudge")).toContainText("看護師 D が採血を記録");
  await expect(page.getByTestId("guide-nudge")).toContainText("強調表示されている部分");
  // 案内どおりの操作に戻って進めると、促しは消える
  await ehr(page).getByRole("button", { name: "看護師 D" }).click();
  await ehr(page).getByRole("button", { name: "採血を記録" }).click();
  await expect(page.getByTestId("guide-instruction")).toContainText("技師 A が検体を受付", { timeout: 8000 });
  await expect(page.getByTestId("guide-nudge")).toHaveCount(0);
});
