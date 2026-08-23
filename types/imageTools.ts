export const imageToolOperations = [
  "crop",
  "color-mark",
  "resize-pixels",
  "quick-split",
  "annotate",
  "save-to-library",
  "multi-angle",
  "redraw",
  "outpaint",
  "erase",
  "enhance-conservative",
  "enhance-creative",
  "remove-background",
  "seedance-validate",
  "download",
  "fullscreen",
  "lighting",
] as const;

export type ImageToolOperation = typeof imageToolOperations[number];

export type ImageMultiAngleParameters = Readonly<{
  distance: number;
  horizontalDegrees: number;
  verticalDegrees: number;
  wideAngle: boolean;
}>;

export const imageToolOperationStatuses = [
  "available",
  "unavailable",
  "paused",
  "disabled_by_operator",
  "stale",
] as const;

export type ImageToolOperationStatus =
  typeof imageToolOperationStatuses[number];

export const imageToolExecutionStates = [
  "unavailable",
  "ready",
  "preparing",
  "submitting",
  "processing",
  "success",
  "failed",
  "cancelled",
  "stale",
] as const;

export type ImageToolExecutionState = typeof imageToolExecutionStates[number];

export type ImageToolCapabilityReasonCode =
  | "AVAILABLE"
  | "CAPABILITY_STALE"
  | "LOCAL_RUNTIME_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "OPERATOR_DISABLED"
  | "PAUSED_BY_SCOPE"
  | "PROVIDER_UNAVAILABLE"
  | "REMOTE_VALIDATION_UNAVAILABLE"
  | "UNSUPPORTED";

export type ImageToolCapability = Readonly<{
  estimatedCost?: Readonly<{
    amount: number;
    currency: "CNY" | "USD" | "credits";
    source: "operator" | "provider";
  }>;
  expiresAt: string;
  maximumInputBytes: number;
  maximumInputPixels: number;
  modelId?: string;
  operation: ImageToolOperation;
  outputContentTypes: readonly ("image/jpeg" | "image/png")[];
  reason: string;
  reasonCode: ImageToolCapabilityReasonCode;
  status: ImageToolOperationStatus;
  supportsAlpha: boolean;
  supportsMask: boolean;
  supportsReferenceImage: boolean;
}>;

export type ImageToolCapabilitySnapshot = Readonly<{
  generatedAt: string;
  operations: readonly ImageToolCapability[];
  revision: string;
}>;

export type ImageToolSource = Readonly<{
  assetId: string;
  checksumSha256: string;
  contentType: "image/jpeg" | "image/png";
  height: number;
  nodeId: string;
  ownerId: string;
  width: number;
}>;

export type ImageToolExecutionIdentity = Readonly<{
  expectedRevision: number;
  operationId: string;
  ownershipKey: string;
  runId: string;
  taskId?: string;
}>;

export type ImageAnnotationPoint = Readonly<{ x: number; y: number }>;

export type ImageAnnotationElement =
  | Readonly<{
      color: string;
      id: string;
      kind: "stroke";
      points: readonly ImageAnnotationPoint[];
      strokeWidth: number;
    }>
  | Readonly<{
      color: string;
      height: number;
      id: string;
      kind: "rectangle";
      strokeWidth: number;
      width: number;
      x: number;
      y: number;
    }>
  | Readonly<{
      color: string;
      id: string;
      kind: "arrow";
      strokeWidth: number;
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    }>
  | Readonly<{
      color: string;
      id: string;
      kind: "number";
      value: number;
      x: number;
      y: number;
    }>
  | Readonly<{
      color: string;
      fontSize: number;
      id: string;
      kind: "text";
      text: string;
      x: number;
      y: number;
    }>;

export type ImageAnnotationDocument = Readonly<{
  elements: readonly ImageAnnotationElement[];
  height: number;
  version: 1;
  width: number;
}>;

export type ImageToolResult =
  | Readonly<{
      assetIds: readonly string[];
      kind: "derived-assets";
      operation: "crop" | "resize-pixels" | "quick-split" | "annotate";
      sourceAssetId: string;
    }>
  | Readonly<{
      kind: "generation-task";
      operation:
        | "enhance-creative"
        | "enhance-conservative"
        | "erase"
        | "multi-angle"
        | "outpaint"
        | "redraw"
        | "remove-background";
      resultAssetId?: string;
      taskId: string;
    }>
  | Readonly<{
      kind: "metadata";
      operation: "color-mark" | "save-to-library";
      revision: number;
    }>
  | Readonly<{
      checkedAt: string;
      expiresAt: string;
      kind: "validation";
      operation: "seedance-validate";
      status: "eligible" | "ineligible" | "stale";
    }>
  | Readonly<{
      kind: "viewer";
      operation: "download" | "fullscreen";
      status: "downloaded" | "opened";
    }>;

export type ImageToolFailureCode =
  | "CAPABILITY_DISABLED"
  | "CAPABILITY_STALE"
  | "CONFLICT"
  | "INPUT_INVALID"
  | "MEDIA_COMMIT_FAILED"
  | "NOT_FOUND"
  | "OWNERSHIP_REJECTED"
  | "PROVIDER_FAILED"
  | "TASK_REQUIRES_REATTACH"
  | "UNAUTHORIZED";

export type ImageToolFailure = Readonly<{
  code: ImageToolFailureCode;
  message: string;
  operation: ImageToolOperation;
  retryable: boolean;
  taskId?: string;
}>;

export const imageToolMaximums = Object.freeze({
  annotationDocumentBytes: 512 * 1024,
  inputBytes: 20 * 1024 * 1024,
  inputPixels: 40_000_000,
  maskBytes: 4 * 1024 * 1024,
  snapshotOperations: imageToolOperations.length,
});

const operationSet = new Set<string>(imageToolOperations);
const statusSet = new Set<string>(imageToolOperationStatuses);
const reasonCodeSet = new Set<ImageToolCapabilityReasonCode>([
  "AVAILABLE",
  "CAPABILITY_STALE",
  "LOCAL_RUNTIME_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "OPERATOR_DISABLED",
  "PAUSED_BY_SCOPE",
  "PROVIDER_UNAVAILABLE",
  "REMOTE_VALIDATION_UNAVAILABLE",
  "UNSUPPORTED",
]);
const outputContentTypeSet = new Set(["image/jpeg", "image/png"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string, maximum = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${label} must be a bounded positive integer`);
  }
  return Number(value);
}

function isoDate(value: unknown, label: string) {
  const text = nonEmptyString(value, label, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be ISO-8601`);
  return text;
}

export function parseImageToolCapabilitySnapshot(
  value: unknown,
): ImageToolCapabilitySnapshot {
  const source = record(value, "image tool capability snapshot");
  if (!Array.isArray(source.operations) ||
      source.operations.length !== imageToolOperations.length) {
    throw new Error("image tool capability snapshot must contain every operation once");
  }
  const seen = new Set<string>();
  const operations = source.operations.map((candidate, index) => {
    const item = record(candidate, `operations[${index}]`);
    if (typeof item.operation !== "string" || !operationSet.has(item.operation)) {
      throw new Error(`operations[${index}].operation is invalid`);
    }
    if (seen.has(item.operation)) throw new Error("image tool operation is duplicated");
    seen.add(item.operation);
    if (typeof item.status !== "string" || !statusSet.has(item.status)) {
      throw new Error(`operations[${index}].status is invalid`);
    }
    if (typeof item.reasonCode !== "string" ||
        !reasonCodeSet.has(item.reasonCode as ImageToolCapabilityReasonCode)) {
      throw new Error(`operations[${index}].reasonCode is invalid`);
    }
    if (item.status === "available" && item.reasonCode !== "AVAILABLE") {
      throw new Error("available image tool capability must use AVAILABLE reasonCode");
    }
    if (item.status !== "available" && item.reasonCode === "AVAILABLE") {
      throw new Error("unavailable image tool capability cannot use AVAILABLE reasonCode");
    }
    if (!Array.isArray(item.outputContentTypes) ||
        item.outputContentTypes.some((entry) =>
          typeof entry !== "string" || !outputContentTypeSet.has(entry))) {
      throw new Error(`operations[${index}].outputContentTypes is invalid`);
    }
    for (const key of ["supportsAlpha", "supportsMask", "supportsReferenceImage"] as const) {
      if (typeof item[key] !== "boolean") {
        throw new Error(`operations[${index}].${key} must be boolean`);
      }
    }
    const estimatedCost = item.estimatedCost === undefined
      ? undefined
      : (() => {
          const cost = record(item.estimatedCost, `operations[${index}].estimatedCost`);
          if (typeof cost.amount !== "number" || !Number.isFinite(cost.amount) ||
              cost.amount < 0 || cost.amount > 1_000_000) {
            throw new Error(`operations[${index}].estimatedCost.amount is invalid`);
          }
          if (cost.currency !== "CNY" && cost.currency !== "USD" &&
              cost.currency !== "credits") {
            throw new Error(`operations[${index}].estimatedCost.currency is invalid`);
          }
          if (cost.source !== "operator" && cost.source !== "provider") {
            throw new Error(`operations[${index}].estimatedCost.source is invalid`);
          }
          return {
            amount: cost.amount,
            currency: cost.currency as "CNY" | "USD" | "credits",
            source: cost.source as "operator" | "provider",
          };
        })();
    return {
      ...(estimatedCost ? { estimatedCost } : {}),
      expiresAt: isoDate(item.expiresAt, `operations[${index}].expiresAt`),
      maximumInputBytes: positiveInteger(
        item.maximumInputBytes,
        `operations[${index}].maximumInputBytes`,
        imageToolMaximums.inputBytes,
      ),
      maximumInputPixels: positiveInteger(
        item.maximumInputPixels,
        `operations[${index}].maximumInputPixels`,
        imageToolMaximums.inputPixels,
      ),
      ...(item.modelId === undefined
        ? {}
        : { modelId: nonEmptyString(item.modelId, `operations[${index}].modelId`) }),
      operation: item.operation as ImageToolOperation,
      outputContentTypes: [...item.outputContentTypes] as Array<"image/jpeg" | "image/png">,
      reason: nonEmptyString(item.reason, `operations[${index}].reason`, 1_024),
      reasonCode: item.reasonCode as ImageToolCapabilityReasonCode,
      status: item.status as ImageToolOperationStatus,
      supportsAlpha: item.supportsAlpha as boolean,
      supportsMask: item.supportsMask as boolean,
      supportsReferenceImage: item.supportsReferenceImage as boolean,
    } satisfies ImageToolCapability;
  });
  return {
    generatedAt: isoDate(source.generatedAt, "generatedAt"),
    operations,
    revision: nonEmptyString(source.revision, "revision", 128),
  };
}

export function imageToolCapability(
  snapshot: ImageToolCapabilitySnapshot,
  operation: ImageToolOperation,
) {
  const capability = snapshot.operations.find((item) => item.operation === operation);
  if (!capability) throw new Error(`Missing image tool capability: ${operation}`);
  return capability;
}
