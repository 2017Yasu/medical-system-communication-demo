import { expect, test, type Page } from "@playwright/test";

const SYNC = { timeout: 3000 };

const ehr = (page: Page) => page.getByRole("region", { name: "電子カルテ" });
const lis = (page: Page) => page.getByRole("region", { name: "検体検査システム" });
const monitor = (page: Page) => page.getByRole("region", { name: "通信モニタ" });

async function open(page: Page, request: import("@playwright/test").APIRequestContext) {
  await request.post("/demo/reset");
  await page.goto("/stage?mode=presentation");
  await expect(page.getByTestId("progress-panel")).toBeVisible();
  await expect(page.getByTestId("btn-next")).toBeEnabled();
  await page.waitForTimeout(1200); // 各領域の通知の登録と進行パネルの開始を待つ
}

const next = async (page: Page, no: number) => {
  await page.getByTestId("btn-next").click();
  await expect(page.getByTestId("explanation")).toContainText(`ステップ ${no}：`, { timeout: 8000 });
  await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 8000 });
};

test("講演モード：「次へ」を 8 回押して S1 を最後まで進め、「戻る」と「初期化」を使う", async ({ page, request }) => {
  await open(page, request);
  const doctorRow = ehr(page).getByTestId("order-1");

  // 1. 依頼
  await next(page, 1);
  await expect(doctorRow).toContainText("依頼済み");
  await expect(doctorRow).toContainText("未採取");
  await expect(doctorRow).toContainText("デモ 太郎");
  await expect(page.getByTestId("explanation")).toContainText("業務上の意味");
  await expect(page.getByTestId("explanation")).toContainText("FHIR 上の意味");
  // 2. 新着（自動）：検査部の画面には既に出ていて、通知が届いたことが完了条件
  await next(page, 2);
  await expect(lis(page).getByTestId("task-1")).toContainText("未採取");
  await expect(monitor(page).getByTestId("sequence-diagram")).toContainText("ping lis-lab-dept");
  // 3. 採血
  await next(page, 3);
  await expect(doctorRow).toContainText("採取済", SYNC);
  // 4. 受付 / 5. 電子カルテの表示（自動）
  await next(page, 4);
  await expect(lis(page).getByTestId("task-1")).toContainText("受付済み");
  await next(page, 5);
  await expect(doctorRow).toContainText("受付済み", SYNC);
  await expect(doctorRow).toContainText("技師 A");
  // 6. 測定開始
  await next(page, 6);
  await expect(doctorRow).toContainText("実施中", SYNC);
  // 7. 結果報告
  await next(page, 7);
  await expect(doctorRow).toContainText("報告済", SYNC);
  // 8. 結果確認
  await next(page, 8);
  const result = ehr(page).getByTestId("result-view");
  await expect(result.locator("tbody tr")).toHaveCount(8, SYNC);
  await expect(result.locator(".flag-H")).toHaveCount(2);
  await expect(page.getByTestId("btn-next")).toBeDisabled();
  await expect(page.getByTestId("btn-next")).toContainText("完了");

  // 戻る：ステップ 7 完了時点の状態を再現する
  await page.getByTestId("btn-back").click();
  await expect(page.getByTestId("explanation")).toContainText("ステップ 7：", { timeout: 20000 });
  await expect(page.getByTestId("step-8")).toHaveAttribute("aria-current", "step");
  await expect(ehr(page).getByTestId("order-1")).toContainText("報告済", SYNC);
  await expect(monitor(page).getByTestId("sequence-diagram")).toContainText("初期化");

  // 初期化：10 秒以内に初期状態に戻る（SC-003）
  const t0 = Date.now();
  await page.getByTestId("btn-reset").click();
  await expect(ehr(page).getByText("まだ依頼がありません。")).toBeVisible({ timeout: 10000 });
  expect(Date.now() - t0).toBeLessThan(10000);
  await expect(page.getByTestId("step-1")).toHaveAttribute("aria-current", "step", { timeout: 10000 });
});

test("講演モード：講演者が画面を直接操作しても、進み具合に追従する", async ({ page, request }) => {
  await open(page, request);
  await ehr(page).getByLabel(/血算/).check();
  await ehr(page).getByRole("button", { name: "依頼する" }).click();
  // 依頼（ステップ 1）と、通知による自動反映（ステップ 2）が完了して、次はステップ 3
  await expect(page.getByTestId("step-3")).toHaveAttribute("aria-current", "step", { timeout: 8000 });
  await expect(page.getByTestId("explanation")).toContainText("ステップ 2：");
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
  test(`ステージビューは ${size.width}×${size.height} で横スクロール無しに 3 つの領域が収まる`, async ({ page, request }) => {
    await page.setViewportSize(size);
    await open(page, request);
    await page.getByTestId("btn-next").click();
    await expect(page.getByTestId("explanation")).toBeVisible({ timeout: 8000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const r of [ehr(page), lis(page), monitor(page)]) {
      const box = await r.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
      expect(box!.height).toBeGreaterThan(150);
    }
  });
}
