import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createHash } from "node:crypto";

const historyAudioIds = ["history-audio-1", "history-audio-2"] as const;

function prepareHistoryAudioMedia(dataDirectory: string) {
  const store = openAppDatabase(dataDirectory);
  try {
    store.exec("BEGIN IMMEDIATE");
    store.prepare(`
      DELETE FROM asset_history WHERE account_id = 'fixture-audio-success'
    `).run();
    const removeMedia = store.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = '__test__' AND kind = 'audio' AND id = ?
    `);
    const insertMedia = store.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_status, checksum_sha256, content_type, duration_seconds,
        duration_source, duration_status
      ) VALUES (
        'audio', ?, '__test__', ?, 1, ?, ?, 'ready', ?, 'audio/mpeg', 184,
        'server-probe', 'ready'
      )
    `);
    const timestamp = new Date().toISOString();
    for (const id of historyAudioIds) {
      removeMedia.run(id);
      insertMedia.run(
        id,
        `${id}.fixture`,
        timestamp,
        timestamp,
        createHash("sha256").update(`history-audio:${id}`).digest("hex"),
      );
    }
    store.exec("COMMIT");
  } catch (error) {
    try {
      store.exec("ROLLBACK");
    } catch {
      // Preserve the setup failure.
    }
    throw error;
  } finally {
    store.close();
  }
}

function cleanupHistoryAudioMedia(dataDirectory: string) {
  const store = openAppDatabase(dataDirectory);
  try {
    store.exec("BEGIN IMMEDIATE");
    store.prepare(`
      DELETE FROM asset_history WHERE account_id = 'fixture-audio-success'
    `).run();
    const removeMedia = store.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = '__test__' AND kind = 'audio' AND id = ?
    `);
    for (const id of historyAudioIds) removeMedia.run(id);
    store.exec("COMMIT");
  } catch (error) {
    try {
      store.exec("ROLLBACK");
    } catch {
      // Preserve the cleanup failure.
    }
    throw error;
  } finally {
    store.close();
  }
}

function wav(seconds = 2, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = 0.08 + 0.82 * (index / samples);
    buffer.writeInt16LE(
      Math.round(Math.sin((index / sampleRate) * Math.PI * 440) * 32767 * envelope),
      44 + index * 2,
    );
  }
  return buffer;
}

const audioFile = {
  buffer: wav(),
  mimeType: "audio/wav",
  name: "probe.wav",
};

test("Audio success returns two local results without quota accounting", async ({
  page,
  request,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await request.delete("/api/canvas/node.audio.success");
  await request.delete("/api/history/fixture-audio-success");
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = await dataDirectoryResponse.json() as {
    dataDirectory: string;
  };
  prepareHistoryAudioMedia(dataDirectory);
  try {
    await page.goto("/__fixture/node.audio.success");

    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(page.locator(".react-flow__node-audio")).toHaveCount(2);
    await expect(page.getByTestId("audio-node-media")).toHaveCount(2);
    await expect(page.locator('[data-generated-result="true"]')).toHaveCount(2);
    const choices = page.getByRole("group", { name: "生成音频版本" });
    await expect(choices).toBeVisible();
    await expect(choices.getByRole("button")).toHaveCount(2);
    await choices.getByRole("button", { name: "使用音频版本 2" }).click();
    await expect(choices.getByRole("button", { name: "使用音频版本 2" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("audio-node-audio-primary"))
      .toHaveAttribute("data-asset-id", "fixture-audio-result-2.mp3");
    await expect(page.locator("[data-unit-cost]")).toHaveCount(0);
    await expect(page.locator("[data-batch-cost]")).toHaveCount(0);
    await expect(page.getByText("00:00/03:04", { exact: true })).toHaveCount(2);
    await expect(page.getByTestId("credits")).toHaveCount(0);

    await page.getByTestId("history").click();
    await expect(page.getByTestId("history-panel")).toBeVisible();
    await page.getByTestId("history-tab-audio").click();
    await expect(page.getByTestId("history-count-audio")).toHaveText("2");
    await expect(page.getByRole("button", { name: "音频 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "音频 2" })).toBeVisible();

    const history = await request.get("/api/history/fixture-audio-success");
    expect((await history.json() as { items: unknown[] }).items).toHaveLength(2);
    expect(generationRequests).toEqual([]);
  } finally {
    cleanupHistoryAudioMedia(dataDirectory);
  }
});

test("Audio empty, upload and playback chrome match the frozen basic state", async ({
  page,
}) => {
  await page.goto("/__fixture/node.audio.empty");

  const node = page.locator(".react-flow__node-audio");
  const card = page.getByTestId("audio-node-audio-primary");
  expect(await node.boundingBox()).toMatchObject({ width: 444, height: 250 });
  await expect(card).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(card).toHaveCSS("border-radius", "16px");
  const emptyUploadToolbar = page.getByTestId("audio-empty-upload-toolbar");
  await expect(emptyUploadToolbar).not.toBeVisible();
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(0);

  await node.click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("button", { name: "上传音频" })).toBeVisible();
  await expect(emptyUploadToolbar).toBeVisible();
  await expect(emptyUploadToolbar).toContainText("上传");
  expect((await emptyUploadToolbar.boundingBox())!.y)
    .toBeLessThan((await card.boundingBox())!.y);
  const title = page.getByTestId("audio-node-title-input");
  await title.fill("配乐");
  await title.press("Enter");
  await expect(title).toHaveValue("配乐");

  await page.getByTestId("audio-upload-input").setInputFiles(audioFile);
  const media = page.getByTestId("audio-node-media");
  await expect(media).toHaveCount(1);
  await expect(emptyUploadToolbar).not.toBeVisible();

  expect(await node.boundingBox()).toMatchObject({ width: 444, height: 250 });
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  const bars = node.locator(".audio-waveform-bars span");
  await expect(bars).toHaveCount(64);
  await expect
    .poll(() =>
      bars.evaluateAll((elements) =>
        new Set(elements.map((element) => element.getAttribute("style"))).size,
      ),
    )
    .toBeGreaterThan(8);
  await expect(page.getByText("00:00/00:02")).toBeVisible();
  await expect(page.getByRole("button", { name: "后退 10 秒" })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放音频" })).toBeVisible();
  await expect(page.getByRole("button", { name: "前进 10 秒" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载音频" })).toHaveCount(0);
  await expect(
    node.locator(".react-flow__handle.target .node-handle-plus"),
  ).toHaveCount(0);
  await expect(
    node.locator(".react-flow__handle.source .node-handle-plus"),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "前进 10 秒" }).click();
  await expect(page.getByText("00:02/00:02")).toBeVisible();
  await page.getByRole("button", { name: "后退 10 秒" }).click();
  await expect(page.getByText("00:00/00:02")).toBeVisible();

  const replace = page.getByRole("button", { name: "替换" });
  await page.mouse.move(1000, 200);
  await expect(replace).toHaveCSS("opacity", "0");
  const toolbar = page.getByTestId("audio-node-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "下载" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "下载" })).toHaveCSS(
    "white-space",
    "nowrap",
  );
  await expect(toolbar).toHaveCSS("height", "48px");
  expect(await toolbar.boundingBox()).toMatchObject({ width: 183, height: 48 });
  await expect(toolbar.getByRole("button", { name: "音频颜色" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "素材检查" })).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "保存到素材库" }),
  ).toBeVisible();
  await card.hover();
  await expect(replace).toHaveCSS("opacity", "1");

  const playhead = node.locator(".audio-waveform-playhead");
  await page.getByRole("button", { name: "播放音频" }).click();
  const firstPosition = await playhead.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.left),
  );
  await expect
    .poll(
      () =>
        playhead.evaluate((element) =>
          Number.parseFloat((element as HTMLElement).style.left),
        ),
      { timeout: 2_000 },
    )
    .toBeGreaterThan(firstPosition);
  await page.getByRole("button", { name: "暂停音频" }).click();

  const beforeDrag = (await node.boundingBox())!;
  await page.mouse.move(beforeDrag.x + 100, beforeDrag.y + 20);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 180, beforeDrag.y + 100, {
    steps: 4,
  });
  await page.mouse.up();
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - beforeDrag.x).toBeGreaterThan(30);
  expect(afterDrag.y - beforeDrag.y).toBeGreaterThan(30);

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { x: box?.x, y: box?.y };
    })
    .toEqual({ x: beforeDrag.x, y: beforeDrag.y });

  await page.keyboard.press("Meta+z");
  await expect(media).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传音频" })).toBeVisible();

  await page.keyboard.press("Meta+z");
  await expect(title).toHaveValue("Audio");
});
