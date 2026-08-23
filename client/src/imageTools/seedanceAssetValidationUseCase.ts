import {
  parseSeedanceAssetValidation,
  type SeedanceImageRole,
} from "../../../types/imageTools";

export type ValidateSeedanceAssetInput = Readonly<{
  assetId: string;
  modelId: string;
  role: SeedanceImageRole;
}>;

export function createSeedanceAssetValidationUseCase(
  fetcher: typeof fetch = fetch,
) {
  return {
    operation: "seedance-validate" as const,
    async execute(input: ValidateSeedanceAssetInput) {
      const response = await fetcher("/api/image-tools/seedance-validation", {
        body: JSON.stringify(input),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) {
        const error = body && typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "Seedance 素材校验失败";
        throw new Error(error);
      }
      return parseSeedanceAssetValidation(body);
    },
  } as const;
}
