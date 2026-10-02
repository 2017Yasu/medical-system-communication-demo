import { expect, test } from "@playwright/test";

// SC-005 / 原則 VII：実行時に外部のネットワーク・CDN に依存しない。
// 全画面を一通り開いて操作し、localhost 以外へのリクエストが 1 件も無いことを確かめる（外部宛ては中断させる）。
test("全画面を操作しても、外部へのリクエストは 0 件で、フォントも手元のものが使われる", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).host;
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || url.host === origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== origin) external.push(ws.url());
  });
  await page.request.post("/demo/reset");

  for (const path of ["/", "/ehr?role=doctor", "/ehr?role=nurse", "/lis?tech=tech-a", "/lis?tech=tech-b", "/monitor", "/control"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // S2：制御パネルの準備ボタンと、2 段階の受付（specs/002）
  await page.goto("/control");
  await page.getByTestId("btn-prepare-s2-2").click();
  await expect(page.getByTestId("prepare-status")).toContainText("の準備ができました", { timeout: 15000 });
  await page.goto("/lis?tech=tech-a");
  await page.getByTestId("task-1").getByRole("button", { name: "受付", exact: true }).click();
  await page.getByTestId("accept-confirm-1").click();
  await expect(page.getByTestId("task-1")).toContainText("受付済み");
  await page.request.post("/demo/reset");
  // ステージビューでシナリオを少し進める
  await page.goto("/stage?mode=presentation");
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("btn-next").click();
    await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 10000 });
  }
  await page.goto("/stage?mode=self-study");
  await expect(page.getByTestId("guide-panel")).toBeVisible();

  expect(external, `外部へのリクエスト: ${external.join(", ")}`).toEqual([]);

  // 日本語フォント（Noto Sans JP）は同梱のものを読み込んでいる
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.family.includes("Noto Sans JP") && f.status === "loaded").length;
  });
  expect(loaded).toBeGreaterThan(0);
});
