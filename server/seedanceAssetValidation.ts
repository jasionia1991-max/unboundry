import type { ModelParameterSchema } from "../types/modelParameters";
import type {
  SeedanceAssetValidation,
  SeedanceImageRole,
} from "../types/imageTools";
import { arkVideoMediaProblem } from "./providerMedia";

export type SeedanceValidationModel = Readonly<{
  configurationRevision: string;
  displayName: string;
  id: string;
  parameterSchema: ModelParameterSchema;
}>;

export type SeedanceValidationMedia = Readonly<{
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds?: number | null;
  durationSource?: "provider-task" | "server-probe" | null;
  durationStatus?: "failed" | "not-applicable" | "pending" | "ready";
  mediaHeight?: number | null;
  mediaWidth?: number | null;
  storageStatus: "failed" | "pending" | "ready";
}>;

export function validateSeedanceAsset(input: Readonly<{
  assetId: string;
  media: SeedanceValidationMedia;
  model: SeedanceValidationModel;
  now?: Date;
  role: SeedanceImageRole;
}>): SeedanceAssetValidation {
  const now = input.now ?? new Date();
  const problems: string[] = [];
  const roles = input.model.parameterSchema.inputPolicy?.roles?.image ?? [];
  if (!roles.includes(input.role)) {
    problems.push("所选素材角色不受当前 Seedance 模型支持");
  }
  if (input.media.storageStatus !== "ready") {
    problems.push("图片尚未完成安全保存");
  } else {
    const mediaProblem = arkVideoMediaProblem(
      "image",
      input.media,
      input.model.parameterSchema.referenceMediaRules,
    );
    if (mediaProblem) problems.push(mediaProblem);
  }
  return {
    assetId: input.assetId,
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    kind: "validation",
    modelConfigurationRevision: input.model.configurationRevision,
    modelDisplayName: input.model.displayName,
    modelId: input.model.id,
    operation: "seedance-validate",
    problems,
    remoteValidationAvailable: false,
    role: input.role,
    scope: "local-technical-preflight",
    status: problems.length === 0 ? "eligible" : "ineligible",
  };
}
