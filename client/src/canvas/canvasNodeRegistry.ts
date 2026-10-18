import type { NodeTypes } from "@xyflow/react";
import { withNodeErrorBoundary } from "./NodeErrorBoundary";
import { AudioNode } from "./AudioNode";
import { GroupNode } from "./GroupNode";
import { ImageNode } from "./ImageNode";
import { PlaylistNode } from "./PlaylistNode";
import { ProbeNode } from "./ProbeNode";
import { StoryboardTableNode } from "./StoryboardTableNode";
import { TextNode } from "./TextNode";
import { VideoNode } from "./VideoNode";
import type { CanvasNodeKind } from "../../../types/nodeVocabulary";

export class CanvasNodeRegistry<Kind extends string = CanvasNodeKind> {
  readonly #renderers = new Map<Kind, NodeTypes[string]>();

  register(kind: Kind, renderer: NodeTypes[string]) {
    if (this.#renderers.has(kind)) {
      throw new Error(`Canvas node renderer is already registered: ${kind}`);
    }
    this.#renderers.set(kind, renderer);
    return this;
  }

  get(kind: unknown): NodeTypes[string] | undefined {
    return typeof kind === "string"
      ? this.#renderers.get(kind as Kind)
      : undefined;
  }

  kinds(): Kind[] {
    return [...this.#renderers.keys()];
  }

  nodeTypes(): NodeTypes {
    return Object.fromEntries(this.#renderers) as NodeTypes;
  }
}

// Each renderer is isolated so one broken node cannot blank the whole canvas.
export const canvasNodeRegistry = new CanvasNodeRegistry()
  .register("audio", withNodeErrorBoundary(AudioNode))
  .register("group", withNodeErrorBoundary(GroupNode))
  .register("image", withNodeErrorBoundary(ImageNode))
  .register("playlist", withNodeErrorBoundary(PlaylistNode))
  .register("probe", withNodeErrorBoundary(ProbeNode))
  .register("storyboard", withNodeErrorBoundary(StoryboardTableNode))
  .register("text", withNodeErrorBoundary(TextNode))
  .register("video", withNodeErrorBoundary(VideoNode));
