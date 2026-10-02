// S3 予約枠の取り合い（specs/003 quickstart §2）：制御パネル・医師 X・医師 Y・放射線部門システム・通信モニタを別々のウィンドウ（ブラウザコンテキスト）で開いて操作する。
import { expect, test, type Browser, type APIRequestContext, type Page } from "@playwright/test";
import { bookDirectOn, confirmOn, holdOn, PageBag, selectSlotOn } from "./pages";

const SYNC = { timeout: 4000 };
const PREPARED = { timeout: 15_000 };
const SLOT = "ct1-1000";
let bag: PageBag;

test.afterEach(async () => {
  await bag?.closeAll();
});

interface Windows {
  control: Page;
  doctorX: Page;
  doctorY: Page;
  ris: Page;
  monitor: Page;
}

async function openWindows(browser: Browser, request: APIRequestContext): Promise<Windows> {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const control = await bag.open("/control");
  const doctorX = await bag.open("/ehr/ct?doctor=dr-x");
  const doctorY = await bag.open("/ehr/ct?doctor=dr-y");
  const ris = await bag.open("/ris");
  const monitor = await bag.open("/monitor");
  return { control, doctorX, doctorY, ris, monitor };
}

async function prepare(w: Windows, id: "s3-1" | "s3-2" | "s3-3") {
  await w.control.getByTestId(`btn-prepare-${id}`).click();
  await expect(w.control.getByTestId("prepare-status")).toContainText("の準備ができました", PREPARED);
  for (const p of [w.doctorX, w.doctorY]) {
    await expect(p.getByTestId(`slot-row-${SLOT}`)).toContainText("空き", PREPARED);
    await expect(p.getByTestId(`slot-select-${SLOT}`)).toBeEnabled(PREPARED);
  }
}

test("S3-1：枠を確認せずに予約すると、同じ枠に予約が 2 件できる（二重予約）", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-1");
  await expect(w.doctorX.getByTestId("ct-booking-mode")).toContainText("直接予約する（デモ設定）", SYNC);
  await expect(w.doctorY.getByTestId("ct-booking-mode")).toContainText("直接予約する（デモ設定）", SYNC);
  await expect(w.control.getByTestId("policy-slot-hold-off")).toHaveAttribute("aria-pressed", "true");
  // 初期データ：9:00・11:00 は予約済み
  await expect(w.doctorX.getByTestId("slot-row-ct1-0900")).toContainText("予約済み");
  await expect(w.ris.getByTestId("ris-slot-ct1-1100")).toContainText("デモ 桜子", SYNC);

  await selectSlotOn(w.doctorX, SLOT);
  await selectSlotOn(w.doctorY, SLOT);
  await expect(w.doctorX.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);
  await expect(w.doctorY.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);
  expect(await w.doctorX.getByTestId("booking-slot").innerText()).toBe(await w.doctorY.getByTestId("booking-slot").innerText());

  await bookDirectOn(w.doctorX);
  await expect(w.doctorX.getByTestId("booking-result")).toContainText("予約しました", SYNC);
  await expect(w.doctorX.getByTestId(`slot-row-${SLOT}`)).toContainText("空き");
  await expect(w.ris.getByTestId(`ris-slot-${SLOT}`)).toContainText("デモ 太郎", SYNC);
  await expect(w.ris.getByTestId(`ris-slot-${SLOT}`)).toContainText("枠は空きのまま");

  // 医師 Y の予約欄は、医師 X の予約が通知で届いても開いたまま・版も変わらない
  await expect(w.doctorY.getByTestId("booking-draft")).toBeVisible();
  await expect(w.doctorY.getByTestId("booking-slot")).toContainText('版 1（W/"1"）');
  await bookDirectOn(w.doctorY);
  await expect(w.doctorY.getByTestId("booking-result")).toContainText("予約しました", SYNC);
  await expect(w.doctorY.getByRole("alert")).toHaveCount(0); // 警告は出ない
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("空き");

  // 放射線部門システム：同じ枠に 2 件の予約
  await expect(w.ris.getByTestId(`ris-slot-${SLOT}`)).toContainText("デモ 花子", SYNC);
  await expect(w.ris.getByTestId(`ris-double-booking-${SLOT}`)).toContainText("同じ枠に予約が 2 件あります", SYNC);
  await expect(w.ris.getByTestId("ris-orders").locator("tr[data-testid^=ris-order-]")).toHaveCount(4, SYNC); // 初期 2 件 + 2 件
  await expect(w.ris.getByTestId("ris-orders")).toContainText("医師 X");
  await expect(w.ris.getByTestId("ris-orders")).toContainText("医師 Y");

  // 通信モニタ：枠の更新を含まない一括送信が 2 件、どちらも成功
  const diagram = w.monitor.getByTestId("sequence-diagram");
  await expect(diagram).toContainText("医師 X：POST Transaction（一括登録）", SYNC);
  await expect(diagram).toContainText("医師 Y：POST Transaction（一括登録）", SYNC);
  await expect(diagram).not.toContainText("枠の版の確認あり");
  await diagram.locator('[role="button"]', { hasText: "医師 Y：POST Transaction" }).click();
  const entries = w.monitor.getByTestId("transaction-entries");
  await expect(entries).toContainText("POST Appointment", SYNC);
  await expect(entries).not.toContainText("PUT Slot");
  await expect(entries).toContainText("201 Created");

  // 枠の版の履歴：版 1（空き）だけ
  await w.monitor.getByLabel("リソース").selectOption(`Slot/${SLOT}`);
  await expect(w.monitor.getByTestId("history-view")).toContainText("空き", SYNC);
  await expect(w.monitor.getByTestId("history-view").locator("tbody tr")).toHaveCount(1, SYNC);
});

test("S3-2：仮押さえ → 確定なら、先に押さえた医師 X だけが予約できる（後発の医師 Y は 412）", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-2");
  await expect(w.doctorX.getByTestId("ct-booking-mode")).toContainText("仮押さえを使う（期限 30 秒）", SYNC);
  await expect(w.doctorY.getByTestId("ct-booking-mode")).toContainText("仮押さえを使う（期限 30 秒）", SYNC);
  // 予約済みの枠（初期データの 9:00）は、仮押さえを使う方式では選べない
  await expect(w.doctorX.getByTestId("slot-row-ct1-0900")).toContainText("予約済み");
  await expect(w.doctorX.getByTestId("slot-select-ct1-0900")).toBeDisabled();

  await selectSlotOn(w.doctorX, SLOT);
  await selectSlotOn(w.doctorY, SLOT);
  await expect(w.doctorX.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);
  await expect(w.doctorY.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);

  await holdOn(w.doctorX);
  await expect(w.doctorX.getByTestId("booking-remaining")).toContainText("確定までの残り", SYNC);
  for (const p of [w.doctorX, w.doctorY, w.ris]) {
    await expect(p.locator(`[data-testid=slot-row-${SLOT}], [data-testid=ris-slot-${SLOT}]`)).toContainText("仮押さえ中 busy-tentative（医師 X）", SYNC);
  }
  // 医師 Y の予約欄は、医師 X の仮押さえが通知で届いても開いたまま（版 1 のまま）
  await expect(w.doctorY.getByTestId("booking-slot")).toContainText('版 1（W/"1"）');

  await holdOn(w.doctorY);
  await expect(w.doctorY.getByTestId("error-banner")).toContainText("この枠は 医師 X が仮押さえ中です。別の枠を選んでください", SYNC);
  await expect(w.doctorY.getByTestId("error-banner")).toContainText("412 Precondition Failed");
  await expect(w.doctorY.getByTestId("booking-draft")).toHaveCount(0); // 自動でやり直さず、予約欄は閉じる
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("仮押さえ中 busy-tentative（医師 X）");

  // 通信モニタ：同じ If-Match: W/"1" の PUT が 2 件、後の 1 件が 412
  const diagram = w.monitor.getByTestId("sequence-diagram");
  await expect(diagram).toContainText('医師 X：PUT Slot/ct1-1000（If-Match: W/"1"）', SYNC);
  await expect(diagram).toContainText('医師 Y：PUT Slot/ct1-1000（If-Match: W/"1"）', SYNC);
  await expect(diagram).toContainText("412 他の利用者が先に更新済み", SYNC);

  await confirmOn(w.doctorX);
  await expect(w.doctorX.getByTestId("booking-result")).toContainText("予約しました", SYNC);
  await expect(w.doctorX.getByTestId(`slot-row-${SLOT}`)).toContainText("予約済み", SYNC);
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("予約済み", SYNC);
  await expect(w.ris.getByTestId(`ris-slot-${SLOT}`)).toContainText("デモ 太郎", SYNC);
  await expect(w.ris.getByTestId(`ris-double-booking-${SLOT}`)).toHaveCount(0);
  const order = w.ris.getByTestId("ris-orders");
  await expect(order).toContainText("医師 X", SYNC);
  await expect(order).toContainText("依頼済み requested・予約済み");

  // 通信モニタ：一括送信に枠の版の確認が含まれる
  await diagram.locator('[role="button"]', { hasText: "医師 X：POST Transaction（一括登録・枠の版の確認あり）" }).click();
  const entries = w.monitor.getByTestId("transaction-entries");
  await expect(entries).toContainText('ifMatch: W/"2"', SYNC);
  await expect(entries).toContainText("200 OK → Slot/ct1-1000");

  // 版の履歴：版 1 空き → 版 2 仮押さえ中 busy-tentative（医師 X）→ 版 3 予約済み。医師 Y による版は無い
  await w.monitor.getByLabel("リソース").selectOption(`Slot/${SLOT}`);
  const history = w.monitor.getByTestId("history-view");
  await expect(history.locator("tbody tr")).toHaveCount(3, SYNC);
  await expect(history).toContainText("医師 X");
  await expect(history.getByTestId("history-cause-3")).toContainText("医師 X", SYNC);
  await expect(history.getByTestId("history-cause-2")).toContainText("医師 X");
});

test("S3-2：仮押さえを取りやめると、枠が空きに戻ってほかの医師が押さえられる", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-2");
  await selectSlotOn(w.doctorX, SLOT);
  await holdOn(w.doctorX);
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("仮押さえ中 busy-tentative（医師 X）", SYNC);
  await w.doctorX.getByTestId("booking-cancel").click();
  await expect(w.doctorX.getByTestId("booking-draft")).toHaveCount(0, SYNC);
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("空き", SYNC);
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).not.toContainText(/仮押さえ中 busy-tentative（/);
  await selectSlotOn(w.doctorY, SLOT);
  await holdOn(w.doctorY);
  await expect(w.doctorY.getByTestId("booking-remaining")).toContainText("確定までの残り", SYNC);
  await expect(w.doctorX.getByTestId(`slot-row-${SLOT}`)).toContainText("仮押さえ中 busy-tentative（医師 Y）", SYNC);
});

test("S3-2：同時に仮押さえを送ると、必ずどちらか一方だけが成功する", async ({ browser, request }) => {
  const repeat = Number(process.env.S3_REPEAT ?? 5);
  test.setTimeout(60_000 + repeat * 15_000);
  const w = await openWindows(browser, request);
  for (let i = 1; i <= repeat; i++) {
    await prepare(w, "s3-2");
    await selectSlotOn(w.doctorX, SLOT);
    await selectSlotOn(w.doctorY, SLOT);
    await expect(w.doctorX.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);
    await expect(w.doctorY.getByTestId("booking-slot")).toContainText('版 1（W/"1"）', SYNC);

    await Promise.all([holdOn(w.doctorX), holdOn(w.doctorY)]);
    const xHeld = w.doctorX.getByTestId("booking-remaining");
    const yHeld = w.doctorY.getByTestId("booking-remaining");
    const xFailed = w.doctorX.getByTestId("error-banner");
    const yFailed = w.doctorY.getByTestId("error-banner");
    // 片方のウィンドウにだけ「仮押さえ中」の残り時間、もう片方にだけ 412 の文言
    await expect(xHeld.or(xFailed), `run ${i}: 医師 X`).toBeVisible({ timeout: 8000 });
    try {
      await expect(yHeld.or(yFailed), `run ${i}: 医師 Y`).toBeVisible({ timeout: 8000 });
    } catch (e) {
      // 診断：サーバーが受けた医師 X・医師 Y の PUT
      const traffic = (await (await request.get("/demo/traffic")).json()).records as { client: string; request?: { method: string }; response?: { status: number } }[];
      const puts = traffic.filter((r) => r.request?.method === "PUT").map((r) => `${r.client}:${r.response?.status}`);
      throw new Error(`run ${i}: 医師 Y の結果が出ない。サーバーが受けた PUT = ${JSON.stringify(puts)}\n${String(e)}`);
    }
    const xWon = await xHeld.isVisible();
    const yWon = await yHeld.isVisible();
    expect(xWon !== yWon, `run ${i}: ちょうど片方だけが成功する`).toBe(true);
    const loser = xWon ? yFailed : xFailed;
    await expect(loser).toContainText("412 Precondition Failed", SYNC);
    await expect(loser).toContainText(`この枠は ${xWon ? "医師 X" : "医師 Y"} が仮押さえ中です`, SYNC);
    await expect(w.ris.getByTestId(`ris-slot-${SLOT}`)).toContainText(`仮押さえ中 busy-tentative（${xWon ? "医師 X" : "医師 Y"}）`, SYNC);
  }
});

test("S3-3：仮押さえを放置すると期限切れで枠が戻り、遅れた確定は一括送信の全体が 412 で取り消される", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-3");
  // 手順書の 30 秒は手で確認する。ここでは API で 2 秒に縮める
  expect((await request.put("/demo/policy", { data: { slotHoldSeconds: 2 } })).ok()).toBe(true);
  await expect(w.doctorX.getByTestId("ct-booking-mode")).toContainText("期限 2 秒", SYNC);

  await selectSlotOn(w.doctorX, SLOT);
  await holdOn(w.doctorX);
  await expect(w.doctorX.getByTestId("booking-remaining")).toContainText("確定までの残り", SYNC);
  await expect(w.doctorY.getByTestId(`slot-row-${SLOT}`)).toContainText("仮押さえ中 busy-tentative（医師 X）", SYNC);

  // 期限を過ぎると、全ウィンドウの枠が空きに戻る（医師 X の予約欄は開いたまま）
  for (const [p, id] of [[w.doctorX, `slot-row-${SLOT}`], [w.doctorY, `slot-row-${SLOT}`], [w.ris, `ris-slot-${SLOT}`]] as const) {
    await expect(p.getByTestId(id)).toContainText("空き free", { timeout: 8000 });
    await expect(p.getByTestId(id)).not.toContainText(/仮押さえ中 busy-tentative（/);
  }
  await expect(w.doctorX.getByTestId("booking-remaining")).toContainText("期限切れ（サーバーの処理を待っています）", SYNC);
  await expect(w.doctorX.getByTestId("booking-draft")).toBeVisible();

  // 通信モニタ：FHIR サーバー（仮押さえの期限切れ）の記録
  const diagram = w.monitor.getByTestId("sequence-diagram");
  await expect(diagram).toContainText("FHIR サーバー（仮押さえの期限切れ）", SYNC);
  await expect(diagram).toContainText("仮押さえの期限切れ Slot/ct1-1000（仮押さえ中 → 空き、版 2 → 3）", SYNC);
  await diagram.locator('[role="button"]', { hasText: "仮押さえの期限切れ Slot/ct1-1000" }).click();
  const detail = w.monitor.getByTestId("server-action-detail");
  await expect(detail).toContainText("サーバーの規則による自動の更新です（期限 2 秒）", SYNC);
  await expect(detail).toContainText("仮押さえ中 busy-tentative・版 2・押さえた人：医師 X");
  await expect(detail).toContainText("空き free・版 3");

  // 遅れた確定：一括送信の全体が 412、予約・依頼・作業は増えない
  await confirmOn(w.doctorX);
  await expect(w.doctorX.getByTestId("error-banner")).toContainText("仮押さえの期限が切れました。枠を選び直してください", SYNC);
  await expect(w.doctorX.getByTestId("error-banner")).toContainText("412 Precondition Failed");
  await expect(w.doctorX.getByTestId("booking-draft")).toHaveCount(0);
  await expect(w.doctorX.getByTestId(`slot-row-${SLOT}`)).toContainText("空き free");
  await expect(w.ris.getByTestId("ris-orders").locator("tr[data-testid^=ris-order-]")).toHaveCount(2); // 初期データの 2 件だけ
  await diagram.locator('[role="button"]', { hasText: "医師 X：POST Transaction（一括登録・枠の版の確認あり）" }).click();
  const entries = w.monitor.getByTestId("transaction-entries");
  await expect(entries.getByTestId("transaction-entry-0")).toContainText("失敗（412）", SYNC);
  await expect(entries.getByTestId("transaction-entry-1")).toContainText("取り消し（登録されていない）");
  await expect(entries).toContainText("一括送信の全体が取り消されました（何も登録されていません）");

  // 版の履歴：版 3 を作った通信は FHIR サーバー（仮押さえの期限切れ）
  await w.monitor.getByLabel("リソース").selectOption(`Slot/${SLOT}`);
  const history = w.monitor.getByTestId("history-view");
  await expect(history.locator("tbody tr")).toHaveCount(3, SYNC);
  await expect(history.getByTestId("history-cause-3")).toContainText("FHIR サーバー（仮押さえの期限切れ）", SYNC);
  await expect(history.getByTestId("history-cause-2")).toContainText("医師 X");
  await expect(history.getByTestId("history-changed-3-comment")).toBeVisible();
});

test("S3-3：制御パネルで仮押さえの期限を変えられる（10〜300 秒）", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-3");
  await expect(w.control.getByTestId("slot-hold-seconds-current")).toContainText("30 秒", SYNC);

  await w.control.getByTestId("slot-hold-seconds-input").fill("5");
  await w.control.getByTestId("slot-hold-seconds-apply").click();
  await expect(w.control.getByTestId("slot-hold-seconds-error")).toContainText("10〜300 秒で指定してください");
  await expect(w.control.getByTestId("slot-hold-seconds-current")).toContainText("30 秒"); // 送られない

  await w.control.getByTestId("slot-hold-seconds-input").fill("60");
  await w.control.getByTestId("slot-hold-seconds-apply").click();
  await expect(w.control.getByTestId("slot-hold-seconds-current")).toContainText("60 秒", SYNC);
  await expect(w.doctorY.getByTestId("ct-booking-mode")).toContainText("期限 60 秒", SYNC);
  await expect(w.monitor.getByTestId("sequence-diagram")).toContainText("ポリシーの変更", SYNC);

  await selectSlotOn(w.doctorY, SLOT);
  await holdOn(w.doctorY);
  await expect(w.doctorY.getByTestId("booking-remaining")).toContainText(/確定までの残り (59|60) 秒/, SYNC);

  // 初期化で既定（仮押さえを使う・30 秒）に戻る
  await w.control.getByRole("button", { name: "初期化", exact: true }).click();
  await expect(w.control.getByTestId("slot-hold-seconds-current")).toContainText("30 秒", SYNC);
  await expect(w.doctorY.getByTestId("booking-draft")).toHaveCount(0, SYNC);
  await expect(w.doctorY.getByTestId("ct-booking-mode")).toContainText("仮押さえを使う（期限 30 秒）", SYNC);
});

test("S3：入口に S3 で開くウィンドウが並び、どのウィンドウにも案内（自習モードのガイド）は出ない", async ({ browser, request }) => {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const launcher = await bag.open("/");
  const section = launcher.getByRole("region", { name: "S3 予約枠の取り合いで開くウィンドウ" });
  await expect(section.getByRole("link")).toHaveCount(5);
  await expect(section).toContainText("docs/06-demo-procedures.md");
  const targets: [string, string][] = [
    ["デモ制御パネル", "デモ制御パネル"],
    ["電子カルテ CT 予約（医師 X）", "電子カルテ（医師 X）CT 予約"],
    ["電子カルテ CT 予約（医師 Y）", "電子カルテ（医師 Y）CT 予約"],
    ["放射線部門システム", "放射線部門システム"],
    ["通信モニタ", "通信モニタ"],
  ];
  for (const [link, heading] of targets) {
    const href = await section.getByRole("link", { name: link }).getAttribute("href");
    const page = await bag.open(href!);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading, SYNC);
    // 画面上の案内（次に押すボタンの強調）は出さない（D-33）
    await expect(page.locator('[data-guide-active="true"]')).toHaveCount(0);
    await expect(page.getByTestId("guide-panel")).toHaveCount(0);
  }
  // 入口の「個別のウィンドウで開く」にも 3 つの画面が並ぶ
  await expect(launcher.getByRole("link", { name: "電子カルテ CT 予約（医師 X）" })).toHaveCount(2);
  await expect(launcher.getByRole("link", { name: "放射線部門システム" })).toHaveCount(2);
});

test("S3：初期化すると、開いているウィンドウが初期状態に戻り、予約方式と期限も既定に戻る", async ({ browser, request }) => {
  const w = await openWindows(browser, request);
  await prepare(w, "s3-1");
  await selectSlotOn(w.doctorX, SLOT);
  await bookDirectOn(w.doctorX);
  await expect(w.ris.getByTestId("ris-orders").locator("tr[data-testid^=ris-order-]")).toHaveCount(3, SYNC);
  await selectSlotOn(w.doctorY, "ct1-1030"); // 予約欄を開いたまま初期化する
  await expect(w.doctorY.getByTestId("booking-draft")).toBeVisible(SYNC);

  await w.control.getByRole("button", { name: "初期化", exact: true }).click();
  await expect(w.doctorY.getByTestId("booking-draft")).toHaveCount(0, SYNC);
  await expect(w.ris.getByTestId("ris-orders").locator("tr[data-testid^=ris-order-]")).toHaveCount(2, SYNC);
  await expect(w.doctorX.getByTestId("ct-booking-mode")).toContainText("仮押さえを使う（期限 30 秒）", SYNC);
  await expect(w.control.getByTestId("policy-slot-hold-on")).toHaveAttribute("aria-pressed", "true", SYNC);
  await expect(w.doctorX.getByTestId(`slot-row-${SLOT}`)).toContainText("空き free", SYNC);
  // 初期化の後は S1・S2 もそのまま使える（S2 の準備を押しても S3 の画面は壊れない）
  await w.control.getByTestId("btn-prepare-s2-2").click();
  await expect(w.control.getByTestId("prepare-status")).toContainText("S2-2 の準備ができました", PREPARED);
  await expect(w.doctorX.getByTestId("ct-slots")).toBeVisible();
});
