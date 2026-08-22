import type { NodeTypes } from "@xyflow/react";
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

export const canvasNodeRegistry = new CanvasNodeRegistry()
  .register("audio", AudioNode)
  .register("group", GroupNode)
  .register("image", ImageNode)
  .register("playlist", PlaylistNode)
  .register("probe", ProbeNode)
  .register("storyboard", StoryboardTableNode)
  .register("text", TextNode)
  .register("video", VideoNode);
