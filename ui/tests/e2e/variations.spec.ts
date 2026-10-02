import { expect, test, type Page } from "@playwright/test";
import { PageBag, acceptOn } from "./pages";

const SYNC = { timeout: 3000 };
let bag: PageBag;
test.afterEach(async () => bag?.closeAll());

async function setup(browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext, sets: RegExp[]) {
  await request.post("/demo/reset");
  bag = new PageBag(browser);
  const doctor = await bag.open("/ehr?role=doctor");
  const nurse = await bag.open("/ehr?role=nurse");
  const lis = await bag.open("/lis?tech=tech-a");
  await doctor.waitForTimeout(1000);
  for (const s of sets) await doctor.getByLabel(s).check();
  await doctor.getByRole("button", { name: "依頼する" }).click();
  await nurse.getByRole("button", { name: "採血を記録" }).click();
  await expect(lis.getByTestId("task-1").getByRole("button", { name: "受付", exact: true })).toBeEnabled(SYNC);
  return { doctor, nurse, lis };
}

const doctorRow = (p: Page) => p.getByTestId("order-1");
const lisRow = (p: Page) => p.getByTestId("task-1");

test("取消：結果報告前の依頼を医師が取り消すと、依頼も作業も「取消」になる", async ({ browser, request }) => {
  const { doctor, lis } = await setup(browser, request, [/血算/]);
  await acceptOn(lisRow(lis));
  await expect(doctorRow(doctor)).toContainText("受付済み", SYNC);
  await doctorRow(doctor).getByRole("button", { name: "取消" }).click();
  await expect(doctorRow(doctor).locator("td").nth(1)).toContainText("取消");
  await expect(doctorRow(doctor).locator("td").nth(2)).toContainText("取消");
  await expect(doctorRow(doctor).getByRole("button", { name: "取消" })).toHaveCount(0);
  await expect(lisRow(lis)).toContainText("取消", SYNC);
  await expect(lisRow(lis).getByRole("button", { name: "測定開始" })).toHaveCount(0);
});

test("受付不可：理由を入力しないと確定できず、理由が電子カルテにも表示される。依頼は有効のまま", async ({ browser, request }) => {
  const { doctor, lis } = await setup(browser, request, [/血算/]);
  await lisRow(lis).getByRole("button", { name: "受付不可" }).click();
  const dialog = lis.getByTestId("reject-dialog");
  await expect(dialog.getByRole("button", { name: "受付不可にする" })).toBeDisabled();
  await dialog.getByLabel("受付不可の理由").fill("溶血のため再採血が必要");
  await dialog.getByRole("button", { name: "受付不可にする" }).click();
  await expect(lisRow(lis)).toContainText("受付不可");
  await expect(lisRow(lis).getByTestId("status-reason")).toContainText("溶血のため再採血が必要");
  await expect(doctorRow(doctor).locator("td").nth(2)).toContainText("受付不可", SYNC);
  await expect(doctorRow(doctor).getByTestId("status-reason")).toContainText("溶血のため再採血が必要");
  await expect(doctorRow(doctor).locator("td").nth(1)).toContainText("有効（依頼中）");
  await expect(lisRow(lis).getByRole("button", { name: "受付", exact: true })).toHaveCount(0);
});

test("再検：保留・再検中を経て実施中に戻り、報告で完了する", async ({ browser, request }) => {
  const { doctor, lis } = await setup(browser, request, [/血算/]);
  await acceptOn(lisRow(lis));
  await lisRow(lis).getByRole("button", { name: "測定開始" }).click();
  await lisRow(lis).getByRole("button", { name: "再検" }).click();
  await expect(lisRow(lis)).toContainText("保留");
  await expect(lisRow(lis)).toContainText("再検中");
  await expect(doctorRow(doctor)).toContainText("再検中", SYNC);
  await lisRow(lis).getByRole("button", { name: "再開" }).click();
  await expect(lisRow(lis)).toContainText("測定中");
  await expect(doctorRow(doctor)).toContainText("実施中", SYNC);
  await lisRow(lis).getByRole("button", { name: "結果入力" }).click();
  await lis.getByRole("button", { name: "既定値を入れる" }).click();
  await lis.getByRole("button", { name: "承認・報告" }).click();
  await expect(doctorRow(doctor).locator("td").nth(1)).toContainText("完了", SYNC);
});

test("一部先行報告：血算だけ先に報告しても作業と依頼は完了せず、残りの報告で完了する", async ({ browser, request }) => {
  const { doctor, lis } = await setup(browser, request, [/血算/, /生化学/]);
  await acceptOn(lisRow(lis));
  await lisRow(lis).getByRole("button", { name: "測定開始" }).click();
  await lisRow(lis).getByRole("button", { name: "結果入力" }).click();
  const entry = lis.getByTestId("result-entry");
  await entry.getByRole("button", { name: "既定値を入れる" }).click();
  // すべて選択されている間は「先に報告」は押せない
  await expect(entry.getByRole("button", { name: "選んだ項目だけ先に報告" })).toBeDisabled();
  for (const name of ["AST", "ALT", "クレアチニン"]) await entry.getByLabel(`${name}を今回報告する`).uncheck();
  await entry.getByRole("button", { name: "選んだ項目だけ先に報告" }).click();

  // 医師：血算の結果が見られる。作業は実施中、依頼は有効のまま
  await expect(doctorRow(doctor)).toContainText("一部報告済", SYNC);
  await expect(doctorRow(doctor).locator("td").nth(1)).toContainText("有効（依頼中）");
  await expect(doctorRow(doctor).locator("td").nth(2)).toContainText("実施中");
  await expect(doctorRow(doctor).getByRole("button", { name: "取消" })).toHaveCount(0); // 一部報告後は取消できない
  await doctorRow(doctor).getByRole("button", { name: "結果を見る" }).click();
  const result = doctor.getByTestId("result-view");
  await expect(result).toContainText("一部報告");
  await expect(result.locator("tbody tr")).toHaveCount(5, SYNC);

  // 技師：残りの 3 項目だけが表示され、報告済みが示される
  await lisRow(lis).getByRole("button", { name: "結果入力" }).click();
  await expect(lis.getByTestId("already-reported")).toContainText("白血球数");
  await expect(lis.getByTestId("result-entry").locator("tbody tr")).toHaveCount(3);
  await lis.getByRole("button", { name: "既定値を入れる" }).click();
  await lis.getByRole("button", { name: "承認・報告" }).click();

  await expect(doctorRow(doctor).locator("td").nth(1)).toContainText("完了", SYNC);
  await expect(result).toContainText("確定", SYNC);
  await expect(result.locator("tbody tr")).toHaveCount(8, SYNC);
});

test("講演モード：バリエーションのシナリオを選んで最後まで進められる（一部先行報告）", async ({ page, request }) => {
  await request.post("/demo/reset");
  await page.goto("/stage?mode=presentation");
  await page.waitForTimeout(1200);
  await page.getByTestId("scenario-select").selectOption("s1-partial");
  await expect(page.getByTestId("step-1")).toHaveAttribute("aria-current", "step", { timeout: 15000 });
  await page.waitForTimeout(1000);
  for (let no = 1; no <= 6; no++) {
    await page.getByTestId("btn-next").click();
    await expect(page.getByTestId("explanation")).toContainText(`ステップ ${no}：`, { timeout: 10000 });
    await expect(page.getByTestId("btn-next")).not.toContainText("実行中", { timeout: 10000 });
  }
  await expect(page.getByTestId("btn-next")).toContainText("完了");
  const row = page.getByRole("region", { name: "電子カルテ" }).getByTestId("order-1");
  await expect(row.locator("td").nth(1)).toContainText("完了", { timeout: 3000 });
});
