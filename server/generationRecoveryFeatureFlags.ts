/** Additive maintenance is opt-in; disabling it never disables V3 recovery. */
export function generationRecoveryCasesEnabled() {
  return process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED === "1";
}
