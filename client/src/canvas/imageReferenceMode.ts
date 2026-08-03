import {
  resolvePublishedModel,
  type PublishedModel,
} from "../models/ModelCatalog";
import {
  normalizeParameterValues,
  parameterFieldEnabled,
  parameterOptionEnabled,
} from "../../../types/modelParameters";
import type { ProbeNodeType } from "./ProbeNode";

/**
 * Select the model's real Image-reference mode without deleting any edge or
 * replacing other saved parameters. The same rule is used when an edge is
 * created and when an already-connected source finishes uploading.
 */
export function withImageReferenceInputMode(
  node: ProbeNodeType,
  imageModels: PublishedModel[] | undefined,
): ProbeNodeType {
  if (node.type !== "image") return node;
  const model = resolvePublishedModel(imageModels, node.data.imageModelId);
  const schema = model?.parameterSchema;
  if (!schema) return node;
  const parameters = normalizeParameterValues(schema, node.data.imageParameters);
  const inputMode = schema.fields.find((field) => field.key === "inputMode");
  const imageMode = inputMode?.options.find((option) => option.value === "image");
  if (
    !inputMode ||
    !imageMode ||
    (imageMode.availability ?? "available") !== "available" ||
    !parameterFieldEnabled(inputMode, parameters) ||
    !parameterOptionEnabled(imageMode, parameters) ||
    String(parameters.inputMode ?? inputMode.defaultValue) !== "text"
  ) {
    return node;
  }
  return {
    ...node,
    data: {
      ...node.data,
      imageParameters: {
        ...node.data.imageParameters,
        inputMode: "image",
      },
    },
  };
}
