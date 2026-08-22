import type {
  GenerationTaskKind,
  GenerationTaskState,
} from "./generationTaskStore";

export type GenerationTaskQueryEvidence = Readonly<{
  attempt: number;
  canvasId: string;
  id: string;
  kind: GenerationTaskKind;
  nodeId: string;
  ownerId?: string;
  providerTaskId?: string;
  state: GenerationTaskState;
  updatedAt: string;
}>;

export type GenerationTaskQuery = Readonly<{
  canvasId?: string;
  kinds?: readonly GenerationTaskKind[];
  ownerId?: string;
  states?: readonly GenerationTaskState[];
}>;

/** Read-only task identity/status seam; it intentionally exposes no mutation. */
export interface GenerationQueryPort<
  Task extends GenerationTaskQueryEvidence = GenerationTaskQueryEvidence,
> {
  get(taskId: string): Task | undefined;
  list(query: GenerationTaskQuery): readonly Task[];
}
