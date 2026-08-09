import { expect, test, type APIRequestContext } from "./safe-test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../server/database";
import {
  downloadEntryName,
  planGroupDownload,
  sanitizeDownloadBaseName,
  type DownloadPlanInput,
} from "../server/groupDownload";

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("download naming helpers sanitize titles and deduplicate by sequence", () => {
  expect(sanitizeDownloadBaseName('商品 图/重:版*')).toBe("商品 图 重 版");
  expect(sanitizeDownloadBaseName("  ")).toBe("节点");
  expect(sanitizeDownloadBaseName("a".repeat(120)).length).toBe(80);
  expect(downloadEntryName("商品图", 3, "png")).toBe("商品图-3.png");
  expect(downloadEntryName("视频", 10, "mp4")).toBe("视频-10.mp4");
});

test("download plan enforces file and byte limits and maps text/media extensions", () => {
  const inputs: DownloadPlanInput[] = [
    {
      byteSize: 12,
      kind: "image",
      nodeTitle: "图片",
      storageExtension: "PNG",
      taskId: "t1",
    },
    {
      byteSize: 34,
      kind: "text",
      nodeTitle: "文案",
      resultText: "你好\n第二行",
      taskId: "t2",
    },
    {
      byteSize: 56,
      kind: "video",
      nodeTitle: "图片",
      storageExtension: "mp4",
      taskId: "t3",
    },
  ];
  const plan = planGroupDownload(inputs);
  expect(plan.entries.map((entry) => entry.name)).toEqual([
    "图片-1.png",
    "文案-2.txt",
    "图片-3.mp4",
  ]);
  expect(plan.entries[1].resultText).toBe("你好\n第二行");
  expect(plan.totalBytes).toBe(12 + Buffer.byteLength("你好\n第二行", "utf8") + 56);

  const tooMany = Array.from({ length: 201 }, (_, index) => ({
    byteSize: 1,
    kind: "text" as const,
    nodeTitle: `节点${index}`,
    resultText: "x",
    taskId: `task-${index}`,
  }));
  expect(() => planGroupDownload(tooMany)).toThrow("200");

  expect(() =>
    planGroupDownload([
      {
        byteSize: 500 * 1024 * 1024 + 1,
        kind: "image",
        nodeTitle: "超大",
        taskId: "big",
      },
    ]),
  ).toThrow("500MB");
});

async function setupDownloadCanvas(
  request: APIRequestContext,
  dataDirectory: string,
) {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const baselineResponse = await request.get(`/api/canvas/${project.id}`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = (await baselineResponse.json()) as {
    loadToken: string;
    revision: number;
  };
  const store = openAppDatabase(dataDirectory);
  const timestamp = new Date().toISOString();
  store.exec(`
    DELETE FROM generation_tasks
    WHERE id IN (
      'dl-task-image', 'dl-task-video', 'dl-task-audio', 'dl-task-text',
      'dl-task-missing'
    );
    DELETE FROM media_assets
    WHERE id IN ('dl-image', 'dl-video', 'dl-audio', 'dl-missing');
  `);
  const mediaDirectory = join(dataDirectory, "media");
  mkdirSync(mediaDirectory, { recursive: true });
  const files = {
    "dl-image.png": Buffer.from("fake-image-bytes-123", "utf8"),
    "dl-video.mp4": Buffer.from("fake-video-bytes-456", "utf8"),
    "dl-audio.mp3": Buffer.from("fake-audio-bytes-789", "utf8"),
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(mediaDirectory, name), bytes);
  }
  const registerMedia = store.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, storage_status
    )
    VALUES (?, ?, '__test__', ?, ?, ?, ?, 'local', ?, ?, 'ready')
  `);
  registerMedia.run(
    "image",
    "dl-image",
    "dl-image.png",
    files["dl-image.png"].length,
    timestamp,
    timestamp,
    "dl-image.png",
    "image/png",
  );
  registerMedia.run(
    "video",
    "dl-video",
    "dl-video.mp4",
    files["dl-video.mp4"].length,
    timestamp,
    timestamp,
    "dl-video.mp4",
    "video/mp4",
  );
  registerMedia.run(
    "audio",
    "dl-audio",
    "dl-audio.mp3",
    files["dl-audio.mp3"].length,
    timestamp,
    timestamp,
    "dl-audio.mp3",
    "audio/mpeg",
  );
  registerMedia.run(
    "image",
    "dl-missing",
    "dl-missing.png",
    10,
    timestamp,
    timestamp,
    "dl-missing.png",
    "image/png",
  );

  const registerTask = store.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, model, parameters,
      idempotency_key, request_fingerprint, state, attempt, owner_id,
      result_asset_id, result_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, '', 'model-1', '{}', ?, ?, 'success', 1, '__test__', ?, ?, ?, ?)
  `);
  const taskRows: Array<{
    id: string;
    node: string;
    kind: string;
    asset: string | null;
    text: string | null;
    created: string;
  }> = [
    {
      asset: "dl-image",
      created: "2026-08-07T00:00:01.000Z",
      id: "dl-task-image",
      kind: "image",
      node: "child-image",
      text: null,
    },
    {
      asset: "dl-video",
      created: "2026-08-07T00:00:02.000Z",
      id: "dl-task-video",
      kind: "video",
      node: "child-video",
      text: null,
    },
    {
      asset: "dl-audio",
      created: "2026-08-07T00:00:03.000Z",
      id: "dl-task-audio",
      kind: "audio",
      node: "child-audio",
      text: null,
    },
    {
      asset: null,
      created: "2026-08-07T00:00:04.000Z",
      id: "dl-task-text",
      kind: "text",
      node: "child-text",
      text: "你好，Unboundry\n第二行",
    },
  ];
  for (const row of taskRows) {
    registerTask.run(
      row.id,
      project.id,
      row.node,
      row.kind,
      `dl-key-${row.id}`,
      `dl-fingerprint-${row.id}`,
      row.asset,
      row.text,
      row.created,
      row.created,
    );
  }
  store.close();

  const groupNode = {
    data: { label: "Group", title: "下载组" },
    id: "dl-group",
    position: { x: 100, y: 100 },
    style: { height: 600, width: 1000 },
    type: "group",
    zIndex: 0,
  };
  const emptyGroupNode = {
    data: { label: "Group", title: "空组" },
    id: "empty-group",
    position: { x: 1200, y: 100 },
    style: { height: 300, width: 500 },
    type: "group",
    zIndex: 0,
  };
  const childTuples: Array<[string, string, string]> = [
    ["child-image", "image", "商品图"],
    ["child-video", "video", "视频"],
    ["child-audio", "audio", "音频"],
    ["child-text", "text", "文案"],
  ];
  const childNodes = childTuples.map(([id, type, title], index) => ({
    data: { label: type === "text" ? "Text" : title, title },
    id,
    parentId: "dl-group",
    position: { x: 20, y: 20 + index * 280 },
    style: { height: 250, width: 250 },
    type,
    zIndex: 1,
  }));
  const nodes = [
    groupNode,
    emptyGroupNode,
    ...childNodes,
  ];
  const saved = await request.put(`/api/canvas/${project.id}`, {
    data: {
      edges: [],
      nodes,
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();
  return project;
}

test("group download streams a zip with hashed contents and 说明-free names", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);
  const response = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { groupId: "dl-group" } },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/zip");
  const disposition = response.headers()["content-disposition"];
  expect(disposition).toContain("filename*=UTF-8''");
  expect(
    decodeURIComponent(disposition.split("UTF-8''")[1]),
  ).toContain("工作流结果-");
  const zipBytes = await response.body();
  const working = mkdtempSync(join(tmpdir(), "unboundry-zip-verify-"));
  try {
    const zipPath = join(working, "result.zip");
    writeFileSync(zipPath, zipBytes);
    const output = join(working, "out");
    mkdirSync(output);
    execFileSync("unzip", ["-o", zipPath, "-d", output], {
      stdio: "ignore",
    });
    const names = [
      "商品图-1.png",
      "视频-2.mp4",
      "音频-3.mp3",
      "文案-4.txt",
    ];
    for (const name of names) {
      expect(readFileSync(join(output, name), "utf8")).toBeDefined();
    }
    expect(
      sha256(readFileSync(join(output, "商品图-1.png"))),
    ).toBe(sha256(Buffer.from("fake-image-bytes-123", "utf8")));
    expect(
      sha256(readFileSync(join(output, "视频-2.mp4"))),
    ).toBe(sha256(Buffer.from("fake-video-bytes-456", "utf8")));
    expect(
      sha256(readFileSync(join(output, "音频-3.mp3"))),
    ).toBe(sha256(Buffer.from("fake-audio-bytes-789", "utf8")));
    expect(readFileSync(join(output, "文案-4.txt"), "utf8")).toBe(
      "你好，Unboundry\n第二行",
    );
    expect(existsSync(join(output, "下载说明.txt"))).toBeFalsy();
  } finally {
    rmSync(working, { force: true, recursive: true });
  }
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group download skips missing files, notes them and still completes", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);
  const store = openAppDatabase(dataDirectory);
  store
    .prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, owner_id,
        result_asset_id, created_at, updated_at
      )
      VALUES (
        'dl-task-missing', ?, 'child-missing', 'image', '', 'model-1', '{}',
        'dl-key-missing', 'dl-fingerprint-missing', 'success', 1, '__test__',
        'dl-missing', ?, ?
      )
    `)
    .run(project.id, new Date().toISOString(), new Date().toISOString());
  const storeCanvas = openAppDatabase(dataDirectory);
  const canvas = (
    storeCanvas
      .prepare("SELECT nodes FROM canvas_documents WHERE id = ?")
      .get(project.id) as { nodes: string }
  ).nodes;
  const nodes = JSON.parse(canvas) as Array<Record<string, unknown>>;
  nodes.push({
    data: { label: "Image", title: "缺失图" },
    id: "child-missing",
    parentId: "dl-group",
    position: { x: 20, y: 900 },
    style: { height: 250, width: 250 },
    type: "image",
    zIndex: 1,
  });
  storeCanvas
    .prepare("UPDATE canvas_documents SET nodes = ?, revision = revision + 1 WHERE id = ?")
    .run(JSON.stringify(nodes), project.id);
  storeCanvas.close();
  store.close();

  const response = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { groupId: "dl-group" } },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["x-download-skipped"]).toBe("1");
  const zipBytes = await response.body();
  const working = mkdtempSync(join(tmpdir(), "unboundry-zip-skip-"));
  try {
    const zipPath = join(working, "result.zip");
    writeFileSync(zipPath, zipBytes);
    const output = join(working, "out");
    mkdirSync(output);
    execFileSync("unzip", ["-o", zipPath, "-d", output], {
      stdio: "ignore",
    });
    expect(
      readFileSync(join(output, "下载说明.txt"), "utf8"),
    ).toContain("缺失图");
    expect(
      readFileSync(join(output, "下载说明.txt"), "utf8"),
    ).toContain("结果素材文件缺失");
    expect(
      ["缺失图-5.png", "缺失图-1.png"].some((name) => {
        try {
          readFileSync(join(output, name));
          return true;
        } catch {
          return false;
        }
      }),
    ).toBeFalsy();
  } finally {
    rmSync(working, { force: true, recursive: true });
  }
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group download rejects empty groups, unknown canvases and bad payloads", async ({
  request,
}) => {
  const unknown = await request.post(
    "/api/canvas/not-exist/group-download",
    { data: { groupId: "g" } },
  );
  expect(unknown.status()).toBe(404);

  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);

  const noBody = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: {} },
  );
  expect(noBody.status()).toBe(400);

  const missingGroup = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { groupId: "missing-group" } },
  );
  expect(missingGroup.status()).toBe(404);

  const emptyGroup = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { groupId: "empty-group" } },
  );
  expect(emptyGroup.status()).toBe(400);

  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group download accepts an explicit nodeIds payload", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);
  const response = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { nodeIds: ["child-text"] } },
  );
  expect(response.status()).toBe(200);
  const zipBytes = await response.body();
  const working = mkdtempSync(join(tmpdir(), "unboundry-zip-nodes-"));
  try {
    const zipPath = join(working, "result.zip");
    writeFileSync(zipPath, zipBytes);
    const output = join(working, "out");
    mkdirSync(output);
    execFileSync("unzip", ["-o", zipPath, "-d", output], {
      stdio: "ignore",
    });
    expect(readFileSync(join(output, "文案-1.txt"), "utf8")).toBe(
      "你好，Unboundry\n第二行",
    );
  } finally {
    rmSync(working, { force: true, recursive: true });
  }
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group toolbar downloads the packed zip on a real canvas", async ({
  page,
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);
  const downloads: Array<{
    failure: () => Promise<string | null>;
    suggestedFilename: () => string;
  }> = [];
  page.on("download", (download) => {
    downloads.push({
      failure: () => download.failure(),
      suggestedFilename: () => download.suggestedFilename(),
    });
  });

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page
    .locator('[data-testid="rf__node-dl-group"]')
    .click({ position: { x: 5, y: 5 } });
  await page.getByTestId("group-download-button").click();
  await expect(page.getByTestId("workflow-run-toast")).toContainText(
    "下载完成",
  );
  await expect.poll(() => downloads.length).toBe(1);
  expect(downloads[0].suggestedFilename()).toContain("工作流结果-");
  expect(await downloads[0].failure()).toBeNull();

  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group download packs only the latest success per node", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const project = await setupDownloadCanvas(request, dataDirectory);
  const store = openAppDatabase(dataDirectory);
  store
    .prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, owner_id,
        result_asset_id, result_text, created_at, updated_at
      )
      VALUES (
        'dl-task-text-newer', ?, 'child-text', 'text', '', 'model-1', '{}',
        'dl-key-text-newer', 'dl-fingerprint-text-newer', 'success', 1,
        '__test__', NULL, '这是最新的文字结果', ?, ?
      )
    `)
    .run(project.id, "2026-08-07T00:10:00.000Z", "2026-08-07T00:10:00.000Z");
  store.close();

  const response = await request.post(
    `/api/canvas/${project.id}/group-download`,
    { data: { groupId: "dl-group" } },
  );
  expect(response.status()).toBe(200);
  const zipBytes = await response.body();
  const working = mkdtempSync(join(tmpdir(), "unboundry-zip-latest-"));
  try {
    const zipPath = join(working, "result.zip");
    writeFileSync(zipPath, zipBytes);
    const output = join(working, "out");
    mkdirSync(output);
    execFileSync("unzip", ["-o", zipPath, "-d", output], {
      stdio: "ignore",
    });
    expect(readdirSync(output).sort()).toEqual([
      "商品图-1.png",
      "文案-4.txt",
      "视频-2.mp4",
      "音频-3.mp3",
    ]);
    expect(readFileSync(join(output, "文案-4.txt"), "utf8")).toBe(
      "这是最新的文字结果",
    );
  } finally {
    rmSync(working, { force: true, recursive: true });
  }
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});
