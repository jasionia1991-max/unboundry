import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { assetStorage } from "../server/assetStorage";
import { adminTemplatesApi } from "../server/adminTemplates";
import { audioStorage } from "../server/audioStorage";
import { adminUsersApi, authApi, authGate } from "../server/auth";
import { canvasPersistence } from "../server/canvasPersistence";
import {
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
  generationProviderAttemptCounts,
  GenerationTaskOwnerDeletingError,
  GenerationTaskTransitionError,
} from "../server/generationTaskStore";
import {
  cleanupPublicationStaging,
  compensateMediaPublication,
  failMediaPublication,
  finalizeMediaPublication,
  hasPendingUploadMediaPublications,
  mediaPublicationFinalPath,
  mediaPublicationStagingPath,
  MediaPublicationConflictError,
  markExternalMediaPublicationReady,
  pendingGeneratedPublicationTaskIds,
  publishLocalMediaPublication,
  recoverPendingMediaDeletions,
  recoverPendingGeneratedMediaPublications,
  recoverPendingUploadMediaPublications,
  reserveMediaPublication,
  stageMediaPublication,
  type MediaPublicationReservation,
} from "../server/mediaLifecycle";
import {
  beginMediaDeletion,
  finishMediaDeletion,
  readableMediaForOwner,
  readyMediaForOwner,
} from "../server/mediaRegistry";
import { projectsApi } from "../server/projects";
import { requestRelayGptImage } from "../server/relayProviderAdapters";
import { templateCatalogApi } from "../server/templateCatalog";
import {
  activateStorageProfile,
  deleteStorageProfile,
  listStorageProfiles,
  markStorageProfileVerified,
  readableStorageProfile,
  saveStorageProfile,
  setStorageMediaRouting,
  storageProfileForMedia,
  withStorageMediaRoutingReservation,
} from "../server/secureStorageProfiles";
import { videoStorage } from "../server/videoStorage";
import { expect, test } from "./safe-test";

test.describe.configure({ mode: "serial" });

type GenerationStore = ReturnType<typeof createGenerationTaskStore>;

async function withDataDirectory<T>(
  label: string,
  operation: (directory: string) => Promise<T>,
) {
  const directory = await mkdtemp(join(tmpdir(), `unboundry-m88-${label}-`));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
  try {
    return await operation(directory);
  } finally {
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    if (previousBypass === undefined) {
      delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    } else {
      process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
    await rm(directory, { force: true, recursive: true });
  }
}

function addOwner(directory: string, ownerId: string) {
  const database = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, ownerId, timestamp, timestamp);
  } finally {
    database.close();
  }
}

function addProject(directory: string, ownerId: string, projectId: string) {
  const database = openAppDatabase(directory);
  try {
    const now = Date.now();
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      ) VALUES (?, ?, 'm88 project', ?, 1, ?)
    `).run(ownerId, projectId, now, now);
  } finally {
    database.close();
  }
}

function checksum(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function wavFixture(seconds = 0.1, sampleRate = 8_000) {
  const samples = Math.floor(seconds * sampleRate);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function stageFixture(
  directory: string,
  reservation: MediaPublicationReservation,
  bytes: Buffer = Buffer.from(`m88-${reservation.id}`),
) {
  await mkdir(join(directory, "media"), { recursive: true });
  await writeFile(mediaPublicationStagingPath(reservation), bytes, {
    flag: "wx",
  });
  stageMediaPublication(reservation, {
    byteSize: bytes.length,
    checksumSha256: checksum(bytes),
    contentType: "image/png",
    mediaHeight: 2,
    mediaWidth: 3,
  });
  return bytes;
}

async function publishFixture(
  directory: string,
  reservation: MediaPublicationReservation,
  bytes?: Buffer,
) {
  const staged = await stageFixture(directory, reservation, bytes);
  await publishLocalMediaPublication(reservation);
  return staged;
}

function reserveGeneratedImage(
  store: GenerationStore,
  ownerId: string,
  suffix: string,
) {
  const task = store.create({
    canvasId: `m88-canvas-${suffix}`,
    costCurrency: "USD",
    idempotencyKey: `m88-publication-${suffix}`,
    kind: "image",
    model: "m88-image-model",
    nodeId: `m88-node-${suffix}`,
    ownerId,
    parameters: {},
    prompt: `m88 publication ${suffix}`,
    providerModelId: "m88-provider-image",
    providerProfileId: "m88-provider-profile",
  }).task;
  expect(store.transition(task.id, "running")).toMatchObject({
    attempt: 1,
    state: "running",
  });
  const assetId = `m88-asset-${suffix}`;
  const reservation = reserveMediaPublication({
    contentType: "image/png",
    finalStorageName: `${assetId}.png`,
    historyLabel: `m88 ${suffix}`,
    id: assetId,
    kind: "image",
    objectKey: `${assetId}.png`,
    ownerId,
    storageBackend: "local",
    task: {
      actualCostMicrounits: 123,
      providerUsageTokens: 7,
      taskId: task.id,
    },
  });
  return { reservation, task };
}

function recordProviderAttemptFixture(
  directory: string,
  taskId: string,
  outcome:
    | "accepted"
    | "boundary-claimed"
    | "outcome-unknown"
    | "response-received" = "boundary-claimed",
) {
  const database = openAppDatabase(directory);
  try {
    const inserted = database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome,
        provider_task_id, failure_code, finished_at
      )
      SELECT
        id, attempt, provider_profile_id, provider_model_id,
        kind, 'provider-boundary', ?, owner_id, credential_revision, ?,
        NULL, NULL, NULL
      FROM generation_tasks
      WHERE id = ? AND state = 'running' AND attempt >= 1
    `).run(new Date().toISOString(), outcome, taskId);
    expect(inserted.changes).toBe(1);
  } finally {
    database.close();
  }
}

function providerAttemptSnapshot(directory: string, taskId: string) {
  const database = openAppDatabase(directory);
  try {
    return database.prepare(`
      SELECT execution_attempt, outcome, provider_task_id, failure_code,
             finished_at
      FROM generation_provider_attempts
      WHERE task_id = ?
      ORDER BY execution_attempt
    `).all(taskId);
  } finally {
    database.close();
  }
}

function syntheticResponse() {
  let body = "";
  const headers = new Map<string, string>();
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return response;
    },
    end(value?: unknown) {
      if (typeof value === "string") body += value;
      else if (Buffer.isBuffer(value)) body += value.toString("utf8");
      response.emit("finish");
      return response;
    },
  }) as unknown as ServerResponse;
  return {
    response,
    snapshot: () => ({ body, headers, statusCode: response.statusCode }),
  };
}

async function authorizedRequest(url: string, method = "GET") {
  const request = {
    headers: {},
    method,
    socket: { remoteAddress: "127.0.0.1" },
    url,
  } as unknown as IncomingMessage;
  const output = syntheticResponse();
  let authorized = false;
  await authGate(request, output.response, () => {
    authorized = true;
  });
  expect(authorized).toBe(true);
  return request;
}

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const request = Readable.from([
    Buffer.from(JSON.stringify(body), "utf8"),
  ]) as unknown as IncomingMessage;
  Object.assign(request, {
    headers: { "content-type": "application/json", ...headers },
    method,
    socket: { remoteAddress: "127.0.0.1" },
    url,
  });
  return request;
}

async function authorizedJsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const request = jsonRequest(url, method, body, headers);
  const output = syntheticResponse();
  let authorized = false;
  await authGate(request, output.response, () => {
    authorized = true;
  });
  expect(authorized).toBe(true);
  return request;
}

async function publishUploadFixture(
  directory: string,
  reservation: MediaPublicationReservation,
  contentType: string,
) {
  const bytes = Buffer.from(`m88-upload-${reservation.kind}-${reservation.id}`);
  await mkdir(join(directory, "media"), { recursive: true });
  await writeFile(mediaPublicationStagingPath(reservation), bytes, { flag: "wx" });
  stageMediaPublication(reservation, {
    byteSize: bytes.length,
    checksumSha256: checksum(bytes),
    contentType,
    ...(reservation.kind === "image"
      ? { mediaHeight: 2, mediaWidth: 3 }
      : { durationSeconds: 1, durationSource: "server-probe" as const }),
  });
  if (reservation.storageBackend === "local") {
    await publishLocalMediaPublication(reservation);
  } else {
    markExternalMediaPublicationReady(reservation);
  }
  finalizeMediaPublication(reservation);
  await cleanupPublicationStaging(reservation);
  return bytes;
}

async function expectImageGet404(id: string) {
  const request = await authorizedRequest(`/${id}`);
  const output = syntheticResponse();
  await assetStorage(request, output.response);
  expect(output.snapshot()).toMatchObject({
    statusCode: 404,
  });
  expect(JSON.parse(output.snapshot().body)).toEqual({
    error: "Asset not found",
  });
}

function publicationSnapshot(
  directory: string,
  input: { assetId: string; attemptId: string; taskId: string },
) {
  const database = openAppDatabase(directory);
  try {
    const task = database.prepare(`
      SELECT state, result_asset_id, actual_cost_microunits,
             provider_usage_tokens
      FROM generation_tasks WHERE id = ?
    `).get(input.taskId) as {
      actual_cost_microunits: number | null;
      provider_usage_tokens: number | null;
      result_asset_id: string | null;
      state: string;
    };
    const media = database.prepare(`
      SELECT storage_status FROM media_assets
      WHERE kind = 'image' AND id = ?
    `).get(input.assetId) as { storage_status: string } | undefined;
    const attempt = database.prepare(`
      SELECT state, error_code FROM media_publication_attempts
      WHERE attempt_id = ?
    `).get(input.attemptId) as {
      error_code: string | null;
      state: string;
    };
    const history = database.prepare(`
      SELECT COUNT(*) AS count FROM asset_history
      WHERE id = ?
    `).get(input.assetId) as { count: number };
    const successEvents = database.prepare(`
      SELECT COUNT(*) AS count FROM generation_task_events
      WHERE task_id = ? AND state = 'success'
    `).get(input.taskId) as { count: number };
    return {
      attempt,
      historyCount: Number(history.count),
      mediaStatus: media?.storage_status,
      successEventCount: Number(successEvents.count),
      task,
    };
  } finally {
    database.close();
  }
}

test("schema 39 grants exactly one reservation before either same-ID contender may write bytes", async () => {
  await withDataDirectory("reservation-races", async (directory) => {
    addOwner(directory, "m88-owner-a");
    addOwner(directory, "m88-owner-b");
    expect(currentSchemaVersion).toBe(39);
    const schema = openAppDatabase(directory);
    try {
      expect(
        (schema.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      ).toBe(39);
    } finally {
      schema.close();
    }

    for (const scenario of [
      {
        label: "different-owners",
        owners: ["m88-owner-a", "m88-owner-b"],
      },
      {
        label: "same-owner",
        owners: ["m88-owner-a", "m88-owner-a"],
      },
    ]) {
      const id = `m88-race-${scenario.label}`;
      const writerAdmissions: MediaPublicationReservation[] = [];
      const results = await Promise.allSettled(
        scenario.owners.map((ownerId, index) => Promise.resolve().then(() => {
          const reservation = reserveMediaPublication({
            contentType: "image/png",
            finalStorageName: `${id}-${index}.png`,
            id,
            kind: "image",
            objectKey: `${id}-${index}.png`,
            ownerId,
            storageBackend: "local",
          });
          // This is the physical-writer admission point. A loser must throw
          // before reaching it, while the winner still has not created bytes.
          writerAdmissions.push(reservation);
          return reservation;
        })),
      );
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<MediaPublicationReservation> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(MediaPublicationConflictError);
      expect(writerAdmissions).toHaveLength(1);
      expect(await pathExists(
        mediaPublicationStagingPath(writerAdmissions[0]!),
      )).toBe(false);
      expect(await pathExists(
        mediaPublicationFinalPath(writerAdmissions[0]!),
      )).toBe(false);

      const database = openAppDatabase(directory);
      try {
        const attempts = database.prepare(`
          SELECT owner_id, state FROM media_publication_attempts
          WHERE kind = 'image' AND asset_id = ?
        `).all(id) as Array<{ owner_id: string; state: string }>;
        const media = database.prepare(`
          SELECT owner_id, storage_status FROM media_assets
          WHERE kind = 'image' AND id = ?
        `).all(id) as Array<{ owner_id: string; storage_status: string }>;
        expect(attempts).toEqual([{
          owner_id: writerAdmissions[0]!.ownerId,
          state: "reserved",
        }]);
        expect(media).toEqual([{
          owner_id: writerAdmissions[0]!.ownerId,
          storage_status: "pending",
        }]);
      } finally {
        database.close();
      }
    }
  });
});

test("DELETE tombstones pre-reservation image, audio and video POST routes", async () => {
  await withDataDirectory("pre-reservation-delete", async (directory) => {
    await authorizedRequest("/bootstrap");
    const fixtures = [
      {
        contentType: "image/png",
        fileName: "pre-reserve.png",
        handler: assetStorage,
        id: "m88-pre-reserve-image",
        kind: "image",
      },
      {
        contentType: "audio/mpeg",
        fileName: "pre-reserve.mp3",
        handler: audioStorage,
        id: "m88-pre-reserve-audio.mp3",
        kind: "audio",
      },
      {
        contentType: "video/mp4",
        fileName: "pre-reserve.mp4",
        handler: videoStorage,
        id: "m88-pre-reserve-video.mp4",
        kind: "video",
      },
    ] as const;

    for (const fixture of fixtures) {
      const postRequest = await authorizedRequest(`/${fixture.id}`, "POST");
      postRequest.headers["content-type"] = fixture.contentType;
      postRequest.headers["x-file-name"] = fixture.fileName;
      const postOutput = syntheticResponse();

      let reachedReservationBoundary!: () => void;
      const reservationBoundaryReached = new Promise<void>((resolve) => {
        reachedReservationBoundary = resolve;
      });
      let releaseReservation!: () => void;
      const reservationReleased = new Promise<void>((resolve) => {
        releaseReservation = resolve;
      });
      const post = fixture.handler(postRequest, postOutput.response, {
        beforeReservation: async () => {
          reachedReservationBoundary();
          await reservationReleased;
        },
      });
      await reservationBoundaryReached;
      const deleteRequest = await authorizedRequest(`/${fixture.id}`, "DELETE");
      const deleteOutput = syntheticResponse();
      await fixture.handler(deleteRequest, deleteOutput.response);
      expect(deleteOutput.snapshot()).toMatchObject({ statusCode: 204 });
      releaseReservation();
      await post;
      expect(postOutput.snapshot()).toMatchObject({ statusCode: 409 });
      expect(JSON.parse(postOutput.snapshot().body)).toMatchObject({
        code: "MEDIA_ID_UNAVAILABLE",
      });

      const getRequest = await authorizedRequest(`/${fixture.id}`);
      const getOutput = syntheticResponse();
      await fixture.handler(getRequest, getOutput.response);
      expect(getOutput.snapshot()).toMatchObject({ statusCode: 404 });

      const database = openAppDatabase(directory);
      try {
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM media_delete_intents
          WHERE owner_id = '__test__' AND kind = ? AND asset_id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 1 });
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM media_assets
          WHERE owner_id = '__test__' AND kind = ? AND id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 0 });
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM media_publication_attempts
          WHERE owner_id = '__test__' AND kind = ? AND asset_id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 0 });
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM asset_history
          WHERE account_id = '__test__' AND kind = ? AND id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 0 });
      } finally {
        database.close();
      }
      expect(() => reserveMediaPublication({
        contentType: fixture.contentType,
        finalStorageName: fixture.kind === "image"
          ? `${fixture.id}.png`
          : fixture.id,
        id: fixture.id,
        kind: fixture.kind,
        objectKey: fixture.kind === "image" ? `${fixture.id}.png` : fixture.id,
        ownerId: "__test__",
        storageBackend: "local",
      })).toThrow(MediaPublicationConflictError);
    }
  });
});

test("DELETE wins reserved image, audio and video handlers and their catch paths compensate", async () => {
  await withDataDirectory("reserved-route-delete", async (directory) => {
    await authorizedRequest("/bootstrap");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const fixtures = [
      {
        body: png,
        contentType: "image/png",
        fileName: "reserved.png",
        handler: assetStorage,
        id: "m88-reserved-route-image",
        kind: "image",
      },
      {
        body: Buffer.from("invalid-after-reservation"),
        contentType: "audio/mpeg",
        fileName: "reserved.mp3",
        handler: audioStorage,
        id: "m88-reserved-route-audio.mp3",
        kind: "audio",
      },
      {
        body: Buffer.from("invalid-after-reservation"),
        contentType: "video/mp4",
        fileName: "reserved.mp4",
        handler: videoStorage,
        id: "m88-reserved-route-video.mp4",
        kind: "video",
      },
    ] as const;

    for (const fixture of fixtures) {
      let enteredBody!: () => void;
      const bodyEntered = new Promise<void>((resolve) => {
        enteredBody = resolve;
      });
      let releaseBody!: () => void;
      const bodyReleased = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      const postRequest = await authorizedRequest(`/${fixture.id}`, "POST");
      postRequest.headers["content-type"] = fixture.contentType;
      postRequest.headers["x-file-name"] = fixture.fileName;
      Object.assign(postRequest, {
        async *[Symbol.asyncIterator]() {
          enteredBody();
          await bodyReleased;
          yield fixture.body;
        },
      });
      const postOutput = syntheticResponse();
      const post = fixture.handler(postRequest, postOutput.response);
      await bodyEntered;

      const reserved = openAppDatabase(directory);
      let attemptId = "";
      try {
        const attempt = reserved.prepare(`
          SELECT attempt_id, state FROM media_publication_attempts
          WHERE owner_id = '__test__' AND kind = ? AND asset_id = ?
        `).get(fixture.kind, fixture.id) as {
          attempt_id: string;
          state: string;
        };
        attemptId = attempt.attempt_id;
        expect(attempt.state).toBe("reserved");
      } finally {
        reserved.close();
      }

      const deleteRequest = await authorizedRequest(`/${fixture.id}`, "DELETE");
      const deleteOutput = syntheticResponse();
      await fixture.handler(deleteRequest, deleteOutput.response);
      expect(deleteOutput.snapshot()).toMatchObject({ statusCode: 204 });
      const deferred = openAppDatabase(directory);
      try {
        expect(deferred.prepare(`
          SELECT state, error_code FROM media_publication_attempts
          WHERE attempt_id = ?
        `).get(attemptId)).toEqual({
          error_code: "MEDIA_DELETE_DEFERRED",
          state: "compensating",
        });
      } finally {
        deferred.close();
      }

      releaseBody();
      await post;
      expect(postOutput.snapshot()).toMatchObject({ statusCode: 400 });
      const cleaned = openAppDatabase(directory);
      try {
        expect(cleaned.prepare(`
          SELECT state FROM media_publication_attempts WHERE attempt_id = ?
        `).get(attemptId)).toEqual({ state: "failed" });
        expect(cleaned.prepare(`
          SELECT COUNT(*) AS count FROM media_assets
          WHERE owner_id = '__test__' AND kind = ? AND id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 0 });
        expect(cleaned.prepare(`
          SELECT COUNT(*) AS count FROM asset_history
          WHERE account_id = '__test__' AND kind = ? AND id = ?
        `).get(fixture.kind, fixture.id)).toEqual({ count: 0 });
      } finally {
        cleaned.close();
      }
    }
  });
});

test("DELETE wins staged and external-ready image, audio and video handler barriers", async () => {
  await withDataDirectory("transition-route-delete", async (directory) => {
    await authorizedRequest("/bootstrap");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const video = await readFile(join(
      process.cwd(),
      "client",
      "public",
      "fixtures",
      "video-success.mp4",
    ));
    const fixtures = [
      {
        body: png,
        contentType: "image/png",
        extension: "",
        fileName: "transition.png",
        handler: assetStorage,
        kind: "image",
      },
      {
        body: wavFixture(),
        contentType: "audio/wav",
        extension: ".wav",
        fileName: "transition.wav",
        handler: audioStorage,
        kind: "audio",
      },
      {
        body: video,
        contentType: "video/mp4",
        extension: ".mp4",
        fileName: "transition.mp4",
        handler: videoStorage,
        kind: "video",
      },
    ] as const;

    for (const targetState of ["staged", "external-ready"] as const) {
      for (const fixture of fixtures) {
        const id = `m88-${fixture.kind}-${targetState}${fixture.extension}`;
        const postRequest = await authorizedRequest(`/${id}`, "POST");
        postRequest.headers["content-type"] = fixture.contentType;
        postRequest.headers["x-file-name"] = fixture.fileName;
        Object.assign(postRequest, {
          async *[Symbol.asyncIterator]() {
            yield fixture.body;
          },
        });
        let reachedBarrier!: () => void;
        const barrierReached = new Promise<void>((resolve) => {
          reachedBarrier = resolve;
        });
        let releaseBarrier!: () => void;
        const barrierReleased = new Promise<void>((resolve) => {
          releaseBarrier = resolve;
        });
        let reservation: MediaPublicationReservation | undefined;
        const postOutput = syntheticResponse();
        const post = fixture.handler(postRequest, postOutput.response, {
          afterTransition: async (state, current) => {
            if (state !== targetState) return;
            reservation = current;
            reachedBarrier();
            await barrierReleased;
          },
        });
        await barrierReached;
        if (!reservation) throw new Error("Publication barrier was not reached");

        const atBarrier = openAppDatabase(directory);
        try {
          expect(atBarrier.prepare(`
            SELECT state FROM media_publication_attempts WHERE attempt_id = ?
          `).get(reservation.attemptId)).toEqual({ state: targetState });
        } finally {
          atBarrier.close();
        }
        const deleteRequest = await authorizedRequest(`/${id}`, "DELETE");
        const deleteOutput = syntheticResponse();
        await fixture.handler(deleteRequest, deleteOutput.response);
        expect(deleteOutput.snapshot()).toMatchObject({ statusCode: 204 });
        const deleted = openAppDatabase(directory);
        try {
          expect(deleted.prepare(`
            SELECT state, error_code FROM media_publication_attempts
            WHERE attempt_id = ?
          `).get(reservation.attemptId)).toEqual({
            error_code: "MEDIA_DELETE_DEFERRED",
            state: "compensating",
          });
        } finally {
          deleted.close();
        }

        releaseBarrier();
        await post;
        expect(postOutput.snapshot()).toMatchObject({ statusCode: 400 });
        const cleaned = openAppDatabase(directory);
        try {
          expect(cleaned.prepare(`
            SELECT state FROM media_publication_attempts WHERE attempt_id = ?
          `).get(reservation.attemptId)).toEqual({ state: "failed" });
          expect(cleaned.prepare(`
            SELECT COUNT(*) AS count FROM media_assets
            WHERE owner_id = '__test__' AND kind = ? AND id = ?
          `).get(fixture.kind, id)).toEqual({ count: 0 });
          expect(cleaned.prepare(`
            SELECT COUNT(*) AS count FROM asset_history
            WHERE account_id = '__test__' AND kind = ? AND id = ?
          `).get(fixture.kind, id)).toEqual({ count: 0 });
        } finally {
          cleaned.close();
        }
        expect(await pathExists(mediaPublicationStagingPath(reservation)))
          .toBe(false);
        expect(await pathExists(mediaPublicationFinalPath(reservation)))
          .toBe(false);
      }
    }
  });
});

test("image GET returns 404 for both pending and failed publication rows", async () => {
  await withDataDirectory("read-gate", async (directory) => {
    await authorizedRequest("/bootstrap");
    const id = "m88-hidden-image";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${id}.png`,
      id,
      kind: "image",
      objectKey: `${id}.png`,
      ownerId: "__test__",
      storageBackend: "local",
    });

    expect(readyMediaForOwner("__test__", "image", id)).toBeUndefined();
    await expectImageGet404(id);
    expect(failMediaPublication(reservation, "M88_FIXTURE_FAILURE")).toBe(true);
    expect(readableMediaForOwner("__test__", "image", id)).toMatchObject({
      storageStatus: "failed",
    });
    expect(readyMediaForOwner("__test__", "image", id)).toBeUndefined();
    await expectImageGet404(id);

    const database = openAppDatabase(directory);
    try {
      expect(database.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "M88_FIXTURE_FAILURE",
        state: "compensating",
      });
    } finally {
      database.close();
    }
  });
});

test("generated finalize atomically settles Provider evidence with task, media, history, event and journal", async () => {
  await withDataDirectory("finalize-transaction", async (directory) => {
    const ownerId = "m88-finalize-owner";
    addOwner(directory, ownerId);
    const store = createGenerationTaskStore(directory);
    try {
      const { reservation, task } = reserveGeneratedImage(
        store,
        ownerId,
        "atomic-finalize",
      );
      await publishFixture(directory, reservation);
      recordProviderAttemptFixture(directory, task.id, "response-received");
      const triggerStore = openAppDatabase(directory);
      try {
        triggerStore.exec(`
          CREATE TRIGGER m88_abort_success_event
          BEFORE INSERT ON generation_task_events
          WHEN NEW.state = 'success'
          BEGIN
            SELECT RAISE(ABORT, 'm88 injected success-event failure');
          END;
        `);
      } finally {
        triggerStore.close();
      }

      expect(() => finalizeMediaPublication(reservation)).toThrow(
        /m88 injected success-event failure/,
      );
      const rolledBack = publicationSnapshot(directory, {
        assetId: reservation.id,
        attemptId: reservation.attemptId,
        taskId: task.id,
      });
      expect(rolledBack).toEqual({
        attempt: { error_code: null, state: "external-ready" },
        historyCount: 0,
        mediaStatus: "pending",
        successEventCount: 0,
        task: {
          actual_cost_microunits: 123,
          provider_usage_tokens: 7,
          result_asset_id: reservation.id,
          state: "running",
        },
      });
      expect(providerAttemptSnapshot(directory, task.id)).toEqual([{
        execution_attempt: 1,
        failure_code: null,
        finished_at: null,
        outcome: "response-received",
        provider_task_id: null,
      }]);

      const retryStore = openAppDatabase(directory);
      try {
        retryStore.exec("DROP TRIGGER m88_abort_success_event");
      } finally {
        retryStore.close();
      }
      finalizeMediaPublication(reservation);
      expect(publicationSnapshot(directory, {
        assetId: reservation.id,
        attemptId: reservation.attemptId,
        taskId: task.id,
      })).toEqual({
        attempt: { error_code: null, state: "published" },
        historyCount: 1,
        mediaStatus: "ready",
        successEventCount: 1,
        task: {
          actual_cost_microunits: 123,
          provider_usage_tokens: 7,
          result_asset_id: reservation.id,
          state: "success",
        },
      });
      expect(providerAttemptSnapshot(directory, task.id)).toEqual([{
        execution_attempt: 1,
        failure_code: null,
        finished_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        outcome: "completed",
        provider_task_id: null,
      }]);

      const blocked = reserveGeneratedImage(
        store,
        ownerId,
        "terminal-provider-outcome",
      );
      await publishFixture(directory, blocked.reservation);
      recordProviderAttemptFixture(directory, blocked.task.id, "outcome-unknown");
      expect(() => finalizeMediaPublication(blocked.reservation)).toThrow(
        "Generation Provider attempt cannot complete publication",
      );
      expect(publicationSnapshot(directory, {
        assetId: blocked.reservation.id,
        attemptId: blocked.reservation.attemptId,
        taskId: blocked.task.id,
      })).toMatchObject({
        attempt: { state: "external-ready" },
        historyCount: 0,
        mediaStatus: "pending",
        successEventCount: 0,
        task: { state: "running" },
      });
      expect(providerAttemptSnapshot(directory, blocked.task.id)).toEqual([{
        execution_attempt: 1,
        failure_code: null,
        finished_at: null,
        outcome: "outcome-unknown",
        provider_task_id: null,
      }]);

      const noLedger = reserveGeneratedImage(
        store,
        ownerId,
        "real-owner-without-provider-ledger",
      );
      await publishFixture(directory, noLedger.reservation);
      expect(() => finalizeMediaPublication(noLedger.reservation)).toThrow(
        "Generation task has no matching paid attempt",
      );
      expect(publicationSnapshot(directory, {
        assetId: noLedger.reservation.id,
        attemptId: noLedger.reservation.attemptId,
        taskId: noLedger.task.id,
      })).toEqual({
        attempt: { error_code: null, state: "external-ready" },
        historyCount: 0,
        mediaStatus: "pending",
        successEventCount: 0,
        task: {
          actual_cost_microunits: 123,
          provider_usage_tokens: 7,
          result_asset_id: noLedger.reservation.id,
          state: "running",
        },
      });
      expect(providerAttemptSnapshot(directory, noLedger.task.id)).toEqual([]);
    } finally {
      store.close();
    }
  });
});

test("cancel and generated finalize preserve the winner in both transaction orders", async () => {
  await withDataDirectory("cancel-finalize", async (directory) => {
    const ownerId = "m88-cancel-owner";
    addOwner(directory, ownerId);
    const store = createGenerationTaskStore(directory);
    try {
      const cancelFirst = reserveGeneratedImage(
        store,
        ownerId,
        "cancel-first",
      );
      await publishFixture(directory, cancelFirst.reservation);
      expect(store.cancelBeforeProviderAttempt(cancelFirst.task.id, {
        code: "USER_CANCELLED",
        message: "m88 cancel wins",
      })).toMatchObject({ state: "cancelled" });
      expect(() => finalizeMediaPublication(cancelFirst.reservation)).toThrow();
      expect(readyMediaForOwner(
        ownerId,
        "image",
        cancelFirst.reservation.id,
      )).toBeUndefined();
      expect(await compensateMediaPublication(cancelFirst.reservation, {
        code: "MEDIA_CANCELLED_BEFORE_FINALIZE",
      })).toBe(true);
      expect(await pathExists(
        mediaPublicationFinalPath(cancelFirst.reservation),
      )).toBe(false);
      expect(publicationSnapshot(directory, {
        assetId: cancelFirst.reservation.id,
        attemptId: cancelFirst.reservation.attemptId,
        taskId: cancelFirst.task.id,
      })).toEqual({
        attempt: {
          error_code: "MEDIA_CANCELLED_BEFORE_FINALIZE",
          state: "failed",
        },
        historyCount: 0,
        mediaStatus: undefined,
        successEventCount: 0,
        task: {
          actual_cost_microunits: 123,
          provider_usage_tokens: 7,
          result_asset_id: null,
          state: "cancelled",
        },
      });

      const finalizeFirst = reserveGeneratedImage(
        store,
        ownerId,
        "finalize-first",
      );
      recordProviderAttemptFixture(directory, finalizeFirst.task.id);
      await publishFixture(directory, finalizeFirst.reservation);
      finalizeMediaPublication(finalizeFirst.reservation);
      expect(() => store.cancelBeforeProviderAttempt(finalizeFirst.task.id, {
        code: "USER_CANCELLED",
        message: "m88 late cancel loses",
      })).toThrow(GenerationTaskTransitionError);
      expect(publicationSnapshot(directory, {
        assetId: finalizeFirst.reservation.id,
        attemptId: finalizeFirst.reservation.attemptId,
        taskId: finalizeFirst.task.id,
      })).toMatchObject({
        attempt: { state: "published" },
        historyCount: 1,
        mediaStatus: "ready",
        successEventCount: 1,
        task: {
          result_asset_id: finalizeFirst.reservation.id,
          state: "success",
        },
      });
      expect(providerAttemptSnapshot(directory, finalizeFirst.task.id)).toEqual([{
        execution_attempt: 1,
        failure_code: null,
        finished_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        outcome: "completed",
        provider_task_id: null,
      }]);
    } finally {
      store.close();
    }
  });
});

test("restart finalizes staged local generation evidence without a second Provider boundary", async () => {
  await withDataDirectory("generated-recovery", async (directory) => {
    const ownerId = "m88-recovery-owner";
    addOwner(directory, ownerId);
    const initialStore = createGenerationTaskStore(directory);
    const { reservation, task } = reserveGeneratedImage(
      initialStore,
      ownerId,
      "restart-local",
    );
    recordProviderAttemptFixture(directory, task.id);
    const bytes = await stageFixture(directory, reservation);
    const before = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(before)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 1,
      });
    } finally {
      before.close();
      initialStore.close();
    }

    const recoveredStore = createGenerationTaskStore(directory);
    try {
      expect(recoveredStore.get(task.id)).toMatchObject({
        attempt: 1,
        state: "recovering",
      });
      const preserved = pendingGeneratedPublicationTaskIds();
      expect([...preserved]).toEqual([task.id]);
      expect(failRecoveredGenerationTasks(recoveredStore, preserved)).toEqual([]);
      expect(await recoverPendingGeneratedMediaPublications()).toEqual([{
        action: "finalized",
        assetId: reservation.id,
        taskId: task.id,
      }]);
      expect(recoveredStore.get(task.id)).toMatchObject({
        resultAssetId: reservation.id,
        state: "success",
      });
      expect(await readFile(mediaPublicationFinalPath(reservation))).toEqual(bytes);
      expect(await pathExists(mediaPublicationStagingPath(reservation))).toBe(false);

      const after = openAppDatabase(directory);
      try {
        expect(generationProviderAttemptCounts(after)).toEqual({
          historicalEstimatedProviderAttempts: 0,
          paidProviderRequests: 1,
        });
        expect(after.prepare(`
          SELECT state FROM media_publication_attempts WHERE attempt_id = ?
        `).get(reservation.attemptId)).toEqual({ state: "published" });
        expect(providerAttemptSnapshot(directory, task.id)).toEqual([{
          execution_attempt: 1,
          failure_code: null,
          finished_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          outcome: "completed",
          provider_task_id: null,
        }]);
      } finally {
        after.close();
      }
    } finally {
      recoveredStore.close();
    }
  });
});

test("startup compensates an active local upload and removes only its exact object", async () => {
  await withDataDirectory("upload-recovery", async (directory) => {
    const ownerId = "m88-upload-recovery-owner";
    addOwner(directory, ownerId);
    const id = "m88-unadopted-upload";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${id}.png`,
      id,
      kind: "image",
      objectKey: `${id}.png`,
      ownerId,
      storageBackend: "local",
    });
    await publishFixture(directory, reservation);
    const neighbor = join(directory, "media", "m88-unrelated-object.png");
    const neighborBytes = Buffer.from("unrelated-object-must-survive");
    await writeFile(neighbor, neighborBytes, { flag: "wx" });
    const recoveryCutoff = "9999-12-31T23:59:59.999Z";
    expect(hasPendingUploadMediaPublications({
      updatedBefore: recoveryCutoff,
    })).toBe(true);
    expect(readyMediaForOwner(ownerId, "image", id)).toBeUndefined();

    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: recoveryCutoff,
    })).toEqual([{
      action: "failed",
      assetId: id,
    }]);
    expect(await pathExists(mediaPublicationFinalPath(reservation))).toBe(false);
    expect(await pathExists(mediaPublicationStagingPath(reservation))).toBe(false);
    expect(await readFile(neighbor)).toEqual(neighborBytes);
    expect(readableMediaForOwner(ownerId, "image", id)).toBeUndefined();
    expect(readyMediaForOwner(ownerId, "image", id)).toBeUndefined();
    expect(hasPendingUploadMediaPublications({
      updatedBefore: recoveryCutoff,
    })).toBe(false);

    const database = openAppDatabase(directory);
    try {
      expect(database.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(ownerId, id)).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});

test("canvas PUT durably adopts uploads while recovery and delete tombstones reject late saves", async () => {
  await withDataDirectory("upload-canvas-adoption", async (directory) => {
    await authorizedRequest("/bootstrap");
    const publish = async (id: string) => {
      const reservation = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${id}.png`,
        id,
        kind: "image",
        objectKey: `${id}.png`,
        ownerId: "__test__",
        storageBackend: "local",
      });
      await publishUploadFixture(directory, reservation, "image/png");
      const database = openAppDatabase(directory);
      try {
        database.prepare(`
          UPDATE media_publication_attempts
          SET created_at = '2000-01-01T00:00:00.000Z',
              updated_at = '2000-01-01T00:00:00.000Z'
          WHERE attempt_id = ?
        `).run(reservation.attemptId);
      } finally {
        database.close();
      }
      return reservation;
    };
    const canvasBody = (assetId: string) => ({
      edges: [],
      nodes: [{
        data: {
          assetId,
          imageSrc: `blob:m88-${assetId}`,
        },
        id: `node-${assetId}`,
        position: { x: 0, y: 0 },
        type: "image",
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    const adopted = await publish("m88-adopted-upload");
    const adoptionRequest = await authorizedJsonRequest(
      "/m88-adoption-canvas",
      "PUT",
      canvasBody(adopted.id),
    );
    const adoptionOutput = syntheticResponse();
    await canvasPersistence(adoptionRequest, adoptionOutput.response);
    expect(adoptionOutput.snapshot().statusCode).toBe(200);
    const adoptedState = openAppDatabase(directory);
    try {
      const publication = adoptedState.prepare(`
        SELECT state, adopted_at, adopted_canvas_id
        FROM media_publication_attempts WHERE attempt_id = ?
      `).get(adopted.attemptId) as {
        adopted_at: string | null;
        adopted_canvas_id: string | null;
        state: string;
      };
      expect(publication.state).toBe("published");
      expect(publication.adopted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(publication.adopted_canvas_id).toBe("m88-adoption-canvas");
      expect(adoptedState.prepare(`
        SELECT COUNT(*) AS count FROM asset_history
        WHERE account_id = '__test__' AND id = ?
      `).get(adopted.id)).toEqual({ count: 0 });
      const canvas = adoptedState.prepare(`
        SELECT nodes FROM canvas_documents
        WHERE owner_id = '__test__' AND id = 'm88-adoption-canvas'
      `).get() as { nodes: string };
      expect(JSON.parse(canvas.nodes)[0].data).toMatchObject({
        assetId: adopted.id,
        imageSrc: `/api/assets/${adopted.id}`,
      });
    } finally {
      adoptedState.close();
    }
    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: "9999-12-31T23:59:59.999Z",
    })).toEqual([]);
    expect(readyMediaForOwner("__test__", "image", adopted.id)).toBeDefined();

    const deleteRequest = await authorizedRequest(`/${adopted.id}`, "DELETE");
    const deletion = beginMediaDeletion(deleteRequest, "image", adopted.id);
    expect(deletion).toMatchObject({ action: "physical" });
    if (!deletion || deletion.action !== "physical") {
      throw new Error("Expected adopted upload physical deletion");
    }
    const adoptedLateRequest = await authorizedJsonRequest(
      "/m88-adopted-late-canvas",
      "PUT",
      canvasBody(adopted.id),
    );
    const adoptedLateOutput = syntheticResponse();
    await canvasPersistence(adoptedLateRequest, adoptedLateOutput.response);
    expect(adoptedLateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(adoptedLateOutput.snapshot().body)).toMatchObject({
      code: "CANVAS_MEDIA_UNAVAILABLE",
    });
    await rm(mediaPublicationFinalPath(adopted), { force: true });
    expect(finishMediaDeletion(
      deleteRequest,
      "image",
      adopted.id,
      deletion.media,
    )).toBe(true);

    const rolledBack = await publish("m88-adoption-rollback-upload");
    const injectCanvasFailure = openAppDatabase(directory);
    try {
      injectCanvasFailure.exec(`
        CREATE TRIGGER m88_canvas_adoption_rollback
        BEFORE INSERT ON canvas_documents
        WHEN NEW.id = 'm88-adoption-rollback-canvas'
        BEGIN
          SELECT RAISE(ABORT, 'm88 canvas write failure');
        END;
      `);
    } finally {
      injectCanvasFailure.close();
    }
    const rollbackRequest = await authorizedJsonRequest(
      "/m88-adoption-rollback-canvas",
      "PUT",
      canvasBody(rolledBack.id),
    );
    const rollbackOutput = syntheticResponse();
    await expect(canvasPersistence(
      rollbackRequest,
      rollbackOutput.response,
    )).rejects.toThrow("m88 canvas write failure");
    const rollbackState = openAppDatabase(directory);
    try {
      expect(rollbackState.prepare(`
        SELECT state, adopted_at, adopted_canvas_id
        FROM media_publication_attempts WHERE attempt_id = ?
      `).get(rolledBack.attemptId)).toEqual({
        adopted_at: null,
        adopted_canvas_id: null,
        state: "published",
      });
      expect(rollbackState.prepare(`
        SELECT COUNT(*) AS count FROM canvas_documents
        WHERE owner_id = '__test__' AND id = 'm88-adoption-rollback-canvas'
      `).get()).toEqual({ count: 0 });
      rollbackState.exec("DROP TRIGGER m88_canvas_adoption_rollback");
    } finally {
      rollbackState.close();
    }
    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: "9999-12-31T23:59:59.999Z",
    })).toEqual([{ action: "failed", assetId: rolledBack.id }]);

    const unadopted = await publish("m88-unadopted-published-upload");
    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: "9999-12-31T23:59:59.999Z",
    })).toEqual([{ action: "failed", assetId: unadopted.id }]);
    expect(await pathExists(mediaPublicationFinalPath(unadopted))).toBe(false);
    expect(readableMediaForOwner(
      "__test__",
      "image",
      unadopted.id,
    )).toBeUndefined();
    const lateRequest = await authorizedJsonRequest(
      "/m88-late-canvas",
      "PUT",
      canvasBody(unadopted.id),
    );
    const lateOutput = syntheticResponse();
    await canvasPersistence(lateRequest, lateOutput.response);
    expect(lateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(lateOutput.snapshot().body)).toMatchObject({
      code: "CANVAS_MEDIA_UNAVAILABLE",
    });
    const noLateCanvas = openAppDatabase(directory);
    try {
      expect(noLateCanvas.prepare(`
        SELECT COUNT(*) AS count FROM canvas_documents
        WHERE owner_id = '__test__' AND id IN (
          'm88-adopted-late-canvas', 'm88-late-canvas'
        )
      `).get()).toEqual({ count: 0 });
    } finally {
      noLateCanvas.close();
    }
  });
});

test("deletion hides the row before physical removal and journals published to compensating to failed", async () => {
  await withDataDirectory("delete-order", async (directory) => {
    const request = await authorizedRequest("/m88-deletable-upload", "DELETE");
    const id = "m88-deletable-upload";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${id}.png`,
      historyLabel: "m88 deletable upload",
      id,
      kind: "image",
      objectKey: `${id}.png`,
      ownerId: "__test__",
      storageBackend: "local",
    });
    await publishFixture(directory, reservation);
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation);
    expect(readyMediaForOwner("__test__", "image", id)).toBeDefined();
    expect(await pathExists(mediaPublicationFinalPath(reservation))).toBe(true);

    const deletion = beginMediaDeletion(request, "image", id);
    expect(deletion).toMatchObject({
      action: "physical",
      media: { storageStatus: "ready" },
    });
    if (!deletion || deletion.action !== "physical") {
      throw new Error("Expected physical media deletion");
    }
    const media = deletion.media;
    expect(readyMediaForOwner("__test__", "image", id)).toBeUndefined();
    expect(readableMediaForOwner("__test__", "image", id)).toMatchObject({
      storageStatus: "failed",
    });
    expect(await pathExists(mediaPublicationFinalPath(reservation))).toBe(true);
    await expectImageGet404(id);

    const hidden = openAppDatabase(directory);
    try {
      expect(hidden.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "MEDIA_DELETE_REQUESTED",
        state: "compensating",
      });
      expect(hidden.prepare(`
        SELECT COUNT(*) AS count FROM asset_history WHERE id = ?
      `).get(id)).toEqual({ count: 0 });
    } finally {
      hidden.close();
    }

    await rm(mediaPublicationFinalPath(reservation));
    expect(finishMediaDeletion(request, "image", id, media!)).toBe(true);
    expect(readableMediaForOwner("__test__", "image", id)).toBeUndefined();
    const finished = openAppDatabase(directory);
    try {
      expect(finished.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "MEDIA_DELETED",
        state: "failed",
      });
      expect(finished.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).get(id)).toEqual({ count: 0 });
    } finally {
      finished.close();
    }
  });
});

test("published DELETE retries physical failure instead of returning deferred success", async () => {
  await withDataDirectory("published-delete-retry", async (directory) => {
    await authorizedRequest("/bootstrap");
    const id = "m88-published-delete-retry";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${id}.png`,
      historyLabel: "m88 published delete retry",
      id,
      kind: "image",
      objectKey: `${id}.png`,
      ownerId: "__test__",
      storageBackend: "local",
    });
    await publishFixture(directory, reservation);
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation);

    const finalPath = mediaPublicationFinalPath(reservation);
    await rm(finalPath);
    await mkdir(finalPath);
    const firstRequest = await authorizedRequest(`/${id}`, "DELETE");
    const firstOutput = syntheticResponse();
    await assetStorage(firstRequest, firstOutput.response);
    expect(firstOutput.snapshot()).toMatchObject({ statusCode: 503 });
    await expectImageGet404(id);
    const failedPhysical = openAppDatabase(directory);
    try {
      expect(failedPhysical.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "MEDIA_DELETE_FAILED",
        state: "compensating",
      });
      expect(failedPhysical.prepare(`
        SELECT state FROM media_delete_intents
        WHERE owner_id = '__test__' AND kind = 'image' AND asset_id = ?
      `).get(id)).toEqual({ state: "delete-failed" });
      expect(failedPhysical.prepare(`
        SELECT storage_status FROM media_assets
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).get(id)).toEqual({ storage_status: "failed" });
    } finally {
      failedPhysical.close();
    }

    await rm(finalPath, { recursive: true });
    const secondRequest = await authorizedRequest(`/${id}`, "DELETE");
    const secondOutput = syntheticResponse();
    await assetStorage(secondRequest, secondOutput.response);
    expect(secondOutput.snapshot()).toMatchObject({ statusCode: 204 });
    expect(readableMediaForOwner("__test__", "image", id)).toBeUndefined();
    const retried = openAppDatabase(directory);
    try {
      expect(retried.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(reservation.attemptId)).toEqual({
        error_code: "MEDIA_DELETED",
        state: "failed",
      });
      expect(retried.prepare(`
        SELECT COUNT(*) AS count FROM media_delete_intents
        WHERE owner_id = '__test__' AND kind = 'image' AND asset_id = ?
      `).get(id)).toEqual({ count: 1 });
    } finally {
      retried.close();
    }
  });
});

test("published image audio and video DELETE routes are single-flight and retry the fixed OSS object", async () => {
  await withDataDirectory("published-delete-single-flight", async (directory) => {
    await authorizedRequest("/bootstrap");
    const original = await saveStorageProfile({
      accessKeyId: "m88-delete-original-key",
      accessKeySecret: "m88-delete-original-secret",
      bucket: "m88-delete-original-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 delete original",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(original.id);
    await activateStorageProfile(original.id);
    const replacement = await saveStorageProfile({
      accessKeyId: "m88-delete-replacement-key",
      accessKeySecret: "m88-delete-replacement-secret",
      bucket: "m88-delete-replacement-bucket",
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
      label: "M88 delete replacement",
      region: "oss-cn-beijing",
    });
    await markStorageProfileVerified(replacement.id);
    await activateStorageProfile(replacement.id);

    const fixtures = [
      {
        contentType: "image/png",
        extension: ".png",
        handler: assetStorage,
        kind: "image",
      },
      {
        contentType: "audio/mpeg",
        extension: ".mp3",
        handler: audioStorage,
        kind: "audio",
      },
      {
        contentType: "video/mp4",
        extension: ".mp4",
        handler: videoStorage,
        kind: "video",
      },
    ] as const;

    for (const fixture of fixtures) {
      const id = `m88-single-flight-${fixture.kind}${
        fixture.kind === "image" ? "" : fixture.extension
      }`;
      const finalStorageName = fixture.kind === "image"
        ? `${id}.png`
        : id;
      const objectKey = `objects/2026/08/${fixture.kind}/${id}${
        fixture.kind === "image" ? fixture.extension : ""
      }`;
      const reservation = reserveMediaPublication({
        contentType: fixture.contentType,
        finalStorageName,
        id,
        kind: fixture.kind,
        objectKey,
        ownerId: "__test__",
        storageBackend: "oss",
        storageProfileId: original.id,
      });
      await publishUploadFixture(directory, reservation, fixture.contentType);

      let reachedPhysicalBoundary!: () => void;
      const physicalBoundaryReached = new Promise<void>((resolve) => {
        reachedPhysicalBoundary = resolve;
      });
      let releasePhysicalBoundary!: () => void;
      const physicalBoundaryReleased = new Promise<void>((resolve) => {
        releasePhysicalBoundary = resolve;
      });
      const deleteCalls: Array<{ bucket: string; key: string }> = [];
      const firstRequest = await authorizedRequest(`/${id}`, "DELETE");
      const firstOutput = syntheticResponse();
      const first = fixture.handler(firstRequest, firstOutput.response, {
        beforePhysicalDelete: async () => {
          reachedPhysicalBoundary();
          await physicalBoundaryReleased;
        },
        deleteExternalObject: async (key, profile) => {
          deleteCalls.push({ bucket: profile.bucket, key });
        },
      });
      await physicalBoundaryReached;

      let duplicatePhysicalCalls = 0;
      const duplicateRequest = await authorizedRequest(`/${id}`, "DELETE");
      const duplicateOutput = syntheticResponse();
      await fixture.handler(duplicateRequest, duplicateOutput.response, {
        beforePhysicalDelete: () => {
          duplicatePhysicalCalls += 1;
        },
        deleteExternalObject: async () => {
          duplicatePhysicalCalls += 1;
        },
      });
      expect(duplicateOutput.snapshot().statusCode).toBe(409);
      expect(duplicatePhysicalCalls).toBe(0);
      releasePhysicalBoundary();
      await first;
      expect(firstOutput.snapshot().statusCode).toBe(204);
      expect(deleteCalls).toEqual([{
        bucket: "m88-delete-original-bucket",
        key: objectKey,
      }]);

      const retryId = `m88-failed-retry-${fixture.kind}${
        fixture.kind === "image" ? "" : fixture.extension
      }`;
      const retryObjectKey = `objects/2026/08/${fixture.kind}/${retryId}${
        fixture.kind === "image" ? fixture.extension : ""
      }`;
      const retryReservation = reserveMediaPublication({
        contentType: fixture.contentType,
        finalStorageName: fixture.kind === "image"
          ? `${retryId}.png`
          : retryId,
        id: retryId,
        kind: fixture.kind,
        objectKey: retryObjectKey,
        ownerId: "__test__",
        storageBackend: "oss",
        storageProfileId: original.id,
      });
      await publishUploadFixture(
        directory,
        retryReservation,
        fixture.contentType,
      );
      let failedDeleteCalls = 0;
      const failedRequest = await authorizedRequest(`/${retryId}`, "DELETE");
      const failedOutput = syntheticResponse();
      await fixture.handler(failedRequest, failedOutput.response, {
        deleteExternalObject: async (key, profile) => {
          failedDeleteCalls += 1;
          expect(key).toBe(retryObjectKey);
          expect(profile.bucket).toBe("m88-delete-original-bucket");
          throw new Error("m88 deterministic delete failure");
        },
      });
      expect(failedOutput.snapshot().statusCode).toBe(503);
      const failed = openAppDatabase(directory);
      try {
        expect(failed.prepare(`
          SELECT state FROM media_delete_intents
          WHERE owner_id = '__test__' AND kind = ? AND asset_id = ?
        `).get(fixture.kind, retryId)).toEqual({ state: "delete-failed" });
        expect(failed.prepare(`
          SELECT state, error_code FROM media_publication_attempts
          WHERE attempt_id = ?
        `).get(retryReservation.attemptId)).toEqual({
          error_code: "MEDIA_DELETE_FAILED",
          state: "compensating",
        });
      } finally {
        failed.close();
      }

      const retryRequest = await authorizedRequest(`/${retryId}`, "DELETE");
      const retryOutput = syntheticResponse();
      await fixture.handler(retryRequest, retryOutput.response, {
        deleteExternalObject: async (key, profile) => {
          failedDeleteCalls += 1;
          expect(key).toBe(retryObjectKey);
          expect(profile.bucket).toBe("m88-delete-original-bucket");
        },
      });
      expect(retryOutput.snapshot().statusCode).toBe(204);
      expect(failedDeleteCalls).toBe(2);
    }
  });
});

test("old requested and failed OSS deletions recover exact fixed objects while legacy null profiles fail closed", async () => {
  await withDataDirectory("delete-startup-recovery", async (directory) => {
    await authorizedRequest("/bootstrap");
    const profile = await saveStorageProfile({
      accessKeyId: "m88-recovery-delete-key",
      accessKeySecret: "m88-recovery-delete-secret",
      bucket: "m88-recovery-delete-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 recovery delete",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(profile.id);
    await activateStorageProfile(profile.id);

    const reservePublished = async (id: string) => {
      const objectKey = `objects/2026/08/image/${id}.png`;
      const reservation = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${id}.png`,
        id,
        kind: "image",
        objectKey,
        ownerId: "__test__",
        storageBackend: "oss",
        storageProfileId: profile.id,
      });
      await publishUploadFixture(directory, reservation, "image/png");
      return { objectKey, reservation };
    };

    const requested = await reservePublished("m88-recover-requested");
    const requestedRequest = await authorizedRequest(
      `/${requested.reservation.id}`,
      "DELETE",
    );
    expect(beginMediaDeletion(
      requestedRequest,
      "image",
      requested.reservation.id,
    )).toMatchObject({ action: "physical" });

    const failed = await reservePublished("m88-recover-failed");
    const failedRequest = await authorizedRequest(
      `/${failed.reservation.id}`,
      "DELETE",
    );
    const failedOutput = syntheticResponse();
    await assetStorage(failedRequest, failedOutput.response, {
      deleteExternalObject: async () => {
        throw new Error("m88 fail before recovery");
      },
    });
    expect(failedOutput.snapshot().statusCode).toBe(503);

    const legacy = await reservePublished("m88-recover-legacy-null");
    const legacyRequest = await authorizedRequest(
      `/${legacy.reservation.id}`,
      "DELETE",
    );
    expect(beginMediaDeletion(
      legacyRequest,
      "image",
      legacy.reservation.id,
    )).toMatchObject({ action: "physical" });

    const oldTimestamp = "2000-01-01T00:00:00.000Z";
    const aged = openAppDatabase(directory);
    try {
      aged.prepare(`
        UPDATE media_delete_intents SET updated_at = ?
        WHERE owner_id = '__test__' AND kind = 'image'
          AND asset_id IN (?, ?, ?)
      `).run(
        oldTimestamp,
        requested.reservation.id,
        failed.reservation.id,
        legacy.reservation.id,
      );
      aged.prepare(`
        UPDATE media_assets SET storage_profile_id = NULL
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).run(legacy.reservation.id);
    } finally {
      aged.close();
    }

    const deleted: Array<{ bucket: string; key: string }> = [];
    expect(await recoverPendingMediaDeletions({
      deleteExternalObject: async (key, credentials) => {
        deleted.push({ bucket: credentials.bucket, key });
      },
      updatedBefore: "9999-12-31T23:59:59.999Z",
    })).toEqual([
      {
        action: "deleted",
        assetId: failed.reservation.id,
        kind: "image",
        ownerId: "__test__",
      },
      {
        action: "blocked",
        assetId: legacy.reservation.id,
        kind: "image",
        ownerId: "__test__",
      },
      {
        action: "deleted",
        assetId: requested.reservation.id,
        kind: "image",
        ownerId: "__test__",
      },
    ]);
    expect(deleted).toEqual([
      {
        bucket: "m88-recovery-delete-bucket",
        key: failed.objectKey,
      },
      {
        bucket: "m88-recovery-delete-bucket",
        key: requested.objectKey,
      },
    ]);

    const recovered = openAppDatabase(directory);
    try {
      for (const publication of [requested, failed]) {
        expect(recovered.prepare(`
          SELECT state, error_code FROM media_publication_attempts
          WHERE attempt_id = ?
        `).get(publication.reservation.attemptId)).toEqual({
          error_code: "MEDIA_DELETED",
          state: "failed",
        });
        expect(recovered.prepare(`
          SELECT state FROM media_delete_intents
          WHERE owner_id = '__test__' AND kind = 'image' AND asset_id = ?
        `).get(publication.reservation.id)).toEqual({ state: "tombstone" });
      }
      expect(recovered.prepare(`
        SELECT storage_status, storage_profile_id FROM media_assets
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).get(legacy.reservation.id)).toEqual({
        storage_profile_id: null,
        storage_status: "failed",
      });
      expect(recovered.prepare(`
        SELECT state FROM media_delete_intents
        WHERE owner_id = '__test__' AND kind = 'image' AND asset_id = ?
      `).get(legacy.reservation.id)).toEqual({ state: "delete-failed" });
    } finally {
      recovered.close();
    }
  });
});

test("DELETE rejects every active generation publication without changing state", async () => {
  await withDataDirectory("active-delete-conflict", async (directory) => {
    await authorizedRequest("/bootstrap");
    const store = createGenerationTaskStore(directory);
    for (const state of ["reserved", "staged", "external-ready"] as const) {
      const { reservation } = reserveGeneratedImage(
        store,
        "__test__",
        `delete-conflict-${state}`,
      );
      const id = reservation.id;
      if (state !== "reserved") await stageFixture(directory, reservation);
      if (state === "external-ready") {
        markExternalMediaPublicationReady(reservation);
      }
      const before = openAppDatabase(directory);
      let snapshot: unknown;
      try {
        snapshot = {
          attempt: before.prepare(`
            SELECT state, error_code, retry_count
            FROM media_publication_attempts WHERE attempt_id = ?
          `).get(reservation.attemptId),
          media: before.prepare(`
            SELECT storage_status, byte_size, checksum_sha256
            FROM media_assets WHERE owner_id = ? AND kind = ? AND id = ?
          `).get(reservation.ownerId, reservation.kind, reservation.id),
        };
      } finally {
        before.close();
      }

      const request = await authorizedRequest(`/${id}`, "DELETE");
      expect(() => beginMediaDeletion(request, "image", id)).toThrow(
        "Media publication is still active",
      );
      const after = openAppDatabase(directory);
      try {
        expect({
          attempt: after.prepare(`
            SELECT state, error_code, retry_count
            FROM media_publication_attempts WHERE attempt_id = ?
          `).get(reservation.attemptId),
          media: after.prepare(`
            SELECT storage_status, byte_size, checksum_sha256
            FROM media_assets WHERE owner_id = ? AND kind = ? AND id = ?
          `).get(reservation.ownerId, reservation.kind, reservation.id),
        }).toEqual(snapshot);
      } finally {
        after.close();
      }
      expect(await compensateMediaPublication(reservation, {
        code: "M88_ACTIVE_DELETE_FIXTURE_CLEANUP",
      })).toBe(true);
      expect(await pathExists(mediaPublicationStagingPath(reservation))).toBe(false);
    }
    store.close();
  });
});

test("DELETE wins staged and external-ready uploads without losing late OSS cleanup", async () => {
  await withDataDirectory("upload-delete-interleaving", async (directory) => {
    await authorizedRequest("/bootstrap");
    const profile = {
      accessKeyId: "m88-delete-race-access-key",
      accessKeySecret: "m88-delete-race-secret-key",
      bucket: "m88-delete-race-bucket",
      createdAt: new Date().toISOString(),
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      id: "m88-delete-race-profile",
      label: "M88 delete race",
      provider: "aliyun-oss" as const,
      region: "oss-cn-shanghai",
      status: "active" as const,
      updatedAt: new Date().toISOString(),
    };
    let providerCalls = 0;

    for (const state of ["staged", "external-ready"] as const) {
      const id = `m88-upload-delete-${state}`;
      const reservation = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${id}.png`,
        id,
        kind: "image",
        objectKey: `objects/2026/08/image/${id}.png`,
        ownerId: "__test__",
        storageBackend: "oss",
        storageProfileId: profile.id,
      });
      await stageFixture(directory, reservation);
      if (state === "external-ready") {
        markExternalMediaPublicationReady(reservation);
      }

      const request = await authorizedRequest(`/${id}`, "DELETE");
      const output = syntheticResponse();
      await assetStorage(request, output.response);
      expect(output.snapshot()).toMatchObject({ statusCode: 204 });
      await expectImageGet404(id);

      const deferred = openAppDatabase(directory);
      try {
        expect(deferred.prepare(`
          SELECT state, error_code FROM media_publication_attempts
          WHERE attempt_id = ?
        `).get(reservation.attemptId)).toEqual({
          error_code: "MEDIA_DELETE_DEFERRED",
          state: "compensating",
        });
        expect(deferred.prepare(`
          SELECT storage_status FROM media_assets
          WHERE owner_id = ? AND kind = ? AND id = ?
        `).get(reservation.ownerId, reservation.kind, reservation.id))
          .toEqual({ storage_status: "failed" });
      } finally {
        deferred.close();
      }

      // The in-flight publisher resumes after DELETE. Its next journal CAS
      // loses, so its catch path compensates the exact fixed OSS key.
      expect(() => state === "staged"
        ? markExternalMediaPublicationReady(reservation)
        : finalizeMediaPublication(reservation)).toThrow();
      let deletedKeys = 0;
      expect(await compensateMediaPublication(reservation, {
        code: "M88_UPLOAD_DELETE_RACE_CLEANUP",
        deleteExternalObject: async (key, credentials) => {
          deletedKeys += 1;
          expect(key).toBe(reservation.objectKey);
          expect(credentials.bucket).toBe(profile.bucket);
        },
        profile,
      })).toBe(true);
      expect(deletedKeys).toBe(1);
      expect(providerCalls).toBe(0);
      expect(await pathExists(mediaPublicationStagingPath(reservation))).toBe(false);
      expect(readableMediaForOwner("__test__", "image", id)).toBeUndefined();

      const cleaned = openAppDatabase(directory);
      try {
        expect(cleaned.prepare(`
          SELECT state FROM media_publication_attempts WHERE attempt_id = ?
        `).get(reservation.attemptId)).toEqual({ state: "failed" });
        expect(cleaned.prepare(`
          SELECT COUNT(*) AS count FROM asset_history
          WHERE account_id = '__test__' AND id = ?
        `).get(id)).toEqual({ count: 0 });
      } finally {
        cleaned.close();
      }
    }
  });
});

test("restart finalizes resumed OSS evidence against the original paid Provider attempt", async () => {
  await withDataDirectory("generated-oss-recovery", async (directory) => {
    const ownerId = "m88-oss-recovery-owner";
    addOwner(directory, ownerId);
    const initialStore = createGenerationTaskStore(directory);
    const task = initialStore.create({
      canvasId: "m88-oss-recovery-canvas",
      costCurrency: "USD",
      idempotencyKey: "m88-oss-recovery-publication",
      kind: "image",
      model: "m88-image-model",
      nodeId: "m88-oss-recovery-node",
      ownerId,
      parameters: {},
      prompt: "m88 verified oss recovery",
      providerModelId: "m88-provider-image",
      providerProfileId: "m88-provider-profile",
    }).task;
    initialStore.transition(task.id, "running");
    recordProviderAttemptFixture(directory, task.id);
    initialStore.attachProviderTaskId({
      executionAttempt: 1,
      providerTaskId: "m88-oss-provider-task",
      taskId: task.id,
    });
    initialStore.transition(task.id, "failed", {
      code: "TIMEOUT",
      message: "m88 resume the accepted remote task",
    });
    const failedTask = initialStore.get(task.id)!;
    const retryInputKey = "m88-oss-recovery-input-key";
    const retryCanvasRevision = 1;
    const retryCanvas = openAppDatabase(directory);
    try {
      retryCanvas.prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport,
          updated_at, save_session_id, save_sequence
        ) VALUES (?, ?, 1, ?, ?, '[]', '{}', ?, NULL, 0)
      `).run(
        ownerId,
        failedTask.canvasId,
        retryCanvasRevision,
        JSON.stringify([{
          data: {
            imageGenerationInputKey: retryInputKey,
            imageGenerationTaskId: failedTask.id,
          },
          id: failedTask.nodeId,
          type: failedTask.kind,
        }]),
        failedTask.updatedAt,
      );
    } finally {
      retryCanvas.close();
    }
    expect(initialStore.admitRetry({
      canvasId: failedTask.canvasId,
      expectedAttempt: failedTask.attempt,
      expectedCanvasRevision: retryCanvasRevision,
      expectedGenerationInputKey: retryInputKey,
      expectedUpdatedAt: failedTask.updatedAt,
      kind: failedTask.kind,
      mode: "resume-provider-task",
      nodeId: failedTask.nodeId,
      taskId: task.id,
    })).toMatchObject({
      attempt: 1,
      providerTaskId: "m88-oss-provider-task",
      state: "queued",
    });
    expect(initialStore.transition(task.id, "running")).toMatchObject({
      attempt: 2,
      providerTaskId: "m88-oss-provider-task",
      state: "running",
    });
    const assetId = "m88-oss-recovery-asset";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${assetId}.png`,
      historyLabel: "m88 verified oss recovery",
      id: assetId,
      kind: "image",
      objectKey: `objects/2026/08/image/${assetId}.png`,
      ownerId,
      storageBackend: "oss",
      storageProfileId: "m88-oss-profile",
      task: {
        actualCostMicrounits: 321,
        providerUsageTokens: 9,
        taskId: task.id,
      },
    });
    await stageFixture(directory, reservation, Buffer.from("m88-verified-oss"));
    markExternalMediaPublicationReady(reservation);
    initialStore.close();

    const recoveredStore = createGenerationTaskStore(directory);
    try {
      const preserved = pendingGeneratedPublicationTaskIds();
      expect([...preserved]).toEqual([task.id]);
      expect(failRecoveredGenerationTasks(recoveredStore, preserved)).toEqual([]);
      expect(await recoverPendingGeneratedMediaPublications()).toEqual([{
        action: "finalized",
        assetId,
        taskId: task.id,
      }]);
      expect(recoveredStore.get(task.id)).toMatchObject({
        actualCostMicrounits: 321,
        providerUsageTokens: 9,
        resultAssetId: assetId,
        state: "success",
      });
      expect(readyMediaForOwner(ownerId, "image", assetId)).toMatchObject({
        storageBackend: "oss",
        storageStatus: "ready",
      });
      expect(await pathExists(mediaPublicationStagingPath(reservation))).toBe(false);
      const evidence = openAppDatabase(directory);
      try {
        expect(generationProviderAttemptCounts(evidence)).toEqual({
          historicalEstimatedProviderAttempts: 0,
          paidProviderRequests: 1,
        });
        expect(evidence.prepare(`
          SELECT state FROM media_publication_attempts WHERE attempt_id = ?
        `).get(reservation.attemptId)).toEqual({ state: "published" });
        expect(providerAttemptSnapshot(directory, task.id)).toEqual([{
          execution_attempt: 1,
          failure_code: null,
          finished_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          outcome: "completed",
          provider_task_id: "m88-oss-provider-task",
        }]);
      } finally {
        evidence.close();
      }
    } finally {
      recoveredStore.close();
    }
  });
});

test("project and account deletion return 409 while schema triggers preserve active journals", async () => {
  await withDataDirectory("active-owner-task-delete", async (directory) => {
    await authorizedRequest("/bootstrap");
    const projectId = "m88-canvas-project-delete-guard";
    addProject(directory, "__test__", projectId);
    const generationStore = createGenerationTaskStore(directory);
    const task = generationStore.create({
      canvasId: projectId,
      costCurrency: "USD",
      idempotencyKey: "m88-project-delete-guard",
      kind: "image",
      model: "m88-image-model",
      nodeId: "m88-project-delete-node",
      ownerId: "__test__",
      parameters: {},
      prompt: "m88 project deletion guard",
      providerModelId: "m88-provider-image",
      providerProfileId: "m88-provider-profile",
    }).task;
    generationStore.transition(task.id, "running");
    const taskReservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: "m88-project-delete-asset.png",
      historyLabel: "m88 project deletion guard",
      id: "m88-project-delete-asset",
      kind: "image",
      objectKey: "m88-project-delete-asset.png",
      ownerId: "__test__",
      storageBackend: "local",
      task: { actualCostMicrounits: 1, taskId: task.id },
    });

    const projectRequest = await authorizedRequest(`/${projectId}`, "DELETE");
    const projectResponse = syntheticResponse();
    await projectsApi(projectRequest, projectResponse.response);
    expect(projectResponse.snapshot().statusCode).toBe(409);
    expect(JSON.parse(projectResponse.snapshot().body)).toMatchObject({
      code: "MEDIA_PUBLICATION_ACTIVE",
    });
    const taskGuard = openAppDatabase(directory);
    try {
      expect(() => taskGuard.prepare(
        "DELETE FROM generation_tasks WHERE id = ?",
      ).run(task.id)).toThrow("active media publication blocks task deletion");
      expect(taskGuard.prepare(`
        SELECT state FROM media_publication_attempts WHERE attempt_id = ?
      `).get(taskReservation.attemptId)).toEqual({ state: "reserved" });
    } finally {
      taskGuard.close();
    }

    const accountId = "m88-account-delete-guard";
    addOwner(directory, accountId);
    const accountReservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: "m88-account-delete-asset.png",
      id: "m88-account-delete-asset",
      kind: "image",
      objectKey: "m88-account-delete-asset.png",
      ownerId: accountId,
      storageBackend: "local",
    });
    const accountRequest = await authorizedRequest(`/${accountId}`, "DELETE");
    const accountResponse = syntheticResponse();
    await adminUsersApi(accountRequest, accountResponse.response);
    expect(accountResponse.snapshot().statusCode).toBe(409);
    expect(JSON.parse(accountResponse.snapshot().body)).toMatchObject({
      code: "MEDIA_PUBLICATION_ACTIVE",
    });
    const ownerGuard = openAppDatabase(directory);
    try {
      expect(() => ownerGuard.prepare(
        "DELETE FROM users WHERE id = ?",
      ).run(accountId)).toThrow("active media publication blocks owner deletion");
      expect(ownerGuard.prepare(`
        SELECT state FROM media_publication_attempts WHERE attempt_id = ?
      `).get(accountReservation.attemptId)).toEqual({ state: "reserved" });
    } finally {
      ownerGuard.close();
    }

    expect(await compensateMediaPublication(taskReservation, {
      code: "M88_PROJECT_DELETE_GUARD_CLEANUP",
    })).toBe(true);
    expect(await compensateMediaPublication(accountReservation, {
      code: "M88_ACCOUNT_DELETE_GUARD_CLEANUP",
    })).toBe(true);
    generationStore.close();
  });
});

test("account deletion preserves retry evidence and fixed OSS credentials until all physical media are removed", async () => {
  await withDataDirectory("account-delete-saga", async (directory) => {
    await authorizedRequest("/bootstrap");
    const ownerId = "m88-account-saga-owner";
    addOwner(directory, ownerId);
    const original = await saveStorageProfile({
      accessKeyId: "m88-account-original-key",
      accessKeySecret: "m88-account-original-secret",
      bucket: "m88-account-original-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 account original",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(original.id);
    await activateStorageProfile(original.id);
    const replacement = await saveStorageProfile({
      accessKeyId: "m88-account-replacement-key",
      accessKeySecret: "m88-account-replacement-secret",
      bucket: "m88-account-replacement-bucket",
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
      label: "M88 account replacement",
      region: "oss-cn-beijing",
    });
    await markStorageProfileVerified(replacement.id);

    const ossId = "z-m88-account-oss";
    const ossKey = `objects/2026/08/image/${ossId}.png`;
    const oss = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${ossId}.png`,
      id: ossId,
      kind: "image",
      objectKey: ossKey,
      ownerId,
      storageBackend: "oss",
      storageProfileId: original.id,
    });
    await publishUploadFixture(directory, oss, "image/png");
    const localId = "a-m88-account-local";
    const local = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${localId}.png`,
      id: localId,
      kind: "image",
      objectKey: `${localId}.png`,
      ownerId,
      storageBackend: "local",
    });
    await publishUploadFixture(directory, local, "image/png");
    expect(await pathExists(mediaPublicationFinalPath(local))).toBe(true);

    const physicalDeletes: string[] = [];
    const remoteDeletes: Array<{ bucket: string; key: string }> = [];
    const firstRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const firstOutput = syntheticResponse();
    await adminUsersApi(firstRequest, firstOutput.response, {
      beforePhysicalMediaDelete: ({ id }) => {
        physicalDeletes.push(id);
      },
      deleteExternalObject: async (key, credentials) => {
        remoteDeletes.push({ bucket: credentials.bucket, key });
        throw new Error("m88 deterministic account cleanup failure");
      },
    });
    expect(firstOutput.snapshot().statusCode).toBe(503);
    expect(JSON.parse(firstOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_MEDIA_CLEANUP_FAILED",
    });
    expect(remoteDeletes).toEqual([{
      bucket: "m88-account-original-bucket",
      key: ossKey,
    }]);
    expect(physicalDeletes).toEqual([localId, ossId]);
    expect(await pathExists(mediaPublicationFinalPath(local))).toBe(false);
    const failed = openAppDatabase(directory);
    try {
      expect(failed.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(ownerId)).toEqual({ status: "disabled" });
      expect(failed.prepare(`
        SELECT state, error_code, retry_count
        FROM account_delete_intents WHERE owner_id = ?
      `).get(ownerId)).toEqual({
        error_code: "ACCOUNT_MEDIA_CLEANUP_FAILED",
        retry_count: 0,
        state: "failed",
      });
      expect(failed.prepare(`
        SELECT id, storage_status FROM media_assets
        WHERE owner_id = ? ORDER BY id
      `).all(ownerId)).toEqual([
        { id: ossId, storage_status: "failed" },
      ]);
      expect(failed.prepare(`
        SELECT asset_id, state FROM media_delete_intents
        WHERE owner_id = ? ORDER BY asset_id
      `).all(ownerId)).toEqual([
        { asset_id: localId, state: "tombstone" },
        { asset_id: ossId, state: "delete-failed" },
      ]);
    } finally {
      failed.close();
    }

    await activateStorageProfile(replacement.id);
    const retryRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const retryOutput = syntheticResponse();
    await adminUsersApi(retryRequest, retryOutput.response, {
      beforePhysicalMediaDelete: ({ id }) => {
        physicalDeletes.push(id);
      },
      deleteExternalObject: async (key, credentials) => {
        remoteDeletes.push({ bucket: credentials.bucket, key });
      },
    });
    expect(retryOutput.snapshot().statusCode).toBe(200);
    expect(remoteDeletes).toEqual([
      { bucket: "m88-account-original-bucket", key: ossKey },
      { bucket: "m88-account-original-bucket", key: ossKey },
    ]);
    expect(physicalDeletes).toEqual([localId, ossId, ossId]);
    expect(await pathExists(mediaPublicationFinalPath(local))).toBe(false);
    const removed = openAppDatabase(directory);
    try {
      expect(removed.prepare(`
        SELECT COUNT(*) AS count FROM users WHERE id = ?
      `).get(ownerId)).toEqual({ count: 0 });
      expect(removed.prepare(`
        SELECT COUNT(*) AS count FROM media_assets WHERE owner_id = ?
      `).get(ownerId)).toEqual({ count: 0 });
      expect(removed.prepare(`
        SELECT COUNT(*) AS count FROM account_delete_intents WHERE owner_id = ?
      `).get(ownerId)).toEqual({ count: 0 });
    } finally {
      removed.close();
    }

    const legacyOwner = "m88-account-legacy-owner";
    addOwner(directory, legacyOwner);
    const legacy = openAppDatabase(directory);
    try {
      const timestamp = new Date().toISOString();
      legacy.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, storage_profile_id, object_key, content_type,
          checksum_sha256, storage_status, duration_seconds, duration_source,
          duration_status, media_width, media_height
        ) VALUES (
          'image', 'm88-account-legacy-oss', ?, 'm88-account-legacy-oss.png',
          1, ?, ?, 'oss', NULL,
          'objects/legacy/m88-account-legacy-oss.png', 'image/png', ?, 'ready',
          NULL, NULL, 'not-applicable', 1, 1
        )
      `).run(legacyOwner, timestamp, timestamp, "0".repeat(64));
    } finally {
      legacy.close();
    }
    let legacyPhysicalCalls = 0;
    const legacyRequest = await authorizedRequest(`/${legacyOwner}`, "DELETE");
    const legacyOutput = syntheticResponse();
    await adminUsersApi(legacyRequest, legacyOutput.response, {
      beforePhysicalMediaDelete: () => {
        legacyPhysicalCalls += 1;
      },
      deleteExternalObject: async () => {
        legacyPhysicalCalls += 1;
      },
    });
    expect(legacyOutput.snapshot().statusCode).toBe(503);
    expect(legacyPhysicalCalls).toBe(0);
    const legacyFailed = openAppDatabase(directory);
    try {
      expect(legacyFailed.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(legacyOwner)).toEqual({ status: "disabled" });
      expect(legacyFailed.prepare(`
        SELECT state FROM account_delete_intents WHERE owner_id = ?
      `).get(legacyOwner)).toEqual({ state: "failed" });
      expect(legacyFailed.prepare(`
        SELECT storage_status, storage_profile_id FROM media_assets
        WHERE owner_id = ?
      `).get(legacyOwner)).toEqual({
        storage_profile_id: null,
        storage_status: "failed",
      });
    } finally {
      legacyFailed.close();
    }
  });
});

test("account deletion waits for authenticated mutation responses and authGate rejects intent-first mutations", async () => {
  await withDataDirectory("account-delete-mutation-lease", async (directory) => {
    await authorizedRequest("/bootstrap");
    const createRequest = await authorizedJsonRequest("/", "POST", {
      displayName: "M88 mutation lease owner",
      loginName: "m88-mutation-lease-owner",
      password: "m88-mutation-lease-password",
      role: "user",
    });
    const createOutput = syntheticResponse();
    await adminUsersApi(createRequest, createOutput.response);
    expect(createOutput.snapshot().statusCode).toBe(201);
    const ownerId = (JSON.parse(createOutput.snapshot().body) as {
      user: { id: string };
    }).user.id;
    const media = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: "m88-mutation-lease-media.png",
      id: "m88-mutation-lease-media",
      kind: "image",
      objectKey: "m88-mutation-lease-media.png",
      ownerId,
      storageBackend: "local",
    });
    await publishUploadFixture(directory, media, "image/png");

    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    let cookie = "";
    let intentFirstRequest: IncomingMessage;
    const heldRequest = jsonRequest("/held-mutation", "POST", {});
    const heldAuthorization = syntheticResponse();
    let heldAuthorized = false;
    try {
      const loginRequest = jsonRequest("/login", "POST", {
        loginName: "m88-mutation-lease-owner",
        password: "m88-mutation-lease-password",
      });
      const loginOutput = syntheticResponse();
      await authApi(loginRequest, loginOutput.response);
      expect(loginOutput.snapshot().statusCode).toBe(200);
      cookie = (loginOutput.snapshot().headers.get("set-cookie") ?? "")
        .split(";")[0];
      expect(cookie).toContain("unboundry_session=");
      Object.assign(heldRequest.headers, { cookie });
      intentFirstRequest = jsonRequest(
        "/intent-first-mutation",
        "POST",
        {},
        { cookie },
      );
      authGate(heldRequest, heldAuthorization.response, () => {
        heldAuthorized = true;
      });
    } finally {
      if (previousBypass === undefined) {
        delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      } else {
        process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
      }
    }
    expect(heldAuthorized).toBe(true);

    let blockedPhysicalCalls = 0;
    const blockedRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const blockedOutput = syntheticResponse();
    await adminUsersApi(blockedRequest, blockedOutput.response, {
      beforePhysicalMediaDelete: () => {
        blockedPhysicalCalls += 1;
      },
    });
    expect(blockedOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(blockedOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(blockedPhysicalCalls).toBe(0);
    const blockedState = openAppDatabase(directory);
    try {
      expect(blockedState.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(ownerId)).toEqual({ status: "active" });
      expect(blockedState.prepare(`
        SELECT COUNT(*) AS count FROM account_delete_intents
        WHERE owner_id = ?
      `).get(ownerId)).toEqual({ count: 0 });
    } finally {
      blockedState.close();
    }

    heldAuthorization.response.end();
    heldAuthorization.response.emit("close");

    let reachedPhysicalBoundary!: () => void;
    const physicalBoundaryReached = new Promise<void>((resolve) => {
      reachedPhysicalBoundary = resolve;
    });
    let releasePhysicalBoundary!: () => void;
    const physicalBoundaryReleased = new Promise<void>((resolve) => {
      releasePhysicalBoundary = resolve;
    });
    let deletePhysicalCalls = 0;
    const deleteRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const deleteOutput = syntheticResponse();
    const deleting = adminUsersApi(deleteRequest, deleteOutput.response, {
      beforePhysicalMediaDelete: async () => {
        deletePhysicalCalls += 1;
        reachedPhysicalBoundary();
        await physicalBoundaryReleased;
      },
    });
    await physicalBoundaryReached;

    const intentFirstOutput = syntheticResponse();
    let intentFirstAuthorized = false;
    const intentFirstBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    try {
      authGate(intentFirstRequest!, intentFirstOutput.response, () => {
        intentFirstAuthorized = true;
      });
    } finally {
      if (intentFirstBypass === undefined) {
        delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      } else {
        process.env.UNBOUNDRY_TEST_AUTH_BYPASS = intentFirstBypass;
      }
    }
    expect(intentFirstAuthorized).toBe(false);
    expect(intentFirstOutput.snapshot().statusCode).toBe(401);

    releasePhysicalBoundary();
    await deleting;
    expect(deleteOutput.snapshot().statusCode).toBe(200);
    expect(deletePhysicalCalls).toBe(1);
    expect(await pathExists(mediaPublicationFinalPath(media))).toBe(false);
  });
});

test("account deletion retains its actor lease after response close until the saga settles", async () => {
  await withDataDirectory("account-delete-actor-lease", async (directory) => {
    await authorizedRequest("/bootstrap");
    const createAccount = async (
      loginName: string,
      role: "admin" | "user",
    ) => {
      const request = await authorizedJsonRequest("/", "POST", {
        displayName: loginName,
        loginName,
        password: `${loginName}-password`,
        role,
      });
      const output = syntheticResponse();
      await adminUsersApi(request, output.response);
      expect(output.snapshot().statusCode).toBe(201);
      return (JSON.parse(output.snapshot().body) as {
        user: { id: string };
      }).user.id;
    };
    const actorLogin = "m88-deletion-actor";
    const actorId = await createAccount(actorLogin, "admin");
    const targetId = await createAccount("m88-deletion-actor-target", "user");
    const readyMedia = async (ownerId: string, id: string) => {
      const media = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${id}.png`,
        id,
        kind: "image",
        objectKey: `${id}.png`,
        ownerId,
        storageBackend: "local",
      });
      await publishUploadFixture(directory, media, "image/png");
      return media;
    };
    const actorMedia = await readyMedia(actorId, "m88-deletion-actor-media");
    const targetMedia = await readyMedia(targetId, "m88-deletion-target-media");

    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    let actorDeleteRequest: IncomingMessage;
    let actorDeleteOutput: ReturnType<typeof syntheticResponse>;
    let deletingTarget!: Promise<void>;
    let reachedPhysicalBoundary!: () => void;
    const physicalBoundaryReached = new Promise<void>((resolve) => {
      reachedPhysicalBoundary = resolve;
    });
    let releasePhysicalBoundary!: () => void;
    const physicalBoundaryReleased = new Promise<void>((resolve) => {
      releasePhysicalBoundary = resolve;
    });
    let dispatched = false;
    try {
      const loginRequest = jsonRequest("/login", "POST", {
        loginName: actorLogin,
        password: `${actorLogin}-password`,
      });
      const loginOutput = syntheticResponse();
      await authApi(loginRequest, loginOutput.response);
      expect(loginOutput.snapshot().statusCode).toBe(200);
      const cookie = (loginOutput.snapshot().headers.get("set-cookie") ?? "")
        .split(";")[0];
      expect(cookie).toContain("unboundry_session=");
      actorDeleteRequest = {
        headers: { cookie },
        method: "DELETE",
        socket: { remoteAddress: "127.0.0.1" },
        url: `/${targetId}`,
      } as unknown as IncomingMessage;
      actorDeleteOutput = syntheticResponse();
      authGate(actorDeleteRequest, actorDeleteOutput.response, () => {
        dispatched = true;
        deletingTarget = adminUsersApi(
          actorDeleteRequest,
          actorDeleteOutput.response,
          {
            beforePhysicalMediaDelete: async () => {
              reachedPhysicalBoundary();
              await physicalBoundaryReleased;
            },
          },
        );
      });
    } finally {
      if (previousBypass === undefined) {
        delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      } else {
        process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
      }
    }
    expect(dispatched).toBe(true);
    await physicalBoundaryReached;

    // A client disconnect releases the generic response lease, but the
    // deletion actor stays retained until its asynchronous saga settles.
    actorDeleteOutput!.response.emit("close");
    let blockedPhysicalCalls = 0;
    const blockedRequest = await authorizedRequest(`/${actorId}`, "DELETE");
    const blockedOutput = syntheticResponse();
    await adminUsersApi(blockedRequest, blockedOutput.response, {
      beforePhysicalMediaDelete: () => {
        blockedPhysicalCalls += 1;
      },
    });
    expect(blockedOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(blockedOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(blockedPhysicalCalls).toBe(0);
    const blockedDisableRequest = await authorizedJsonRequest(
      `/${actorId}`,
      "PATCH",
      { status: "disabled" },
    );
    const blockedDisableOutput = syntheticResponse();
    await adminUsersApi(
      blockedDisableRequest,
      blockedDisableOutput.response,
    );
    expect(blockedDisableOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(blockedDisableOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    const blockedState = openAppDatabase(directory);
    try {
      expect(blockedState.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(actorId)).toEqual({ status: "active" });
      expect(blockedState.prepare(`
        SELECT COUNT(*) AS count FROM account_delete_intents
        WHERE owner_id = ?
      `).get(actorId)).toEqual({ count: 0 });
    } finally {
      blockedState.close();
    }

    releasePhysicalBoundary();
    await deletingTarget;
    expect(actorDeleteOutput!.snapshot().statusCode).toBe(200);
    expect(await pathExists(mediaPublicationFinalPath(targetMedia))).toBe(false);

    const disableRequest = await authorizedJsonRequest(
      `/${actorId}`,
      "PATCH",
      { status: "disabled" },
    );
    const disableOutput = syntheticResponse();
    await adminUsersApi(disableRequest, disableOutput.response);
    expect(disableOutput.snapshot().statusCode).toBe(200);
    expect(JSON.parse(disableOutput.snapshot().body)).toMatchObject({
      user: { id: actorId, status: "disabled" },
    });

    let actorPhysicalCalls = 0;
    const actorRequest = await authorizedRequest(`/${actorId}`, "DELETE");
    const actorOutput = syntheticResponse();
    await adminUsersApi(actorRequest, actorOutput.response, {
      beforePhysicalMediaDelete: () => {
        actorPhysicalCalls += 1;
      },
    });
    expect(actorOutput.snapshot().statusCode).toBe(200);
    expect(actorPhysicalCalls).toBe(1);
    expect(await pathExists(mediaPublicationFinalPath(actorMedia))).toBe(false);
  });
});

test("account deletion writer-lock guards concurrent writers and transfers retained template roots", async () => {
  await withDataDirectory("account-delete-writer-guards", async (directory) => {
    await authorizedRequest("/bootstrap");
    const graph = {
      edges: [{
        id: "edge-1",
        source: "node-1",
        sourceHandle: "source",
        target: "node-2",
        targetHandle: "target",
        type: "cuttable",
      }],
      nodes: [
        {
          data: { label: "Text", title: "节点1" },
          id: "node-1",
          position: { x: 20, y: 40 },
          style: { height: 250, width: 250 },
          type: "text",
          zIndex: 1,
        },
        {
          data: { label: "Image", title: "节点2" },
          id: "node-2",
          position: { x: 320, y: 40 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        },
      ],
      version: 1,
    };

    const createTargetRequest = await authorizedJsonRequest("/", "POST", {
      displayName: "M88 deleting admin",
      loginName: "m88-deleting-admin",
      password: "m88-deleting-admin-password",
      role: "admin",
    });
    const createTargetOutput = syntheticResponse();
    await adminUsersApi(createTargetRequest, createTargetOutput.response);
    expect(createTargetOutput.snapshot().statusCode).toBe(201);
    const targetId = (JSON.parse(createTargetOutput.snapshot().body) as {
      user: { id: string };
    }).user.id;
    const mediaId = "m88-delete-guard-media";
    const media = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${mediaId}.png`,
      id: mediaId,
      kind: "image",
      objectKey: `${mediaId}.png`,
      ownerId: targetId,
      storageBackend: "local",
    });
    await publishUploadFixture(directory, media, "image/png");

    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    let userTemplateRequest: IncomingMessage;
    let publicTemplateRequest: IncomingMessage;
    let createFirstRequest: IncomingMessage;
    let deletionFirstCreateRequest: IncomingMessage;
    let passwordChangeRequest: IncomingMessage;
    try {
      const loginRequest = jsonRequest("/login", "POST", {
        loginName: "m88-deleting-admin",
        password: "m88-deleting-admin-password",
      });
      const loginOutput = syntheticResponse();
      await authApi(loginRequest, loginOutput.response);
      expect(loginOutput.snapshot().statusCode).toBe(200);
      const cookie = (loginOutput.snapshot().headers.get("set-cookie") ?? "")
        .split(";")[0];
      expect(cookie).toContain("unboundry_session=");
      userTemplateRequest = jsonRequest("/", "POST", {
        category: "电商",
        graph,
        title: "删除竞态私有模板",
      }, { cookie });
      publicTemplateRequest = jsonRequest("/", "POST", {
        category: ["电商"],
        graph,
        status: "draft",
        title: "删除竞态公共模板",
      }, { cookie });
      createFirstRequest = jsonRequest("/", "POST", {
        displayName: "M88 create first",
        loginName: "m88-create-first",
        password: "m88-create-first-password",
        role: "user",
      }, { cookie });
      deletionFirstCreateRequest = jsonRequest("/", "POST", {
        displayName: "M88 deletion first ghost",
        loginName: "m88-deletion-first-ghost",
        password: "m88-deletion-first-password",
        role: "user",
      }, { cookie });
      passwordChangeRequest = jsonRequest("/password", "POST", {
        currentPassword: "m88-deleting-admin-password",
        newPassword: "m88-deleting-admin-new-password",
      }, { cookie });
      for (const request of [
        userTemplateRequest,
        publicTemplateRequest,
        createFirstRequest,
        deletionFirstCreateRequest,
      ]) {
        const authorization = syntheticResponse();
        let authorized = false;
        await authGate(request, authorization.response, () => {
          authorized = true;
        });
        expect(authorized).toBe(true);
        authorization.response.end();
      }
    } finally {
      if (previousBypass === undefined) {
        delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      } else {
        process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
      }
    }

    const createFirstOutput = syntheticResponse();
    await adminUsersApi(createFirstRequest!, createFirstOutput.response);
    expect(createFirstOutput.snapshot().statusCode).toBe(201);
    const createFirstId = (JSON.parse(createFirstOutput.snapshot().body) as {
      user: { id: string };
    }).user.id;

    let reachedPasswordCommit!: () => void;
    const passwordCommitReached = new Promise<void>((resolve) => {
      reachedPasswordCommit = resolve;
    });
    let releasePasswordCommit!: () => void;
    const passwordCommitReleased = new Promise<void>((resolve) => {
      releasePasswordCommit = resolve;
    });
    const passwordOutput = syntheticResponse();
    const passwordBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    let changingPassword!: Promise<void>;
    try {
      changingPassword = authApi(
        passwordChangeRequest!,
        passwordOutput.response,
        {
          beforePasswordCommit: async () => {
            reachedPasswordCommit();
            await passwordCommitReleased;
          },
        },
      );
    } finally {
      if (passwordBypass === undefined) {
        delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      } else {
        process.env.UNBOUNDRY_TEST_AUTH_BYPASS = passwordBypass;
      }
    }
    await passwordCommitReached;

    const generationStore = createGenerationTaskStore(directory);
    let reachedPhysicalBoundary!: () => void;
    const physicalBoundaryReached = new Promise<void>((resolve) => {
      reachedPhysicalBoundary = resolve;
    });
    let releasePhysicalBoundary!: () => void;
    const physicalBoundaryReleased = new Promise<void>((resolve) => {
      releasePhysicalBoundary = resolve;
    });
    const deleteRequest = await authorizedRequest(`/${targetId}`, "DELETE");
    const deleteOutput = syntheticResponse();
    const deleting = adminUsersApi(deleteRequest, deleteOutput.response, {
      beforePhysicalMediaDelete: async () => {
        reachedPhysicalBoundary();
        await physicalBoundaryReleased;
      },
    });
    await physicalBoundaryReached;

    let secondDeletePhysicalCalls = 0;
    const secondDeleteRequest = await authorizedRequest(`/${targetId}`, "DELETE");
    const secondDeleteOutput = syntheticResponse();
    await adminUsersApi(secondDeleteRequest, secondDeleteOutput.response, {
      beforePhysicalMediaDelete: () => {
        secondDeletePhysicalCalls += 1;
      },
    });
    expect(secondDeleteOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(secondDeleteOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(secondDeletePhysicalCalls).toBe(0);

    const deletionFirstCreateOutput = syntheticResponse();
    await adminUsersApi(
      deletionFirstCreateRequest!,
      deletionFirstCreateOutput.response,
    );
    expect(deletionFirstCreateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(deletionFirstCreateOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });

    releasePasswordCommit();
    await changingPassword;
    expect(passwordOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(passwordOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });

    const userTemplateOutput = syntheticResponse();
    await templateCatalogApi(userTemplateRequest!, userTemplateOutput.response);
    expect(userTemplateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(userTemplateOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    const publicTemplateOutput = syntheticResponse();
    await adminTemplatesApi(publicTemplateRequest!, publicTemplateOutput.response);
    expect(publicTemplateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(publicTemplateOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(() => generationStore.create({
      canvasId: "m88-delete-race-canvas",
      idempotencyKey: "m88-delete-race-task",
      kind: "image",
      model: "m88-delete-race-model",
      nodeId: "m88-delete-race-node",
      ownerId: targetId,
      parameters: {},
      prompt: "must not reach provider",
    })).toThrow(GenerationTaskOwnerDeletingError);
    const reactivateRequest = await authorizedJsonRequest(
      `/${targetId}`,
      "PATCH",
      { status: "active" },
    );
    const reactivateOutput = syntheticResponse();
    await adminUsersApi(reactivateRequest, reactivateOutput.response);
    expect(reactivateOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(reactivateOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    const duringDelete = openAppDatabase(directory);
    try {
      const timestamp = new Date().toISOString();
      expect(() => duringDelete.prepare(`
        INSERT INTO sessions (
          id, token_hash, user_id, expires_at, created_at, last_seen_at
        ) VALUES (
          'm88-late-session', 'm88-late-session-token', ?, ?, ?, ?
        )
      `).run(targetId, timestamp, timestamp, timestamp)).toThrow(
        "account deletion blocks session creation",
      );
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?
      `).get(targetId)).toEqual({ count: 0 });
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM user_templates WHERE owner_id = ?
      `).get(targetId)).toEqual({ count: 0 });
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM public_templates
        WHERE created_by = ? OR updated_by = ?
      `).get(targetId, targetId)).toEqual({ count: 0 });
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks WHERE owner_id = ?
      `).get(targetId)).toEqual({ count: 0 });
      expect(duringDelete.prepare(`
        SELECT login_name, status FROM users WHERE id = ?
      `).get(createFirstId)).toEqual({
        login_name: "m88-create-first",
        status: "active",
      });
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM users
        WHERE login_name = 'm88-deletion-first-ghost'
      `).get()).toEqual({ count: 0 });
      expect(duringDelete.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE actor_user_id = ? AND action = 'password_change'
      `).get(targetId)).toEqual({ count: 0 });
      expect(generationProviderAttemptCounts(duringDelete)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
    } finally {
      duringDelete.close();
    }
    releasePhysicalBoundary();
    await deleting;
    expect(deleteOutput.snapshot().statusCode).toBe(200);
    expect(await pathExists(mediaPublicationFinalPath(media))).toBe(false);
    const afterDelete = openAppDatabase(directory);
    try {
      expect(afterDelete.prepare(`
        SELECT login_name, status FROM users WHERE id = ?
      `).get(createFirstId)).toEqual({
        login_name: "m88-create-first",
        status: "active",
      });
      expect(afterDelete.prepare(`
        SELECT COUNT(*) AS count FROM users
        WHERE login_name = 'm88-deletion-first-ghost'
      `).get()).toEqual({ count: 0 });
    } finally {
      afterDelete.close();
    }
    generationStore.close();

    const activeTaskOwner = "m88-account-active-task-owner";
    addOwner(directory, activeTaskOwner);
    const activeMediaId = "m88-account-active-task-media";
    const activeMedia = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${activeMediaId}.png`,
      id: activeMediaId,
      kind: "image",
      objectKey: `${activeMediaId}.png`,
      ownerId: activeTaskOwner,
      storageBackend: "local",
    });
    await publishUploadFixture(directory, activeMedia, "image/png");
    const activeTaskStore = createGenerationTaskStore(directory);
    activeTaskStore.create({
      canvasId: "m88-active-task-canvas",
      idempotencyKey: "m88-active-task-key",
      kind: "image",
      model: "m88-active-task-model",
      nodeId: "m88-active-task-node",
      ownerId: activeTaskOwner,
      parameters: {},
      prompt: "queued task blocks account deletion",
    });
    let activeTaskPhysicalCalls = 0;
    const activeTaskDeleteRequest = await authorizedRequest(
      `/${activeTaskOwner}`,
      "DELETE",
    );
    const activeTaskDeleteOutput = syntheticResponse();
    await adminUsersApi(
      activeTaskDeleteRequest,
      activeTaskDeleteOutput.response,
      {
        beforePhysicalMediaDelete: () => {
          activeTaskPhysicalCalls += 1;
        },
      },
    );
    expect(activeTaskDeleteOutput.snapshot().statusCode).toBe(409);
    expect(JSON.parse(activeTaskDeleteOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_TASK_ACTIVE",
    });
    expect(activeTaskPhysicalCalls).toBe(0);
    expect(await pathExists(mediaPublicationFinalPath(activeMedia))).toBe(true);
    const activeTaskPreserved = openAppDatabase(directory);
    try {
      expect(activeTaskPreserved.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(activeTaskOwner)).toEqual({ status: "active" });
      expect(activeTaskPreserved.prepare(`
        SELECT storage_status FROM media_assets
        WHERE owner_id = ? AND id = ?
      `).get(activeTaskOwner, activeMediaId)).toEqual({ storage_status: "ready" });
      expect(activeTaskPreserved.prepare(`
        SELECT COUNT(*) AS count FROM account_delete_intents WHERE owner_id = ?
      `).get(activeTaskOwner)).toEqual({ count: 0 });
    } finally {
      activeTaskPreserved.close();
    }
    activeTaskStore.close();

    const referencedOwner = "m88-account-template-referenced";
    addOwner(directory, referencedOwner);
    const thirdAdminId = "m88-account-template-third-admin";
    addOwner(directory, thirdAdminId);
    const readyTemplateMedia = async (
      kind: "audio" | "image" | "video",
      id: string,
      contentType: string,
    ) => {
      const reservation = reserveMediaPublication({
        contentType,
        finalStorageName: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
        id,
        kind,
        objectKey: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
        ownerId: referencedOwner,
        storageBackend: "local",
      });
      await publishUploadFixture(directory, reservation, contentType);
      return reservation;
    };
    const coverMedia = await readyTemplateMedia(
      "image",
      "m88-account-template-cover",
      "image/png",
    );
    const audioMedia = await readyTemplateMedia(
      "audio",
      "m88-account-template-audio",
      "audio/wav",
    );
    const playlistMedia = await readyTemplateMedia(
      "video",
      "m88-account-template-playlist",
      "video/mp4",
    );
    const updatedOnlyMedia = await readyTemplateMedia(
      "image",
      "m88-account-template-updated-only",
      "image/png",
    );
    const previewMedia = await readyTemplateMedia(
      "audio",
      "m88-account-template-preview",
      "audio/wav",
    );
    const privateMedia = await readyTemplateMedia(
      "image",
      "m88-account-private-media",
      "image/png",
    );
    const transferGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          data: {
            assetId: audioMedia.id,
            label: "Audio",
            title: "公开音频",
          },
          id: "node-public-audio",
          position: { x: 20, y: 340 },
          style: { height: 250, width: 250 },
          type: "audio",
          zIndex: 1,
        },
        {
          data: {
            label: "Playlist",
            playlistClips: [{
              id: "clip-public-video",
              src: `/api/video-assets/${playlistMedia.id}`,
            }],
            title: "公开视频列表",
          },
          id: "node-public-playlist",
          position: { x: 320, y: 340 },
          style: { height: 250, width: 250 },
          type: "playlist",
          zIndex: 1,
        },
      ],
    };
    const updatedOnlyGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "node-2"
          ? {
              ...node,
              data: { ...node.data, assetId: updatedOnlyMedia.id },
            }
          : node
      ),
    };
    const references = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    try {
      references.prepare(`
        UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?
      `).run(timestamp, thirdAdminId);
      references.prepare(`
        INSERT INTO user_templates (
          id, owner_id, title, category, graph, cover_asset_id,
          created_at, updated_at
        ) VALUES (
          'm88-user-template-reference', ?, 'M88 user reference', NULL, ?, NULL,
          ?, ?
        )
      `).run(referencedOwner, JSON.stringify(graph), timestamp, timestamp);
      references.prepare(`
        INSERT INTO public_templates (
          id, title, graph, cover_asset_id, status,
          created_by, created_at, updated_by, updated_at
        ) VALUES (
          'm88-public-template-reference', 'M88 public reference', ?, ?,
          'draft', ?, ?, ?, ?
        )
      `).run(
        JSON.stringify(transferGraph),
        coverMedia.id,
        referencedOwner,
        timestamp,
        referencedOwner,
        timestamp,
      );
      references.prepare(`
        INSERT INTO public_templates (
          id, title, graph, status, created_by, created_at, updated_by, updated_at
        ) VALUES (
          'm88-public-template-updated-only', 'M88 updated-only reference', ?,
          'draft', '__test__', ?, ?, ?
        )
      `).run(
        JSON.stringify(updatedOnlyGraph),
        timestamp,
        referencedOwner,
        timestamp,
      );
      references.prepare(`
        INSERT INTO public_templates (
          id, title, graph, preview_image, status,
          created_by, created_at, updated_by, updated_at
        ) VALUES (
          'm88-public-template-third-actor', 'M88 third actor references', ?, ?,
          'draft', ?, ?, ?, ?
        )
      `).run(
        JSON.stringify(updatedOnlyGraph),
        `/api/audio-assets/${previewMedia.id}`,
        thirdAdminId,
        timestamp,
        thirdAdminId,
        timestamp,
      );
      references.prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt,
          created_at, updated_at, owner_id, cost_currency,
          model_configuration, credential_revision
        ) VALUES (
          'm88-template-private-task', 'm88-template-private-canvas',
          'm88-template-private-node', 'text', 'private prompt', NULL, '{}',
          'm88-template-private-key', 'm88-template-private-fingerprint',
          'failed', 0, ?, ?, ?, 'USD', '{}', 0
        )
      `).run(timestamp, timestamp, referencedOwner);
    } finally {
      references.close();
    }
    const physicalCalls: string[] = [];
    const deleteReferencedRequest = await authorizedRequest(
      `/${referencedOwner}`,
      "DELETE",
    );
    const deleteReferencedOutput = syntheticResponse();
    await adminUsersApi(
      deleteReferencedRequest,
      deleteReferencedOutput.response,
      {
        beforePhysicalMediaDelete: ({ id }) => {
          physicalCalls.push(id);
        },
      },
    );
    expect(deleteReferencedOutput.snapshot().statusCode).toBe(200);
    expect(physicalCalls).toEqual([privateMedia.id]);
    expect(await pathExists(mediaPublicationFinalPath(coverMedia))).toBe(true);
    expect(await pathExists(mediaPublicationFinalPath(audioMedia))).toBe(true);
    expect(await pathExists(mediaPublicationFinalPath(playlistMedia))).toBe(true);
    expect(await pathExists(mediaPublicationFinalPath(updatedOnlyMedia))).toBe(true);
    expect(await pathExists(mediaPublicationFinalPath(previewMedia))).toBe(true);
    expect(await pathExists(mediaPublicationFinalPath(privateMedia))).toBe(false);
    const referencedState = openAppDatabase(directory);
    try {
      expect(referencedState.prepare(`
        SELECT COUNT(*) AS count FROM users WHERE id = ?
      `).get(referencedOwner)).toEqual({ count: 0 });
      expect(referencedState.prepare(`
        SELECT id, kind, owner_id, storage_status FROM media_assets
        WHERE id IN (?, ?, ?, ?, ?)
        ORDER BY id
      `).all(
        coverMedia.id,
        audioMedia.id,
        playlistMedia.id,
        updatedOnlyMedia.id,
        previewMedia.id,
      )).toEqual([
        {
          id: audioMedia.id,
          kind: "audio",
          owner_id: "__test__",
          storage_status: "ready",
        },
        {
          id: coverMedia.id,
          kind: "image",
          owner_id: "__test__",
          storage_status: "ready",
        },
        {
          id: playlistMedia.id,
          kind: "video",
          owner_id: "__test__",
          storage_status: "ready",
        },
        {
          id: previewMedia.id,
          kind: "audio",
          owner_id: "__test__",
          storage_status: "ready",
        },
        {
          id: updatedOnlyMedia.id,
          kind: "image",
          owner_id: "__test__",
          storage_status: "ready",
        },
      ]);
      expect(referencedState.prepare(`
        SELECT id, created_by, updated_by
        FROM public_templates
        WHERE id IN (
          'm88-public-template-reference',
          'm88-public-template-third-actor',
          'm88-public-template-updated-only'
        )
        ORDER BY id
      `).all()).toEqual([
        {
          created_by: "__test__",
          id: "m88-public-template-reference",
          updated_by: "__test__",
        },
        {
          created_by: thirdAdminId,
          id: "m88-public-template-third-actor",
          updated_by: thirdAdminId,
        },
        {
          created_by: "__test__",
          id: "m88-public-template-updated-only",
          updated_by: "__test__",
        },
      ]);
      expect(referencedState.prepare(`
        SELECT COUNT(*) AS count FROM user_templates WHERE owner_id = ?
      `).get(referencedOwner)).toEqual({ count: 0 });
      expect(referencedState.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks WHERE owner_id = ?
      `).get(referencedOwner)).toEqual({ count: 0 });
      expect(referencedState.prepare(`
        SELECT COUNT(*) AS count FROM media_assets WHERE id = ?
      `).get(privateMedia.id)).toEqual({ count: 0 });
      expect(referencedState.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE action = 'delete_user' AND target_user_id = ?
      `).get(referencedOwner)).toEqual({ count: 1 });
    } finally {
      referencedState.close();
    }
  });
});

test("account deletion blocks every unresolved paid outcome before physical media cleanup", async () => {
  await withDataDirectory("account-delete-paid-gate", async (directory) => {
    await authorizedRequest("/bootstrap");
    const outcomes = [
      "boundary-claimed",
      "accepted",
      "response-received",
      "outcome-unknown",
    ] as const;
    const store = createGenerationTaskStore(directory);
    for (const [index, outcome] of outcomes.entries()) {
      const ownerId = `m88-account-paid-${index}`;
      addOwner(directory, ownerId);
      const mediaId = `m88-account-paid-media-${index}`;
      const media = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${mediaId}.png`,
        id: mediaId,
        kind: "image",
        objectKey: `${mediaId}.png`,
        ownerId,
        storageBackend: "local",
      });
      await publishUploadFixture(directory, media, "image/png");
      const task = store.create({
        canvasId: `m88-paid-canvas-${index}`,
        idempotencyKey: `m88-paid-key-${index}`,
        kind: "image",
        model: "m88-paid-model",
        nodeId: `m88-paid-node-${index}`,
        ownerId,
        parameters: {},
        prompt: "never cross a paid uncertainty boundary",
        providerModelId: "m88-paid-provider-model",
        providerProfileId: "m88-paid-provider",
      }).task;
      store.transition(task.id, "running");
      recordProviderAttemptFixture(directory, task.id, outcome);
      const terminal = openAppDatabase(directory);
      try {
        terminal.prepare(`
          UPDATE generation_tasks
          SET state = 'failed', error_code = 'NETWORK',
              error_message = 'fixture terminal state', updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), task.id);
      } finally {
        terminal.close();
      }

      let physicalCalls = 0;
      const request = await authorizedRequest(`/${ownerId}`, "DELETE");
      const output = syntheticResponse();
      await adminUsersApi(request, output.response, {
        beforePhysicalMediaDelete: () => {
          physicalCalls += 1;
        },
      });
      expect(output.snapshot().statusCode).toBe(409);
      expect(JSON.parse(output.snapshot().body)).toMatchObject({
        code: "ACCOUNT_DELETE_TASK_ACTIVE",
      });
      expect(physicalCalls).toBe(0);
      expect(await pathExists(mediaPublicationFinalPath(media))).toBe(true);
      const preserved = openAppDatabase(directory);
      try {
        expect(preserved.prepare(`
          SELECT status FROM users WHERE id = ?
        `).get(ownerId)).toEqual({ status: "active" });
        expect(preserved.prepare(`
          SELECT COUNT(*) AS count FROM account_delete_intents
          WHERE owner_id = ?
        `).get(ownerId)).toEqual({ count: 0 });
        expect(preserved.prepare(`
          SELECT outcome FROM generation_provider_attempts WHERE task_id = ?
        `).get(task.id)).toEqual({ outcome });
      } finally {
        preserved.close();
      }
    }
    for (const [index, outcome] of ([
      "accepted",
      "response-received",
    ] as const).entries()) {
      const ownerId = `m88-account-abandoned-${index}`;
      addOwner(directory, ownerId);
      const mediaId = `m88-account-abandoned-media-${index}`;
      const media = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${mediaId}.png`,
        id: mediaId,
        kind: "image",
        objectKey: `${mediaId}.png`,
        ownerId,
        storageBackend: "local",
      });
      await publishUploadFixture(directory, media, "image/png");
      const task = store.create({
        canvasId: `m88-abandoned-canvas-${index}`,
        idempotencyKey: `m88-abandoned-key-${index}`,
        kind: "image",
        model: "m88-abandoned-model",
        nodeId: `m88-abandoned-node-${index}`,
        ownerId,
        parameters: {},
        prompt: "explicitly abandon the exact paid result",
        providerModelId: "m88-abandoned-provider-model",
        providerProfileId: "m88-abandoned-provider",
      }).task;
      store.transition(task.id, "running");
      recordProviderAttemptFixture(directory, task.id, outcome);
      if (outcome === "accepted") {
        store.attachProviderTaskId({
          executionAttempt: 1,
          providerTaskId: `m88-abandoned-provider-task-${index}`,
          taskId: task.id,
        });
      }
      const failed = store.transition(task.id, "failed", {
        code: outcome === "accepted" ? "AUTH" : "MEDIA_PUBLICATION_FAILED",
        message: "fixture exact result can be explicitly abandoned",
      })!;
      expect(store.abandonAcceptedProviderTask({
        expectedAttempt: failed.attempt,
        expectedUpdatedAt: failed.updatedAt,
        taskId: task.id,
      })).toMatchObject({
        errorCode: "USER_ABANDONED",
        state: "cancelled",
      });

      let physicalCalls = 0;
      const request = await authorizedRequest(`/${ownerId}`, "DELETE");
      const output = syntheticResponse();
      await adminUsersApi(request, output.response, {
        beforePhysicalMediaDelete: () => {
          physicalCalls += 1;
        },
      });
      expect(output.snapshot().statusCode).toBe(200);
      expect(physicalCalls).toBe(1);
      expect(await pathExists(mediaPublicationFinalPath(media))).toBe(false);
    }
    store.close();
  });
});

test("account deletion fails closed unless exactly one active protected administrator exists", async () => {
  await withDataDirectory("account-delete-root-cardinality", async (directory) => {
    await authorizedRequest("/bootstrap");
    const ownerId = "m88-account-root-cardinality-owner";
    addOwner(directory, ownerId);
    const media = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: "m88-account-root-cardinality.png",
      id: "m88-account-root-cardinality",
      kind: "image",
      objectKey: "m88-account-root-cardinality.png",
      ownerId,
      storageBackend: "local",
    });
    await publishUploadFixture(directory, media, "image/png");

    const setRootState = (
      testRootProtected: 0 | 1,
      secondRootProtected: 0 | 1,
    ) => {
      const database = openAppDatabase(directory);
      try {
        const timestamp = new Date().toISOString();
        database.prepare(`
          UPDATE users SET protected = ? WHERE id = '__test__'
        `).run(testRootProtected);
        database.prepare(`
          INSERT OR IGNORE INTO users (
            id, login_name, display_name, password_hash, role, status,
            protected, created_at, updated_at
          ) VALUES (
            'm88-second-root', 'm88-second-root', 'M88 second root',
            'fixture-only', 'admin', 'active', ?, ?, ?
          )
        `).run(secondRootProtected, timestamp, timestamp);
        database.prepare(`
          UPDATE users
          SET role = 'admin', status = 'active', protected = ?
          WHERE id = 'm88-second-root'
        `).run(secondRootProtected);
      } finally {
        database.close();
      }
    };
    const expectBlocked = async () => {
      let physicalCalls = 0;
      const request = await authorizedRequest(`/${ownerId}`, "DELETE");
      const output = syntheticResponse();
      await adminUsersApi(request, output.response, {
        beforePhysicalMediaDelete: () => {
          physicalCalls += 1;
        },
      });
      expect(output.snapshot().statusCode).toBe(409);
      expect(JSON.parse(output.snapshot().body)).toMatchObject({
        code: "ACCOUNT_DELETE_REFERENCED",
      });
      expect(physicalCalls).toBe(0);
      const preserved = openAppDatabase(directory);
      try {
        expect(preserved.prepare(`
          SELECT status FROM users WHERE id = ?
        `).get(ownerId)).toEqual({ status: "active" });
        expect(preserved.prepare(`
          SELECT COUNT(*) AS count FROM account_delete_intents
          WHERE owner_id = ?
        `).get(ownerId)).toEqual({ count: 0 });
      } finally {
        preserved.close();
      }
    };

    setRootState(0, 0);
    await expectBlocked();
    setRootState(1, 1);
    await expectBlocked();
    setRootState(1, 0);
    const finalRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const finalOutput = syntheticResponse();
    await adminUsersApi(finalRequest, finalOutput.response);
    expect(finalOutput.snapshot().statusCode).toBe(200);
    expect(await pathExists(mediaPublicationFinalPath(media))).toBe(false);
  });
});

test("delete_user audit failure rolls back the final transaction and remains retryable", async () => {
  await withDataDirectory("account-delete-audit-rollback", async (directory) => {
    await authorizedRequest("/bootstrap");
    const ownerId = "m88-account-audit-rollback";
    addOwner(directory, ownerId);
    const setup = openAppDatabase(directory);
    try {
      const timestamp = new Date().toISOString();
      setup.prepare(`
        INSERT INTO admin_audit_events (
          actor_user_id, action, target_user_id, details, created_at
        ) VALUES (?, 'fixture_old_audit', ?, '{}', ?)
      `).run(ownerId, ownerId, timestamp);
      setup.exec(`
        CREATE TRIGGER m88_fail_delete_user_audit
        BEFORE INSERT ON admin_audit_events
        WHEN NEW.action = 'delete_user'
        BEGIN
          SELECT RAISE(ABORT, 'm88 deterministic audit failure');
        END;
      `);
    } finally {
      setup.close();
    }

    let physicalCalls = 0;
    const firstRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const firstOutput = syntheticResponse();
    await adminUsersApi(firstRequest, firstOutput.response, {
      beforePhysicalMediaDelete: () => {
        physicalCalls += 1;
      },
    });
    expect(firstOutput.snapshot().statusCode).toBe(503);
    expect(JSON.parse(firstOutput.snapshot().body)).toMatchObject({
      code: "ACCOUNT_DELETE_FINALIZE_FAILED",
    });
    expect(physicalCalls).toBe(0);
    const rolledBack = openAppDatabase(directory);
    try {
      expect(rolledBack.prepare(`
        SELECT status FROM users WHERE id = ?
      `).get(ownerId)).toEqual({ status: "disabled" });
      expect(rolledBack.prepare(`
        SELECT state, error_code FROM account_delete_intents WHERE owner_id = ?
      `).get(ownerId)).toEqual({
        error_code: "ACCOUNT_FINALIZE_FAILED",
        state: "failed",
      });
      expect(rolledBack.prepare(`
        SELECT action FROM admin_audit_events WHERE actor_user_id = ?
      `).all(ownerId)).toEqual([{ action: "fixture_old_audit" }]);
      expect(rolledBack.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE action = 'delete_user' AND target_user_id = ?
      `).get(ownerId)).toEqual({ count: 0 });
      rolledBack.exec("DROP TRIGGER m88_fail_delete_user_audit");
    } finally {
      rolledBack.close();
    }

    const retryRequest = await authorizedRequest(`/${ownerId}`, "DELETE");
    const retryOutput = syntheticResponse();
    await adminUsersApi(retryRequest, retryOutput.response);
    expect(retryOutput.snapshot().statusCode).toBe(200);
    const completed = openAppDatabase(directory);
    try {
      expect(completed.prepare(`
        SELECT COUNT(*) AS count FROM users WHERE id = ?
      `).get(ownerId)).toEqual({ count: 0 });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE action = 'delete_user' AND target_user_id = ?
      `).get(ownerId)).toEqual({ count: 1 });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count FROM admin_audit_events
        WHERE actor_user_id = ?
      `).get(ownerId)).toEqual({ count: 0 });
    } finally {
      completed.close();
    }
  });
});

test("GPT Image keeps data references inline when no readable OSS profile exists", async () => {
  await withDataDirectory("relay-inline-reference", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const reference = `data:image/png;base64,${png.toString("base64")}`;
    let providerCalls = 0;
    const result = await requestRelayGptImage({
      apiKey: "m88-inline-provider-key",
      baseUrl: "https://relay.example.test/v1",
    }, {
      capability: "image",
      inputImages: [reference],
      model: "gpt-image-2",
      operation: "edit",
      prompt: "m88 inline reference",
      providerProtocol: "gpt-image",
      responseFormat: "b64_json",
    }, {
      fetcher: async (_input, init) => {
        providerCalls += 1;
        expect(JSON.parse(String(init?.body))).toMatchObject({
          image: reference,
        });
        return new Response(JSON.stringify({
          data: [{ b64_json: png.toString("base64"), media_type: "image/png" }],
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    });
    expect(providerCalls).toBe(1);
    expect(result).toMatchObject({ state: "success" });
  });
});

test("GPT Image data references use recoverable OSS upload journals and retain fixed credentials", async () => {
  await withDataDirectory("relay-temp-reference", async (directory) => {
    const ownerId = "m88-relay-temp-owner";
    addOwner(directory, ownerId);
    const originalProfile = await saveStorageProfile({
      accessKeyId: "m88-original-access-key",
      accessKeySecret: "m88-original-secret-key",
      bucket: "m88-original-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 original",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(originalProfile.id);
    await activateStorageProfile(originalProfile.id);
    const replacementProfile = await saveStorageProfile({
      accessKeyId: "m88-replacement-access-key",
      accessKeySecret: "m88-replacement-secret-key",
      bucket: "m88-replacement-bucket",
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
      label: "M88 replacement",
      region: "oss-cn-beijing",
    });
    await markStorageProfileVerified(replacementProfile.id);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    let attemptId = "";
    let assetId = "";
    let objectKey = "";
    let providerCalls = 0;
    let initialDeleteCalls = 0;
    const immutableUpdate = {
      accessKeyId: "m88-mutated-access-key",
      accessKeySecret: "m88-mutated-secret-key",
      bucket: "m88-mutated-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M88 mutated",
      region: "oss-cn-hangzhou",
    };

    const result = await requestRelayGptImage({
      apiKey: "m88-relay-provider-key",
      baseUrl: "https://relay.example.test/v1",
    }, {
      capability: "image",
      inputImages: [`data:image/png;base64,${png.toString("base64")}`],
      model: "gpt-image-2",
      operation: "edit",
      prompt: "m88 journaled reference",
      providerProtocol: "gpt-image",
      responseFormat: "b64_json",
    }, {
      fetcher: async (_input, init) => {
        providerCalls += 1;
        const body = JSON.parse(String(init?.body)) as { image: string };
        expect(body.image).toBe(
          `https://signed.example.test/${encodeURIComponent(objectKey)}`,
        );

        // A pointer switch is allowed, but the old fixed profile remains
        // immutable and undeletable while its cleanup journal is active.
        await activateStorageProfile(replacementProfile.id);
        await expect(saveStorageProfile(immutableUpdate, originalProfile.id))
          .rejects.toThrow("retained by registered media");
        await expect(deleteStorageProfile(originalProfile.id))
          .rejects.toThrow("retained by registered media");
        return new Response(JSON.stringify({
          data: [{ b64_json: png.toString("base64"), media_type: "image/png" }],
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
      mediaLifecycle: { ownerId },
      temporaryImageObjectStore: {
        createReadUrl: async (key, credentials) => {
          expect(key).toBe(objectKey);
          expect(credentials.bucket).toBe("m88-original-bucket");
          const database = openAppDatabase(directory);
          try {
            expect(database.prepare(`
              SELECT state FROM media_publication_attempts
              WHERE attempt_id = ?
            `).get(attemptId)).toEqual({ state: "external-ready" });
          } finally {
            database.close();
          }
          return `https://signed.example.test/${encodeURIComponent(key)}`;
        },
        deleteObject: async (key, credentials) => {
          initialDeleteCalls += 1;
          expect(key).toBe(objectKey);
          expect(credentials.bucket).toBe("m88-original-bucket");
          throw new Error("m88 deterministic cleanup failure");
        },
        uploadObject: async (input) => {
          expect(input.credentials.bucket).toBe("m88-original-bucket");
          expect(await readFile(input.filePath)).toEqual(png);
          objectKey = input.objectKey;
          const database = openAppDatabase(directory);
          try {
            const attempt = database.prepare(`
              SELECT attempt_id, asset_id, source, state, storage_profile_id
              FROM media_publication_attempts WHERE object_key = ?
            `).get(input.objectKey) as {
              attempt_id: string;
              asset_id: string;
              source: string;
              state: string;
              storage_profile_id: string;
            };
            attemptId = attempt.attempt_id;
            assetId = attempt.asset_id;
            expect(attempt).toMatchObject({
              source: "upload",
              state: "staged",
              storage_profile_id: originalProfile.id,
            });
          } finally {
            database.close();
          }
          return { etag: "m88-etag", requestId: "m88-put", versionId: "" };
        },
      },
    });

    expect(result).toMatchObject({ state: "success" });
    expect(providerCalls).toBe(1);
    expect(initialDeleteCalls).toBe(1);
    const stranded = openAppDatabase(directory);
    try {
      expect(stranded.prepare(`
        SELECT source, state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(attemptId)).toEqual({
        error_code: "RELAY_TEMP_REFERENCE_CLEANUP",
        source: "upload",
        state: "compensating",
      });
      expect(stranded.prepare(`
        SELECT storage_status FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(ownerId, assetId)).toEqual({ storage_status: "failed" });
    } finally {
      stranded.close();
    }
    await expect(saveStorageProfile(immutableUpdate, originalProfile.id))
      .rejects.toThrow("retained by registered media");
    await expect(deleteStorageProfile(originalProfile.id))
      .rejects.toThrow("retained by registered media");

    let recoveredDeletes = 0;
    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: "9999-12-31T23:59:59.999Z",
      deleteExternalObject: async (key, credentials) => {
        recoveredDeletes += 1;
        expect(key).toBe(objectKey);
        expect(credentials.bucket).toBe("m88-original-bucket");
      },
    })).toEqual([{ action: "failed", assetId }]);
    expect(recoveredDeletes).toBe(1);
    expect(providerCalls).toBe(1);
    expect(await pathExists(join(
      directory,
      "media",
      `.publication-${attemptId}.generating`,
    ))).toBe(false);
    expect(readyMediaForOwner(ownerId, "image", assetId)).toBeUndefined();

    const recovered = openAppDatabase(directory);
    try {
      expect(recovered.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(recovered.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND object_key = ?
      `).get(ownerId, objectKey)).toEqual({ count: 0 });
    } finally {
      recovered.close();
    }

    // The terminal journal remains part of backup/audit provenance. Its fixed
    // profile must therefore survive even after the temporary object and media
    // row are gone; otherwise a backup would contain a dangling profile ID.
    await expect(saveStorageProfile(immutableUpdate, originalProfile.id))
      .rejects.toThrow("retained by registered media");
    await expect(deleteStorageProfile(originalProfile.id))
      .rejects.toThrow("retained by registered media");
  });
});

test("ready OSS media retains its profile and explicit missing profile IDs never fall back", async () => {
  await withDataDirectory("ready-profile-retention", async (directory) => {
    await authorizedRequest("/bootstrap");
    const original = await saveStorageProfile({
      accessKeyId: "m88-ready-original-key",
      accessKeySecret: "m88-ready-original-secret",
      bucket: "m88-ready-original-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 ready original",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(original.id);
    await activateStorageProfile(original.id);
    const id = "m88-ready-profile-asset";
    const reservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${id}.png`,
      id,
      kind: "image",
      objectKey: `objects/2026/08/image/${id}.png`,
      ownerId: "__test__",
      storageBackend: "oss",
      storageProfileId: original.id,
    });
    await stageFixture(directory, reservation);
    markExternalMediaPublicationReady(reservation);
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation);

    const replacement = await saveStorageProfile({
      accessKeyId: "m88-ready-replacement-key",
      accessKeySecret: "m88-ready-replacement-secret",
      bucket: "m88-ready-replacement-bucket",
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
      label: "M88 ready replacement",
      region: "oss-cn-beijing",
    });
    await markStorageProfileVerified(replacement.id);
    await activateStorageProfile(replacement.id);
    const registered = readyMediaForOwner("__test__", "image", id)!;
    expect(await storageProfileForMedia(registered)).toMatchObject({
      bucket: "m88-ready-original-bucket",
      id: original.id,
    });
    await expect(saveStorageProfile({
      accessKeyId: "m88-ready-mutated-key",
      accessKeySecret: "m88-ready-mutated-secret",
      bucket: "m88-ready-mutated-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M88 ready mutated",
      region: "oss-cn-hangzhou",
    }, original.id)).rejects.toThrow("retained by registered media");
    await expect(deleteStorageProfile(original.id))
      .rejects.toThrow("retained by registered media");

    expect(await storageProfileForMedia({
      storageProfileId: "m88-explicit-missing-profile",
    })).toBeUndefined();
    expect(await storageProfileForMedia({ storageProfileId: null }))
      .toMatchObject({ id: replacement.id });
    expect(await readableStorageProfile()).toMatchObject({
      bucket: "m88-ready-replacement-bucket",
      id: replacement.id,
    });

    const missingId = "m88-missing-profile-asset";
    const missingReservation = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: `${missingId}.png`,
      id: missingId,
      kind: "image",
      objectKey: `objects/2026/08/image/${missingId}.png`,
      ownerId: "__test__",
      storageBackend: "oss",
      storageProfileId: "m88-explicit-missing-profile",
    });
    await stageFixture(directory, missingReservation);
    markExternalMediaPublicationReady(missingReservation);
    finalizeMediaPublication(missingReservation);
    await cleanupPublicationStaging(missingReservation);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request = await authorizedRequest(`/${missingId}`, "DELETE");
      const output = syntheticResponse();
      await assetStorage(request, output.response);
      expect(output.snapshot()).toMatchObject({ statusCode: 503 });
      expect(await readableStorageProfile()).toMatchObject({
        bucket: "m88-ready-replacement-bucket",
        id: replacement.id,
      });
    }
    const missing = openAppDatabase(directory);
    try {
      expect(missing.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(missingReservation.attemptId)).toEqual({
        error_code: "MEDIA_DELETE_FAILED",
        state: "compensating",
      });
    } finally {
      missing.close();
    }
    expect(await compensateMediaPublication(missingReservation, {
      code: "M88_MISSING_PROFILE_CLEANUP",
      deleteExternalObject: async () => undefined,
      profile: {
        ...original,
        id: "m88-explicit-missing-profile",
      },
    })).toBe(true);

    const profiles = await listStorageProfiles();
    expect(profiles.activeProfileId).toBe(replacement.id);
    expect(profiles.profiles.map((profile) => profile.id)).toContain(original.id);
  });
});

test("storage routing read and media reservation hold one profile mutation lock", async () => {
  await withDataDirectory("routing-reservation-lock", async (directory) => {
    const ownerId = "m88-routing-lock-owner";
    addOwner(directory, ownerId);
    const original = await saveStorageProfile({
      accessKeyId: "m88-routing-lock-original-key",
      accessKeySecret: "m88-routing-lock-original-secret",
      bucket: "m88-routing-lock-original-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "M88 routing lock original",
      region: "oss-cn-shanghai",
    });
    await markStorageProfileVerified(original.id);
    await activateStorageProfile(original.id);
    await setStorageMediaRouting(true);
    const replacement = await saveStorageProfile({
      accessKeyId: "m88-routing-lock-replacement-key",
      accessKeySecret: "m88-routing-lock-replacement-secret",
      bucket: "m88-routing-lock-replacement-bucket",
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
      label: "M88 routing lock replacement",
      region: "oss-cn-beijing",
    });
    await markStorageProfileVerified(replacement.id);

    let routingRead!: () => void;
    const read = new Promise<void>((resolve) => {
      routingRead = resolve;
    });
    let releaseRead!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const id = "m88-routing-lock-asset";
    const reserving = withStorageMediaRoutingReservation((routing) => {
      expect(routing).toMatchObject({
        enabled: true,
        profile: { id: original.id },
      });
      return {
        profile: routing.profile!,
        reservation: reserveMediaPublication({
          contentType: "image/png",
          finalStorageName: `${id}.png`,
          id,
          kind: "image",
          objectKey: `objects/2026/08/image/${id}.png`,
          ownerId,
          storageBackend: "oss",
          storageProfileId: routing.profile!.id,
        }),
      };
    }, {
      afterRead: async (routing) => {
        expect(routing.profile?.id).toBe(original.id);
        routingRead();
        await released;
      },
    });
    await read;
    let switched = false;
    const switching = activateStorageProfile(replacement.id).then(() => {
      switched = true;
    });
    await Promise.resolve();
    expect(switched).toBe(false);
    releaseRead();
    const publication = await reserving;
    await switching;
    expect(switched).toBe(true);
    expect(publication.reservation.storageProfileId).toBe(original.id);

    await expect(saveStorageProfile({
      accessKeyId: "m88-routing-lock-mutated-key",
      accessKeySecret: "m88-routing-lock-mutated-secret",
      bucket: "m88-routing-lock-mutated-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M88 routing lock mutated",
      region: "oss-cn-hangzhou",
    }, original.id)).rejects.toThrow("retained by registered media");
    await expect(deleteStorageProfile(original.id))
      .rejects.toThrow("retained by registered media");
    expect(await compensateMediaPublication(publication.reservation, {
      code: "M88_ROUTING_LOCK_CLEANUP",
      deleteExternalObject: async () => undefined,
      profile: publication.profile,
    })).toBe(true);
  });
});

test("startup upload recovery cutoff cleans old attempts but never same-process new uploads", async () => {
  await withDataDirectory("upload-recovery-cutoff", async (directory) => {
    const ownerId = "m88-recovery-cutoff-owner";
    addOwner(directory, ownerId);
    const reserve = async (id: string) => {
      const reservation = reserveMediaPublication({
        contentType: "image/png",
        finalStorageName: `${id}.png`,
        id,
        kind: "image",
        objectKey: `${id}.png`,
        ownerId,
        storageBackend: "local",
      });
      await stageFixture(directory, reservation);
      return reservation;
    };
    const oldReservation = await reserve("m88-recovery-before-startup");
    const newReservation = await reserve("m88-recovery-after-startup");
    const timestamps = openAppDatabase(directory);
    try {
      timestamps.prepare(`
        UPDATE media_publication_attempts SET created_at = ?, updated_at = ?
        WHERE attempt_id = ?
      `).run(
        "2000-01-01T00:00:00.000Z",
        "2000-01-01T00:00:00.000Z",
        oldReservation.attemptId,
      );
      timestamps.prepare(`
        UPDATE media_publication_attempts SET created_at = ?, updated_at = ?
        WHERE attempt_id = ?
      `).run(
        "2000-01-01T00:00:00.000Z",
        "2999-01-01T00:00:00.000Z",
        newReservation.attemptId,
      );
    } finally {
      timestamps.close();
    }

    expect(hasPendingUploadMediaPublications()).toBe(true);
    expect(await recoverPendingUploadMediaPublications()).toEqual([{
      action: "failed",
      assetId: oldReservation.id,
    }]);
    expect(hasPendingUploadMediaPublications()).toBe(false);
    const firstSweep = openAppDatabase(directory);
    try {
      expect(firstSweep.prepare(`
        SELECT state FROM media_publication_attempts WHERE attempt_id = ?
      `).get(oldReservation.attemptId)).toEqual({ state: "failed" });
      expect(firstSweep.prepare(`
        SELECT state FROM media_publication_attempts WHERE attempt_id = ?
      `).get(newReservation.attemptId)).toEqual({ state: "staged" });
      expect(firstSweep.prepare(`
        SELECT storage_status FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(ownerId, newReservation.id)).toEqual({ storage_status: "pending" });
    } finally {
      firstSweep.close();
    }

    expect(await recoverPendingUploadMediaPublications({
      updatedBefore: "9999-12-31T23:59:59.999Z",
    })).toEqual([{
      action: "failed",
      assetId: newReservation.id,
    }]);
  });
});
