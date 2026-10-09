// S4 処方調剤（specs/004 quickstart）：個別ウィンドウの手動操作、講演モード、自習モード。
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PageBag, pharmacyButton, prescribeOn, switchPharmacist } from "./pages";

const SYNC = { timeout: 5000 };
let bag: PageBag;

test.afterEach(async () => {
  await bag?.closeAll();
});

async function openBase(browser: Browser, request: import("@playwright/test").APIRequestContext, urls: string[]): Promise<Page[]> {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const pages: Page[] = [];
  for (const url of urls) pages.push(await bag.open(url));
  return pages;
}

test.describe("個別ウィンドウ", () => {
  test("外来：処方からお渡しまで（調剤した薬剤師は監査できない）", async ({ browser, request }) => {
    const [doctor, pharmacy] = await openBase(browser, request, ["/ehr/rx?role=dr-x", "/pharmacy"]);

    await prescribeOn(doctor);
    const mine = doctor.getByTestId("rx-row-1");
    await expect(mine).toContainText("有効（依頼中）", SYNC);
    await expect(mine).toContainText("依頼済み");
    await expect(mine).toContainText("薬剤部");
    const theirs = pharmacy.getByTestId("rx-pharmacy-row-1");
    await expect(theirs).toContainText("デモ 太郎", SYNC);
    await expect(theirs).toContainText("外来");

    await pharmacyButton(pharmacy, "1", "受付・調剤開始").click();
    await expect(theirs).toContainText("調剤中", SYNC);
    await expect(theirs).toContainText("薬剤師 C");
    await expect(mine).toContainText("調剤中", SYNC);
    await expect(mine).toContainText("有効（依頼中）");

    // 調剤した薬剤師（薬剤師 C）は監査を始められない
    await expect(pharmacyButton(pharmacy, "1", "監査を開始")).toBeDisabled();
    await expect(pharmacy.getByTestId("rx-hint-1")).toContainText("調剤した薬剤師とは別の薬剤師が監査します");
    await switchPharmacist(pharmacy, "薬剤師 E");
    await pharmacyButton(pharmacy, "1", "監査を開始").click();
    await expect(theirs).toContainText("監査中", SYNC);
    await expect(theirs).toContainText("薬剤師 E");

    // 監査を始めた薬剤師（薬剤師 E）だけがお渡しできる
    await switchPharmacist(pharmacy, "薬剤師 C");
    await expect(pharmacyButton(pharmacy, "1", "監査を終えてお渡し")).toBeDisabled();
    await expect(pharmacy.getByTestId("rx-hint-1")).toContainText("監査を始めた薬剤師（薬剤師 E）が操作します");
    await switchPharmacist(pharmacy, "薬剤師 E");
    await pharmacyButton(pharmacy, "1", "監査を終えてお渡し").click();

    await expect(mine).toContainText("お渡し済み", SYNC);
    await expect(doctor.getByTestId("rx-progress-1")).toContainText("お渡し済み");
    await expect(mine).toContainText("完了");
    await expect(theirs).toContainText("完了", SYNC);
  });

  test("検体検査の画面に処方が混ざらない", async ({ browser, request }) => {
    const [doctor, , orders, lis] = await openBase(browser, request, ["/ehr/rx?role=dr-x", "/pharmacy", "/ehr?role=doctor", "/lis?tech=tech-a"]);
    await prescribeOn(doctor);
    await expect(doctor.getByTestId("rx-row-1")).toBeVisible(SYNC);
    await orders.waitForTimeout(1000);
    await expect(orders.getByText("まだ依頼がありません。")).toBeVisible();
    await expect(lis.getByText("作業はありません。")).toBeVisible();
  });
});

test("入院：処方から払出まで（処方は有効のまま、看護師 F の画面に払出済み）", async ({ browser, request }) => {
  const [doctorY, pharmacy, ward, monitor] = await openBase(browser, request, [
    "/ehr/rx?role=dr-y",
    "/pharmacy",
    "/ehr/rx?role=ns-f",
    "/monitor",
  ]);

  await expect(doctorY.getByTestId("rx-category")).toContainText("入院処方・臨時処方（外科病棟）", SYNC);
  await prescribeOn(doctorY);
  const theirs = pharmacy.getByTestId("rx-pharmacy-row-1");
  await expect(theirs).toContainText("デモ 三郎", SYNC);
  await expect(theirs).toContainText("入院（外科病棟）");
  const wardRow = ward.getByTestId("ward-row-1");
  await expect(wardRow).toContainText("薬剤部で受付待ち", SYNC);

  await pharmacyButton(pharmacy, "1", "受付・調剤開始").click();
  await expect(theirs).toContainText("調剤中", SYNC);
  await switchPharmacist(pharmacy, "薬剤師 E");
  await pharmacyButton(pharmacy, "1", "監査を開始").click();
  await expect(theirs).toContainText("監査中", SYNC);
  await pharmacyButton(pharmacy, "1", "監査を終えて払出").click();

  // 作業は完了、処方は有効のまま。看護師 F の画面に払出済みと表示される
  await expect(wardRow).toContainText("払出済み", SYNC);
  await expect(wardRow).toContainText("有効（依頼中）");
  await expect(wardRow).toContainText("完了");
  const mine = doctorY.getByTestId("rx-row-1");
  await expect(mine).toContainText("払出済み", SYNC);
  await expect(mine).toContainText("有効（依頼中）");
  await expect(doctorY.getByTestId("rx-progress-1")).toContainText("投与中");

  // 通信モニタ：払出の Transaction の中身に MedicationRequest の更新が無い（外来のお渡しとの違い）
  const diagram = monitor.getByTestId("sequence-diagram");
  await expect(diagram).toContainText("薬剤師 E：POST Transaction（一括登録）", SYNC);
  await diagram.locator('[role="button"]', { hasText: "薬剤師 E：POST Transaction" }).click();
  const entries = monitor.getByTestId("transaction-entries");
  await expect(entries).toContainText("POST MedicationDispense", SYNC);
  await expect(entries).toContainText("PUT Task/1");
  await expect(entries).not.toContainText("PUT MedicationRequest");
});

// ---- 講演モード（US3） ----

const ehrRegion = (page: Page) => page.getByRole("region", { name: "電子カルテ" });
const pharmacyRegion = (page: Page) => page.getByRole("region", { name: "薬剤部門システム" });
const monitorRegion = (page: Page) => page.getByRole("region", { name: "通信モニタ" });

async function openStage(page: Page, request: import("@playwright/test").APIRequestContext, scenario: string) {
  await request.post("/demo/reset");
  await page.goto(`/stage?mode=presentation&scenario=${scenario}`);
  await expect(page.getByTestId("progress-panel")).toBeVisible();
  await expect(page.getByTestId("btn-next")).toBeEnabled();
  await page.waitForTimeout(1200); // 各領域の通知の登録と進行パネルの開始を待つ
}

const nextStep = async (page: Page, no: number) => {
  await page.getByTestId("btn-next").click();
  await expect(page.getByTestId("explanation")).toContainText(`ステップ ${no}：`, { timeout: 8000 });
  await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 8000 });
};

test.describe("講演モード", () => {
  test("外来：次へで最後まで進め、戻るで 1 つ前の状態に戻る", async ({ page, request }) => {
    await openStage(page, request, "s4-outpatient");
    const outpatientStarted = Date.now();
    await expect(ehrRegion(page)).toBeVisible();
    await expect(pharmacyRegion(page)).toBeVisible();
    await expect(monitorRegion(page)).toBeVisible();
    const mine = ehrRegion(page).getByTestId("rx-row-1");
    const theirs = pharmacyRegion(page).getByTestId("rx-pharmacy-row-1");

    await nextStep(page, 1);
    await expect(mine).toContainText("有効（依頼中）");
    await expect(mine).toContainText("薬剤部");
    await expect(page.getByTestId("explanation")).toContainText("業務上の意味");
    await expect(page.getByTestId("explanation")).toContainText("MedicationRequest");
    await nextStep(page, 2);
    await expect(theirs).toContainText("外来");
    await expect(monitorRegion(page).getByTestId("sequence-diagram")).toContainText("ping pharmacy-dept");
    await nextStep(page, 3);
    await expect(theirs).toContainText("調剤中", SYNC);
    await expect(theirs).toContainText("薬剤師 C");
    await nextStep(page, 4);
    await expect(theirs).toContainText("監査中", SYNC);
    // 解説中のステップに合わせて、薬剤師が薬剤師 E に切り替わる
    await expect(pharmacyRegion(page).getByRole("button", { name: "薬剤師 E", exact: true })).toBeDisabled();
    await nextStep(page, 5);
    await expect(mine).toContainText("お渡し済み", SYNC);
    await nextStep(page, 6);
    await expect(mine).toContainText("完了");
    await expect(page.getByTestId("btn-next")).toContainText("完了");
    console.log(`外来の 6 ステップ（次へ ×6、確認の待ち時間を含む）: ${Date.now() - outpatientStarted} ms`); // SC-001（解説なしの操作のみ 2 分以内）

    // 戻る：初期化して、1 つ前のステップ（5）までを再現する。もう一度戻ると、ステップ 4 まで
    const progress = ehrRegion(page).getByTestId("rx-progress-1");
    await page.getByTestId("btn-back").click();
    await expect(page.getByTestId("explanation")).toContainText("ステップ 5：", { timeout: 30_000 });
    await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 30_000 });
    await expect(progress).toContainText("お渡し済み", { timeout: 10_000 });
    await page.getByTestId("btn-back").click();
    await expect(page.getByTestId("explanation")).toContainText("ステップ 4：", { timeout: 30_000 });
    await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 30_000 });
    await expect(progress).toContainText("薬剤部で監査中", { timeout: 10_000 });
  });

  test("入院：ステップ 4 までまとめて進め、払出で電子カルテの列が看護師 F になる", async ({ page, request }) => {
    await openStage(page, request, "s4-outpatient");
    await page.getByTestId("scenario-select").selectOption("s4-inpatient");
    await expect(page.getByTestId("btn-fast-forward")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    const started = Date.now();
    await page.getByTestId("btn-fast-forward").click();
    await expect(page.getByTestId("explanation")).toContainText("ステップ 4：", { timeout: 60_000 });
    await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 60_000 });
    const elapsed = Date.now() - started;
    console.log(`入院のステップ 1〜4（まとめて進める）: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(60_000); // SC-002
    await expect(pharmacyRegion(page).getByTestId("rx-pharmacy-row-1")).toContainText("入院（外科病棟）");
    await expect(pharmacyRegion(page).getByTestId("rx-pharmacy-row-1")).toContainText("監査中");
    // 途中の通信もすべて通信モニタに残る
    const diagram = monitorRegion(page).getByTestId("sequence-diagram");
    await expect(diagram).toContainText("医師 Y：POST Transaction");
    await expect(diagram).toContainText("薬剤師 C：PATCH");
    await expect(diagram).toContainText("薬剤師 E：PATCH");
    // まとめて進めるボタンは、ステップ 4 を過ぎたら出ない
    await nextStep(page, 5);
    await expect(page.getByTestId("btn-fast-forward")).toHaveCount(0);
    await nextStep(page, 6);
    await expect(ehrRegion(page).getByRole("button", { name: "看護師 F（外科病棟）" })).toHaveAttribute("aria-pressed", "true");
    const wardRow = ehrRegion(page).getByTestId("ward-row-1");
    await expect(wardRow).toBeVisible();
    await expect(wardRow).toContainText("払出済み");
    await expect(wardRow).toContainText("有効（依頼中）");
  });

  test("画面で直接操作しても、現在のステップが追従する", async ({ page, request }) => {
    await openStage(page, request, "s4-outpatient");
    await ehrRegion(page).getByTestId("rx-form").getByRole("button", { name: "処方する" }).click();
    await expect(page.getByTestId("step-1")).toHaveClass(/ok/, SYNC);
    await expect(page.getByTestId("step-2")).toHaveClass(/ok/, SYNC);
    await pharmacyRegion(page).getByRole("button", { name: "受付・調剤開始", exact: true }).click();
    await expect(page.getByTestId("step-3")).toHaveClass(/ok/, SYNC);
  });

  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    test(`ステージビューの 3 領域が ${size.width}×${size.height} に収まる`, async ({ page, request }) => {
      await page.setViewportSize(size);
      await openStage(page, request, "s4-outpatient");
      for (const region of [ehrRegion(page), pharmacyRegion(page), monitorRegion(page)]) await expect(region).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

// ---- 自習モード（US4） ----

/** 強調表示されている（枠が点滅している）要素のうち、操作できるものを 1 つずつ操作する（S1 の自習モードの E2E と同じ）。 */
async function followGuideOnce(page: Page, done: Set<string>) {
  const marked = page.locator('[data-guide-active="true"]');
  const n = await marked.count();
  for (let i = 0; i < n; i++) {
    const el = marked.nth(i);
    // 1 つ操作すると強調の対象が変わる（例：薬剤師 E に切り替えた後は、そのボタンは強調されない）ので、消えた要素は飛ばす
    const key = (await el.getAttribute("data-guide", { timeout: 500 }).catch(() => null)) ?? "";
    if (!key || done.has(key)) continue; // 領域の強調（自動のステップ）は操作しない／同じ要素は 1 回だけ
    const tag = await el.evaluate((e) => e.tagName.toLowerCase(), undefined, { timeout: 500 }).catch(() => "");
    if (!tag || tag === "select") continue; // 患者・薬剤は既定のまま
    if (!(await el.isEnabled({ timeout: 500 }).catch(() => false))) continue;
    done.add(key);
    await el.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("自習モード：入院をガイドどおりに最後まで進める（薬剤師 E への切り替えが案内される）", async ({ page, request }) => {
  await request.post("/demo/reset");
  await page.goto("/stage?mode=self-study&scenario=s4-inpatient");
  await expect(page.getByTestId("guide-panel")).toBeVisible();
  await expect(page.getByTestId("guide-instruction")).toContainText("医師 Y がデモ 三郎に臨時処方", { timeout: 8000 });
  await page.waitForTimeout(1200); // 各領域の通知の登録を待つ

  let step = "";
  let done = new Set<string>();
  let sawSwitchHint = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await page.getByText("最後まで完了しました").isVisible()) break;
    const text = await page.getByTestId("guide-instruction").innerText().catch(() => "");
    const current = text.split("\n")[0];
    if (current !== step) {
      step = current;
      done = new Set(); // ステップが変わったら、操作済みの記録を捨てる
    }
    if (current.includes("薬剤師 E が監査を開始") && text.includes("薬剤師 E に切り替えてください")) sawSwitchHint = true;
    await followGuideOnce(page, done);
    await page.waitForTimeout(400);
  }
  await expect(page.getByText("最後まで完了しました")).toBeVisible();
  expect(sawSwitchHint, "監査の開始の場面で、薬剤師 E への切り替えが案内される").toBe(true);

  // 最後は病棟の看護師 F の画面に払出済みが表示され、処方は有効のまま
  const wardRow = ehrRegion(page).getByTestId("ward-row-1");
  await expect(wardRow).toContainText("払出済み", SYNC);
  await expect(wardRow).toContainText("有効（依頼中）");
  await expect(page.getByTestId("guide-done")).toContainText("できました");
  await expect(page.getByTestId("guide-done")).toContainText("FHIR 上の意味");

  // 最初から：初期状態に戻る
  await page.getByTestId("btn-restart").click();
  await expect(pharmacyRegion(page).getByText("処方はまだありません。")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("guide-instruction")).toContainText("医師 Y がデモ 三郎に臨時処方", { timeout: 10_000 });
});

test("自習モード：外来を選んで始められ、案内と違う操作には促しが出る", async ({ page, request }) => {
  await request.post("/demo/reset");
  await page.goto("/stage?mode=self-study&scenario=s4-outpatient");
  await expect(page.getByTestId("guide-instruction")).toContainText("医師 X がデモ 太郎に処方", { timeout: 8000 });
  await expect(page.getByTestId("guide-instruction")).toContainText("電子カルテ（医師 X）");
  await page.waitForTimeout(1200);
  // 案内の対象ではない操作（薬剤師の切り替え）をすると、案内に戻るよう促される
  await pharmacyRegion(page).getByRole("button", { name: "薬剤師 E", exact: true }).click();
  await expect(page.getByTestId("guide-nudge")).toContainText("電子カルテ", SYNC);
});

// SC-003：操作の結果が、関係するほかの画面に 2 秒以内に反映される
test("操作の結果は、ほかの画面に 2 秒以内に反映される", async ({ browser, request }) => {
  const [doctor, pharmacy] = await openBase(browser, request, ["/ehr/rx?role=dr-x", "/pharmacy"]);
  await pharmacy.waitForTimeout(1000); // 通知の登録を待つ
  const mine = doctor.getByTestId("rx-row-1");
  const theirs = pharmacy.getByTestId("rx-pharmacy-row-1");

  let t = Date.now();
  await prescribeOn(doctor);
  await expect(theirs).toContainText("デモ 太郎", { timeout: 2000 });
  const toPharmacy = Date.now() - t;

  t = Date.now();
  await pharmacyButton(pharmacy, "1", "受付・調剤開始").click();
  await expect(mine).toContainText("調剤中", { timeout: 2000 });
  const toDoctor = Date.now() - t;
  console.log(`処方 → 薬剤部の画面: ${toPharmacy} ms、受付 → 電子カルテの画面: ${toDoctor} ms`);
  expect(toPharmacy).toBeLessThan(2000);
  expect(toDoctor).toBeLessThan(2000);
});

