import { expect, test } from "./safe-test";

test("template API provides the three real e-commerce templates and their graph data", async ({
  page,
  request,
}) => {
  const firstPage = await request.get(
    "/api/templates?space=public&category=电商&q=电商&limit=1&offset=0&includeGraph=false",
  );
  expect(firstPage.ok()).toBeTruthy();
  expect(firstPage.headers()["cache-control"]).toBe("no-store");
  const first = await firstPage.json() as {
    categories: string[];
    items: Array<{
      description: string;
      graph?: unknown;
      id: string;
      previewImage: string;
      title: string;
    }>;
    pagination: { hasMore: boolean; limit: number; offset: number; total: number };
  };
  expect(first.categories).toContain("电商");
  expect(first.items).toHaveLength(1);
  expect(first.items[0].graph).toBeUndefined();
  expect(first.items[0].previewImage).toMatch(/^\/templates\/.+\.png$/);
  expect(first.pagination).toEqual({ hasMore: true, limit: 1, offset: 0, total: 3 });

  const imageExpertGraph = await request.get(
    "/api/templates?q=213.电商图片生成专家&limit=10&offset=0&includeGraph=true",
  );
  expect(imageExpertGraph.ok()).toBeTruthy();
  const imageExpert = await imageExpertGraph.json() as {
    items: Array<{
      graph: {
        edges: unknown[];
        nodes: Array<{ type: string }>;
        version: 1;
      };
      id: string;
    }>;
  };
  expect(imageExpert.items).toHaveLength(1);
  expect(imageExpert.items[0].id).toBe("aaf7cc53-a595-45da-a6bb-7c93309e0962");
  expect(imageExpert.items[0].graph.version).toBe(1);
  expect(imageExpert.items[0].graph.nodes).toHaveLength(14);
  expect(imageExpert.items[0].graph.edges).toHaveLength(12);
  expect(imageExpert.items[0].graph.nodes.filter((node) => node.type === "group")).toHaveLength(1);
  expect(imageExpert.items[0].graph.nodes.filter((node) => node.type === "text")).toHaveLength(6);
  expect(imageExpert.items[0].graph.nodes.filter((node) => node.type === "image")).toHaveLength(7);

  const detailGraph = await request.get(
    "/api/templates?q=电商详情页工作流&limit=10&offset=0&includeGraph=true",
  );
  expect(detailGraph.ok()).toBeTruthy();
  const detail = await detailGraph.json() as {
    items: Array<{
      graph: {
        edges: unknown[];
        nodes: Array<{ type: string }>;
        version: 1;
      };
      id: string;
    }>;
  };
  expect(detail.items).toHaveLength(1);
  expect(detail.items[0].id).toBe("0786e042-095e-4551-b91b-365492e91241");
  expect(detail.items[0].graph.nodes).toHaveLength(12);
  expect(detail.items[0].graph.edges).toHaveLength(29);
  expect(detail.items[0].graph.nodes.filter((node) => node.type === "group")).toHaveLength(1);
  expect(detail.items[0].graph.nodes.filter((node) => node.type === "text")).toHaveLength(2);
  expect(detail.items[0].graph.nodes.filter((node) => node.type === "image")).toHaveLength(9);

  const garmentGraph = await request.get(
    "/api/templates?q=服装详情页组图&limit=10&offset=0&includeGraph=true",
  );
  expect(garmentGraph.ok()).toBeTruthy();
  const garment = await garmentGraph.json() as {
    items: Array<{
      graph: {
        edges: Array<{ type: string }>;
        nodes: Array<{ data: Record<string, unknown>; type: string }>;
        version: 1;
      };
      id: string;
    }>;
  };
  expect(garment.items).toHaveLength(1);
  expect(garment.items[0].id).toBe("e6b7f8c4-8c7d-4f8e-9d0a-3a1b2c3d4e5f");
  expect(garment.items[0].graph.version).toBe(1);
  expect(garment.items[0].graph.nodes).toHaveLength(9);
  expect(garment.items[0].graph.edges).toHaveLength(12);
  expect(garment.items[0].graph.nodes.filter((node) => node.type === "group")).toHaveLength(1);
  expect(garment.items[0].graph.nodes.filter((node) => node.type === "text")).toHaveLength(1);
  const garmentImages = garment.items[0].graph.nodes.filter((node) => node.type === "image");
  expect(garmentImages).toHaveLength(7);
  for (const node of garmentImages) {
    expect(node.data.imageAspectRatio).toBe("1:1");
    expect(node.data.imageQuality).toBe("2k");
  }

  await page.goto("/__fixture/panel.templates.public");
  const panel = page.getByTestId("templates-panel");
  await page.getByTestId("template-first-notice").getByRole("button", { name: "知道了" }).click();
  await panel.getByRole("searchbox", { name: "搜索资产包..." }).fill("电商");
  await expect(panel.getByText("电商详情页工作流", { exact: true })).toBeVisible();
  await expect(panel.getByText("213.电商图片生成专家", { exact: true })).toBeVisible();
  await expect(panel.getByText("服装详情页组图", { exact: false })).toBeVisible();
  await panel.getByRole("searchbox", { name: "搜索资产包..." }).fill("分镜");
  await expect(panel.getByText("分镜大师", { exact: true })).toHaveCount(0);
});
