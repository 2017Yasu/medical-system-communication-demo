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
