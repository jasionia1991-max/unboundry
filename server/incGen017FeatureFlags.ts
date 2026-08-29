function enabled(value: string | undefined) {
  return value !== "0" && value !== "false";
}

/**
 * Temporary INC-GEN-017 stop-loss switches. Disabling either switch never
 * re-enables an unregistered model and never changes paid retry fences.
 */
export function incGen017FeatureFlags() {
  return Object.freeze({
    modelInputContractV2: enabled(
      process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2,
    ),
    workflowSelfHealingV2: enabled(
      process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2,
    ),
  });
}

export function incGen017GenerationEnabled() {
  const flags = incGen017FeatureFlags();
  return flags.modelInputContractV2 && flags.workflowSelfHealingV2;
}
