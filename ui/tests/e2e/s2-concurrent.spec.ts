// S2 同時受付（specs/002 quickstart §2）：制御パネル・技師 A・技師 B・通信モニタを別々のウィンドウ（ブラウザコンテキスト）で開いて操作する。
import { expect, test, type Page } from "@playwright/test";
import { PageBag } from "./pages";

const SYNC = { timeout: 3000 };
const PREPARED = { timeout: 15_000 };
let bag: PageBag;

test.afterEach(async () => {
  await bag?.closeAll();
});

interface Windows {
  control: Page;
  techA: Page;
  techB: Page;
  monitor: Page;
}

const row = (p: Page) => p.getByTestId("task-1");
const accept = (p: Page) => row(p).getByRole("button", { name: "受付", exact: true });
const confirm = (p: Page) => p.getByTestId("accept-confirm-1");

async function openWindows(browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext): Promise<Windows> {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const control = await bag.open("/control");
  const techA = await bag.open("/lis?tech=tech-a");
  const techB = await bag.open("/lis?tech=tech-b");
  const monitor = await bag.open("/monitor");
  return { control, techA, techB, monitor };
}

async function prepare(w: Windows, id: "s2-1" | "s2-2" | "s2-3") {
  await w.control.getByTestId(`btn-prepare-${id}`).click();
  await expect(w.control.getByTestId("prepare-status")).toContainText("の準備ができました", PREPARED);
  for (const p of [w.techA, w.techB]) {
    await expect(row(p)).toContainText("採取済", PREPARED);
    await expect(accept(p)).toBeEnabled(PREPARED);
  }
}

async function bothBegin(w: Windows) {
  await accept(w.techA).click();
  await accept(w.techB).click();
  await expect(w.techA.getByTestId("accept-draft-1")).toBeVisible(SYNC);
  await expect(w.techB.getByTestId("accept-draft-1")).toBeVisible(SYNC);
  const a = await w.techA.getByTestId("accept-draft-version-1").innerText();
  const b = await w.techB.getByTestId("accept-draft-version-1").innerText();
  expect(a).toBe(b); // 両者が同じ版を読み込んでいる
}

test("S2-1：版の確認が無いと、後から確定した技師 B の内容で上書きされる", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s2-1");
  await expect(w.techA.getByTestId("lab-if-match-mode")).toContainText("付けない（デモ設定）", SYNC);
  await expect(w.techB.getByTestId("lab-if-match-mode")).toContainText("付けない（デモ設定）", SYNC);
  await expect(w.control.getByTestId("policy-if-match-required-off")).toHaveAttribute("aria-pressed", "true");

  await bothBegin(w);
  await confirm(w.techA).click();
  await expect(row(w.techA)).toContainText("受付済み", SYNC);
  await expect(row(w.techB)).toContainText("受付済み", SYNC); // 通知で一覧が更新される
  await expect(w.techB.getByTestId("accept-draft-1")).toBeVisible(); // 技師 B の確認欄は開いたまま

  await confirm(w.techB).click();
  await expect(w.techB.getByRole("alert")).toHaveCount(0); // エラーは出ない
  await expect(row(w.techB)).toContainText("技師 B", SYNC);
  const change = w.techA.getByTestId("row-change-1");
  await expect(change).toContainText("担当：技師 A → 技師 B", SYNC);

  // 通信モニタ：If-Match なしの PATCH が 2 件、どちらも成功し、送信元が区別される
  const diagram = w.monitor.getByTestId("sequence-diagram");
  const patches = diagram.getByRole("button", { name: /PATCH Task\/1（If-Match なし）/ });
  await expect(patches).toHaveCount(2, SYNC);
  await expect(patches.nth(0)).toContainText("技師 A");
  await expect(patches.nth(1)).toContainText("技師 B");
  // 版の履歴：最新の版で担当が強調され、作った画面は「技師 B」
  const history = w.monitor.getByTestId("history-view");
  await expect(history.locator("tbody tr").first()).toContainText("PractitionerRole/tech-b", SYNC);
  await expect(history.locator('[data-testid$="-owner"]').first()).toBeVisible();
  await expect(history.locator('[data-testid^="history-cause-"]').first()).toContainText("技師 B");
});

test("S2-2：版の確認があれば、後から確定した技師 B は 412 で拒否される", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s2-2");
  await expect(w.techA.getByTestId("lab-if-match-mode")).toContainText("版の確認：付ける", SYNC);

  await bothBegin(w);
  await confirm(w.techA).click();
  await expect(row(w.techA)).toContainText("受付済み", SYNC);
  // 技師 A の反映後は、技師 B の行に「受付」ボタンは無い（確認欄は開いたまま）
  await expect(w.techB.getByTestId("accepted-note-1")).toContainText("受付済みです", SYNC);

  await confirm(w.techB).click();
  await expect(w.techB.getByRole("alert")).toContainText("この依頼は既に 技師 A が受付済みです", SYNC);
  await expect(w.techB.getByRole("alert")).toContainText("412 Precondition Failed");
  await expect(w.techB.getByTestId("accept-draft-1")).toHaveCount(0);
  await expect(row(w.techB)).toContainText("技師 A");

  const diagram = w.monitor.getByTestId("sequence-diagram");
  const patches = diagram.getByRole("button", { name: /PATCH Task\/1（If-Match: W\/"\d+"）/ });
  await expect(patches).toHaveCount(2, SYNC);
  const labelA = await patches.nth(0).getAttribute("aria-label");
  const labelB = await patches.nth(1).getAttribute("aria-label");
  expect(labelA!.match(/W\/"\d+"/)![0]).toBe(labelB!.match(/W\/"\d+"/)![0]); // 同じ版の確認で 2 回
  await expect(diagram).toContainText("412 他の利用者が先に更新済み");
  // 技師 B が作った版は無い
  await expect(w.monitor.getByTestId("history-view").locator('[data-testid^="history-cause-"]').first()).toContainText("技師 A");
});

test("S2-2：同時に確定しても、必ず片方だけが成功する", async ({ browser, request }) => {
  const rounds = Number(process.env.S2_REPEAT ?? 5);
  test.setTimeout(60_000 + rounds * 20_000);
  const w = await openWindows(browser, request);
  for (let i = 1; i <= rounds; i++) {
    await prepare(w, "s2-2");
    await bothBegin(w);
    await Promise.all([confirm(w.techA).click(), confirm(w.techB).click()]);
    await expect.poll(async () => (await w.techA.getByRole("alert").count()) + (await w.techB.getByRole("alert").count()), SYNC).toBe(1);
    const alertA = await w.techA.getByRole("alert").count();
    const loser = alertA === 1 ? w.techA : w.techB;
    const winnerName = alertA === 1 ? "技師 B" : "技師 A";
    await expect(loser.getByRole("alert")).toContainText(`この依頼は既に ${winnerName} が受付済みです`, SYNC);
    await expect(row(w.techA)).toContainText(winnerName, SYNC);
    await expect(row(w.techB)).toContainText(winnerName, SYNC);
  }
});

test("S2-3：サーバーが版の確認を必須にしていると、確認の無い更新は 400 で拒否される", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s2-3");
  await expect(w.control.getByTestId("policy-lab-sends-off")).toHaveAttribute("aria-pressed", "true");

  await accept(w.techA).click();
  await confirm(w.techA).click();
  await expect(w.techA.getByRole("alert")).toContainText("版の確認（If-Match）が無い更新はサーバーが受け付けません", SYNC);
  await expect(w.techA.getByRole("alert")).toContainText("400 Bad Request");
  await expect(row(w.techA)).toContainText("依頼済み");
  const diagram = w.monitor.getByTestId("sequence-diagram");
  await expect(diagram.getByRole("button", { name: /PATCH Task\/1（If-Match なし）/ })).toHaveCount(1, SYNC);
  await expect(diagram).toContainText("400 版の確認が必要");

  // サーバーを「任意」に切り替えると、同じ操作が成功する
  await w.control.getByTestId("policy-if-match-required-off").click();
  await expect(w.monitor.getByTestId("sequence-diagram")).toContainText("ポリシーの変更", SYNC);
  await accept(w.techA).click();
  await confirm(w.techA).click();
  await expect(row(w.techA)).toContainText("受付済み", SYNC);
});

test("入口に S2 のウィンドウの一覧があり、S2 の画面には自習モードの案内が出ない", async ({ browser, request }) => {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const home = await bag.open("/");
  const section = home.getByRole("region", { name: "S2 同時受付で開くウィンドウ" });
  await expect(section.getByRole("link")).toHaveCount(4);
  await section.getByRole("link", { name: "デモ制御パネル" }).click();
  await expect(home).toHaveURL(/\/control$/);
  await home.waitForTimeout(600);
  await expect(home.locator("[data-guide-active]")).toHaveCount(0);
  const lis = await bag.open("/lis?tech=tech-a");
  await lis.waitForTimeout(600);
  await expect(lis.locator("[data-guide-active]")).toHaveCount(0);
});
