/**
 * This module is intentionally pure. It imports no database, Provider, Media,
 * network, or runtime implementation so every recovery owner shares the same
 * serializable observation -> action table.
 */

export const generationOutcomeAdapterIds = [
  "ark-text",
  "ark-video",
  "mureka-audio",
  "openrouter-image",
  "relay-gpt-image",
  "relay-media",
] as const;

export type GenerationOutcomeAdapterId =
  (typeof generationOutcomeAdapterIds)[number];

export function generationOutcomeAdapterId(
  value: unknown,
): GenerationOutcomeAdapterId | undefined {
  switch (value) {
    case "ark-text":
    case "ark-video":
    case "mureka-audio":
    case "openrouter-image":
    case "relay-gpt-image":
    case "relay-media":
      return value;
    default:
      return undefined;
  }
}

export type GenerationOutcomeAttemptDto = Readonly<{
  failureCode?: string;
  finishedAt?: string;
  outcome:
    | "boundary-claimed"
    | "definitive-rejected"
    | "accepted"
    | "response-received"
    | "provider-failed"
    | "completed"
    | "outcome-unknown";
  providerTaskId?: string;
}>;

export type GenerationOutcomePublicationDto = Readonly<{
  state: "none" | "pending" | "published" | "quarantined";
}>;

export type GenerationOutcomeTaskDto = Readonly<{
  errorCode?: string;
  providerTaskId?: string;
  state:
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "cancelled"
    | "retrying"
    | "recovering";
}>;

export type GenerationProviderObservationDto =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "provider-accepted"; providerTaskId: string }>
  | Readonly<{ kind: "provider-running"; providerTaskId: string }>
  | Readonly<{
      failureCode: string;
      kind: "provider-terminal-failed";
      providerTaskId?: string;
    }>
  | Readonly<{ kind: "provider-succeeded"; providerTaskId?: string }>
  | Readonly<{ kind: "temporary-inspect-failure"; providerTaskId: string }>
  | Readonly<{ kind: "billing-unknown" }>
  | Readonly<{ kind: "evidence-conflict"; reason: string }>;

export type GenerationProviderOutcomeDecision =
  | Readonly<{ action: "settle-terminal-failure"; failureCode: string }>
  | Readonly<{ action: "inspect-original-task"; providerTaskId: string }>
  | Readonly<{ action: "recover-publication" }>
  | Readonly<{ action: "retry-inspect"; providerTaskId: string }>
  | Readonly<{ action: "preserve-billing-unknown" }>
  | Readonly<{ action: "quarantine-operator-incident"; reason: string }>
  | Readonly<{ action: "no-new-fact" }>
  | Readonly<{ action: "commit-provider-success" }>;

export type GenerationProviderOutcomeInput = Readonly<{
  adapterId: string;
  attempt?: GenerationOutcomeAttemptDto;
  observation: GenerationProviderObservationDto;
  publication: GenerationOutcomePublicationDto;
  task: GenerationOutcomeTaskDto;
}>;

const terminalAttemptOutcomes = new Set([
  "completed",
  "provider-failed",
  "definitive-rejected",
]);

export function classifyGenerationProviderOutcome(
  input: GenerationProviderOutcomeInput,
): GenerationProviderOutcomeDecision {
  // Durable publication evidence owns the exact Provider result bytes. It has
  // priority even when older task metadata no longer maps to a registered
  // adapter, because recovery must finish or quarantine those same bytes
  // before any Provider-side inspection can be considered.
  if (input.publication.state === "pending") {
    return Object.freeze({ action: "recover-publication" });
  }
  if (input.publication.state === "quarantined") {
    return Object.freeze({
      action: "quarantine-operator-incident",
      reason: "publication evidence is quarantined",
    });
  }
  if (!generationOutcomeAdapterId(input.adapterId)) {
    return Object.freeze({
      action: "quarantine-operator-incident",
      reason: "adapter identity is not registered",
    });
  }
  if (input.observation.kind === "evidence-conflict") {
    return Object.freeze({
      action: "quarantine-operator-incident",
      reason: input.observation.reason,
    });
  }
  if (input.observation.kind === "provider-succeeded") {
    return input.publication.state === "published"
      ? Object.freeze({ action: "commit-provider-success" })
      : Object.freeze({ action: "no-new-fact" });
  }
  if (
    input.attempt && terminalAttemptOutcomes.has(input.attempt.outcome)
  ) return Object.freeze({ action: "no-new-fact" });
  if (input.observation.kind === "provider-terminal-failed") {
    return Object.freeze({
      action: "settle-terminal-failure",
      failureCode: input.observation.failureCode,
    });
  }
  if (input.observation.kind === "temporary-inspect-failure") {
    return Object.freeze({
      action: "retry-inspect",
      providerTaskId: input.observation.providerTaskId,
    });
  }
  if (input.observation.kind === "billing-unknown") {
    return Object.freeze({ action: "preserve-billing-unknown" });
  }
  if (
    input.observation.kind === "provider-accepted" ||
    input.observation.kind === "provider-running"
  ) {
    return Object.freeze({
      action: "inspect-original-task",
      providerTaskId: input.observation.providerTaskId,
    });
  }
  if (input.attempt?.outcome === "outcome-unknown") {
    return Object.freeze({ action: "preserve-billing-unknown" });
  }
  const providerTaskId = input.task.providerTaskId ??
    input.attempt?.providerTaskId;
  if (
    providerTaskId && input.attempt &&
    ["accepted", "response-received"].includes(input.attempt.outcome)
  ) {
    return Object.freeze({ action: "inspect-original-task", providerTaskId });
  }
  if (input.attempt?.outcome === "boundary-claimed") {
    return Object.freeze({ action: "preserve-billing-unknown" });
  }
  return Object.freeze({ action: "no-new-fact" });
}
