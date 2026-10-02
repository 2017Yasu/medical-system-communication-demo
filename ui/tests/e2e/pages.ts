import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

/** テスト内で開いた画面（別々のブラウザコンテキスト）をまとめて閉じる。閉じないと次のテストの間も動き続けて干渉する。 */
export class PageBag {
  private contexts: BrowserContext[] = [];

  constructor(private readonly browser: Browser) {}

  async open(url: string): Promise<Page> {
    const context = await this.browser.newContext();
    this.contexts.push(context);
    const page = await context.newPage();
    await page.goto(url);
    return page;
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.contexts.map((c) => c.close().catch(() => undefined)));
    this.contexts = [];
  }
}

/** 検体検査システムの受付（D-27）：行の「受付」で受付を始め、確認欄の「受付を確定」で確定する。 */
export async function acceptOn(row: Locator): Promise<void> {
  await row.getByRole("button", { name: "受付", exact: true }).click();
  await row.getByRole("button", { name: "受付を確定" }).click();
}

/** CT 予約（specs/003）：枠の「枠を選ぶ」を押す。 */
export async function selectSlotOn(page: Page, slotId: string): Promise<void> {
  await page.getByTestId(`slot-select-${slotId}`).click();
}

/** 直接予約する方式：予約欄の「予約を確定する」。 */
export async function bookDirectOn(page: Page): Promise<void> {
  await page.getByTestId("booking-confirm-direct").click();
}

/** 仮押さえを使う方式：予約欄の「仮押さえする」。 */
export async function holdOn(page: Page): Promise<void> {
  await page.getByTestId("booking-hold").click();
}

/** 仮押さえを使う方式：予約欄の「確定する」。 */
export async function confirmOn(page: Page): Promise<void> {
  await page.getByTestId("booking-confirm").click();
}
