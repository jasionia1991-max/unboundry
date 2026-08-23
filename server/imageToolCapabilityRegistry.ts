import { createHash } from "node:crypto";
import {
  imageToolMaximums,
  imageToolOperations,
  type ImageToolCapability,
  type ImageToolCapabilityReasonCode,
  type ImageToolCapabilitySnapshot,
  type ImageToolOperation,
} from "../types/imageTools";

export type ImageToolGenerationCapability = Readonly<{
  configured: boolean;
  emergencyStop: boolean;
  globalEnabled: boolean;
  maxCostMicrounits?: number;
  modelId?: string;
  providerDriver?: string;
  providerProtocol?: string;
}>;

export type ImageToolCapabilityAdapter = Readonly<{
  id: string;
  operations: readonly ImageToolOperation[];
  supportsAlpha: boolean;
  supportsMask: boolean;
  supportsReferenceImage: boolean;
}>;

export class ImageToolCapabilityAdapterRegistry {
  readonly #adapters = new Map<ImageToolOperation, ImageToolCapabilityAdapter>();

  register(adapter: ImageToolCapabilityAdapter) {
    if (!adapter.id.trim() || adapter.operations.length < 1) {
      throw new Error("Image tool capability adapter is invalid");
    }
    for (const operation of adapter.operations) {
      if (this.#adapters.has(operation)) {
        throw new Error(`Image tool capability adapter already owns ${operation}`);
      }
      this.#adapters.set(operation, adapter);
    }
    return this;
  }

  get(operation: ImageToolOperation) {
    return this.#adapters.get(operation);
  }
}

export function createFakeImageToolCapabilityAdapter(
  input: Omit<ImageToolCapabilityAdapter, "id"> & { id?: string },
): ImageToolCapabilityAdapter {
  return Object.freeze({
    id: input.id ?? "fake-image-tool-adapter",
    operations: Object.freeze([...input.operations]),
    supportsAlpha: input.supportsAlpha,
    supportsMask: input.supportsMask,
    supportsReferenceImage: input.supportsReferenceImage,
  });
}

const localReadyOperations = new Set<ImageToolOperation>([
  "annotate",
  "color-mark",
  "crop",
  "download",
  "fullscreen",
  "quick-split",
  "resize-pixels",
  "save-to-library",
]);

const providerOperations = [
  "enhance-creative",
  "erase",
  "multi-angle",
  "outpaint",
  "redraw",
] as const satisfies readonly ImageToolOperation[];

export const gptImageCapabilityAdapter = Object.freeze({
  id: "gpt-image-edit",
  operations: providerOperations,
  supportsAlpha: true,
  supportsMask: true,
  supportsReferenceImage: true,
}) satisfies ImageToolCapabilityAdapter;

export const productionImageToolCapabilityAdapters =
  new ImageToolCapabilityAdapterRegistry().register(gptImageCapabilityAdapter);

function disabledOperations(value: string | undefined) {
  const result = new Set<ImageToolOperation>();
  for (const item of value?.split(",") ?? []) {
    const operation = item.trim();
    if ((imageToolOperations as readonly string[]).includes(operation)) {
      result.add(operation as ImageToolOperation);
    }
  }
  return result;
}

function capability(
  operation: ImageToolOperation,
  input: {
    adapter?: ImageToolCapabilityAdapter;
    estimatedCost?: ImageToolCapability["estimatedCost"];
    expiresAt: string;
    modelId?: string;
    reason: string;
    reasonCode: ImageToolCapabilityReasonCode;
    status: ImageToolCapability["status"];
  },
): ImageToolCapability {
  const local = localReadyOperations.has(operation);
  const removeBackground = operation === "remove-background";
  return {
    ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
    expiresAt: input.expiresAt,
    maximumInputBytes: imageToolMaximums.inputBytes,
    maximumInputPixels: imageToolMaximums.inputPixels,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    operation,
    outputContentTypes: removeBackground
      ? ["image/png"]
      : ["image/png", "image/jpeg"],
    reason: input.reason,
    reasonCode: input.reasonCode,
    status: input.status,
    supportsAlpha: removeBackground || input.adapter?.supportsAlpha === true,
    supportsMask: input.adapter?.supportsMask === true,
    supportsReferenceImage:
      local || input.adapter?.supportsReferenceImage === true,
  };
}

function providerAvailable(input: ImageToolGenerationCapability) {
  return input.configured && input.globalEnabled && !input.emergencyStop &&
    input.providerProtocol === "gpt-image" &&
    /^gpt-image-(?:1(?:\.5)?|2)(?:-|$)/i.test(input.modelId ?? "");
}

export function imageToolCapabilitySnapshot(input: {
  adapters?: ImageToolCapabilityAdapterRegistry;
  disabled?: string;
  generation: ImageToolGenerationCapability;
  now?: Date;
}): ImageToolCapabilitySnapshot {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const disabled = disabledOperations(input.disabled);
  const adapters = input.adapters ?? productionImageToolCapabilityAdapters;
  const operations = imageToolOperations.map((operation) => {
    if (disabled.has(operation)) {
      return capability(operation, {
        expiresAt,
        reason: "管理员已单独关闭此图片工具",
        reasonCode: "OPERATOR_DISABLED",
        status: "disabled_by_operator",
      });
    }
    if (operation === "lighting") {
      return capability(operation, {
        expiresAt,
        reason: "图片打光不在本次开放范围",
        reasonCode: "PAUSED_BY_SCOPE",
        status: "paused",
      });
    }
    if (localReadyOperations.has(operation)) {
      return capability(operation, {
        expiresAt,
        reason: "本地图片工具已就绪",
        reasonCode: "AVAILABLE",
        status: "available",
      });
    }
    if (operation === "seedance-validate") {
      return capability(operation, {
        expiresAt,
        reason: "Seedance 本地资格预检将在 D11 接入",
        reasonCode: "REMOTE_VALIDATION_UNAVAILABLE",
        status: "unavailable",
      });
    }
    if (operation === "enhance-conservative" || operation === "remove-background") {
      return capability(operation, {
        expiresAt,
        reason: "本地处理适配器将在 D10 接入",
        reasonCode: "LOCAL_RUNTIME_UNAVAILABLE",
        status: "unavailable",
      });
    }
    const adapter = adapters.get(operation);
    if (!adapter) {
      return capability(operation, {
        expiresAt,
        reason: "服务器没有注册此图片处理适配器",
        reasonCode: "UNSUPPORTED",
        status: "unavailable",
      });
    }
    if (!providerAvailable(input.generation)) {
      const operatorStopped = input.generation.emergencyStop ||
        !input.generation.globalEnabled;
      return capability(operation, {
        adapter,
        expiresAt,
        reason: operatorStopped
          ? "真实生成已由管理员停止"
          : "当前账号没有可用的 GPT Image 编辑模型",
        reasonCode: operatorStopped
          ? "OPERATOR_DISABLED"
          : input.generation.configured
            ? "MODEL_UNAVAILABLE"
            : "PROVIDER_UNAVAILABLE",
        status: operatorStopped ? "disabled_by_operator" : "unavailable",
      });
    }
    return capability(operation, {
      adapter,
      ...(input.generation.maxCostMicrounits === undefined
        ? {}
        : {
            estimatedCost: {
              amount: input.generation.maxCostMicrounits / 1_000_000,
              currency: "USD" as const,
              source: "operator" as const,
            },
          }),
      expiresAt,
      modelId: input.generation.modelId,
      reason: "当前图片编辑模型和安全适配器已就绪",
      reasonCode: "AVAILABLE",
      status: "available",
    });
  });
  const generatedAt = now.toISOString();
  const revision = createHash("sha256").update(JSON.stringify({
    generatedAt,
    operations,
  })).digest("hex").slice(0, 24);
  return { generatedAt, operations, revision };
}
