import type { ModelCapability } from "../types/modelParameters";

export type ProviderCatalogCapabilityCounts = Record<
  ModelCapability | "unknown",
  number
>;

export type ProviderCatalogDiagnostics = {
  capabilityCounts?: ProviderCatalogCapabilityCounts;
  catalogSource?: "basic-fallback" | "enhanced" | "enhanced+basic";
  fallbackReason?: "EMPTY" | "NOT_SUPPORTED";
  rejectedModelCount?: number;
  reportedModelCount?: number;
};

const maximumCatalogCount = 2_000;
const capabilityKeys = [
  "text",
  "image",
  "video",
  "audio",
  "unknown",
] as const;

function safeCount(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximumCatalogCount
  ) {
    throw new Error("Invalid catalog diagnostics");
  }
  return Number(value);
}

export function parseProviderCatalogDiagnostics(
  serialized: string,
): ProviderCatalogDiagnostics {
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid catalog diagnostics");
  }
  const record = parsed as Record<string, unknown>;
  const catalogSource = record.catalogSource;
  if (
    catalogSource !== undefined &&
    catalogSource !== "enhanced" &&
    catalogSource !== "enhanced+basic" &&
    catalogSource !== "basic-fallback"
  ) {
    throw new Error("Invalid catalog diagnostics");
  }
  const fallbackReason = record.fallbackReason;
  if (
    fallbackReason !== undefined &&
    fallbackReason !== "EMPTY" &&
    fallbackReason !== "NOT_SUPPORTED"
  ) {
    throw new Error("Invalid catalog diagnostics");
  }
  let capabilityCounts: ProviderCatalogCapabilityCounts | undefined;
  if (record.capabilityCounts !== undefined) {
    if (
      !record.capabilityCounts ||
      typeof record.capabilityCounts !== "object" ||
      Array.isArray(record.capabilityCounts)
    ) {
      throw new Error("Invalid catalog diagnostics");
    }
    const counts = record.capabilityCounts as Record<string, unknown>;
    capabilityCounts = Object.fromEntries(
      capabilityKeys.map((key) => [key, safeCount(counts[key])]),
    ) as ProviderCatalogCapabilityCounts;
  }
  return {
    ...(capabilityCounts ? { capabilityCounts } : {}),
    ...(catalogSource ? { catalogSource } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(record.rejectedModelCount !== undefined
      ? { rejectedModelCount: safeCount(record.rejectedModelCount) }
      : {}),
    ...(record.reportedModelCount !== undefined
      ? { reportedModelCount: safeCount(record.reportedModelCount) }
      : {}),
  };
}

export function serializeProviderCatalogDiagnostics(
  diagnostics: ProviderCatalogDiagnostics,
) {
  return JSON.stringify(parseProviderCatalogDiagnostics(JSON.stringify(diagnostics)));
}
