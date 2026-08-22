export const generationCapabilityKinds = [
  "text",
  "image",
  "video",
  "audio",
] as const;

export const persistedNodeKinds = [
  "audio",
  "group",
  "image",
  "playlist",
  "probe",
  "storyboard",
  "text",
  "video",
] as const;

export const templateNodeKinds = [
  "audio",
  "group",
  "image",
  "playlist",
  "storyboard",
  "text",
  "video",
] as const;

export const canvasNodeKinds = persistedNodeKinds;

export type GenerationCapabilityKind =
  (typeof generationCapabilityKinds)[number];
export type PersistedNodeKind = (typeof persistedNodeKinds)[number];
export type TemplateNodeKind = (typeof templateNodeKinds)[number];
export type CanvasNodeKind = (typeof canvasNodeKinds)[number];

export function isGenerationCapabilityKind(
  value: unknown,
): value is GenerationCapabilityKind {
  return generationCapabilityKinds.includes(value as GenerationCapabilityKind);
}

export function isPersistedNodeKind(value: unknown): value is PersistedNodeKind {
  return persistedNodeKinds.includes(value as PersistedNodeKind);
}

export function isTemplateNodeKind(value: unknown): value is TemplateNodeKind {
  return templateNodeKinds.includes(value as TemplateNodeKind);
}
