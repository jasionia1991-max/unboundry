import { expect, test } from "./safe-test";
import { createHash } from "node:crypto";
import { openAppDatabase } from "../server/database";

test("deleting a canvas node does not delete account history", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = await dataDirectoryResponse.json() as {
    dataDirectory: string;
  };
  const fixtureMedia = [
    ["image", "history-image-1"],
    ["image", "history-image-2"],
    ["video", "history-video-1"],
    ["audio", "history-audio-1"],
    ["audio", "history-audio-2"],
    ["audio", "history-audio-3"],
    ["audio", "history-audio-4"],
    ["image", "generated-history-image"],
    ["image", "history-pending-image"],
  ] as const;
  try {
    const store = openAppDatabase(dataDirectory);
    try {
      store.exec("BEGIN IMMEDIATE");
      const timestamp = new Date().toISOString();
      const insertMedia = store.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_status, checksum_sha256, duration_seconds, duration_source,
          duration_status
        )
        VALUES (?, ?, '__test__', ?, 1, ?, ?, 'ready', ?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET
          owner_id = excluded.owner_id,
          storage_status = 'ready',
          checksum_sha256 = excluded.checksum_sha256,
          duration_seconds = excluded.duration_seconds,
          duration_source = excluded.duration_source,
          duration_status = excluded.duration_status,
          updated_at = excluded.updated_at
      `);
      for (const [kind, id] of fixtureMedia) {
        const timedMedia = kind === "video" || kind === "audio";
        insertMedia.run(
          kind,
          id,
          `history-fixture-${kind}-${id}`,
          timestamp,
          timestamp,
          createHash("sha256").update(`m3-history:${kind}:${id}`).digest("hex"),
          timedMedia ? 1 : null,
          timedMedia ? "server-probe" : null,
          timedMedia ? "ready" : "not-applicable",
        );
      }
      store.prepare(`
        UPDATE media_assets
        SET storage_status = 'pending'
        WHERE kind = 'image' AND id = 'history-pending-image'
      `).run();
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
    await page.goto("/__fixture/panel.history.final");

    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-node-count", "3");
    await expect(page.getByTestId("history-panel")).toBeVisible();
    await expect(page.getByTestId("history-count-image")).toHaveText("2");
    await expect(page.getByTestId("history-count-video")).toHaveText("1");
    await expect(page.getByTestId("history-count-audio")).toHaveText("4");

    const generatedHistory = await request.post("/api/history/fixture-account", {
      data: {
        id: "generated-history-image",
        kind: "image",
        label: "一只黑猫",
        preview: "/api/assets/generated-history-image",
      },
    });
    expect(generatedHistory.ok()).toBeTruthy();
    const historyButton = page.getByTestId("history");
    await historyButton.click();
    await historyButton.click();
    const generatedCard = page.getByRole("button", { name: "一只黑猫" });
    await expect(generatedCard).toBeVisible();
    await expect(generatedCard.locator("img")).toHaveAttribute(
      "src",
      "/api/assets/generated-history-image",
    );
    await expect(
      page.getByTestId("history-count-image"),
    ).toHaveText("3");
    await request.delete("/api/history/fixture-account");
    await historyButton.click();
    await historyButton.click();
    await expect(page.getByTestId("history-count-image")).toHaveText("2");

    await page.locator('[data-id="history-canvas-image"]').click();
    await page.keyboard.press("Backspace");
    await expect(world).toHaveAttribute("data-node-count", "2");
    await expect(page.getByTestId("history-panel")).toHaveCount(0);
    await page.waitForTimeout(700);

    const pendingHistory = await request.post("/api/history/fixture-account", {
      data: {
        id: "history-pending-image",
        kind: "image",
        label: "尚未发布的图片",
        preview: "/api/assets/history-pending-image",
      },
    });
    expect(pendingHistory.status()).toBe(409);
    expect(await pendingHistory.json()).toEqual({
      code: "MEDIA_NOT_READY",
      error: "History media must be an owned ready asset",
    });

    const history = await request.get("/api/history/fixture-account");
    expect(history.ok()).toBeTruthy();
    expect((await history.json() as { items: unknown[] }).items).toHaveLength(7);

    await page.getByRole("button", { name: "历史" }).click();
    await expect(page.getByTestId("history-count-image")).toHaveText("2");
    await expect(page.getByTestId("history-count-video")).toHaveText("1");
    await expect(page.getByTestId("history-count-audio")).toHaveText("4");

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-node-count", "2");
    await expect(page.getByTestId("history-count-image")).toHaveText("2");
    await expect(page.getByTestId("history-count-video")).toHaveText("1");
    await expect(page.getByTestId("history-count-audio")).toHaveText("4");
  } finally {
    const cleanup = openAppDatabase(dataDirectory);
    try {
      cleanup.exec("BEGIN IMMEDIATE");
      cleanup.prepare(`
        DELETE FROM asset_history WHERE account_id = 'fixture-account'
      `).run();
      const deleteMedia = cleanup.prepare(`
        DELETE FROM media_assets
        WHERE owner_id = '__test__' AND kind = ? AND id = ?
      `);
      for (const [kind, id] of fixtureMedia) deleteMedia.run(kind, id);
      cleanup.exec("COMMIT");
    } catch (error) {
      try {
        cleanup.exec("ROLLBACK");
      } catch {
        // Preserve the cleanup failure.
      }
      throw error;
    } finally {
      cleanup.close();
    }
  }
});
