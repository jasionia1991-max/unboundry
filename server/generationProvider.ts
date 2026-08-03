import type {
  GenerationTask,
  GenerationTaskKind,
} from "./generationTaskStore";

export type GenerationProviderOutput = {
  bytes: Uint8Array;
  durationMs?: number;
  height?: number;
  mimeType: string;
  width?: number;
};

export type GenerationProviderResult =
  | {
      externalTaskId: string;
      state: "running";
    }
  | {
      externalTaskId: string;
      outputs: GenerationProviderOutput[];
      state: "success";
    };

export type GenerationProviderSnapshot =
  | {
      progress?: number;
      state: "running";
    }
  | {
      code: string;
      message: string;
      state: "failed";
    }
  | {
      outputs: GenerationProviderOutput[];
      state: "success";
    };

/**
 * Provider implementations live only on the server. They receive a normalized
 * task and return bytes for the media store; browser code never receives a
 * Provider key or a Provider URL.
 */
export interface GenerationProvider {
  readonly id: string;
  readonly kinds: readonly GenerationTaskKind[];

  cancel?(externalTaskId: string, signal: AbortSignal): Promise<void>;
  inspect(
    externalTaskId: string,
    signal: AbortSignal,
  ): Promise<GenerationProviderSnapshot>;
  submit(
    task: GenerationTask,
    signal: AbortSignal,
  ): Promise<GenerationProviderResult>;
}

export function supportsGenerationKind(
  provider: GenerationProvider,
  kind: GenerationTaskKind,
) {
  return provider.kinds.includes(kind);
}
