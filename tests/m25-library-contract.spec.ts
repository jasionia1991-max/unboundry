import { expect, test } from "./safe-test";

type LibraryCatalog = {
  folders: Array<{ id: string; kind: string; label: string }>;
  items: Array<{ id: string; kind: string; label: string; src: string }>;
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
  spaces: Array<{ id: string; label: string; readOnly: boolean }>;
};

test("the local library API provides spaces, folders, pagination and totals", async ({
  request,
}) => {
  const firstResponse = await request.get(
    "/api/library?space=personal&folder=others&limit=2&offset=0",
  );
  expect(firstResponse.ok()).toBeTruthy();
  expect(firstResponse.headers()["cache-control"]).toBe("no-store");
  const first = await firstResponse.json() as LibraryCatalog;
  expect(first.spaces).toEqual([
    { id: "personal", label: "个人", readOnly: false },
    { id: "team", label: "团队", readOnly: true },
  ]);
  expect(first.folders.map((folder) => folder.label)).toEqual([
    "收藏",
    "主体库",
    "角色",
    "场景",
    "道具",
    "风格",
    "音效",
    "Others",
  ]);
  expect(first.items).toHaveLength(2);
  expect(first.pagination).toEqual({
    hasMore: true,
    limit: 2,
    offset: 0,
    total: 3,
  });

  const secondResponse = await request.get(
    "/api/library?space=personal&folder=others&limit=2&offset=2",
  );
  const second = await secondResponse.json() as LibraryCatalog;
  expect(second.items).toHaveLength(1);
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(second.pagination.hasMore).toBe(false);

  const teamResponse = await request.get(
    "/api/library?space=team&folder=others&limit=20&offset=0",
  );
  const team = await teamResponse.json() as LibraryCatalog;
  expect(team.items).toEqual([]);
  expect(team.pagination.total).toBe(0);

  const searchResponse = await request.get(
    "/api/library?space=personal&folder=favorites&q=场景&limit=20&offset=0",
  );
  const search = await searchResponse.json() as LibraryCatalog;
  expect(search.folders.map((folder) => folder.label)).toEqual(["场景"]);
});

test("the material library UI reads its local catalog without provider traffic", async ({
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

  await page.goto("/__fixture/panel.assets.drag-ready");
  const panel = page.getByTestId("assets-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("assets-library-total")).toHaveText("共 3 个素材");
  await expect(panel.getByTestId("assets-library-grid").getByRole("button"))
    .toHaveCount(3);

  await panel.getByRole("tab", { name: "团队" }).click();
  await expect(panel.getByText("该文件夹暂无素材", { exact: true })).toBeVisible();
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(providerRequests).toBe(0);
});
