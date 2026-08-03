export const providerProtocols = [
  "native",
  "openai-chat",
  "openai-responses",
  "claude-messages",
  "gemini-generate-content",
  "gpt-image",
  "media-generate",
] as const;

export type ProviderProtocol = (typeof providerProtocols)[number];

export const relayProviderProtocols = providerProtocols.filter(
  (protocol): protocol is Exclude<ProviderProtocol, "native"> =>
    protocol !== "native",
);

export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === "string" &&
    providerProtocols.includes(value as ProviderProtocol);
}

export function providerProtocolCapabilities(
  protocol: ProviderProtocol,
): readonly ("audio" | "image" | "text" | "video")[] {
  if (
    protocol === "openai-chat" ||
    protocol === "openai-responses" ||
    protocol === "claude-messages" ||
    protocol === "gemini-generate-content"
  ) {
    return ["text"];
  }
  if (protocol === "gpt-image") return ["image"];
  if (protocol === "media-generate") return ["image", "video", "audio"];
  return ["text", "image", "video", "audio"];
}

export function providerProtocolSupportsCapability(
  protocol: ProviderProtocol,
  capability: "audio" | "image" | "text" | "video",
) {
  return providerProtocolCapabilities(protocol).includes(capability);
}
