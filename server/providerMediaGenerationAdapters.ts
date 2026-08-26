import type { ProviderProfile } from "./providerProfiles";
import {
  type MediaGenerationExecution,
  type MediaGenerationProvider,
  MediaGenerationProviderError,
  MediaGenerationProviderRegistry,
  type MediaProviderTaskSnapshot,
  type NormalizedMediaProviderResult,
} from "./mediaGenerationProvider";
import {
  getMurekaAudioTask,
  createMurekaAudioTask,
  type MurekaAudioQueryKind,
  type MurekaAudioTaskStatus,
} from "./murekaAudioProvider";
import {
  pollContractRelayMediaTask,
  pollRelayMediaTask,
  submitContractRelayMedia,
  submitRelayMedia,
  type RelayMediaParamValue,
  type RelayMediaTaskSnapshot,
} from "./relayProviderAdapters";
import {
  cancelVolcengineArkVideoTask,
  createVolcengineArkVideoTask,
  getVolcengineArkVideoTask,
  type ArkVideoLimits,
  type ArkVideoMediaInput,
  type ArkVideoStatus,
} from "./volcengineArkVideoProvider";

function profile(execution: MediaGenerationExecution): ProviderProfile {
  return execution.profile as ProviderProfile;
}

function relayConnection(execution: MediaGenerationExecution) {
  const resolved = profile(execution);
  if (!resolved.apiKey) {
    throw new MediaGenerationProviderError("AUTH", "中转站 API Key 无效");
  }
  return { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl };
}

function assertExecution(execution: MediaGenerationExecution) {
  const deadline = Date.parse(execution.absoluteDeadline);
  if (
    !Number.isFinite(deadline) || deadline <= Date.now() ||
    !Number.isSafeInteger(execution.attempt) || execution.attempt < 1
  ) {
    throw new MediaGenerationProviderError(
      "TIMEOUT",
      "媒体任务的持久截止时间已失效",
      true,
    );
  }
}

function relaySnapshot(
  providerTaskId: string,
  value: RelayMediaTaskSnapshot,
): MediaProviderTaskSnapshot {
  if (value.state === "queued" || value.state === "running") {
    return {
      progress: value.progress,
      providerTaskId,
      state: value.state,
    };
  }
  if (value.state === "failed") {
    return {
      providerTaskId,
      ...(value.refunded === true ? { refunded: true } : {}),
      state: "failed",
    };
  }
  return {
    providerTaskId,
    rawResult: value,
    state: "succeeded",
  };
}

function relayNormalized(rawResult: unknown): NormalizedMediaProviderResult {
  const value = rawResult as RelayMediaTaskSnapshot;
  if (!value || value.state !== "success") {
    throw new MediaGenerationProviderError(
      "FORMAT",
      "中转站媒体结果无法安全识别",
      true,
    );
  }
  return {
    actualCostMicrounits: value.providerCostUnits,
    outputs: value.outputs.map((output) => output.transport === "bytes"
      ? {
          bytes: output.bytes,
          contentType: output.mimeType,
          kind: output.kind,
        }
      : {
          contentType: output.mimeType,
          kind: output.kind,
          transientUrl: output.transientUrl,
        }),
  };
}

export const relayMediaGenerationProvider: MediaGenerationProvider = {
  id: "multi-protocol-relay-media",
  registrations: (["audio", "image", "video"] as const).map((kind) => ({
    driver: "multi-protocol-relay" as const,
    kind,
    protocol: "media-generate" as const,
  })),
  async cancel(providerTaskId) {
    return { providerTaskId, state: "unsupported" };
  },
  async inspect(providerTaskId, execution) {
    assertExecution(execution);
    const kind = execution.metadata?.kind;
    if (kind !== "audio" && kind !== "image" && kind !== "video") {
      throw new MediaGenerationProviderError("FORMAT", "媒体任务类型无效", true);
    }
    const transport = {
      beforeProviderRequest: execution.beforeProviderRequest,
      fetcher: execution.fetcher,
      signal: execution.signal,
      usePinnedTransport: true,
    } as const;
    const contract = execution.metadata?.modelExecutionContract;
    const result = contract
      ? await pollContractRelayMediaTask(
          relayConnection(execution),
          {
            capability: kind,
            externalTaskId: providerTaskId,
            providerProtocol: "media-generate",
          },
          contract,
          transport,
        )
      : await pollRelayMediaTask(
          relayConnection(execution),
          {
            capability: kind,
            externalTaskId: providerTaskId,
            providerProtocol: "media-generate",
            requireResultType: execution.metadata?.requireResultType === true,
          },
          transport,
        );
    return relaySnapshot(providerTaskId, result);
  },
  normalize: relayNormalized,
  async recover() {
    return { state: "not-found" };
  },
  async submit(request, execution) {
    assertExecution(execution);
    const relayRequest = {
      capability: request.kind,
      model: request.model,
      params: request.parameters as Record<string, RelayMediaParamValue>,
      prompt: request.prompt,
      providerProtocol: "media-generate" as const,
    };
    const transport = {
      beforeProviderRequest: execution.beforeProviderRequest,
      fetcher: execution.fetcher,
      signal: execution.signal,
      usePinnedTransport: true,
    } as const;
    const contract = execution.metadata?.modelExecutionContract;
    const created = contract
      ? await submitContractRelayMedia(
          relayConnection(execution), relayRequest, contract, transport,
        )
      : await submitRelayMedia(
          relayConnection(execution), relayRequest, transport,
        );
    return {
      providerTaskId: created.externalTaskId,
      providerTaskMayStillRun: true,
      state: "accepted",
    };
  },
};

function arkSnapshot(
  providerTaskId: string,
  value: ArkVideoStatus,
): MediaProviderTaskSnapshot {
  if (value.state === "succeeded") {
    return { providerTaskId, rawResult: value, state: "succeeded" };
  }
  return { providerTaskId, state: value.state };
}

function arkNormalized(rawResult: unknown): NormalizedMediaProviderResult {
  const value = rawResult as ArkVideoStatus;
  if (!value || value.state !== "succeeded" || !value.videoUrl) {
    throw new MediaGenerationProviderError(
      "FORMAT",
      "方舟视频结果无法安全识别",
      true,
    );
  }
  return {
    outputs: [{
      kind: "video",
      providerUsageTokens: value.providerUsageTokens,
      transientUrl: value.videoUrl,
    }],
  };
}

export const arkVideoGenerationProvider: MediaGenerationProvider = {
  id: "volcengine-ark-video",
  registrations: [{
    driver: "volcengine-ark",
    kind: "video",
    protocol: "native",
  }],
  async cancel(providerTaskId, execution) {
    assertExecution(execution);
    await cancelVolcengineArkVideoTask(
      profile(execution),
      providerTaskId,
      execution.fetcher,
      execution.signal,
    );
    return { providerTaskId, state: "cancelled" };
  },
  async inspect(providerTaskId, execution) {
    assertExecution(execution);
    return arkSnapshot(providerTaskId, await getVolcengineArkVideoTask(
      profile(execution),
      providerTaskId,
      execution.fetcher,
      execution.signal,
    ));
  },
  normalize: arkNormalized,
  async recover() {
    return { state: "not-found" };
  },
  async submit(request, execution) {
    assertExecution(execution);
    const parameters = request.parameters;
    const created = await createVolcengineArkVideoTask(
      profile(execution),
      {
        duration: parameters.duration as number | undefined,
        generateAudio: parameters.generateAudio as boolean | undefined,
        inputs: parameters.inputs as ArkVideoMediaInput[] | undefined,
        limits: parameters.limits as ArkVideoLimits | undefined,
        model: request.model,
        prompt: request.prompt,
        ratio: parameters.aspectRatio as string | undefined,
        resolution: parameters.resolution as string | undefined,
      },
      execution.fetcher,
      execution.signal,
      execution.beforeProviderRequest,
    );
    return {
      providerTaskId: created.id,
      providerTaskMayStillRun: true,
      state: "accepted",
    };
  },
};

function murekaSnapshot(
  providerTaskId: string,
  value: MurekaAudioTaskStatus,
): MediaProviderTaskSnapshot {
  if (value.state === "pending") return { providerTaskId, state: "running" };
  if (value.state === "succeeded") {
    return { providerTaskId, rawResult: value, state: "succeeded" };
  }
  return {
    providerTaskId,
    ...(value.state === "failed" && value.errorMessage
      ? { failureMessage: value.errorMessage }
      : {}),
    state: value.state,
  };
}

function murekaNormalized(rawResult: unknown): NormalizedMediaProviderResult {
  const value = rawResult as MurekaAudioTaskStatus;
  if (!value || value.state !== "succeeded" || !value.audioUrl) {
    throw new MediaGenerationProviderError(
      "FORMAT",
      "Mureka 音频结果无法安全识别",
      true,
    );
  }
  return {
    outputs: [{
      durationSeconds: value.durationMs === undefined
        ? undefined
        : value.durationMs / 1_000,
      kind: "audio",
      transientUrl: value.audioUrl,
    }],
  };
}

export const murekaMediaGenerationProvider: MediaGenerationProvider = {
  id: "mureka-audio",
  registrations: [{ driver: "mureka", kind: "audio", protocol: "native" }],
  async cancel(providerTaskId) {
    return { providerTaskId, state: "unsupported" };
  },
  async inspect(providerTaskId, execution) {
    assertExecution(execution);
    const queryKind = execution.metadata?.queryKind;
    if (queryKind !== "instrumental" && queryKind !== "song") {
      throw new MediaGenerationProviderError("FORMAT", "Mureka 查询类型无效", true);
    }
    return murekaSnapshot(providerTaskId, await getMurekaAudioTask(
      profile(execution),
      providerTaskId,
      queryKind as MurekaAudioQueryKind,
      execution.fetcher,
      execution.signal,
    ));
  },
  normalize: murekaNormalized,
  async recover() {
    return { state: "not-found" };
  },
  async submit(request, execution) {
    assertExecution(execution);
    const created = await createMurekaAudioTask(
      profile(execution),
      {
        lyrics: request.parameters.lyrics,
        model: request.model,
        musicGenerationMode: request.parameters.musicGenerationMode,
        outputCount: request.parameters.outputCount,
        prompt: request.prompt,
        streamPlayback: request.parameters.streamPlayback,
        vocalGender: request.parameters.vocalGender,
      },
      execution.fetcher,
      execution.signal,
      execution.beforeProviderRequest,
    );
    return {
      providerTaskId: created.id,
      providerTaskMayStillRun: true,
      state: "accepted",
    };
  },
};

export const mediaProviderRegistry = new MediaGenerationProviderRegistry([
  relayMediaGenerationProvider,
  arkVideoGenerationProvider,
  murekaMediaGenerationProvider,
]);
