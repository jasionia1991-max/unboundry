import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createCanvasGraphCommandPort,
  type CanvasGraphCommand,
  type CanvasGraphCommandPort,
  type CanvasGraphSnapshot,
  type CanvasSavePort,
} from "../client/src/canvas/canvasPorts";
import {
  CanvasNodeRegistry,
  canvasNodeRegistry,
} from "../client/src/canvas/canvasNodeRegistry";
import {
  createSingleNodeGenerationLifecycle,
  type SingleNodeGenerationLifecycle,
  type SingleNodeGenerationTaskPort,
} from "../client/src/generation/singleNodeGenerationLifecycle";
import type { GenerationTaskSummary } from
  "../client/src/generation/generationTasks";
import {
  type GenerationQueryPort,
  type GenerationTaskQueryEvidence,
} from "../server/generationQueryPort";
import { applicationComposition } from "../server/applicationComposition";
import {
  MediaGenerationProviderRegistry,
  type MediaGenerationExecution,
  type MediaGenerationProvider,
  type MediaGenerationRequest,
} from "../server/mediaGenerationProvider";
import { mediaProviderRegistry } from "../server/providerMediaGenerationAdapters";
import {
  GenerationCapabilityRegistry,
  generationCapabilityRegistry,
} from "../server/generationCapabilityRegistry";
import { deleteAccountCanvasDataCommand } from "../server/canvasTransactionCommands";
import { deleteAccountGenerationDataCommand } from "../server/generationTransactionCommands";
import { transferAccountMediaCommand } from "../server/mediaTransactionCommands";
import { deleteAccountProjectDataCommand } from "../server/projectTransactionCommands";
import { transferAndDeleteAccountTemplatesCommand } from
  "../server/templateTransactionCommands";
import {
  createAliyunMediaBlobStore,
  createLocalMediaBlobStore,
  createMemoryMediaBlobStore,
  type AliyunMediaBlobDriver,
} from "../server/mediaBlobStores";
import type {
  MediaBlobStore,
  ReadMediaBlobInput,
} from "../server/mediaBlobStore";
import {
  MediaEditSourceAdmission,
  mediaEditSource,
} from "../server/mediaEditSource";
import type { MediaRecord } from "../server/mediaRegistry";
import { validatePng, validateTransparentPng } from "../server/assetStorage";
import type { ProviderProfile } from "../server/providerProfiles";
import {
  createMediaPublicationService,
  mediaPublicationService,
} from "../server/mediaPublicationService";
import {
  genericReferenceMediaRules,
  providerMediaUrlForOwner,
} from "../server/providerMedia";
import {
  type AcquireProviderReferenceInput,
  type ProviderReferenceLease,
  type ProviderReferenceStore,
} from "../server/providerReferenceStore";
import {
  executeTransactionScopedCommand,
  type TransactionScopedCommand,
} from "../server/transactionCommand";
import {
  PersistedNodeSchemaRegistry,
  persistedNodeSchemaRegistry,
} from "../types/persistedNodeSchemaRegistry";
import {
  canvasNodeKinds,
  generationCapabilityKinds,
  persistedNodeKinds,
  templateNodeKinds,
} from "../types/nodeVocabulary";
import {
  imageToolCapability,
  imageToolMaximums,
  imageToolOperations,
  parseImageToolCapabilitySnapshot,
  parseSeedanceAssetValidation,
  seedanceAssetValidationState,
  type ImageAnnotationElement,
  type ImageToolCapability,
} from "../types/imageTools";
import { knownModelParameterSchema } from "../types/modelParameters";
import { createImageToolDispatcher } from
  "../client/src/imageTools/imageToolDispatcher";
import { createDerivedImageToolUseCase } from
  "../client/src/imageTools/derivedImageToolUseCase";
import { createBatchDerivedImageToolUseCase } from
  "../client/src/imageTools/batchDerivedImageToolUseCase";
import {
  createGenerationImageToolUseCase,
  imageToolSubmissionParameterValues,
} from
  "../client/src/imageTools/generationImageToolUseCase";
import { createMultiAngleImageToolUseCase } from
  "../client/src/imageTools/multiAngleImageToolUseCase";
import { createOutpaintEraseImageToolUseCase } from
  "../client/src/imageTools/outpaintEraseImageToolUseCase";
import { createPromptGenerationImageToolUseCase } from
  "../client/src/imageTools/promptGenerationImageToolUseCase";
import {
  createFakeImageToolCapabilityAdapter,
  ImageToolCapabilityAdapterRegistry,
  imageToolCapabilitySnapshot,
} from "../server/imageToolCapabilityRegistry";
import { validateSeedanceAsset } from "../server/seedanceAssetValidation";
import {
  simplifyAnnotationPoints,
  validateImageAnnotationDocument,
} from "../client/src/imageTools/imageAnnotations";
import { redrawCanvasPoint } from
  "../client/src/imageTools/redrawMask";
import { persistedMediaReferences } from
  "../types/persistedMediaSources";
import { expect, test } from "./safe-test";

type MediaEditHandlerDependencies = NonNullable<
  Parameters<typeof mediaEditSource>[2]
>;

function mediaEditDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolvePromise = accept;
  });
  return { promise, resolve: resolvePromise };
}

async function imageEditFixture(backend: "local" | "oss" = "oss") {
  const bytes = await readFile(resolve(
    "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
  ));
  const dimensions = validatePng(bytes);
  const media: MediaRecord = {
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "image/png",
    durationSeconds: null,
    durationSource: null,
    durationStatus: "not-applicable",
    mediaHeight: dimensions.height,
    mediaWidth: dimensions.width,
    objectKey: "objects/image/source.png",
    storageBackend: backend,
    storageName: "source.png",
    storageProfileId: backend === "oss" ? "profile-1" : null,
    storageStatus: "ready",
  };
  return { bytes, media };
}

function imageEditBlobStore(
  read: (input: ReadMediaBlobInput) => Promise<Uint8Array>,
): MediaBlobStore {
  return {
    async delete() {},
    async head() { return undefined; },
    async put() { throw new Error("not used"); },
    async read(_reference, input) { return read(input); },
    async signRead() { throw new Error("not used"); },
  };
}

async function invokeMediaEditSource(
  dependencies: MediaEditHandlerDependencies,
  path: string,
  method = "GET",
  afterStart?: (request: IncomingMessage) => void,
) {
  const request = Object.assign(new EventEmitter(), {
    headers: {},
    method,
    socket: { remoteAddress: "127.0.0.1" },
    url: path,
  }) as unknown as IncomingMessage;
  const headers = new Map<string, string>();
  let body = Buffer.alloc(0);
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    writableEnded: false,
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return response;
    },
    end(value?: string | Uint8Array) {
      if (value !== undefined) body = Buffer.from(value);
      response.emit("finish");
      return response;
    },
  }) as unknown as ServerResponse;
  const pending = mediaEditSource(request, response, dependencies);
  afterStart?.(request);
  await pending;
  return {
    body,
    header: (name: string) => headers.get(name.toLowerCase()) ?? null,
    json: () => JSON.parse(body.toString("utf8")) as Record<string, unknown>,
    status: response.statusCode,
  };
}

function mediaEditIdentity() {
  return {
    bypass: false,
    displayName: "Owner",
    role: "admin" as const,
    userId: "owner-1",
  };
}

async function verifyMediaEditSourceContracts() {
  const { bytes, media } = await imageEditFixture();
  let reads = 0;
  const success = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async (input) => {
      reads += 1;
      expect(input.maximumBytes).toBe(20 * 1024 * 1024);
      expect(input.signal?.aborted).toBe(false);
      return bytes;
    }),
    identity: mediaEditIdentity,
    lookup: () => media,
  }, "/asset-1");
  expect(success.status).toBe(200);
  expect(success.header("content-type")).toBe("image/png");
  expect(success.header("content-length")).toBe(String(bytes.byteLength));
  expect(success.header("cache-control")).toBe("private, no-store");
  expect(success.header("location")).toBeNull();
  expect(success.body).toEqual(bytes);
  expect(reads).toBe(1);

  const invalidDependencies = {
    blobStore: imageEditBlobStore(async () => bytes),
    identity: mediaEditIdentity,
    lookup: (_request, _kind, id) => id === "missing" ? undefined : {
      ...media,
      checksumSha256: "0".repeat(64),
    },
  } satisfies MediaEditHandlerDependencies;
  const missing = await invokeMediaEditSource(invalidDependencies, "/missing");
  expect(missing.status).toBe(404);
  expect(missing.json()).toMatchObject({ code: "IMAGE_EDIT_SOURCE_NOT_FOUND" });
  const invalid = await invokeMediaEditSource(invalidDependencies, "/asset-1");
  expect(invalid.status).toBe(409);
  expect(invalid.json()).toMatchObject({ code: "IMAGE_EDIT_SOURCE_INVALID" });
  const method = await invokeMediaEditSource(
    invalidDependencies,
    "/asset-1",
    "POST",
  );
  expect(method.status).toBe(405);
  expect(method.header("allow")).toBe("GET");

  const unauthenticated = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => bytes),
    identity: () => undefined,
    lookup: () => media,
  }, "/asset-1");
  expect(unauthenticated.status).toBe(401);
  const unavailable = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => bytes),
    identity: mediaEditIdentity,
    lookup: (_request, _kind, id) => {
      if (id === "other-owner") return undefined;
      if (id === "pending") return { ...media, storageStatus: "pending" };
      return media;
    },
  }, "/pending");
  expect(unavailable.status).toBe(404);
  const otherOwner = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => bytes),
    identity: mediaEditIdentity,
    lookup: () => undefined,
  }, "/other-owner");
  expect(otherOwner.status).toBe(404);
  for (const record of [
    { ...media, byteSize: 20 * 1024 * 1024 + 1 },
    { ...media, contentType: "image/jpeg" },
  ]) {
    const invalidMetadata = await invokeMediaEditSource({
      blobStore: imageEditBlobStore(async () => bytes),
      identity: mediaEditIdentity,
      lookup: () => record,
    }, "/asset-1");
    expect(invalidMetadata.status).toBe(409);
  }
  const wrongLength = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => bytes),
    identity: mediaEditIdentity,
    lookup: () => ({ ...media, byteSize: media.byteSize + 1 }),
  }, "/asset-1");
  expect(wrongLength.status).toBe(409);
  const invalidPngBytes = Buffer.from("not-a-png", "utf8");
  const invalidPng = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => invalidPngBytes),
    identity: mediaEditIdentity,
    lookup: () => ({
      ...media,
      byteSize: invalidPngBytes.byteLength,
      checksumSha256: createHash("sha256").update(invalidPngBytes).digest("hex"),
      mediaHeight: null,
      mediaWidth: null,
    }),
  }, "/asset-1");
  expect(invalidPng.status).toBe(409);
  const storageFailure = await invokeMediaEditSource({
    blobStore: imageEditBlobStore(async () => {
      throw new Error("offline fake storage unavailable");
    }),
    identity: mediaEditIdentity,
    lookup: () => media,
  }, "/asset-1");
  expect(storageFailure.status).toBe(503);

  const entered = mediaEditDeferred<void>();
  const releaseRead = mediaEditDeferred<void>();
  const busyAdmission = new MediaEditSourceAdmission(2, 1);
  const busyDependencies = {
    admission: busyAdmission,
    blobStore: imageEditBlobStore(async () => {
      entered.resolve();
      await releaseRead.promise;
      return bytes;
    }),
    identity: mediaEditIdentity,
    lookup: () => media,
  } satisfies MediaEditHandlerDependencies;
  const first = invokeMediaEditSource(busyDependencies, "/asset-1");
  await entered.promise;
  const busy = await invokeMediaEditSource(busyDependencies, "/asset-2");
  expect(busy.status).toBe(429);
  expect(busy.header("retry-after")).toBe("1");
  expect(busy.json()).toMatchObject({ code: "IMAGE_EDIT_SOURCE_BUSY" });
  releaseRead.resolve();
  expect((await first).status).toBe(200);
  expect(busyAdmission.snapshot()).toEqual({ active: 0, owners: 0 });

  const globalEntered = mediaEditDeferred<void>();
  const releaseGlobalReads = mediaEditDeferred<void>();
  const globalAdmission = new MediaEditSourceAdmission(2, 1);
  let globalReadCount = 0;
  const globalDependencies = (ownerId: string) => ({
    admission: globalAdmission,
    blobStore: imageEditBlobStore(async () => {
      globalReadCount += 1;
      if (globalReadCount === 2) globalEntered.resolve();
      await releaseGlobalReads.promise;
      return bytes;
    }),
    identity: () => ({
      bypass: false,
      displayName: ownerId,
      role: "admin" as const,
      userId: ownerId,
    }),
    lookup: () => media,
  }) satisfies MediaEditHandlerDependencies;
  const globalFirst = invokeMediaEditSource(
    globalDependencies("owner-1"),
    "/asset-1",
  );
  const globalSecond = invokeMediaEditSource(
    globalDependencies("owner-2"),
    "/asset-2",
  );
  await globalEntered.promise;
  const globallyBusy = await invokeMediaEditSource(
    globalDependencies("owner-3"),
    "/asset-3",
  );
  expect(globallyBusy.status).toBe(429);
  releaseGlobalReads.resolve();
  expect((await globalFirst).status).toBe(200);
  expect((await globalSecond).status).toBe(200);
  expect(globalAdmission.snapshot()).toEqual({ active: 0, owners: 0 });

  let disconnectedRead = false;
  const disconnectAdmission = new MediaEditSourceAdmission(2, 1);
  const disconnected = await invokeMediaEditSource({
    admission: disconnectAdmission,
    blobStore: imageEditBlobStore(async (input) => await new Promise<Uint8Array>(
      (_accept, reject) => {
        input.signal?.addEventListener("abort", () => {
          disconnectedRead = true;
          reject(input.signal?.reason);
        }, { once: true });
      },
    )),
    identity: mediaEditIdentity,
    lookup: () => media,
  }, "/asset-1", "GET", (request) => request.emit("aborted"));
  expect(disconnected.status).toBe(503);
  expect(disconnectedRead).toBe(true);
  expect(disconnectAdmission.snapshot()).toEqual({ active: 0, owners: 0 });

  let aborted = false;
  const timeoutAdmission = new MediaEditSourceAdmission(2, 1);
  const timeout = await invokeMediaEditSource({
    admission: timeoutAdmission,
    blobStore: imageEditBlobStore(async (input) => await new Promise<Uint8Array>(
      (_accept, reject) => {
        input.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(input.signal?.reason);
        }, { once: true });
      },
    )),
    identity: mediaEditIdentity,
    lookup: () => media,
    readTimeoutMs: 20,
  }, "/asset-1");
  expect(timeout.status).toBe(504);
  expect(timeout.json()).toMatchObject({ code: "IMAGE_EDIT_SOURCE_TIMEOUT" });
  expect(aborted).toBe(true);
  expect(timeoutAdmission.snapshot()).toEqual({ active: 0, owners: 0 });
}

const profile = (input: Pick<ProviderProfile, "driver" | "id">): ProviderProfile => ({
  baseUrl: "https://provider.invalid/v1",
  createdAt: "2026-08-22T00:00:00.000Z",
  label: `P2 ${input.id}`,
  updatedAt: "2026-08-22T00:00:00.000Z",
  ...input,
});

function modularImageToolCapability(
  operation: typeof imageToolOperations[number],
  overrides: Partial<ImageToolCapability> = {},
) {
  return {
    expiresAt: "2026-08-23T13:00:00.000Z",
    maximumInputBytes: imageToolMaximums.inputBytes,
    maximumInputPixels: imageToolMaximums.inputPixels,
    operation,
    outputContentTypes: ["image/png"],
    reason: "Ready",
    reasonCode: "AVAILABLE",
    status: "available",
    supportsAlpha: false,
    supportsMask: false,
    supportsReferenceImage: true,
    ...overrides,
  } satisfies ImageToolCapability;
}

function modularImageToolSnapshot() {
  return {
    generatedAt: "2026-08-23T12:00:00.000Z",
    operations: imageToolOperations.map((operation) =>
      modularImageToolCapability(operation)),
    revision: "capabilities-1",
  };
}

test("image tool capability snapshot is complete, unique and fail-closed", () => {
  const parsed = parseImageToolCapabilitySnapshot(modularImageToolSnapshot());
  expect(parsed.operations).toHaveLength(imageToolOperations.length);
  expect(imageToolCapability(parsed, "redraw")).toMatchObject({
    operation: "redraw",
    status: "available",
    supportsReferenceImage: true,
  });

  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.slice(1),
  })).toThrow(/every operation once/);
  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.map((item, index) =>
      index === 1 ? { ...item, operation: "crop" } : item),
  })).toThrow(/duplicated/);
  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.map((item) =>
      item.operation === "redraw"
        ? { ...item, reasonCode: "AVAILABLE", status: "disabled_by_operator" }
        : item),
  })).toThrow(/cannot use AVAILABLE/);

  const fake = createFakeImageToolCapabilityAdapter({
    operations: ["multi-angle", "redraw", "remove-background"],
    supportsAlpha: true,
    supportsMask: true,
    supportsReferenceImage: true,
  });
  const registry = new ImageToolCapabilityAdapterRegistry().register(fake);
  expect(() => registry.register({ ...fake, id: "duplicate" }))
    .toThrow(/already owns multi-angle/);
  const serverSnapshot = imageToolCapabilitySnapshot({
    adapters: registry,
    disabled: "redraw,unknown-operation",
    generation: {
      configured: true,
      emergencyStop: false,
      globalEnabled: true,
      maxCostMicrounits: 9_000,
      modelId: "image-model-internal-id",
      providerModelId: "gpt-image-2",
      providerProtocol: "gpt-image",
    },
    now: new Date("2026-08-23T12:00:00.000Z"),
  });
  expect(imageToolCapability(serverSnapshot, "multi-angle")).toMatchObject({
    estimatedCost: { amount: 0.009, currency: "USD", source: "operator" },
    modelId: "image-model-internal-id",
    status: "available",
    supportsMask: true,
  });
  expect(imageToolCapability(serverSnapshot, "redraw")).toMatchObject({
    reasonCode: "OPERATOR_DISABLED",
    status: "disabled_by_operator",
  });
  expect(imageToolCapability(serverSnapshot, "lighting")).toMatchObject({
    reasonCode: "PAUSED_BY_SCOPE",
    status: "paused",
  });
  expect(imageToolCapability(serverSnapshot, "remove-background")).toMatchObject({
    reasonCode: "AVAILABLE",
    status: "available",
    supportsAlpha: true,
  });
  expect(imageToolCapability(serverSnapshot, "enhance-conservative")).toMatchObject({
    reasonCode: "AVAILABLE",
    status: "available",
  });
  expect(imageToolCapability(serverSnapshot, "seedance-validate")).toMatchObject({
    reasonCode: "AVAILABLE",
    status: "available",
  });

  const validation = parseSeedanceAssetValidation(validateSeedanceAsset({
    assetId: "seedance-image-1",
    media: {
      byteSize: 1_048_576,
      checksumSha256: "a".repeat(64),
      contentType: "image/png",
      mediaHeight: 720,
      mediaWidth: 1280,
      storageStatus: "ready",
    },
    model: {
      configurationRevision: "rules-1",
      displayName: "Seedance 2.0 Mini",
      id: "seedance-model-1",
      parameterSchema: knownModelParameterSchema({
        capability: "video",
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seedance-2-0-mini-260615",
      }),
    },
    now: new Date("2026-08-23T12:00:00.000Z"),
    role: "reference-image",
  }));
  expect(validation).toMatchObject({
    assetId: "seedance-image-1",
    remoteValidationAvailable: false,
    status: "eligible",
  });
  expect(seedanceAssetValidationState(validation, {
    assetId: "seedance-image-1",
    modelConfigurationRevision: "rules-1",
    modelId: "seedance-model-1",
    role: "reference-image",
  }, new Date("2026-08-23T12:04:59.000Z"))).toBe("eligible");
  expect(seedanceAssetValidationState(validation, {
    assetId: "seedance-image-1",
    modelConfigurationRevision: "rules-2",
    modelId: "seedance-model-1",
    role: "reference-image",
  }, new Date("2026-08-23T12:04:59.000Z"))).toBe("stale");
  expect(seedanceAssetValidationState(validation, {
    assetId: "seedance-image-1",
    modelConfigurationRevision: "rules-1",
    modelId: "seedance-model-1",
    role: "reference-image",
  }, new Date("2026-08-23T12:05:00.000Z"))).toBe("stale");
  expect(validateSeedanceAsset({
    assetId: "seedance-image-1",
    media: {
      byteSize: 1_048_576,
      checksumSha256: "b".repeat(64),
      contentType: "image/jpeg",
      mediaHeight: 720,
      mediaWidth: 1280,
      storageStatus: "ready",
    },
    model: {
      configurationRevision: "rules-1",
      displayName: "Seedance 2.0 Mini",
      id: "seedance-model-1",
      parameterSchema: knownModelParameterSchema({
        capability: "video",
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seedance-2-0-mini-260615",
      }),
    },
    role: "subject",
  })).toMatchObject({ status: "ineligible" });
});

test("image tool capability contract bounds payloads, cost and output formats", async () => {
  const productionLikeImageSchema = knownModelParameterSchema({
    capability: "image",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  });
  productionLikeImageSchema.fields = productionLikeImageSchema.fields.map((field) =>
    field.key === "quality"
      ? {
          ...field,
          defaultValue: "2k",
          options: [
            { label: "1K", value: "1k" },
            { label: "2K", value: "2k" },
          ],
        }
      : field
  );
  expect(imageToolSubmissionParameterValues(productionLikeImageSchema, {
    aspectRatio: "1:1",
    inputMode: "text",
    outputCount: 1,
    quality: "1k",
  })).toMatchObject({
    aspectRatio: "1:1",
    inputMode: "image",
    outputCount: 1,
    quality: "1k",
  });

  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.map((item) =>
      item.operation === "redraw"
        ? { ...item, maximumInputBytes: imageToolMaximums.inputBytes + 1 }
        : item),
  })).toThrow(/maximumInputBytes/);
  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.map((item) =>
      item.operation === "remove-background"
        ? { ...item, outputContentTypes: ["image/webp"] }
        : item),
  })).toThrow(/outputContentTypes/);
  expect(() => parseImageToolCapabilitySnapshot({
    ...modularImageToolSnapshot(),
    operations: modularImageToolSnapshot().operations.map((item) =>
      item.operation === "multi-angle"
        ? { ...item, estimatedCost: { amount: -1, currency: "USD", source: "provider" } }
        : item),
  })).toThrow(/estimatedCost.amount/);

  const annotationElements: ImageAnnotationElement[] = Array.from(
    { length: 100 },
    (_, index) => ({
      color: "#ff5b5b",
      height: 80,
      id: `rectangle-${index}`,
      kind: "rectangle" as const,
      strokeWidth: 4,
      width: 120,
      x: index * 3,
      y: index * 2,
    }),
  );
  const densePoints = Array.from({ length: 1_000 }, (_, index) => ({
    x: index % 800,
    y: index % 2 === 0 ? 200 : 201,
  }));
  annotationElements.push({
    color: "#5b8cff",
    id: "stroke-1000",
    kind: "stroke",
    points: densePoints,
    strokeWidth: 6,
  }, {
    color: "#fff",
    fontSize: 28,
    id: "text-chinese",
    kind: "text",
    text: "中文标注刷新、自动保存、revision 与撤销恢复",
    x: 20,
    y: 30,
  });
  const annotationCapacity = validateImageAnnotationDocument({
    elements: annotationElements,
    height: 720,
    version: 1,
    width: 1280,
  });
  expect(annotationCapacity.bytes).toBeLessThan(
    imageToolMaximums.annotationDocumentBytes,
  );
  expect(simplifyAnnotationPoints(densePoints).length).toBeLessThan(100);

  const dispatcher = createImageToolDispatcher().register({
    operation: "fullscreen",
    execute: () => ({
      kind: "viewer",
      operation: "fullscreen",
      status: "opened",
    }),
  });
  await expect(dispatcher.execute("fullscreen", {})).resolves.toEqual({
    kind: "viewer",
    operation: "fullscreen",
    status: "opened",
  });
  await expect(dispatcher.execute("download", {})).rejects.toThrow(/not registered/);
  expect(() => dispatcher.register({
    operation: "fullscreen",
    execute: () => ({
      kind: "viewer",
      operation: "fullscreen",
      status: "opened",
    }),
  })).toThrow(/Duplicate/);
});

class InMemoryCanvasPorts implements CanvasGraphCommandPort, CanvasSavePort {
  #revision = 0;
  #snapshot: CanvasGraphSnapshot;

  constructor(snapshot: CanvasGraphSnapshot) {
    this.#snapshot = snapshot;
  }

  apply(command: CanvasGraphCommand) {
    if (command.scope !== "generation") {
      return { reason: "fence-rejected", status: "rejected" } as const;
    }
    const node = this.#snapshot.nodes.find((candidate) =>
      candidate.id === command.fence.nodeId
    );
    if (
      !node || node.type !== command.fence.kind ||
      node.data.workflowExecutionRunId !== command.fence.runId ||
      node.data[`${command.fence.kind}GenerationOwnershipKey`] !==
        command.fence.ownershipKey ||
      (command.fence.taskId !== undefined &&
        node.data[`${command.fence.kind}GenerationTaskId`] !== command.fence.taskId) ||
      (command.fence.expectedRevision !== undefined &&
        command.fence.expectedRevision !== this.#revision)
    ) {
      return { reason: "fence-rejected", status: "rejected" } as const;
    }
    this.#snapshot = command.update(this.#snapshot);
    return { status: "applied" } as const;
  }

  async flush() {}

  snapshot() {
    return this.#snapshot;
  }

  async waitForRevision() {
    this.#revision += 1;
    return { revision: this.#revision };
  }
}

test("Canvas graph/save ports are independently replaceable and preserve write fences", async () => {
  const port = new InMemoryCanvasPorts({
    edges: [],
    nodes: [{
      data: {
        imageGenerationOwnershipKey: "owner-1",
        imageGenerationTaskId: "task-1",
        label: "P2 image node",
        workflowExecutionRunId: "run-1",
      },
      id: "node-1",
      position: { x: 0, y: 0 },
      type: "image",
    }],
  });
  const receipt = await port.waitForRevision();
  expect(receipt).toEqual({ revision: 1 });
  expect(port.apply({
    fence: {
      expectedRevision: 1,
      kind: "image",
      nodeId: "node-1",
      ownershipKey: "owner-1",
      runId: "run-1",
      taskId: "task-1",
    },
    scope: "generation",
    update: (snapshot) => ({
      ...snapshot,
      nodes: snapshot.nodes.map((node) => node.id === "node-1"
        ? { ...node, data: { ...node.data, imageGenerating: false } }
        : node),
    }),
  })).toEqual({ status: "applied" });
  expect(port.apply({
    fence: {
      expectedRevision: 1,
      kind: "image",
      nodeId: "node-1",
      ownershipKey: "stale-owner",
      runId: "run-1",
      taskId: "task-1",
    },
    scope: "generation",
    update: (snapshot) => snapshot,
  })).toEqual({ reason: "fence-rejected", status: "rejected" });
  expect(port.snapshot().nodes[0].data.imageGenerating).toBe(false);

  let imageToolSnapshot: CanvasGraphSnapshot = {
    edges: [],
    nodes: [{
      data: { assetId: "source-asset", imageSrc: "/source.png", label: "Image" },
      id: "source-node",
      position: { x: 20, y: 30 },
      style: { width: 250 },
      type: "image",
    }],
    revision: 4,
  };
  const imageToolGraph = createCanvasGraphCommandPort({
    commit(snapshot) { imageToolSnapshot = snapshot; },
    persistenceReady: () => true,
    snapshot: () => imageToolSnapshot,
  });
  const discarded: string[] = [];
  const derived = createDerivedImageToolUseCase({
    graph: imageToolGraph,
    media: {
      async discard(assetId) { discarded.push(assetId); },
      async metadata() { return { mediaMetadataStatus: "ready" }; },
      async upload() {
        return {
          assetId: `derived-${discarded.length}`,
          fileName: "crop.png",
          height: 120,
          url: "/derived.png",
          width: 200,
        };
      },
    },
    operation: "crop",
    size: (width, height) => ({ height, width }),
  });
  await expect(derived.execute({
    expectedRevision: 4,
    file: new File([Uint8Array.from([1])], "crop.png", { type: "image/png" }),
    operationId: "operation-1",
    ownershipKey: "owner-1",
    runId: "run-1",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
    title: "Crop",
  })).resolves.toMatchObject({
    assetIds: ["derived-0"],
    kind: "derived-assets",
    operation: "crop",
  });
  expect(imageToolSnapshot.nodes).toHaveLength(2);
  expect(imageToolSnapshot.edges).toHaveLength(1);
  expect(discarded).toEqual([]);
  await expect(derived.execute({
    expectedRevision: 5,
    file: new File([Uint8Array.from([2])], "crop.png", { type: "image/png" }),
    operationId: "operation-2",
    ownershipKey: "owner-1",
    runId: "run-2",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
    title: "Crop",
  })).rejects.toThrow(/版本已发生变化/);
  expect(discarded).toEqual(["derived-0"]);

  let batchSequence = 0;
  const batchDiscarded: string[] = [];
  const batch = createBatchDerivedImageToolUseCase({
    graph: imageToolGraph,
    media: {
      async discard(assetId) { batchDiscarded.push(assetId); },
      async metadata(assetId) {
        return {
          mediaHeight: 60,
          mediaMetadataStatus: "ready" as const,
          mediaWidth: 100,
          sourceAssetId: assetId,
        };
      },
      async upload(file) {
        const index = batchSequence++;
        return {
          assetId: `split-${index}`,
          fileName: file.name,
          height: 60,
          url: `/split-${index}.png`,
          width: 100,
        };
      },
    },
    operation: "quick-split",
    size: (width, height) => ({ height, width }),
  });
  const splitFiles = Array.from({ length: 4 }, (_, index) =>
    new File([Uint8Array.from([index])], `split-${index}.png`, {
      type: "image/png",
    })
  );
  await expect(batch.execute({
    expectedRevision: 4,
    files: splitFiles,
    grid: 2,
    operationId: "operation-split-1",
    ownershipKey: "owner-split-1",
    runId: "run-split-1",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
    title: "Split",
  })).resolves.toMatchObject({
    assetIds: ["split-0", "split-1", "split-2", "split-3"],
    kind: "derived-assets",
    operation: "quick-split",
  });
  expect(imageToolSnapshot.nodes).toHaveLength(6);
  expect(imageToolSnapshot.edges).toHaveLength(5);
  expect(batchDiscarded).toEqual([]);

  for (const grid of [3, 4] as const) {
    const files = Array.from({ length: grid ** 2 }, (_, index) =>
      new File([Uint8Array.from([index])], `split-${grid}-${index}.png`, {
        type: "image/png",
      })
    );
    await expect(batch.execute({
      expectedRevision: 4,
      files,
      grid,
      operationId: `operation-split-${grid}`,
      ownershipKey: `owner-split-${grid}`,
      runId: `run-split-${grid}`,
      sourceAssetId: "source-asset",
      sourceNodeId: "source-node",
      title: `Split ${grid}`,
    })).resolves.toMatchObject({
      assetIds: expect.arrayContaining([`split-${grid === 3 ? 4 : 13}`]),
      operation: "quick-split",
    });
  }
  expect(imageToolSnapshot.nodes).toHaveLength(31);
  expect(imageToolSnapshot.edges).toHaveLength(30);
  expect(batchDiscarded).toEqual([]);

  await expect(batch.execute({
    expectedRevision: 5,
    files: splitFiles,
    grid: 2,
    operationId: "operation-split-stale",
    ownershipKey: "owner-split-stale",
    runId: "run-split-stale",
    sourceAssetId: "source-asset",
    sourceNodeId: "source-node",
    title: "Split stale",
  })).rejects.toThrow(/版本已发生变化/);
  expect(batchDiscarded).toEqual([
    "split-29",
    "split-30",
    "split-31",
    "split-32",
  ]);

  let multiAngleSnapshot: CanvasGraphSnapshot = {
    edges: [],
    nodes: [{
      data: { assetId: "angle-source-asset", label: "Image" },
      id: "angle-source",
      position: { x: 10, y: 20 },
      style: { width: 250 },
      type: "image",
    }],
    revision: 7,
  };
  const multiAngleGraph = createCanvasGraphCommandPort({
    commit(next) { multiAngleSnapshot = next; },
    persistenceReady: () => true,
    snapshot: () => multiAngleSnapshot,
  });
  let capturedPlan: { nodeId: string; payload: {
    imageTool: {
      operation: string;
      operationId: string;
      sourceAssetId: string;
      sourceNodeId: string;
    };
    inputs: readonly [{ order: number }];
    ownPrompt: string;
  } } |
    undefined;
  const multiAngle = createMultiAngleImageToolUseCase({
    async afterPlaceholderCreated() {},
    capability: modularImageToolCapability("multi-angle", {
      expiresAt: "2099-08-23T13:00:00.000Z",
      modelId: "image-model-internal-id",
    }),
    graph: multiAngleGraph,
    createLifecycle(plan) {
      capturedPlan = plan;
      const fakeTask: GenerationTaskSummary = {
        attempt: 1,
        canvasId: "angle-canvas",
        costCurrency: "USD",
        createdAt: "2026-08-23T12:00:00.000Z",
        generationInputKey: plan.inputKey,
        generationOwnershipKey: plan.ownershipKey,
        id: "angle-task-1",
        kind: "image",
        nodeId: plan.nodeId,
        prompt: plan.payload.prompt,
        state: "queued",
        updatedAt: "2026-08-23T12:00:01.000Z",
      };
      return {
        abort() {},
        async cancel() { return { status: "cancelled", task: fakeTask }; },
        async generate() { return { status: "success", task: fakeTask }; },
        async reconcile() { return { status: "success", task: fakeTask }; },
        async recover() { return { status: "success", task: fakeTask }; },
        async retry() { return { status: "success", task: fakeTask }; },
        async submit() { return { status: "submitted", task: fakeTask }; },
      } satisfies SingleNodeGenerationLifecycle;
    },
  });
  await expect(multiAngle.execute({
    aspectRatio: "auto",
    canvasId: "angle-canvas",
    expectedRevision: 7,
    modelId: "image-model-internal-id",
    modelName: "GPT Image 2",
    modelParameters: { inputMode: "image", outputCount: 1 },
    operationId: "angle-operation-1",
    ownershipKey: "angle-owner-1",
    parameters: {
      distance: 20,
      horizontalDegrees: 45,
      verticalDegrees: -12,
      wideAngle: true,
    },
    quality: "auto",
    runId: "angle-run-1",
    sourceAssetId: "angle-source-asset",
    sourceNodeId: "angle-source",
    title: "Source",
  })).resolves.toEqual({
    kind: "generation-task",
    operation: "multi-angle",
    taskId: "angle-task-1",
  });
  expect(multiAngleSnapshot.nodes).toHaveLength(2);
  expect(multiAngleSnapshot.edges).toContainEqual(expect.objectContaining({
    data: { inputOrder: 1, inputRole: "reference-image" },
    source: "angle-source",
    target: "image-multi-angle-angle-operation-1",
  }));
  expect(capturedPlan?.payload.inputs[0]?.order).toBe(1);
  expect(capturedPlan?.payload.ownPrompt).toContain("水平视角旋转 45 度");
  expect(capturedPlan?.payload.imageTool).toEqual({
    operation: "multi-angle",
    operationId: "angle-operation-1",
    sourceAssetId: "angle-source-asset",
    sourceNodeId: "angle-source",
  });
  expect(multiAngleSnapshot.nodes[1]?.data).toMatchObject({
    imageModelId: "image-model-internal-id",
    imageMultiAngleParameters: {
      distance: 20,
      horizontalDegrees: 45,
      verticalDegrees: -12,
      wideAngle: true,
    },
    imageToolOperation: "multi-angle",
    imageToolOperationId: "angle-operation-1",
    imageToolSourceAssetId: "angle-source-asset",
  });
  for (const operation of ["erase", "outpaint"] as const) {
    let maskedSnapshot: CanvasGraphSnapshot = {
      edges: [],
      nodes: [{ data: { assetId: `${operation}-source-asset`, label: "Image",
        mediaHeight: 720, mediaWidth: 1280 }, id: `${operation}-source`,
        position: { x: 0, y: 0 }, style: { width: 250 }, type: "image" }],
      revision: 9,
    };
    const uploads: string[] = [];
    let capturedMaskedOrder: number | undefined;
    const masked = createOutpaintEraseImageToolUseCase({
      async afterPlaceholderCreated() {},
      capability: modularImageToolCapability(operation, {
        expiresAt: "2099-08-23T13:00:00.000Z",
        modelId: "image-model-internal-id",
        supportsMask: true,
      }),
      graph: createCanvasGraphCommandPort({
        commit(next) { maskedSnapshot = next; },
        persistenceReady: () => true,
        snapshot: () => maskedSnapshot,
      }),
      media: {
        async discard() {},
        async metadata(assetId) { return { mediaHeight: 720,
          mediaMetadataStatus: "ready" as const, mediaWidth: 1280,
          sourceAssetId: assetId }; },
        async upload(file) {
          uploads.push(file.name);
          const expanded = operation === "outpaint";
          return { assetId: `${operation}-upload-${uploads.length}`,
            fileName: file.name, height: expanded ? 1080 : 720,
            url: `/api/assets/${operation}-upload-${uploads.length}`,
            width: expanded ? 1920 : 1280 };
        },
      },
      operation,
      ownershipKey: (evidence) => JSON.stringify(evidence),
      createLifecycle(plan) {
        capturedMaskedOrder = plan.payload.inputs[0].order;
        const task = { attempt: 1, canvasId: "masked-canvas", costCurrency: "USD",
          createdAt: "2026-08-23T12:00:00.000Z", generationInputKey: plan.inputKey,
          generationOwnershipKey: plan.ownershipKey, id: `${operation}-task`,
          kind: "image", nodeId: plan.nodeId, prompt: plan.payload.prompt,
          state: "queued", updatedAt: "2026-08-23T12:00:01.000Z" } as const;
        return { abort() {}, async cancel() { return { status: "cancelled", task }; },
          async generate() { return { status: "success", task }; },
          async reconcile() { return { status: "success", task }; },
          async recover() { return { status: "success", task }; },
          async retry() { return { status: "success", task }; },
          async submit() { return { status: "submitted", task }; } } satisfies
          SingleNodeGenerationLifecycle;
      },
    });
    const outpaint = operation === "outpaint" ? { outputHeight: 1080,
      outputWidth: 1920, sourceHeight: 720, sourceWidth: 1280,
      sourceX: 320, sourceY: 180, version: 1 as const } : undefined;
    await expect(masked.execute({ accountId: "account", aspectRatio: "auto",
      canvasId: "masked-canvas", expectedRevision: 9, featherPixels: 0,
      maskFile: new File([Uint8Array.from([1])], `${operation}-mask.png`, { type: "image/png" }),
      modelId: "image-model-internal-id", modelName: "GPT Image 2",
      modelParameters: { inputMode: "image" }, operationId: `${operation}-operation`,
      outpaint, preOwnershipKey: "pre-owner",
      preparedFile: operation === "outpaint"
        ? new File([Uint8Array.from([1])], "outpaint-input.png", { type: "image/png" })
        : undefined,
      prompt: operation === "erase" ? "移除对象并补全背景" : "自然延展",
      quality: "auto", runId: `${operation}-run`,
      sourceAssetId: `${operation}-source-asset`, sourceNodeId: `${operation}-source`,
      title: "Source" })).resolves.toMatchObject({ operation,
        taskId: `${operation}-task` });
    expect(maskedSnapshot.nodes[1]?.data).toMatchObject({
      imageToolOperation: operation,
      imageToolOutpaintParameters: outpaint,
      ...(operation === "outpaint"
        ? { imageToolPreparedAssetId: "outpaint-upload-1" }
        : {}),
    });
    expect(maskedSnapshot.edges[0]?.data).toMatchObject({
      inputOrder: 1,
      inputRole: "reference-image",
    });
    expect(capturedMaskedOrder).toBe(1);
  }
  for (const operation of ["enhance-creative", "remove-background"] as const) {
    let processingSnapshot: CanvasGraphSnapshot = {
      edges: [],
      nodes: [{ data: { assetId: `${operation}-source-asset`, label: "Image" },
        id: `${operation}-source`, position: { x: 0, y: 0 },
        style: { width: 250 }, type: "image" }], revision: 11,
    };
    let capturedPayload: {
      imageTool: import("../types/imageTools").ImageGenerationToolInput;
      inputs: readonly [{ order: number }];
    } |
      undefined;
    const useCase = createPromptGenerationImageToolUseCase({
      async afterPlaceholderCreated() {},
      capability: modularImageToolCapability(operation, {
        expiresAt: "2099-08-23T13:00:00.000Z",
        modelId: "image-model-internal-id",
        supportsAlpha: operation === "remove-background",
      }),
      graph: createCanvasGraphCommandPort({
        commit(next) { processingSnapshot = next; },
        persistenceReady: () => true,
        snapshot: () => processingSnapshot,
      }),
      operation,
      ownershipKey: (evidence) => JSON.stringify(evidence),
      createLifecycle(plan) {
        capturedPayload = plan.payload;
        const task = { attempt: 1, canvasId: "processing-canvas", costCurrency: "USD",
          createdAt: "2026-08-23T12:00:00.000Z", generationInputKey: plan.inputKey,
          generationOwnershipKey: plan.ownershipKey, id: `${operation}-task`, kind: "image",
          nodeId: plan.nodeId, prompt: plan.payload.prompt, state: "queued",
          updatedAt: "2026-08-23T12:00:01.000Z" } as const;
        return { abort() {}, async cancel() { return { status: "cancelled", task }; },
          async generate() { return { status: "success", task }; },
          async reconcile() { return { status: "success", task }; },
          async recover() { return { status: "success", task }; },
          async retry() { return { status: "success", task }; },
          async submit() { return { status: "submitted", task }; } } satisfies
          SingleNodeGenerationLifecycle;
      },
    });
    await expect(useCase.execute({ accountId: "account", aspectRatio: "auto",
      canvasId: "processing-canvas", expectedRevision: 11,
      modelId: "image-model-internal-id", modelName: "GPT Image 2",
      modelParameters: { inputMode: "image" }, operationId: `${operation}-operation`,
      preOwnershipKey: "pre-owner", prompt: "处理图片", quality: "auto",
      runId: `${operation}-run`, sourceAssetId: `${operation}-source-asset`,
      sourceNodeId: `${operation}-source`, title: "Source" }))
      .resolves.toMatchObject({ operation, taskId: `${operation}-task` });
    expect(capturedPayload?.imageTool).toMatchObject({ operation,
      ...(operation === "remove-background"
        ? { outputBackground: "transparent" }
        : {}) });
    expect(capturedPayload?.inputs[0]?.order).toBe(1);
    expect(processingSnapshot.edges[0]?.data).toMatchObject({
      inputOrder: 1,
      inputRole: "reference-image",
    });
    expect(processingSnapshot.nodes[1]?.data).toMatchObject({
      imageToolOperation: operation,
      ...(operation === "remove-background"
        ? { imageToolOutputBackground: "transparent" }
        : {}),
    });
  }
  const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==",
    "base64",
  );
  const opaqueAlphaPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  expect(validateTransparentPng(transparentPng)).toEqual({ height: 1, width: 1 });
  expect(() => validateTransparentPng(opaqueAlphaPng)).toThrow(/transparent pixels/);
  expect(redrawCanvasPoint({
    canvasHeight: 720,
    canvasWidth: 1280,
    clientX: 491,
    clientY: 260,
    rect: { height: 360, left: 171, top: 80, width: 640 },
  })).toEqual({ x: 640, y: 360 });
  expect(redrawCanvasPoint({
    canvasHeight: 720,
    canvasWidth: 1280,
    clientX: 9999,
    clientY: -9999,
    rect: { height: 360, left: 171, top: 80, width: 640 },
  })).toEqual({ x: 1280, y: 0 });
  expect(persistedMediaReferences([{
    data: {
      imageToolMaskAssetId: "redraw-mask-asset",
      imageToolPreparedAssetId: "outpaint-input-asset",
      imageToolOperation: "redraw",
    },
    id: "redraw-placeholder",
    type: "image",
  }])).toEqual([
    { assetId: "redraw-mask-asset", kind: "image" },
    { assetId: "outpaint-input-asset", kind: "image" },
  ]);
});

test("Provider references and durable blobs remain separate replaceable stores", async () => {
  const blobStore = createMemoryMediaBlobStore();
  const leases = new Map<string, ProviderReferenceLease>();
  const acquisitions: AcquireProviderReferenceInput[] = [];
  const referenceStore: ProviderReferenceStore = {
    async acquire(input) {
      acquisitions.push(input);
      const lease: ProviderReferenceLease = {
        assetId: input.assetId,
        byteSize: 3,
        checksumSha256: "a".repeat(64),
        contentType: "image/png",
        kind: input.kind,
        leaseId: `lease-${input.assetId}`,
        locator: {
          expiresAt: "2026-08-22T00:05:00.000Z",
          transport: "signed-url",
          url: `https://provider.invalid/${input.assetId}`,
        },
        ownerId: input.ownerId,
      };
      leases.set(lease.leaseId, lease);
      return lease;
    },
    async release(lease) {
      leases.delete(lease.leaseId);
    },
  };

  const stored = await blobStore.put({
    bytes: Uint8Array.from([1, 2, 3]),
    contentType: "image/png",
    objectKey: "asset-1.png",
  });
  const lease = await referenceStore.acquire({
    assetId: "asset-1",
    kind: "image",
    maximumBytes: 20,
    ownerId: "owner-1",
    preferredTransports: ["signed-url"],
  });
  expect(stored.reference.backend).toBe("memory");
  expect(lease.locator.transport).toBe("signed-url");
  expect(leases.size).toBe(1);
  await referenceStore.release(lease);
  expect(leases.size).toBe(0);
  expect((await blobStore.read(stored.reference, { maximumBytes: 3 })).byteLength)
    .toBe(3);
  expect(await providerMediaUrlForOwner({
    assetId: "asset-1",
    kind: "image",
    ownerId: "owner-1",
  }, {
    rules: genericReferenceMediaRules,
    store: referenceStore,
  })).toBe("https://provider.invalid/asset-1");
  expect(acquisitions.at(-1)).toMatchObject({
    assetId: "asset-1",
    kind: "image",
    maximumBytes: 20 * 1024 * 1024,
    ownerId: "owner-1",
    preferredTransports: ["signed-url", "inline-data"],
  });
  expect(leases.size).toBe(0);

  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  expect(testRoot).toBeTruthy();
  const localRoot = join(String(testRoot), "m100-local-blobs");
  await rm(localRoot, { force: true, recursive: true });
  const localStore = createLocalMediaBlobStore(localRoot);
  const bytes = Uint8Array.from([9, 8, 7, 6]);
  const local = await localStore.put({
    bytes,
    contentType: "image/png",
    objectKey: "local.png",
  });
  expect(await localStore.head(local.reference)).toMatchObject({
    byteSize: 4,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "image/png",
  });
  expect(Array.from(await localStore.read(local.reference, { maximumBytes: 4 })))
    .toEqual([
    9,
    8,
    7,
    6,
  ]);
  await expect(localStore.signRead(local.reference, 60)).rejects.toMatchObject({
    code: "UNSUPPORTED_OPERATION",
  });
  await localStore.delete(local.reference);
  expect(await localStore.head(local.reference)).toBeUndefined();
  await rm(localRoot, { force: true, recursive: true });

  const ossBytes = new Map<string, Uint8Array>();
  const ossOperations: string[] = [];
  const ossDriver: AliyunMediaBlobDriver = {
    async deleteObject(reference) {
      ossOperations.push("delete");
      ossBytes.delete(reference.objectKey);
    },
    async headObject(reference) {
      ossOperations.push("head");
      const storedBytes = ossBytes.get(reference.objectKey);
      return storedBytes
        ? {
            byteSize: storedBytes.byteLength,
            checksumSha256: createHash("sha256").update(storedBytes).digest("hex"),
            contentType: "image/png",
          }
        : undefined;
    },
    async putObject(input) {
      ossOperations.push("put");
      if (!input.bytes) throw new Error("fake OSS expects bytes");
      ossBytes.set(input.objectKey, Uint8Array.from(input.bytes));
      return {
        byteSize: input.bytes.byteLength,
        checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
        contentType: input.contentType,
      };
    },
    async readObject(reference, input) {
      ossOperations.push("read");
      const storedBytes = ossBytes.get(reference.objectKey);
      if (!storedBytes || storedBytes.byteLength > input.maximumBytes) {
        throw new Error("fake OSS blob unavailable");
      }
      return Uint8Array.from(storedBytes);
    },
    async signRead(reference) {
      ossOperations.push("sign");
      return `https://oss.invalid/${reference.objectKey}`;
    },
  };
  const ossStore = createAliyunMediaBlobStore({
    driver: ossDriver,
    resolveProfile: async (reference) => reference.storageProfileId === "profile-1"
      ? {
          accessKeyId: "fake-access-key",
          accessKeySecret: "fake-access-secret",
          bucket: "fake-bucket",
          endpoint: "https://oss-cn-beijing.aliyuncs.com",
          region: "oss-cn-beijing",
        }
      : undefined,
  });
  const oss = await ossStore.put({
    bytes,
    contentType: "image/png",
    objectKey: "objects/2026/08/image/fake.png",
    storageProfileId: "profile-1",
  });
  expect(await ossStore.head(oss.reference)).toMatchObject({ byteSize: 4 });
  expect((await ossStore.read(oss.reference, { maximumBytes: 4 })).byteLength)
    .toBe(4);
  expect((await ossStore.signRead(oss.reference, 60)).url).toBe(
    "https://oss.invalid/objects/2026/08/image/fake.png",
  );
  await ossStore.delete(oss.reference);
  expect(ossOperations).toEqual(["put", "head", "read", "sign", "delete"]);

  const publicationEvents: string[] = [];
  const publicationStore = createMediaPublicationService({
    ...mediaPublicationService,
    async compensate() {
      publicationEvents.push("compensate");
      return true;
    },
    finalize() {
      publicationEvents.push("finalize");
    },
    async recoverUploads() {
      publicationEvents.push("recover");
      return [{ action: "failed", assetId: "asset-1" }];
    },
  });
  const fakeReservation = {
    attemptId: "attempt-1",
    finalStorageName: "asset-1.png",
    id: "asset-1",
    kind: "image" as const,
    objectKey: "asset-1.png",
    ownerId: "owner-1",
    stagingName: ".publication-attempt-1.generating",
    storageBackend: "local" as const,
    storageProfileId: null,
  };
  publicationStore.finalize(fakeReservation);
  expect(await publicationStore.compensate(fakeReservation)).toBe(true);
  expect(await publicationStore.recoverUploads()).toEqual([
    { action: "failed", assetId: "asset-1" },
  ]);
  expect(publicationEvents).toEqual(["finalize", "compensate", "recover"]);
  await verifyMediaEditSourceContracts();
});

test("Generation HTTP transport is isolated from the application runtime", async () => {
  const [runtimeSource, adapterSource] = await Promise.all([
    readFile(join(process.cwd(), "server/generationTasks.ts"), "utf8"),
    readFile(join(process.cwd(), "server/generationTasksApi.ts"), "utf8"),
  ]);
  expect(runtimeSource).not.toContain('from "node:http"');
  expect(runtimeSource).not.toContain('from "./httpRequest"');
  expect(runtimeSource).not.toContain("requestIdentity(");
  expect(runtimeSource).not.toContain("readJsonBody<");
  expect(adapterSource).toContain('from "node:http"');
  expect(adapterSource).toContain('from "./httpRequest"');
  expect(adapterSource).toContain(
    'import { generationTaskApplication } from "./generationTasks"',
  );
});

test("composition root wires public module APIs and delegates readiness SQL", async () => {
  expect(Object.isFrozen(applicationComposition)).toBe(true);
  expect(Object.isFrozen(applicationComposition.auth)).toBe(true);
  expect(Object.isFrozen(applicationComposition.canvas)).toBe(true);
  expect(Object.isFrozen(applicationComposition.generation)).toBe(true);
  expect(Object.isFrozen(applicationComposition.imageTools)).toBe(true);
  expect(Object.isFrozen(applicationComposition.media)).toBe(true);
  expect(Object.isFrozen(applicationComposition.provider)).toBe(true);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE generation_tasks (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL
      )
    `);
    expect(
      applicationComposition.generation.readinessQuery
        .hasCommittedActiveTasks(database),
    ).toBe(false);
    database.prepare(`
      INSERT INTO generation_tasks (id, state) VALUES (?, ?)
    `).run("composition-ready", "success");
    expect(
      applicationComposition.generation.readinessQuery
        .hasCommittedActiveTasks(database),
    ).toBe(false);
    database.prepare(`
      INSERT INTO generation_tasks (id, state) VALUES (?, ?)
    `).run("composition-active", "recovering");
    expect(
      applicationComposition.generation.readinessQuery
        .hasCommittedActiveTasks(database),
    ).toBe(true);
  } finally {
    database.close();
  }

  const [compositionSource, viteSource] = await Promise.all([
    readFile(join(process.cwd(), "server/applicationComposition.ts"), "utf8"),
    readFile(join(process.cwd(), "vite.config.ts"), "utf8"),
  ]);
  expect(compositionSource).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|generation_tasks/);
  expect(compositionSource).not.toMatch(
    /canvasPersistence|generationTasks|generationSafety|providerProfiles/,
  );
  expect(compositionSource.match(/from "\.\/[^\"]+(?:Application|Runtime)Api"/g))
    .toHaveLength(8);
  expect(viteSource).not.toMatch(
    /server\/(?:canvasPersistence|generationAttemptQueries|generationSafety|generationTasks|providerProfiles)/,
  );
  expect(viteSource).not.toContain("FROM generation_tasks");
});

test("node registries align by vocabulary while remaining independently replaceable", async () => {
  expect(canvasNodeRegistry.kinds()).toEqual([...canvasNodeKinds]);
  expect(generationCapabilityRegistry.kinds()).toEqual([
    ...generationCapabilityKinds,
  ]);
  expect(persistedNodeSchemaRegistry.kinds()).toEqual([...persistedNodeKinds]);
  expect(templateNodeKinds.every((kind) => persistedNodeSchemaRegistry.has(kind)))
    .toBe(true);
  expect(generationCapabilityKinds.every((kind) => canvasNodeRegistry.get(kind)))
    .toBe(true);
  expect(generationCapabilityKinds.every((kind) => persistedNodeSchemaRegistry.has(kind)))
    .toBe(true);
  expect(templateNodeKinds).not.toContain("probe");

  const canvasOnly = new CanvasNodeRegistry<string>()
    .register("test-canvas", canvasNodeRegistry.get("probe")!);
  expect(canvasOnly.kinds()).toEqual(["test-canvas"]);
  expect(generationCapabilityRegistry.has("test-canvas")).toBe(false);
  expect(persistedNodeSchemaRegistry.has("test-canvas")).toBe(false);

  const generationOnly = new GenerationCapabilityRegistry<string>()
    .register({ kind: "test-generation" });
  expect(generationOnly.get("test-generation")).toEqual({
    kind: "test-generation",
  });
  expect(canvasNodeRegistry.get("test-generation")).toBeUndefined();
  expect(persistedNodeSchemaRegistry.has("test-generation")).toBe(false);

  const persistedOnly = new PersistedNodeSchemaRegistry<string>()
    .register({
      kind: "test-persisted",
      validate: (node) => node.data === "accepted",
    });
  expect(persistedOnly.accepts({
    data: "accepted",
    id: "test-node",
    type: "test-persisted",
  })).toBe(true);
  expect(persistedOnly.accepts({
    data: "rejected",
    id: "test-node",
    type: "test-persisted",
  })).toBe(false);
  expect(canvasNodeRegistry.get("test-persisted")).toBeUndefined();
  expect(generationCapabilityRegistry.has("test-persisted")).toBe(false);

  const [canvasSource, generationSource, persistedSource] = await Promise.all([
    readFile(join(process.cwd(), "client/src/canvas/canvasNodeRegistry.ts"), "utf8"),
    readFile(join(process.cwd(), "server/generationCapabilityRegistry.ts"), "utf8"),
    readFile(join(process.cwd(), "types/persistedNodeSchemaRegistry.ts"), "utf8"),
  ]);
  expect(canvasSource).toContain("NodeTypes");
  expect(generationSource).not.toMatch(/React|renderer|template/i);
  expect(persistedSource).not.toMatch(/React|renderer|Provider|executor/i);
});

function execution(target: ProviderProfile): MediaGenerationExecution {
  return {
    absoluteDeadline: "2026-08-22T01:00:00.000Z",
    attempt: 1,
    beforeProviderRequest: () => undefined,
    fetcher: async () => {
      throw new Error("P2 fake Provider must not use network");
    },
    profile: target,
  };
}

const mediaRequest: MediaGenerationRequest = {
  inputs: [],
  kind: "image",
  model: "p2-image",
  parameters: {},
  prompt: "P2 fake image",
};

test("media Provider port supports a synchronous fake without task identity loss", async () => {
  const target = profile({ driver: "openrouter", id: "p2-sync" });
  const provider: MediaGenerationProvider = {
    id: "p2-sync-provider",
    registrations: [{ driver: "openrouter", kind: "image", protocol: "gpt-image" }],
    async cancel(providerTaskId) {
      return { providerTaskId, state: "unsupported" };
    },
    async inspect(providerTaskId) {
      return { providerTaskId, state: "succeeded", rawResult: { url: "fixture" } };
    },
    normalize() {
      return { outputs: [{ kind: "image", transientUrl: "https://result.invalid/image" }] };
    },
    async recover() {
      return { state: "not-found" };
    },
    async submit() {
      return { providerTaskMayStillRun: false, rawResult: { url: "fixture" }, state: "completed" };
    },
  };
  const resolved = new MediaGenerationProviderRegistry([provider]).resolve(
    target,
    "gpt-image",
    "image",
  );
  const submitted = await resolved.submit(mediaRequest, execution(target));
  expect(submitted).toMatchObject({ providerTaskMayStillRun: false, state: "completed" });
  expect(resolved.normalize("fixture").outputs).toHaveLength(1);
});

test("media Provider port supports async inspect/recover/cancel with one providerTaskId", async () => {
  const target = profile({ driver: "multi-protocol-relay", id: "p2-async" });
  let submits = 0;
  const provider: MediaGenerationProvider = {
    id: "p2-async-provider",
    registrations: [{
      driver: "multi-protocol-relay",
      kind: "image",
      protocol: "media-generate",
    }],
    async cancel(providerTaskId) {
      return { providerTaskId, state: "cancelled" };
    },
    async inspect(providerTaskId) {
      return { progress: 50, providerTaskId, state: "running" };
    },
    normalize(rawResult) {
      return { outputs: [{ kind: "image", transientUrl: String(rawResult) }] };
    },
    async recover() {
      return { providerTaskId: "provider-task-1", state: "matched" };
    },
    async submit(_request, providerExecution) {
      submits += 1;
      expect(providerExecution.attempt).toBe(1);
      expect(providerExecution.absoluteDeadline).toBe("2026-08-22T01:00:00.000Z");
      return {
        providerTaskId: "provider-task-1",
        providerTaskMayStillRun: true,
        state: "accepted",
      };
    },
  };
  const resolved = new MediaGenerationProviderRegistry([provider]).resolve(
    target,
    "media-generate",
    "image",
  );
  const submitted = await resolved.submit(mediaRequest, execution(target));
  expect(submitted).toMatchObject({ providerTaskId: "provider-task-1", state: "accepted" });
  expect(await resolved.inspect("provider-task-1", execution(target))).toMatchObject({
    progress: 50,
    providerTaskId: "provider-task-1",
    state: "running",
  });
  expect(await resolved.recover(mediaRequest, execution(target))).toEqual({
    providerTaskId: "provider-task-1",
    state: "matched",
  });
  expect(await resolved.cancel("provider-task-1", execution(target))).toEqual({
    providerTaskId: "provider-task-1",
    state: "cancelled",
  });
  expect(submits).toBe(1);
  expect(mediaProviderRegistry.resolve(
    profile({ driver: "multi-protocol-relay", id: "relay" }),
    "media-generate",
    "image",
  ).id).toBe("multi-protocol-relay-media");
  expect(mediaProviderRegistry.resolve(
    profile({ driver: "volcengine-ark", id: "ark" }),
    "native",
    "video",
  ).id).toBe("volcengine-ark-video");
  expect(mediaProviderRegistry.resolve(
    profile({ driver: "mureka", id: "mureka" }),
    "native",
    "audio",
  ).id).toBe("mureka-audio");
});

test("Generation query port is read-only and replaceable", () => {
  const tasks: GenerationTaskQueryEvidence[] = [{
    attempt: 2,
    canvasId: "canvas-1",
    id: "task-1",
    kind: "video",
    nodeId: "node-1",
    ownerId: "owner-1",
    providerTaskId: "provider-task-1",
    state: "recovering",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }];
  const query: GenerationQueryPort = {
    get: (taskId) => tasks.find((task) => task.id === taskId),
    list: (input) => tasks.filter((task) =>
      (!input.canvasId || task.canvasId === input.canvasId) &&
      (!input.ownerId || task.ownerId === input.ownerId) &&
      (!input.kinds || input.kinds.includes(task.kind)) &&
      (!input.states || input.states.includes(task.state))
    ),
  };
  expect(query.get("task-1")).toMatchObject({
    attempt: 2,
    providerTaskId: "provider-task-1",
    state: "recovering",
  });
  expect(query.list({ canvasId: "canvas-1", states: ["recovering"] })).toHaveLength(1);
});

test("transaction-scoped commands join caller rollback and reject async work", async () => {
  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  expect(testRoot).toBeTruthy();
  const directory = join(String(testRoot), "m100-transaction");
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "ports.sqlite"));
  try {
    database.exec("CREATE TABLE evidence (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const insert: TransactionScopedCommand<Readonly<{ id: string; value: string }>, number> = {
      execute(scope, input) {
        return Number(scope.prepare(
          "INSERT INTO evidence (id, value) VALUES (?, ?)",
        ).run(input.id, input.value).changes);
      },
    };
    expect(() => executeTransactionScopedCommand(
      database,
      insert,
      { id: "outside", value: "rejected" },
    )).toThrow(/active transaction/);

    database.exec("BEGIN IMMEDIATE");
    expect(executeTransactionScopedCommand(
      database,
      insert,
      { id: "inside", value: "rolled-back" },
    )).toBe(1);
    database.exec("ROLLBACK");
    expect((database.prepare("SELECT COUNT(*) AS count FROM evidence").get() as {
      count: number;
    }).count).toBe(0);

    database.exec("BEGIN IMMEDIATE");
    expect(() => executeTransactionScopedCommand(
      database,
      { execute: () => Promise.resolve("unsafe") },
      undefined,
    )).toThrow(/must be synchronous/);
    database.exec("ROLLBACK");

    database.exec("BEGIN IMMEDIATE");
    expect(() => executeTransactionScopedCommand(
      database,
      { execute: (scope) => scope.prepare("COMMIT").run() },
      undefined,
    )).toThrow(/cannot control transactions/);
    expect(database.isTransaction).toBe(true);
    database.exec("ROLLBACK");
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("account deletion owner commands share one rollback boundary", async () => {
  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  expect(testRoot).toBeTruthy();
  const directory = join(String(testRoot), "m100-account-command-rollback");
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "account.sqlite"));
  try {
    database.exec(`
      CREATE TABLE generation_tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
      CREATE TABLE generation_provider_attempts (task_id TEXT NOT NULL);
      CREATE TABLE generation_task_events (task_id TEXT NOT NULL);
      CREATE TABLE generation_admission_events (task_id TEXT NOT NULL);
      CREATE TABLE canvas_documents (owner_id TEXT NOT NULL);
      CREATE TABLE asset_history (owner_id TEXT, account_id TEXT);
      CREATE TABLE project_metadata (owner_id TEXT NOT NULL);
      CREATE TABLE public_templates (created_by TEXT, updated_by TEXT);
      CREATE TABLE user_templates (owner_id TEXT NOT NULL);
      CREATE TABLE media_assets (
        owner_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
        storage_status TEXT NOT NULL
      );
      INSERT INTO generation_tasks VALUES ('task-1', 'owner-1');
      INSERT INTO generation_provider_attempts VALUES ('task-1');
      INSERT INTO generation_task_events VALUES ('task-1');
      INSERT INTO generation_admission_events VALUES ('task-1');
      INSERT INTO canvas_documents VALUES ('owner-1');
      INSERT INTO asset_history VALUES ('owner-1', 'owner-1');
      INSERT INTO project_metadata VALUES ('owner-1');
      INSERT INTO public_templates VALUES ('owner-1', 'owner-1');
      INSERT INTO user_templates VALUES ('owner-1');
      INSERT INTO media_assets VALUES ('owner-1', 'image', 'asset-1', 'ready');
    `);
    database.exec("BEGIN IMMEDIATE");
    expect(executeTransactionScopedCommand(database, transferAccountMediaCommand, {
      assetId: "asset-1",
      kind: "image",
      ownerId: "owner-1",
      rootOwnerId: "root-1",
    })).toBe(1);
    expect(executeTransactionScopedCommand(
      database,
      transferAndDeleteAccountTemplatesCommand,
      { ownerId: "owner-1", rootOwnerId: "root-1" },
    )).toBe(1);
    executeTransactionScopedCommand(
      database,
      deleteAccountGenerationDataCommand,
      "owner-1",
    );
    executeTransactionScopedCommand(database, deleteAccountCanvasDataCommand, "owner-1");
    executeTransactionScopedCommand(database, deleteAccountProjectDataCommand, "owner-1");
    expect(() => {
      throw new Error("injected before final account audit");
    }).toThrow(/injected/);
    database.exec("ROLLBACK");

    expect(database.prepare("SELECT owner_id FROM media_assets").get()).toEqual({
      owner_id: "owner-1",
    });
    expect(database.prepare("SELECT created_by, updated_by FROM public_templates").get())
      .toEqual({ created_by: "owner-1", updated_by: "owner-1" });
    for (const table of [
      "generation_tasks",
      "generation_provider_attempts",
      "generation_task_events",
      "generation_admission_events",
      "canvas_documents",
      "asset_history",
      "project_metadata",
      "user_templates",
    ]) {
      expect((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }).count).toBe(1);
    }
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("single-node lifecycle replaces React with fenced graph save and task ports", async () => {
  let revision = 0;
  let flushes = 0;
  let revisionWaits = 0;
  let snapshot: CanvasGraphSnapshot = {
    edges: [],
    nodes: [{
      data: { label: "P5 text node", textPrompt: "draw a moon" },
      id: "text-1",
      position: { x: 0, y: 0 },
      type: "text",
    }],
    revision,
  };
  const graph = createCanvasGraphCommandPort({
    commit(next) {
      snapshot = { ...next, revision: undefined };
    },
    persistenceReady: () => true,
    snapshot: () => snapshot,
  });
  const save: CanvasSavePort = {
    async flush() {
      flushes += 1;
    },
    async waitForRevision() {
      revisionWaits += 1;
      revision += 1;
      snapshot = { ...snapshot, revision };
      return { revision };
    },
  };
  const task = (state: GenerationTaskSummary["state"]): GenerationTaskSummary => ({
    attempt: 1,
    canvasId: "canvas-1",
    costCurrency: "CNY",
    createdAt: "2026-08-22T00:00:00.000Z",
    generationInputKey: "input-1",
    generationOwnershipKey: "owner-1",
    id: "task-1",
    kind: "text",
    nodeId: "text-1",
    prompt: "draw a moon",
    ...(state === "success" ? { resultText: "moon result" } : {}),
    state,
    updatedAt: "2026-08-22T00:00:01.000Z",
  });
  let ensureCalls = 0;
  let preparedCalls = 0;
  let preparedBeforeEnsure = false;
  let retryCalls = 0;
  let retryRevisionWaits = 0;
  let reconcileOutcome: "ambiguous" | "missing" | "recovered" = "recovered";
  let watchCalls = 0;
  const tasks: SingleNodeGenerationTaskPort = {
    async cancel() {
      return task("cancelled");
    },
    async ensure(_plan, context) {
      ensureCalls += 1;
      context.assertCurrent();
      preparedBeforeEnsure = context.canvasRevision === 1 &&
        snapshot.nodes[0]?.data.textModelId === "text-model-1";
      return {
        generationOwnershipKey: "owner-1",
        idempotencyKey: "idem-1",
        recovered: true,
        task: task("running"),
      };
    },
    async reconcile(_task, _plan, context) {
      await context.waitForRevision();
      const reconciledTask = task(
        reconcileOutcome === "recovered" ? "success" : "failed",
      );
      return {
        outcome: reconcileOutcome,
        task: reconcileOutcome === "missing"
          ? {
              ...reconciledTask,
              errorCode: "PROVIDER_RESULT_MISSING",
              errorMessage: "平台没有成片，可以重试",
              retryAllowed: true,
            }
          : reconciledTask,
      };
    },
    async recover() {
      return task("running");
    },
    async retry(_task, _plan, context) {
      retryCalls += 1;
      await context.waitForRevision();
      retryRevisionWaits += 1;
      return task("running");
    },
    async watch() {
      watchCalls += 1;
      return task("success");
    },
  };
  const lifecycle = createSingleNodeGenerationLifecycle({
    adapter: {
      applyPrepared(node) {
        preparedCalls += 1;
        return {
          ...node,
          data: { ...node.data, textModelId: "text-model-1" },
        };
      },
      applyBinding(node, boundTask, plan) {
        return {
          ...node,
          data: {
            ...node.data,
            textGenerating: true,
            textGenerationInputKey: plan.inputKey,
            textGenerationOwnershipKey: plan.ownershipKey,
            textGenerationTaskId: boundTask.id,
          },
        };
      },
      applyTerminal(node, finalTask) {
        return {
          ...node,
          data: {
            ...node.data,
            textGenerating: false,
            content: finalTask.state === "success"
              ? finalTask.resultText
              : node.data.content,
            textGenerationErrorCode: finalTask.errorCode,
          },
        };
      },
      kind: "text",
      readPlan() {
        return {
          inputKey: "input-1",
          kind: "text",
          nodeId: "text-1",
          ownershipKey: "owner-1",
          payload: { prompt: "draw a moon" },
        };
      },
    },
    graph,
    nodeId: "text-1",
    randomUUID: () => "single-run-1",
    save,
    tasks,
  });
  await expect(lifecycle.generate()).resolves.toMatchObject({
    status: "success",
    task: { id: "task-1", resultText: "moon result" },
  });
  expect({ ensureCalls, flushes, preparedBeforeEnsure, preparedCalls, revisionWaits, watchCalls }).toEqual({
    ensureCalls: 1,
    flushes: 3,
    preparedBeforeEnsure: true,
    preparedCalls: 1,
    revisionWaits: 3,
    watchCalls: 1,
  });
  expect(snapshot.nodes[0]?.data).toMatchObject({
    textGenerating: false,
    textGenerationInputKey: "input-1",
    textGenerationOwnershipKey: "owner-1",
    content: "moon result",
    textGenerationTaskId: "task-1",
  });

  tasks.watch = async () => {
    watchCalls += 1;
    snapshot = {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => node.id === "text-1"
        ? {
            ...node,
            data: { ...node.data, textGenerationOwnershipKey: "owner-2" },
          }
        : node),
    };
    return { ...task("success"), resultText: "stale result" };
  };
  await expect(lifecycle.retry(task("failed"))).resolves.toEqual({
    reason: "stale",
    status: "stale",
  });
  expect(snapshot.nodes[0]?.data.content).toBe("moon result");
  expect({ flushes, preparedCalls, retryCalls, retryRevisionWaits, revisionWaits, watchCalls }).toEqual({
    flushes: 3,
    preparedCalls: 1,
    retryCalls: 1,
    retryRevisionWaits: 1,
    revisionWaits: 4,
    watchCalls: 2,
  });

  snapshot = {
    ...snapshot,
    revision: undefined,
    nodes: snapshot.nodes.map((node) => node.id === "text-1"
      ? {
          ...node,
          data: { ...node.data, textGenerationOwnershipKey: "owner-1" },
        }
      : node),
  };
  tasks.watch = async () => {
    watchCalls += 1;
    return task("success");
  };
  await expect(lifecycle.retry(task("failed"))).resolves.toMatchObject({
    status: "success",
    task: { id: "task-1", resultText: "moon result" },
  });
  expect({ flushes, preparedCalls, retryCalls, retryRevisionWaits, revisionWaits, watchCalls }).toEqual({
    flushes: 4,
    preparedCalls: 1,
    retryCalls: 2,
    retryRevisionWaits: 2,
    revisionWaits: 7,
    watchCalls: 3,
  });

  reconcileOutcome = "ambiguous";
  await expect(lifecycle.reconcile({ id: "task-1" })).resolves.toMatchObject({
    reconcileOutcome: "ambiguous",
    status: "failed",
    task: { id: "task-1" },
  });
  expect(snapshot.nodes[0]?.data.content).toBe("moon result");
  expect({ flushes, revisionWaits }).toEqual({ flushes: 4, revisionWaits: 8 });

  reconcileOutcome = "missing";
  await expect(lifecycle.reconcile({ id: "task-1" })).resolves.toMatchObject({
    reconcileOutcome: "missing",
    status: "failed",
    task: {
      errorCode: "PROVIDER_RESULT_MISSING",
      id: "task-1",
      retryAllowed: true,
    },
  });
  expect(snapshot.nodes[0]?.data).toMatchObject({
    content: "moon result",
    textGenerating: false,
    textGenerationErrorCode: "PROVIDER_RESULT_MISSING",
  });
  expect({ flushes, revisionWaits }).toEqual({ flushes: 5, revisionWaits: 10 });

  const imageToolGeneration = createGenerationImageToolUseCase({
    lifecycle: {
      abort() {},
      async cancel() { return { status: "cancelled", task: task("cancelled") }; },
      async generate() { return { status: "success", task: task("success") }; },
      async reconcile() { return { status: "success", task: task("success") }; },
      async recover() { return { status: "success", task: task("success") }; },
      async retry() { return { status: "success", task: task("success") }; },
      async submit() { return { status: "submitted", task: task("running") }; },
    },
    operation: "multi-angle",
  });
  await expect(imageToolGeneration.execute({ action: "generate" })).resolves
    .toMatchObject({
      kind: "generation-task",
      operation: "multi-angle",
      taskId: "task-1",
    });
  await expect(imageToolGeneration.execute({ action: "submit" })).resolves
    .toMatchObject({
      kind: "generation-task",
      operation: "multi-angle",
      taskId: "task-1",
    });
});
