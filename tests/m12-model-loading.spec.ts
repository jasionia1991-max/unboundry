import { expect, test } from "@playwright/test";

test("node model controls distinguish a catalog failure without provider traffic", async ({
  page,
}) => {
  const paidPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /generation-tasks|openrouter|volces|mureka|provider/i.test(request.url())
    ) {
      paidPosts.push(request.url());
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/__fixture/node.image.prompt-ready");

  await expect(page.getByTestId("image-creator")).toContainText("模型加载失败");
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  expect(paidPosts).toEqual([]);
});
