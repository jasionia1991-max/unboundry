import type { ImageToolResult } from "../../../types/imageTools";

export const LIBRARY_CHANGED_EVENT = "unboundry:library-changed";

export type SaveLibraryAssetInput = Readonly<{
  assetId: string;
  folderId?: string;
  kind: "audio" | "image" | "video";
  label: string;
}>;

export function createSaveLibraryAssetUseCase(
  fetcher: typeof fetch = fetch,
) {
  return {
    operation: "save-to-library" as const,
    async execute(input: SaveLibraryAssetInput): Promise<ImageToolResult> {
      const response = await fetcher("/api/library", {
        body: JSON.stringify({
          assetId: input.assetId,
          folderId: input.folderId ?? "others",
          kind: input.kind,
          label: input.label,
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        item?: { revision?: number };
      };
      if (!response.ok || !Number.isSafeInteger(body.item?.revision)) {
        throw new Error(body.error || "素材保存失败，请稍后重试");
      }
      window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
      return {
        kind: "metadata",
        operation: "save-to-library",
        revision: body.item!.revision!,
      };
    },
  } as const;
}
