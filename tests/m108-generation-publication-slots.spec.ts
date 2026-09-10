import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { saveGeneratedPng } from "../server/assetStorage";
import { bindGenerationOutputSet, GenerationOutputSlotBlockedError } from "../server/generationOutputSlots";
import {
  withGenerationResultSave, assertGenerationSaveToken,
  assertGenerationSaveSettlementInTransaction, GenerationSaveOwnershipError,
  type GenerationSaveToken,
} from "../server/generationResultSaveOwnership";
import {
  publishGenerationMediaCandidate, commitGenerationMediaOutputSet,
  recoverPendingGenerationMediaResults, settleSynchronousResultSaveExhaustion,
} from "../server/generationResultCommit";
import {
  reserveMediaPublication, stageMediaPublication, mediaPublicationStagingPath,
  mediaPublicationFinalPath, pendingGeneratedPublicationTaskIds,
  cleanupPublishedGeneratedMediaStaging, compensateMediaPublication,
  requestOriginalMediaRedownload, MediaPublicationDeferredError,
} from "../server/mediaPublicationService";
import {
  assertMediaPublicationIo, prepareReservedMediaStaging,
  MediaPublicationEvidenceConflictError,
} from "../server/mediaLifecycle";
import { AliyunOssPublicationQuarantineError, deleteExactAliyunOssGenerationObject,
  aliyunOssGenerationIdentityHeaders, type AliyunOssUrllib } from "../server/aliyunOss";
import type { DatabaseSync } from "node:sqlite";
import { publishedGenerationMediaCandidateIds as candidates } from "../server/mediaRegistry";
import { recoverGenerationTasksAtStartupForRuntimeTest } from "../server/generationTasks";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ownerId = "m108-owner";
const model = "m108-model";
const profile = "m108-profile";
type Store = ReturnType<typeof createGenerationTaskStore>;

async function fixture(work: (directory: string, store: Store) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m108-"));
  const prior = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const database = openAppDatabase(directory);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO users (id, login_name, display_name, password_hash,
    role, status, created_at, updated_at) VALUES (?, ?, ?, 'fixture', 'user', 'active', ?, ?)`)
    .run(ownerId, ownerId, ownerId, now, now);
  database.close();
  const store = createGenerationTaskStore(directory);
  try { await work(directory, store); }
  finally {
    store.close();
    if (prior === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = prior;
    await rm(directory, { recursive: true, force: true });
  }
}

function createTask(directory: string, store: Store, count = 1,
  providerTaskId?: string | null) {
  const task = store.create({ ownerId, kind: "image", model,
    canvasId: "m108-canvas", nodeId: `node-${randomUUID()}`,
    idempotencyKey: randomUUID(), prompt: "synthetic", parameters: {},
    providerProfileId: profile, providerModelId: model,
    modelConfiguration: { modelId: model, modelResultCount: count, providerDriver: "multi-protocol-relay",
      providerProtocol: "media-generate", providerModelId: model, providerProfileId: profile },
  }).task;
  store.transition(task.id, "running");
  const database = openAppDatabase(directory);
  database.prepare(`UPDATE generation_tasks SET provider_task_id = ? WHERE id = ?`)
    .run(providerTaskId === undefined ? `provider-${task.id}` : providerTaskId, task.id);
  database.prepare(`INSERT INTO generation_provider_attempts
    (task_id, execution_attempt, owner_id, kind, provider_profile_id, provider_model_id,
      credential_revision, evidence, outcome, provider_task_id, created_at)
    SELECT id, attempt, owner_id, kind, provider_profile_id, provider_model_id,
      credential_revision, 'provider-boundary', 'response-received', provider_task_id, ?
    FROM generation_tasks WHERE id = ?`).run(new Date().toISOString(), task.id);
  database.close();
  return { taskId: task.id, ownerId, kind: "image" as const, executionAttempt: 1 };
}

async function saveSlot(identity: ReturnType<typeof createTask>, token: GenerationSaveToken, slot: number, count: number) {
  const saved = await saveGeneratedPng({ bytes: png, label: "synthetic output", ownerId,
    task: { ...identity, saveToken: token, outputSlot: slot, outputSetCount: count, actualCostMicrounits: 1 },
  });
  if (!("publicationToken" in saved)) throw new Error("Missing publication token");
  publishGenerationMediaCandidate(saved.publicationToken);
  return saved;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("one, two and four identical-byte outputs keep distinct slots and replay without new assets", async () => {
  await fixture(async (directory, store) => {
    for (const count of [1, 2, 4]) {
      const identity = createTask(directory, store, count);
      await withGenerationResultSave(identity, async (token) => {
        bindGenerationOutputSet({ ...identity, token, outputs: Array.from({ length: count }, () => ({ kind: "image", transport: "bytes", bytes: png })) });
        const ids: string[] = [];
        for (let slot = 0; slot < count; slot += 1) {
          const saved = await saveSlot(identity, token, slot, count);
          const replay = await saveSlot(identity, token, slot, count);
          expect(replay.assetId).toBe(saved.assetId);
          ids.push(saved.assetId);
        }
        expect(new Set(ids).size).toBe(count);
        expect(candidates(identity)).toEqual(ids);
        expect(commitGenerationMediaOutputSet({ ...identity, assetIds: ids, saveToken: token }).state).toBe("success");
        expect((await saveSlot(identity, token, 0, count)).assetId).toBe(ids[0]);
      });
      const database = openAppDatabase(directory);
      expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts WHERE task_id = ?").get(identity.taskId)).toEqual({ n: 1 });
      expect(database.prepare("SELECT COUNT(*) AS n FROM media_publication_attempts WHERE task_id = ?").get(identity.taskId)).toEqual({ n: count });
      expect(store.get(identity.taskId)?.state).toBe("success");
      database.prepare("DELETE FROM generation_task_events WHERE task_id = ? AND error_code = 'GENERATION_OUTPUT_SET_V1'").run(identity.taskId);
      database.close();
      await withGenerationResultSave(identity, async (token) => {
        expect(() => bindGenerationOutputSet({ ...identity, token,
          outputs: Array.from({ length: count }, () => ({ kind: "image", transport: "bytes", bytes: png })),
        })).toThrow(GenerationOutputSlotBlockedError);
      });
    }
  });
});

test("OSS cleanup sends an exact version DELETE and never deletes an unversioned or mismatched object", async () => {
  const identity = { byteSize: 4, checksumSha256: "a".repeat(64), contentType: "image/png",
    executionAttempt: 1, format: "png", kind: "image" as const,
    objectKey: "objects/m108/exact.png", ownerId, publicationId: "m108-publication",
    storageProfileId: "m108-storage", taskId: "m108-task" };
  const credentials = { accessKeyId: "fixture", accessKeySecret: "fixture",
    bucket: "fixture-bucket", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", region: "oss-cn-hangzhou" };
  for (const scenario of ["exact", "no-version", "changed-owner"] as const) {
    const requests: { method: string; url: string }[] = [];
    const urllib: AliyunOssUrllib = { async request(url, options = {}) {
      const method = String(options.method ?? "GET").toUpperCase();
      requests.push({ method, url });
      const headers = { "content-length": "4", "content-type": "image/png",
        ...aliyunOssGenerationIdentityHeaders({ ...identity,
          ownerId: scenario === "changed-owner" ? "someone-else" : ownerId }),
        "x-oss-version-id": scenario === "no-version" ? "null" : "exact-version-1",
        "x-oss-request-id": "fixture-request", etag: "fixture-etag" };
      return { data: Buffer.alloc(0), headers, res: { headers } as never,
        status: method === "DELETE" ? 204 : 200 };
    } };
    const action = deleteExactAliyunOssGenerationObject(identity, credentials, {
      urllib, resolver: (async () => [{ address: "93.184.216.34", family: 4 as const }]) as never,
    });
    if (scenario === "exact") {
      await action;
      expect(requests.map(({ method }) => method)).toEqual(["HEAD", "DELETE"]);
      expect(new URL(requests[1].url).searchParams.get("versionId")).toBe("exact-version-1");
    } else {
      await expect(action).rejects.toBeInstanceOf(AliyunOssPublicationQuarantineError);
      expect(requests.map(({ method }) => method)).toEqual(["HEAD"]);
    }
  }
});

test("signed URL renewal preserves identity while reordered or changed output sets are refused", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store, 2);
    await withGenerationResultSave(identity, async (token) => {
      const outputs = ["one", "two"].map((path) => ({ kind: "image" as const, transport: "transient-url" as const, transientUrl: `https://fixture.invalid/${path}?X-Amz-Signature=old&X-Amz-Expires=60` }));
      bindGenerationOutputSet({ ...identity, token, outputs });
      bindGenerationOutputSet({ ...identity, token, outputs: outputs.map((output) => ({ ...output, transientUrl: output.transientUrl.replace("old", "new").replace("=60", "=120") })) });
      expect(() => bindGenerationOutputSet({ ...identity, token, outputs: [...outputs].reverse() })).toThrow(GenerationOutputSlotBlockedError);
      expect(() => bindGenerationOutputSet({ ...identity, token, outputs: [outputs[0]] })).toThrow(GenerationOutputSlotBlockedError);
    });
  });
});

test("a live save beyond thirty seconds is not stolen and nine unrelated tasks plus nested work continue", async () => {
  test.setTimeout(65_000);
  await fixture(async (directory, store) => {
    const identities = Array.from({ length: 10 }, () => createTask(directory, store));
    const entered = deferred(); const finish = deferred();
    const startedAt = Date.now();
    const first = withGenerationResultSave(identities[0], async (token) => {
      entered.resolve();
      await withGenerationResultSave(identities[0], async (nested) => { expect(nested).toBe(token); }, { token });
      await finish.promise;
      assertGenerationSaveToken(token);
    });
    await entered.promise;
    try {
    await Promise.all(identities.slice(1).map((identity) => withGenerationResultSave(identity, async () => undefined)));
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    const database = openAppDatabase(directory);
    database.prepare("UPDATE generation_result_save_leases SET lease_until = '2000-01-01T00:00:00.000Z' WHERE task_id = ?").run(identities[0].taskId);
    database.close();
    expect(await withGenerationResultSave(identities[0], async () => "stolen", { nonBlocking: true })).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 31_000 - (Date.now() - startedAt))));
    expect(await withGenerationResultSave(identities[0], async () => "stolen", { nonBlocking: true })).toBeUndefined();
    } finally { finish.resolve(); await first; }
    expect(await withGenerationResultSave(identities[0], async () => "released")).toBe("released");
  });
});

test("a superseded or forged owner token cannot settle a late result", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let old!: GenerationSaveToken;
    await withGenerationResultSave(identity, async (token) => { old = token; });
    const database = openAppDatabase(directory);
    assertGenerationSaveSettlementInTransaction(database, old);
    await withGenerationResultSave(identity, async (token) => {
      expect(token.fenceEpoch).toBe(old.fenceEpoch + 1);
      expect(() => assertGenerationSaveToken({ ...token })).toThrow(GenerationSaveOwnershipError);
      expect(() => assertGenerationSaveSettlementInTransaction(database, old)).toThrow(GenerationSaveOwnershipError);
    });
    expect(() => assertGenerationSaveSettlementInTransaction(database, old)).toThrow(GenerationSaveOwnershipError);
    database.close();
  });
});


test("lost staged bytes are downloaded from the original result and reuse the same reservation", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let originalId = "";
    await withGenerationResultSave(identity, async (saveToken) => {
      originalId = randomUUID();
      const reservation = reserveMediaPublication({ id: originalId, ownerId,
        kind: "image", contentType: "image/png", finalStorageName: `${originalId}.png`,
        objectKey: `${originalId}.png`, storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, { byteSize: png.length,
        checksumSha256: createHash("sha256").update(png).digest("hex"),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
      await rm(mediaPublicationStagingPath(reservation));
    });
    await recoverPendingGenerationMediaResults();
    expect(store.get(identity.taskId)?.state).toBe("recovering");
    expect(pendingGeneratedPublicationTaskIds().has(identity.taskId)).toBe(false);
    await withGenerationResultSave(identity, async (saveToken) => {
      const saved = await saveSlot(identity, saveToken, 0, 1);
      expect(saved.assetId).toBe(originalId);
      commitGenerationMediaOutputSet({ ...identity, assetIds: [originalId], saveToken });
    });
    expect(store.get(identity.taskId)?.state).toBe("success");
    const database = openAppDatabase(directory);
    expect(database.prepare("SELECT COUNT(*) AS n FROM media_publication_attempts WHERE task_id = ?").get(identity.taskId)).toEqual({ n: 1 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts WHERE task_id = ?").get(identity.taskId)).toEqual({ n: 1 });
    database.close();
  });
});

test("an ID-less synchronous save exhaustion fences the reservation and preserves its bytes", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store, 1, null);
    const partial = Buffer.from("provider-result-evidence");
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), partial, { flag: "wx" });
      expect(settleSynchronousResultSaveExhaustion({
        taskId: identity.taskId, executionAttempt: identity.executionAttempt, saveToken,
      })).toEqual({ state: "failed", taskId: identity.taskId });
    });
    expect(store.get(identity.taskId)?.state).toBe("failed");
    const database = openAppDatabase(directory);
    expect(database.prepare(`SELECT state, error_code
      FROM media_publication_attempts WHERE attempt_id = ?`).get(reservation.attemptId))
      .toEqual({ state: "reserved", error_code: "RESULT_SAVE_FAILED_NO_RETRY" });
    expect(database.prepare(`SELECT provider_task_id, failure_code
      FROM generation_provider_attempts WHERE task_id = ? AND execution_attempt = ?`)
      .get(identity.taskId, identity.executionAttempt))
      .toEqual({ provider_task_id: null, failure_code: "RESULT_SAVE_FAILED_NO_RETRY" });
    database.close();
    expect(await readFile(mediaPublicationStagingPath(reservation))).toEqual(partial);
    expect(pendingGeneratedPublicationTaskIds().has(identity.taskId)).toBe(false);
  });
});

test("a reserved result with a Provider id resumes the original task without a new attempt", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
    });
    expect(store.transition(identity.taskId, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "系统正在找回平台结果；不会重新提交付费请求",
    })?.state).toBe("recovering");
    expect(pendingGeneratedPublicationTaskIds().has(identity.taskId)).toBe(false);
    const launches: Array<{ taskId: string; kind: string }> = [];
    recoverGenerationTasksAtStartupForRuntimeTest({
      store,
      pendingPublicationTaskIds: new Set(),
      launch: (taskId, kind) => launches.push({ taskId, kind }),
    });
    expect(launches).toEqual([{ taskId: identity.taskId, kind: "image" }]);
    expect(store.get(identity.taskId)?.state).toBe("running");
    const database = openAppDatabase(directory);
    expect(database.prepare(`SELECT provider_task_id, attempt
      FROM generation_tasks WHERE id = ?`).get(identity.taskId))
      .toEqual({ provider_task_id: `provider-${identity.taskId}`, attempt: 1 });
    expect(database.prepare(`SELECT COUNT(*) AS n
      FROM generation_provider_attempts WHERE task_id = ?`).get(identity.taskId))
      .toEqual({ n: 1 });
    expect(database.prepare(`SELECT state FROM media_publication_attempts
      WHERE attempt_id = ?`).get(reservation.attemptId)).toEqual({ state: "reserved" });
    database.close();
  });
});

test("a staged evidence conflict defers replacement and preserves the exact staged bytes", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, {
        byteSize: png.length,
        checksumSha256: createHash("sha256").update(png).digest("hex"),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
      requestOriginalMediaRedownload(reservation);
      await writeFile(mediaPublicationStagingPath(reservation), Buffer.from("durable-staged-evidence"));
    });
    const stagedEvidence = Buffer.from("durable-staged-evidence");
    await expect(saveGeneratedPng({
      bytes: png, label: "replacement attempt", ownerId,
      task: { ...identity, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
    })).rejects.toBeInstanceOf(MediaPublicationDeferredError);
    expect(await readFile(mediaPublicationStagingPath(reservation))).toEqual(stagedEvidence);
    const database = openAppDatabase(directory);
    expect(database.prepare(`SELECT state, error_code FROM media_publication_attempts
      WHERE attempt_id = ?`).get(reservation.attemptId))
      .toEqual({ state: "staged", error_code: "MEDIA_ORIGINAL_DOWNLOAD_REQUIRED" });
    expect(database.prepare(`SELECT storage_status FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ?`).get(ownerId, "image", reservation.id))
      .toEqual({ storage_status: "pending" });
    database.close();
  });
});

test("a PNG checksum conflict on existing staging defers and preserves the original evidence", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    const originalChecksum = createHash("sha256").update(png).digest("hex");
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, {
        byteSize: png.length, checksumSha256: originalChecksum,
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
    });

    await expect(saveGeneratedPng({
      bytes: Buffer.concat([png, Buffer.from("different-result-bytes")]),
      label: "checksum-conflict-replacement", ownerId,
      task: { ...identity, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
    })).rejects.toBeInstanceOf(MediaPublicationDeferredError);
    expect(await readFile(mediaPublicationStagingPath(reservation))).toEqual(png);

    const database = openAppDatabase(directory);
    expect(database.prepare(`SELECT state, error_code, checksum_sha256
      FROM media_publication_attempts WHERE attempt_id = ?`).get(reservation.attemptId))
      .toEqual({ state: "staged", error_code: null, checksum_sha256: originalChecksum });
    expect(database.prepare(`SELECT storage_status, checksum_sha256
      FROM media_assets WHERE owner_id = ? AND kind = ? AND id = ?`)
      .get(ownerId, "image", reservation.id))
      .toEqual({ storage_status: "pending", checksum_sha256: originalChecksum });
    expect(database.prepare(`SELECT COUNT(*) AS n
      FROM media_publication_attempts WHERE task_id = ?`).get(identity.taskId))
      .toEqual({ n: 1 });
    database.close();
  });
});

test("ordinary staged re-entry is deferred and preserves the staged metadata and bytes", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, {
        byteSize: png.length,
        checksumSha256: createHash("sha256").update(png).digest("hex"),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
      await expect(prepareReservedMediaStaging({ ...reservation, disposition: "reused-active" }))
        .rejects.toBeInstanceOf(MediaPublicationEvidenceConflictError);
      expect(() => stageMediaPublication(reservation, {
        byteSize: png.length + 1,
        checksumSha256: "b".repeat(64),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      })).toThrow(MediaPublicationEvidenceConflictError);
    });
    expect(await readFile(mediaPublicationStagingPath(reservation))).toEqual(png);
    const database = openAppDatabase(directory);
    expect(database.prepare(`SELECT state, error_code, byte_size, checksum_sha256
      FROM media_publication_attempts WHERE attempt_id = ?`).get(reservation.attemptId))
      .toEqual({
        state: "staged", error_code: null, byte_size: png.length,
        checksum_sha256: createHash("sha256").update(png).digest("hex"),
      });
    expect(database.prepare(`SELECT storage_status, byte_size, checksum_sha256
      FROM media_assets WHERE owner_id = ? AND kind = ? AND id = ?`)
      .get(ownerId, "image", reservation.id))
      .toEqual({
        storage_status: "pending", byte_size: png.length,
        checksum_sha256: createHash("sha256").update(png).digest("hex"),
      });
    database.close();
  });
});

test("published generation cleanup removes only stale staging and keeps the final media", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let saved!: Awaited<ReturnType<typeof saveSlot>>;
    await withGenerationResultSave(identity, async (saveToken) => {
      bindGenerationOutputSet({ ...identity, token: saveToken,
        outputs: [{ kind: "image", transport: "bytes", bytes: png }],
      });
      saved = await saveSlot(identity, saveToken, 0, 1);
      expect(commitGenerationMediaOutputSet({
        ...identity, assetIds: [saved.assetId], saveToken,
      }).state).toBe("success");
    });
    const stagingPath = mediaPublicationStagingPath(saved.publicationToken);
    const finalPath = mediaPublicationFinalPath(saved.publicationToken);
    expect(await readFile(stagingPath)).toEqual(png);
    expect(await readFile(finalPath)).toEqual(png);
    const cleanup = await cleanupPublishedGeneratedMediaStaging();
    expect(cleanup.cleaned).toBe(1);
    expect(cleanup.blocked).toBe(0);
    await expect(readFile(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(finalPath)).toEqual(png);
    expect(store.get(identity.taskId)?.state).toBe("success");
  });
});

function exactCancelledTaskInTransaction(
  database: DatabaseSync,
  reservation: { taskId?: string; taskExecutionAttempt?: number; ownerId: string; kind: string },
) {
  if (!reservation.taskId || reservation.taskExecutionAttempt === undefined) return false;
  const task = database.prepare(`
    SELECT owner_id, kind, attempt, state, error_code
    FROM generation_tasks WHERE id = ?
  `).get(reservation.taskId) as {
    owner_id?: string; kind?: string; attempt?: number; state?: string; error_code?: string;
  } | undefined;
  return Boolean(task && task.owner_id === reservation.ownerId &&
    task.kind === reservation.kind && task.attempt === reservation.taskExecutionAttempt &&
    task.state === "cancelled" && task.error_code === "USER_CANCELLED");
}

test("cancellation waits for the active save lease, then compensates only its exact pending publication", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    let reservation!: ReturnType<typeof reserveMediaPublication>;
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `${assetId}.png`,
        storageBackend: "local",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, {
        byteSize: png.length,
        checksumSha256: createHash("sha256").update(png).digest("hex"),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
      expect(store.transition(identity.taskId, "cancelled", {
        code: "USER_CANCELLED", message: "fixture cancellation",
      })?.state).toBe("cancelled");
      expect(() => assertMediaPublicationIo(reservation)).toThrow();
      expect((await recoverPendingGenerationMediaResults())
        .some((outcome) => outcome.action === "blocked" && outcome.taskId === identity.taskId)).toBe(true);
      const database = openAppDatabase(directory);
      expect(database.prepare("SELECT state FROM media_publication_attempts WHERE attempt_id = ?")
        .get(reservation.attemptId)).toEqual({ state: "staged" });
      database.close();
    });
    const recovered = await recoverPendingGenerationMediaResults();
    expect(recovered).toContainEqual({ action: "failed", assetId: reservation.id, taskId: identity.taskId });
    const database = openAppDatabase(directory);
    expect(database.prepare("SELECT state, error_code FROM media_publication_attempts WHERE attempt_id = ?")
      .get(reservation.attemptId)).toEqual({ state: "failed", error_code: "USER_CANCELLED" });
    expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts WHERE task_id = ?")
      .get(identity.taskId)).toEqual({ n: 1 });
    database.close();
    await expect(readFile(mediaPublicationStagingPath(reservation))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

test("OSS identity uncertainty quarantines cancelled cleanup and retains the staged bytes", async () => {
  await fixture(async (directory, store) => {
    const identity = createTask(directory, store);
    await withGenerationResultSave(identity, async (saveToken) => {
      const assetId = randomUUID();
      const reservation = reserveMediaPublication({
        id: assetId, ownerId, kind: "image", contentType: "image/png",
        finalStorageName: `${assetId}.png`, objectKey: `objects/m108/${assetId}.png`,
        storageBackend: "oss", storageProfileId: "m108-storage",
        task: { ...identity, saveToken, outputSlot: 0, outputSetCount: 1, actualCostMicrounits: 1 },
      });
      await mkdir(join(directory, "media"), { recursive: true });
      await writeFile(mediaPublicationStagingPath(reservation), png, { flag: "wx" });
      stageMediaPublication(reservation, {
        byteSize: png.length,
        checksumSha256: createHash("sha256").update(png).digest("hex"),
        contentType: "image/png", mediaHeight: 1, mediaWidth: 1,
      });
      expect(store.transition(identity.taskId, "cancelled", {
        code: "USER_CANCELLED", message: "fixture cancellation",
      })?.state).toBe("cancelled");
      const result = await compensateMediaPublication(reservation, {
        code: "USER_CANCELLED",
        requireCancelledTask: true,
        assertCancelledTask: exactCancelledTaskInTransaction,
        profile: {
          accessKeyId: "fixture", accessKeySecret: "fixture", bucket: "fixture-bucket",
          createdAt: new Date().toISOString(), endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
          id: "m108-storage", label: "fixture", provider: "aliyun-oss", region: "cn-hangzhou",
          status: "verified", updatedAt: new Date().toISOString(),
        },
        deleteGeneratedExternalObject: async () => {
          throw new AliyunOssPublicationQuarantineError("IDENTITY_MISMATCH", "fixture");
        },
      });
      expect(result).toBe(false);
      expect(await readFile(mediaPublicationStagingPath(reservation))).toEqual(png);
      const database = openAppDatabase(directory);
      expect(database.prepare("SELECT state, error_code FROM media_publication_attempts WHERE attempt_id = ?")
        .get(reservation.attemptId)).toEqual({ state: "compensating", error_code: "OSS_IDENTITY_QUARANTINED" });
      expect(database.prepare("SELECT COUNT(*) AS n FROM generation_provider_attempts WHERE task_id = ?")
        .get(identity.taskId)).toEqual({ n: 1 });
      database.close();
    });
  });
});
