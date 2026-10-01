import type { Browser, BrowserContext, Page } from "@playwright/test";

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
