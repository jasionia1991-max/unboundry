import type { ProbeNodeType } from "../canvas/ProbeNode";
import { NODE_DEFAULT_SIZES } from "../canvas/mediaGeometry";
import { trustedMediaPatch } from "../canvas/mediaInputMetadata";
import { groupRunResultKey } from "./groupRunCheckpoint";
import {
  generationFailureMessage,
  safelyRetryableGenerationTask,
} from "./generationRetry";
import type {
  SingleNodeGenerationAdapter,
  SingleNodeGenerationBlocked,
  SingleNodeGenerationPlan,
} from "./singleNodeGenerationLifecycle";

export function createImageGenerationAdapter(input: {
  aspectRatio?: string;
  bindingOwnershipKey?: string;
  inputKey: string;
  modelId?: string;
  modelName?: string;
  nodeId: string;
  ownershipKey: string;
  parameters?: ProbeNodeType["data"]["imageParameters"];
  payload: unknown;
  preserveBindingOwnership?: boolean;
  quality?: string;
  readBlock: () => SingleNodeGenerationBlocked | undefined;
}): SingleNodeGenerationAdapter {
  return {
    applyPrepared(node) {
      return {
        ...node,
        data: {
          ...node.data,
          imageAspectRatio: input.aspectRatio,
          imageModelId: input.modelId,
          imageModelName: input.modelName,
          imageParameters: input.parameters,
          imageQuality: input.quality,
        },
      };
    },
    applyBinding(node, task, plan) {
      return {
        ...node,
        data: {
          ...node.data,
          groupRunSuccessOwnershipKey: undefined,
          groupRunSuccessResultKey: undefined,
          groupRunSuccessTaskId: undefined,
          imageGeneratedSuccess: false,
          imageGenerating: true,
          imageGenerationError: undefined,
          imageGenerationErrorCode: undefined,
          imageGenerationInputKey: plan.inputKey,
          imageGenerationOwnershipKey: input.preserveBindingOwnership
            ? input.bindingOwnershipKey
            : task.generationOwnershipKey ?? plan.ownershipKey,
          imageGenerationRetryAllowed: undefined,
          imageGenerationRetryBlockCode: undefined,
          imageGenerationRetryBlockReason: undefined,
          imageGenerationTaskId: task.id,
          imageAspectRatio: input.aspectRatio,
          imageModelId: input.modelId,
          imageModelName: input.modelName,
          imageParameters: input.parameters,
          imageQuality: input.quality,
        },
      };
    },
    applyTerminal(node, task, plan) {
      if (task.state === "success") {
        if (!task.resultAssetId || !task.resultUrl) {
          throw new Error("图片结果不完整");
        }
        return {
          ...node,
          height: undefined,
          measured: undefined,
          style: { ...node.style, ...NODE_DEFAULT_SIZES.image },
          width: undefined,
          data: {
            ...node.data,
            assetId: task.resultAssetId,
            ...(task.resultMedia
              ? trustedMediaPatch({
                  assetId: task.resultAssetId,
                  kind: "image",
                  ...task.resultMedia,
                })
              : {}),
            groupRunSuccessOwnershipKey: plan.ownershipKey,
            groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
            groupRunSuccessTaskId: task.id,
            imageGeneratedSuccess: true,
            imageGenerating: false,
            imageGenerationError: undefined,
            imageGenerationErrorCode: undefined,
            imageGenerationRetryAllowed: undefined,
            imageGenerationRetryBlockCode: undefined,
            imageGenerationRetryBlockReason: undefined,
            imageGenerationTaskId: undefined,
            imageSrc: task.resultUrl,
          },
        };
      }
      if (task.state === "cancelled") {
        return {
          ...node,
          data: {
            ...node.data,
            imageGenerating: false,
            imageGenerationError: task.errorMessage ?? "图片生成已取消",
            imageGenerationErrorCode: undefined,
            imageGenerationInputKey: undefined,
            imageGenerationOwnershipKey: undefined,
            imageGenerationRetryAllowed: undefined,
            imageGenerationRetryBlockCode: undefined,
            imageGenerationRetryBlockReason: undefined,
            imageGenerationTaskId: undefined,
          },
        };
      }
      const retryAllowed = safelyRetryableGenerationTask(task);
      const visibleMessage = generationFailureMessage(
        task.errorMessage ?? "图片生成失败，请稍后再试",
        retryAllowed ? undefined : task.retryBlockReason,
        task.errorCode,
        "image",
      );
      return {
        ...node,
        data: {
          ...node.data,
          imageGenerating: false,
          imageGenerationError: visibleMessage,
          imageGenerationErrorCode: task.errorCode,
          imageGenerationInputKey: plan.inputKey,
          imageGenerationRetryAllowed: retryAllowed,
          imageGenerationRetryBlockCode: task.retryBlockCode,
          imageGenerationRetryBlockReason: task.retryBlockReason,
          imageGenerationTaskId: task.id,
        },
      };
    },
    kind: "image",
    readPlan(): SingleNodeGenerationBlocked | SingleNodeGenerationPlan {
      const block = input.readBlock();
      if (block) return block;
      return {
        inputKey: input.inputKey,
        kind: "image",
        nodeId: input.nodeId,
        ownershipKey: input.ownershipKey,
        payload: input.payload,
      };
    },
  };
}
