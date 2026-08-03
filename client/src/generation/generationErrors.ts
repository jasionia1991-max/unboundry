const historicalPreTaskConfigurationErrors = new Set([
  "Generation provider is not configured",
]);

/**
 * Old clients persisted a server configuration rejection as if a paid task
 * had failed. Hide only the exact known pre-task message; real task failures
 * and media errors remain untouched.
 */
export function visibleGenerationError(value: string | undefined) {
  const message = value?.trim() ?? "";
  return historicalPreTaskConfigurationErrors.has(message) ? "" : message;
}
