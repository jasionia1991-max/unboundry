import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo } from "react";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import type { ModelParameterValue } from "../../../types/modelParameters";
import type { NodeInputState } from "../../../types/nodeInputs";

function stableOwnershipValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableOwnershipValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableOwnershipValue(item)]),
    );
  }
  return value;
}

/** Compact, catalog-independent ownership evidence for an in-flight task. */
export function generationOwnershipKey(value: unknown) {
  const source = JSON.stringify(stableOwnershipValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

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
    groupRunSuccessResultKey?: string;
    groupRunSuccessTaskId?: string;
    audioDuration?: number;
    audioFileSize?: number;
    audioFileName?: string;
    audioGeneratedResult?: boolean;
    audioGenerationErrorCode?: string;
    audioGenerationError?: string;
    audioGenerationInputKey?: string;
    audioGenerationOwnershipKey?: string;
    audioGenerationRetryAllowed?: boolean;
    audioGenerationRetryBlockCode?: string;
    audioGenerationRetryBlockReason?: string;
    audioGenerationTaskId?: string;
    audioGenerating?: boolean;
    audioModelId?: string;
    audioModelName?: string;
    audioPrompt?: string;
    audioPromptReady?: boolean;
    audioParameters?: Record<string, ModelParameterValue>;
    audioSrc?: string;
    audioWaveform?: number[];
    content?: string;
    contentHtml?: string;
    imageGeneratedSuccess?: boolean;
    imageGenerationErrorCode?: string;
    imageGenerationError?: string;
    imageGenerationInputKey?: string;
    imageGenerationOwnershipKey?: string;
    imageGenerationRetryAllowed?: boolean;
    imageGenerationRetryBlockCode?: string;
    imageGenerationRetryBlockReason?: string;
    imageGenerationTaskId?: string;
    imageGenerating?: boolean;
    imageAspectRatio?: string;
    imageModelId?: string;
    imageModelName?: string;
    imagePrompt?: string;
    imagePromptReady?: boolean;
    imageParameters?: Record<string, ModelParameterValue>;
    imageQuality?: string;
    imageSrc?: string;
    inputState?: NodeInputState;
    inputStateReason?: string;
    label: string;
    mediaByteSize?: number;
    mediaContentType?: string;
    mediaDurationSeconds?: number;
    mediaMetadataSource?: "server";
    mediaMetadataStatus?: "failed" | "pending" | "ready";
    mediaStorageBackend?: "local" | "oss";
    playlistClips?: PlaylistClip[];
    playlistPicking?: boolean;
    sourceKind?: "audio" | "image" | "video";
    storyboardShots?: StoryboardShot[];
    textPrompt?: string;
    textPromptReady?: boolean;
    textGenerationError?: string;
    textGenerationErrorCode?: string;
    textGenerationInputKey?: string;
    textGenerationOwnershipKey?: string;
    textGenerationRetryAllowed?: boolean;
    textGenerationRetryBlockCode?: string;
    textGenerationRetryBlockReason?: string;
    textGenerating?: boolean;
    textGenerationTaskId?: string;
    textParameters?: Record<string, ModelParameterValue>;
    textModelId?: string;
    textModelName?: string;
    title?: string;
    groupColor?: string;
    groupTemplate?: boolean;
    videoAudioEnabled?: boolean;
    videoCreatedAt?: string;
    videoDuration?: number;
    videoFileSize?: number;
    videoHeight?: number;
    videoGenerationError?: string;
    videoGenerationErrorCode?: string;
    videoGenerationInputKey?: string;
    videoGenerationOwnershipKey?: string;
    videoGenerationRetryAllowed?: boolean;
    videoGenerationRetryBlockCode?: string;
    videoGenerationRetryBlockReason?: string;
    videoGenerationTaskId?: string;
    videoGenerating?: boolean;
    videoModel?: string;
    videoModelId?: string;
    videoPrompt?: string;
    videoPromptReady?: boolean;
    videoParameters?: Record<string, ModelParameterValue>;
    videoSrc?: string;
    videoWidth?: number;
    variant?: "group";
  },
  | "audio"
  | "group"
  | "image"
  | "playlist"
  | "probe"
  | "storyboard"
  | "text"
  | "video"
>;

function ProbeNodeImpl({
  data,
  dragging,
  id,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const group = data.variant === "group";
  const checkpoint = useCanvasCheckpoint();

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        onResizeStart={() => checkpoint()}
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
