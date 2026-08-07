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
    audioDuration?: number;
    audioFileSize?: number;
    audioFileName?: string;
    audioGeneratedResult?: boolean;
    audioGenerationErrorCode?: string;
    audioGenerationError?: string;
    audioGenerationInputKey?: string;
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
  id,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected);
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
