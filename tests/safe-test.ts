import {
  expect,
  test as playwrightTest,
  type APIRequestContext,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  isLoopbackTestUrl,
  recordBlockedBrowserRequest,
  safeTestEnvironment,
} from "./test-environment";
import "../server/applicationComposition";

safeTestEnvironment();

const guardedContexts = new WeakSet<BrowserContext>();

export async function guardBrowserContext(
  context: BrowserContext,
): Promise<BrowserContext> {
  if (guardedContexts.has(context)) return context;
  context.on("request", (request) => {
    const url = request.url();
    if (!isLoopbackTestUrl(url)) recordBlockedBrowserRequest(url);
  });
  const guardPageSockets = (page: Page) => {
    page.on("websocket", (socket) => {
      const url = socket.url();
      if (!isLoopbackTestUrl(url)) recordBlockedBrowserRequest(url);
    });
  };
  context.pages().forEach(guardPageSockets);
  context.on("page", guardPageSockets);
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isLoopbackTestUrl(url)) {
      await route.continue();
      return;
    }
    recordBlockedBrowserRequest(url);
    await route.abort("blockedbyclient");
  });
  guardedContexts.add(context);
  return context;
}

export const test = playwrightTest.extend({
  context: async ({ context }, use) => {
    await guardBrowserContext(context);
    await use(context);
  },
});

export { expect };
export type { APIRequestContext, Download, Locator, Page };
