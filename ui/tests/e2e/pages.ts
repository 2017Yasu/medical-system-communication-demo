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
