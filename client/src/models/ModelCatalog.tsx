import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ModelCapability,
  ModelParameterSchema,
} from "../../../types/modelParameters";
import type { ProviderProtocol } from "../../../types/relayProtocols";

export type { ModelCapability } from "../../../types/modelParameters";

export type ModelGenerationUnavailableReasonCode =
  | "ADAPTER_UNSUPPORTED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RECOVERY_ATTEMPT_USED"
  | "PROVIDER_PROFILE_MISSING"
  | "PROVIDER_DRIVER_MISMATCH"
  | "PROVIDER_REVERIFY_REQUIRED"
  | "COST_LIMIT_NOT_CONFIGURED"
  | "EMERGENCY_STOP"
  | "GLOBAL_GENERATION_DISABLED";

export type PublishedModel = {
  capability: ModelCapability;
  displayName: string;
  generationAvailable: boolean;
  generationUnavailableReason: string;
  generationUnavailableReasonCode: ModelGenerationUnavailableReasonCode | null;
  id: string;
  imageParameters?: {
    aspectRatios: string[];
    maxReferenceImages: number;
    qualities: string[];
  };
  isDefault: boolean;
  mediaInputPolicy?: "seedance-2";
  parameterSchema?: ModelParameterSchema;
  providerProtocol?: ProviderProtocol;
};

export type ModelCatalogStatus = "error" | "loading" | "ready";

export const SAVED_MODEL_UNAVAILABLE_REASON =
  "原模型已停用/归档或不可用，当前不可生成";

export type PublishedModelSelection = {
  displayName?: string;
  model?: PublishedModel;
  savedModelUnavailable: boolean;
  selectedId?: string;
  unavailableReason: string;
};

type ModelCatalogValue = {
  models: PublishedModel[] | undefined;
  status: ModelCatalogStatus;
};

const ModelCatalogContext = createContext<ModelCatalogValue | undefined>(
  undefined,
);

export function ModelCatalogProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<PublishedModel[] | undefined>(undefined);
  const [status, setStatus] = useState<ModelCatalogStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/models", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Model catalog unavailable");
        return (await response.json()) as { models: PublishedModel[] };
      })
      .then(({ models: published }) => {
        setModels(published);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setModels([]);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <ModelCatalogContext.Provider value={{ models, status }}>
      {children}
    </ModelCatalogContext.Provider>
  );
}

export function usePublishedModels(capability: ModelCapability) {
  const catalog = useContext(ModelCatalogContext);
  return catalog?.models?.filter((model) => model.capability === capability);
}

export function useModelCatalogStatus() {
  return useContext(ModelCatalogContext)?.status ?? "error";
}

export function defaultPublishedModel(models: PublishedModel[] | undefined) {
  return models?.find((model) => model.isDefault) ?? models?.[0];
}

/**
 * A non-empty saved id is an exact reference, not a hint. Callers that need a
 * model schema for an existing node must not silently borrow the current
 * default when that exact model is no longer public.
 */
export function resolvePublishedModel(
  models: PublishedModel[] | undefined,
  savedId?: string,
) {
  const normalizedSavedId = savedId?.trim();
  return normalizedSavedId
    ? models?.find((model) => model.id === normalizedSavedId)
    : defaultPublishedModel(models);
}

/**
 * A saved model id is user data, so it is never treated like an empty choice.
 * Only a node that has never saved a model may inherit the current default.
 */
export function resolvePublishedModelSelection({
  models,
  savedId,
  savedName,
  status,
}: {
  models: PublishedModel[] | undefined;
  savedId?: string;
  savedName?: string;
  status: ModelCatalogStatus;
}): PublishedModelSelection {
  const normalizedSavedId = savedId?.trim() || undefined;
  const normalizedSavedName = savedName?.trim() || undefined;
  if (normalizedSavedId) {
    const savedModel = resolvePublishedModel(models, normalizedSavedId);
    if (savedModel) {
      return {
        displayName: savedModel.displayName,
        model: savedModel,
        savedModelUnavailable: false,
        selectedId: savedModel.id,
        unavailableReason: savedModel.generationAvailable === false
          ? savedModel.generationUnavailableReason || "当前模型暂不可生成"
          : "",
      };
    }
    return {
      displayName: normalizedSavedName ?? "原模型",
      savedModelUnavailable: status === "ready",
      selectedId: normalizedSavedId,
      unavailableReason: status === "ready"
        ? SAVED_MODEL_UNAVAILABLE_REASON
        : "",
    };
  }

  const model = resolvePublishedModel(models);
  return {
    displayName: model?.displayName,
    model,
    savedModelUnavailable: false,
    selectedId: model?.id,
    unavailableReason: model?.generationAvailable === false
      ? model.generationUnavailableReason || "当前模型暂不可生成"
      : "",
  };
}

export function usePublishedModelSelection(
  capability: ModelCapability,
  savedId?: string,
  savedName?: string,
) {
  const catalog = useContext(ModelCatalogContext);
  const models = catalog?.models?.filter(
    (model) => model.capability === capability,
  );
  const status = catalog?.status ?? "error";
  return {
    models,
    status,
    ...resolvePublishedModelSelection({ models, savedId, savedName, status }),
  };
}
