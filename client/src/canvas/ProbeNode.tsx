import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo } from "react";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import type { ModelParameterValue } from "../../../types/modelParameters";
import type { NodeInputState } from "../../../types/nodeInputs";
import type { CanvasNodeKind } from "../../../types/nodeVocabulary";
import type {
  ImageAnnotationDocument,
  ImageMultiAngleParameters,
  ImageToolOperation,
  SeedanceAssetValidation,
} from "../../../types/imageTools";
export { generationOwnershipKey } from "../../../types/generationIdentity";

export type PlaylistClip = {
  end: number;
  id: string;
  sourceNodeId: string;
  sourceEnd?: number;
  sourceStart?: number;
  src: string;
  start: number;
  title: string;
};

export type StoryboardShot = {
  dialogue: string;
  duration: string;
  framing: string;
  id: string;
  mediaTone: "desk" | "monitor" | "loading";
  notes: string;
  number: number;
  status: "complete" | "loading";
  summary: string;
};

export type ProbeNodeType = Node<
  {
    assetId?: string;
    /** Durable proof for a completed group-run task; unlike live task fields it is not terminally cleared. */
    groupRunSuccessOwnershipKey?: string;
    groupRunSuccessInputFingerprint?: string;
    groupRunSuccessModelConfigurationRevision?: string;
    groupRunSuccessModelReleaseRevision?: string;
    groupRunSuccessResultKey?: string;
    groupRunSuccessTaskId?: string;
    /** Idempotency receipt for an exact legacy terminal-detach application. */
    legacyTerminalDetachApplicationId?: string;
    /** Durable owner marker for a headless workflow executor. */
    workflowExecutionRunId?: string;
    audioDuration?: number;
    audioFileSize?: number;
    audioFileName?: string;
    audioGeneratedResult?: boolean;
    audioGenerationErrorCode?: string;
    audioGenerationError?: string;
    audioGenerationContractFingerprint?: string;
    audioGenerationModelConfigurationRevision?: string;
    audioGenerationInputKey?: string;
    audioGenerationModelReleaseRevision?: string;
    audioGenerationOwnershipKey?: string;
    audioGenerationRetryAllowed?: boolean;
    audioGenerationRetryBlockCode?: string;
    audioGenerationRetryBlockReason?: string;
    audioGenerationTaskId?: string;
    audioGenerating?: boolean;
    audioModelId?: string;
    audioModelConfigurationRevision?: string;
    audioModelName?: string;
    audioPrompt?: string;
    audioPromptReady?: boolean;
    audioParameters?: Record<string, ModelParameterValue>;
    audioResultChoices?: Array<{
      assetId: string;
      byteSize: number;
      contentType: string;
      durationSeconds: number | null;
      durationStatus: "failed" | "not-applicable" | "pending" | "ready";
      mediaHeight: number | null;
      mediaWidth: number | null;
      role: "alternate" | "primary";
      storageBackend: "local" | "oss";
      url: string;
    }>;
    audioSrc?: string;
    audioWaveform?: number[];
    content?: string;
    contentHtml?: string;
    imageGeneratedSuccess?: boolean;
    imageHasTransparency?: boolean;
    imageAssetOrigin?: "image-tool" | "local-upload";
    imageAnnotations?: ImageAnnotationDocument;
    imageColorMarks?: string[];
    imageGenerationErrorCode?: string;
    imageGenerationError?: string;
    imageGenerationContractFingerprint?: string;
    imageGenerationModelConfigurationRevision?: string;
    imageGenerationInputKey?: string;
    imageGenerationModelReleaseRevision?: string;
    imageGenerationOwnershipKey?: string;
    imageGenerationRetryAllowed?: boolean;
    imageGenerationRetryBlockCode?: string;
    imageGenerationRetryBlockReason?: string;
    imageGenerationTaskId?: string;
    imageGenerating?: boolean;
    imageAspectRatio?: string;
    imageModelId?: string;
    imageModelConfigurationRevision?: string;
    imageModelName?: string;
    imageMultiAngleParameters?: ImageMultiAngleParameters;
    imagePrompt?: string;
    imagePromptReady?: boolean;
    imageParameters?: Record<string, ModelParameterValue>;
    imageQuality?: string;
    imageSrc?: string;
    imageToolOperation?: ImageToolOperation;
    imageToolOperationId?: string;
    /** Graph-owned compare-and-set receipt for the source image mutation. */
    imageToolGraphOperationId?: string;
    imageToolGraphOperationRevision?: number;
    imageToolGraphOwnershipKey?: string;
    imageToolGraphRunId?: string;
    imageToolGraphSourceAssetId?: string;
    imageToolOutputBackground?: "transparent";
    imageToolMaskAssetId?: string;
    imageToolMaskFeatherPixels?: number;
    imageToolMaskHeight?: number;
    imageToolMaskVersion?: 1;
    imageToolMaskWidth?: number;
    imageToolOutpaintParameters?: import("../../../types/imageTools").ImageOutpaintParameters;
    imageToolPreparedAssetId?: string;
    imageToolPreparedHeight?: number;
    imageToolPreparedVersion?: 1;
    imageToolPreparedWidth?: number;
    imageToolSourceAssetId?: string;
    imageSeedanceValidation?: SeedanceAssetValidation;
    inputState?: NodeInputState;
    inputStateReason?: string;
    /** Local-only upload/request overlay; never serialized into Canvas. */
    inputViewState?: NodeInputState;
    inputViewStateReason?: string;
    label: string;
    mediaByteSize?: number;
    mediaContentType?: string;
    mediaDurationSeconds?: number;
    mediaHeight?: number;
    mediaMetadataSource?: "server";
    mediaMetadataStatus?: "failed" | "pending" | "ready";
    mediaStorageBackend?: "local" | "oss";
    mediaWidth?: number;
    playlistClips?: PlaylistClip[];
    playlistPicking?: boolean;
    sourceKind?: "audio" | "image" | "video";
    storyboardShots?: StoryboardShot[];
    textPrompt?: string;
    textPromptReady?: boolean;
    textGenerationError?: string;
    textGenerationErrorCode?: string;
    textGenerationContractFingerprint?: string;
    textGenerationModelConfigurationRevision?: string;
    textGenerationInputKey?: string;
    textGenerationModelReleaseRevision?: string;
    textGenerationOwnershipKey?: string;
    textGenerationRetryAllowed?: boolean;
    textGenerationRetryBlockCode?: string;
    textGenerationRetryBlockReason?: string;
    textGenerating?: boolean;
    textGenerationTaskId?: string;
    textParameters?: Record<string, ModelParameterValue>;
    textModelId?: string;
    textModelConfigurationRevision?: string;
    textModelName?: string;
    title?: string;
    groupColor?: string;
    groupTemplate?: boolean;
    videoAudioEnabled?: boolean;
    mediaSizingMode?: "auto" | "manual";
    videoCreatedAt?: string;
    videoDuration?: number;
    videoFileSize?: number;
    videoHeight?: number;
    videoGenerationError?: string;
    videoGenerationErrorCode?: string;
    /** Contract fingerprint that authored the current preflight/server error. */
    videoGenerationContractFingerprint?: string;
    videoGenerationModelConfigurationRevision?: string;
    videoGenerationInputKey?: string;
    videoGenerationModelInputContractFingerprint?: string;
    videoGenerationModelReleaseRevision?: string;
    videoGenerationOwnershipKey?: string;
    videoGenerationRetryAllowed?: boolean;
    videoGenerationRetryBlockCode?: string;
    videoGenerationRetryBlockReason?: string;
    videoGenerationTaskId?: string;
    videoGenerating?: boolean;
    videoModel?: string;
    videoModelId?: string;
    videoModelConfigurationRevision?: string;
    videoPrompt?: string;
    videoPromptReady?: boolean;
    videoParameters?: Record<string, ModelParameterValue>;
    /** Provider-neutral normalized model/input contract saved with the graph. */
    videoInputContractFingerprint?: string;
    videoSrc?: string;
    videoWidth?: number;
    variant?: "group";
  },
  CanvasNodeKind
>;

function ProbeNodeImpl({
  data,
  dragging,
  id,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const group = data.variant === "group";

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
      />
      {!group && (
        <Handle id="target" position={Position.Left} type="target">
          <span className="node-handle-hit node-handle-hit-left">
            <span className="node-handle-plus" />
          </span>
        </Handle>
      )}
      <div
        className={`probe-node${group ? " probe-node-group" : ""}`}
        data-asset-id={data.assetId}
        data-node-variant={data.variant}
        data-testid={`probe-node-${id}`}
      >
        <span>{data.label}</span>
        {data.content && (
          <span className="probe-node-content">{data.content}</span>
        )}
      </div>
      {!group && (
        <Handle id="source" position={Position.Right} type="source">
          <span className="node-handle-hit node-handle-hit-right">
            <span className="node-handle-plus" />
          </span>
        </Handle>
      )}
    </>
  );
}
export const ProbeNode = memo(ProbeNodeImpl);
