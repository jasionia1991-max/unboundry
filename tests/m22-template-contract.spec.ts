import { expect, test } from "@playwright/test";

test("template API provides categories, server search, pagination and safe graph data", async ({
  page,
  request,
}) => {
  const firstPage = await request.get(
    "/api/templates?space=public&category=影视&q=分镜&limit=1&offset=0&includeGraph=false",
  );
  expect(firstPage.ok()).toBeTruthy();
  expect(firstPage.headers()["cache-control"]).toBe("no-store");
  const first = await firstPage.json() as {
    categories: string[];
    items: Array<{ graph?: unknown; id: string; title: string }>;
    pagination: { hasMore: boolean; limit: number; offset: number; total: number };
  };
  expect(first.categories).toContain("Seedance 2.0");
  expect(first.categories).toContain("影视");
  expect(first.items).toHaveLength(1);
  expect(first.items[0].graph).toBeUndefined();
  expect(first.pagination).toEqual({ hasMore: true, limit: 1, offset: 0, total: 2 });

  const graphResponse = await request.get(
    "/api/templates?q=分镜大师&limit=10&offset=0&includeGraph=true",
  );
  expect(graphResponse.ok()).toBeTruthy();
  const graphCatalog = await graphResponse.json() as {
    items: Array<{
      graph: { edges: unknown[]; nodes: Array<{ type: string }> };
      id: string;
    }>;
  };
  expect(graphCatalog.items).toHaveLength(1);
  expect(graphCatalog.items[0].id).toBe("storyboard-master");
  expect(graphCatalog.items[0].graph.nodes).toHaveLength(26);
  expect(graphCatalog.items[0].graph.edges).toHaveLength(31);
  expect(graphCatalog.items[0].graph.nodes.filter((node) => node.type === "group")).toHaveLength(1);
  expect(graphCatalog.items[0].graph.nodes.filter((node) => node.type === "text")).toHaveLength(1);
  expect(graphCatalog.items[0].graph.nodes.filter((node) => node.type === "image")).toHaveLength(15);
  expect(graphCatalog.items[0].graph.nodes.filter((node) => node.type === "video")).toHaveLength(9);

  await page.goto("/__fixture/panel.templates.public");
  const panel = page.getByTestId("templates-panel");
  await page.getByTestId("template-first-notice").getByRole("button", { name: "知道了" }).click();
  await panel.getByRole("searchbox", { name: "搜索资产包..." }).fill("分镜大师");
  await expect(panel.getByText("分镜大师", { exact: true })).toBeVisible();
  await expect(panel.getByText("Json大师电影分镜", { exact: true })).toHaveCount(0);
});
