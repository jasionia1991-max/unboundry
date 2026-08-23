import { expect, test, type APIRequestContext } from "./safe-test";

type LibraryCatalog = {
  folders: Array<{ id: string; kind: string; label: string }>;
  items: Array<{
    id: string;
    kind: string;
    label: string;
    revision: number;
    src: string;
  }>;
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
  spaces: Array<{ id: string; label: string; readOnly: boolean }>;
};

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function uploadImage(request: APIRequestContext, assetId: string) {
  const response = await request.post(`/api/assets/${assetId}`, {
    data: onePixelPng,
    headers: { "Content-Type": "image/png" },
  });
  expect(response.status()).toBe(201);
}

async function saveImage(
  request: APIRequestContext,
  assetId: string,
  label: string,
) {
  return request.post("/api/library", {
    data: { assetId, folderId: "others", kind: "image", label },
  });
}

test("personal library saves owner media idempotently and releases only its reference", async ({
  request,
}) => {
  const assetId = "m25-library-contract-image";
  await uploadImage(request, assetId);

  const emptyResponse = await request.get(
    "/api/library?space=personal&folder=others&limit=2&offset=0",
  );
  expect(emptyResponse.ok()).toBeTruthy();
  expect(emptyResponse.headers()["cache-control"]).toBe("no-store");
  const empty = await emptyResponse.json() as LibraryCatalog;
  expect(empty.spaces).toEqual([
    { id: "personal", label: "个人", readOnly: false },
    { id: "team", label: "团队", readOnly: true },
  ]);
  expect(empty.folders.map((folder) => folder.label)).toEqual([
    "收藏",
    "主体库",
    "角色",
    "场景",
    "道具",
    "风格",
    "音效",
    "Others",
  ]);
  expect(empty.items).toEqual([]);
  expect(empty.pagination.total).toBe(0);

  const firstSave = await saveImage(request, assetId, "真实个人素材");
  expect(firstSave.ok()).toBeTruthy();
  expect((await firstSave.json()).item.revision).toBe(1);
  const duplicate = await saveImage(request, assetId, "真实个人素材");
  expect(duplicate.ok()).toBeTruthy();
  expect((await duplicate.json()).item.revision).toBe(1);

  const saved = await (await request.get(
    "/api/library?space=personal&folder=others&limit=2&offset=0",
  )).json() as LibraryCatalog;
  expect(saved.items).toEqual([{
    id: assetId,
    kind: "image",
    label: "真实个人素材",
    revision: 1,
    src: `/api/assets/${assetId}`,
  }]);
  expect(saved.pagination).toEqual({
    hasMore: false,
    limit: 2,
    offset: 0,
    total: 1,
  });
  const team = await (await request.get(
    "/api/library?space=team&folder=others&limit=20&offset=0",
  )).json() as LibraryCatalog;
  expect(team.items).toEqual([]);
  expect(team.pagination.total).toBe(0);

  expect((await request.delete(`/api/assets/${assetId}`)).status()).toBe(409);
  expect((await request.delete(`/api/library/image/${assetId}`)).status()).toBe(204);
  expect((await request.get(`/api/assets/${assetId}`)).status()).toBe(200);
  expect((await request.delete(`/api/assets/${assetId}`)).status()).toBe(204);

  const racingAssetId = "m25-library-delete-race";
  await uploadImage(request, racingAssetId);
  const [racingSave, racingDelete] = await Promise.all([
    saveImage(request, racingAssetId, "并发引用"),
    request.delete(`/api/assets/${racingAssetId}`),
  ]);
  expect([[200, 409], [409, 204]])
    .toContainEqual([racingSave.status(), racingDelete.status()]);
  if (racingSave.status() === 200) {
    expect(racingDelete.status()).toBe(409);
    expect((await request.get(`/api/assets/${racingAssetId}`)).status()).toBe(200);
    expect((await request.delete(
      `/api/library/image/${racingAssetId}`,
    )).status()).toBe(204);
    expect((await request.delete(`/api/assets/${racingAssetId}`)).status()).toBe(204);
  } else {
    expect(racingSave.status()).toBe(409);
    expect(racingDelete.status()).toBe(204);
    expect((await request.get(`/api/assets/${racingAssetId}`)).status()).toBe(404);
    const afterRace = await (await request.get(
      "/api/library?space=personal&folder=others&limit=20&offset=0",
    )).json() as LibraryCatalog;
    expect(afterRace.items.some((item) => item.id === racingAssetId)).toBe(false);
  }
});

test("the material library UI reads and removes real entries without provider traffic", async ({
  page,
  request,
}) => {
  const assetId = "m25-library-ui-image";
  await uploadImage(request, assetId);
  expect((await saveImage(request, assetId, "界面素材")).ok()).toBeTruthy();
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  let providerRequests = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" && /\/api\/generation-tasks(?:[/?]|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) providerRequests += 1;
  });

  await page.goto("/__fixture/panel.assets.drag-ready");
  const panel = page.getByTestId("assets-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("assets-library-total")).toHaveText("共 1 个素材");
  await expect(panel.getByRole("button", { name: "拖动素材 界面素材" })).toBeVisible();
  await panel.getByRole("button", { name: "从素材库移除 界面素材" }).click();
  await expect(panel.getByTestId("assets-empty")).toHaveText("该文件夹暂无素材");
  expect((await request.get(`/api/assets/${assetId}`)).status()).toBe(200);

  await panel.getByRole("tab", { name: "团队" }).click();
  await expect(panel.getByText("该文件夹暂无素材", { exact: true })).toBeVisible();
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(providerRequests).toBe(0);
  expect((await request.delete(`/api/assets/${assetId}`)).status()).toBe(204);
});
