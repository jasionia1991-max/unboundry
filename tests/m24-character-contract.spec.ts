import { expect, test } from "./safe-test";

type CharacterCatalog = {
  categories: string[];
  filters: Record<string, string[]>;
  items: Array<{
    category: string;
    id: string;
    name: string;
    tags: string[];
  }>;
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
};

test("the local character catalog supports categories, filters and pagination", async ({
  request,
}) => {
  const firstResponse = await request.get(
    "/api/characters?category=全部角色&limit=10&offset=0",
  );
  expect(firstResponse.ok()).toBeTruthy();
  expect(firstResponse.headers()["cache-control"]).toBe("no-store");
  const first = await firstResponse.json() as CharacterCatalog;
  expect(first.categories).toEqual([
    "全部角色",
    "古代历史",
    "近代历史",
    "当代现实",
    "科幻未来",
    "架空幻想",
  ]);
  expect(first.filters["性别"]).toEqual(["男", "女", "中性"]);
  expect(first.items).toHaveLength(10);
  expect(first.pagination).toEqual({
    hasMore: true,
    limit: 10,
    offset: 0,
    total: 80,
  });

  const secondResponse = await request.get(
    "/api/characters?category=全部角色&limit=10&offset=10",
  );
  const second = await secondResponse.json() as CharacterCatalog;
  expect(second.items).toHaveLength(10);
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(second.pagination.offset).toBe(10);

  const filteredResponse = await request.get(
    "/api/characters?category=全部角色&filter=性别:男&limit=100&offset=0",
  );
  expect(filteredResponse.ok()).toBeTruthy();
  const filtered = await filteredResponse.json() as CharacterCatalog;
  expect(filtered.pagination.total).toBeGreaterThan(0);
  expect(filtered.pagination.total).toBeLessThan(80);
  expect(filtered.items.every((item) => item.tags.includes("男"))).toBeTruthy();

  const invalid = await request.get(
    "/api/characters?filter=不存在:无&limit=10&offset=0",
  );
  expect(invalid.status()).toBe(400);
});

test("the AI character overlay reads the local catalog without provider requests", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  let providerRequests = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" && /\/api\/generation-tasks(?:[/?]|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) {
      providerRequests += 1;
    }
  });

  await page.goto("/__fixture/overlay.ai-characters.loaded");
  const overlay = page.getByTestId("ai-characters-overlay");
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId("ai-character-card")).toHaveCount(60);

  await overlay.getByRole("button", { name: "性别", exact: true }).click();
  await overlay.getByLabel("性别筛选").getByRole("checkbox", { name: "男" }).check();
  const filteredCount = await page.getByTestId("ai-character-card").count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThan(60);
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(providerRequests).toBe(0);
});
