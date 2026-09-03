import type { RuntimeRole } from "./runtimeRole.ts";

export const releaseRoles = Object.freeze(["bridge", "final"] as const);

export type ReleaseRole = (typeof releaseRoles)[number];

export type BridgeRuntimeMode = "current" | "legacy-schema37";

type SchemaProbe =
  | Readonly<{ ok: false }>
  | Readonly<{ ok: true; schemaVersion: number; standby: boolean }>;

export function releaseRoleFromEnvironment(
  packageVersion: string,
  environment: NodeJS.ProcessEnv = process.env,
): ReleaseRole {
  const packageRole = packageVersion === "0.5.2"
    ? "bridge"
    : packageVersion === "0.6.0" || packageVersion === "0.6.1" ||
        packageVersion === "0.6.2" || packageVersion === "0.6.3" ||
        packageVersion === "0.6.4" || packageVersion === "0.6.5" ||
        packageVersion === "0.6.6" || packageVersion === "0.6.7" ||
        packageVersion === "0.6.8" ||
        packageVersion === "0.6.9" ||
        packageVersion === "0.6.10" ||
        packageVersion === "0.6.11" ||
        packageVersion === "0.6.12" ||
        packageVersion === "0.6.13" ||
        packageVersion === "0.6.14" ||
        packageVersion === "0.6.15" ||
        packageVersion === "0.6.16" ||
        packageVersion === "0.6.17" ||
        packageVersion === "0.6.18" ||
        packageVersion === "0.6.19" ||
        packageVersion === "0.6.20" ||
        packageVersion === "0.6.21" ||
        packageVersion === "0.6.22" ||
        packageVersion === "0.6.23" ||
        packageVersion === "0.6.24" ||
        packageVersion === "0.6.25" ||
        packageVersion === "0.6.26" ||
        packageVersion === "0.6.27" ||
        packageVersion === "0.6.28" ||
        packageVersion === "0.6.29" ||
        packageVersion === "0.6.30" ||
        packageVersion === "0.6.31" ||
        packageVersion === "0.6.32" ||
        packageVersion === "0.6.33" ||
        packageVersion === "0.6.34" ||
        packageVersion === "0.6.35" ||
        packageVersion === "0.6.36" ||
        packageVersion === "0.6.37" ||
        packageVersion === "0.6.38" ||
        packageVersion === "0.6.39" ||
        packageVersion === "0.6.40" ||
        packageVersion === "0.6.41" ||
        packageVersion === "0.6.42" ||
        packageVersion === "0.6.43" ||
        packageVersion === "0.6.44" ||
        packageVersion === "0.6.45" ||
        packageVersion === "0.6.46" ||
        packageVersion === "0.6.47" ||
        packageVersion === "0.6.48" || packageVersion === "0.6.49" || packageVersion === "0.6.50" ||
        packageVersion === "0.6.51" || packageVersion === "0.6.52" ||
        packageVersion === "0.6.53" || packageVersion === "0.6.54" ||
        packageVersion === "0.6.55" || packageVersion === "0.6.56" ||
        packageVersion === "0.6.57" || packageVersion === "0.6.58" ||
        packageVersion === "0.6.60" || packageVersion === "0.6.61" ||
        packageVersion === "0.6.62" || packageVersion === "0.6.63" ||
        packageVersion === "0.6.64" || packageVersion === "0.6.65" ||
        packageVersion === "0.6.66" || packageVersion === "0.6.67" ||
        packageVersion === "0.6.68" || packageVersion === "0.6.69" ||
        packageVersion === "0.6.70" || packageVersion === "0.7.0" ||
        packageVersion === "0.7.1" || packageVersion === "0.7.2" ||
        packageVersion === "0.7.3" || packageVersion === "0.7.4" ||
        packageVersion === "0.7.5" || packageVersion === "0.7.6" ||
        packageVersion === "0.7.7"
      ? "final"
      : undefined;
  if (!packageRole) {
    throw new Error(
      "UNBOUNDRY_RELEASE_VERSION_INVALID: runtime package version is not a release role",
    );
  }
  const raw = environment.UNBOUNDRY_RELEASE_ROLE;
  if (raw === undefined) return packageRole;
  if (!releaseRoles.includes(raw as ReleaseRole)) {
    throw new Error(
      "UNBOUNDRY_RELEASE_ROLE_INVALID: UNBOUNDRY_RELEASE_ROLE must be bridge or final",
    );
  }
  if (raw !== packageRole) {
    throw new Error(
      "UNBOUNDRY_RELEASE_ROLE_MISMATCH: environment conflicts with runtime package version",
    );
  }
  return packageRole;
}

/**
 * A bridge delegates only an exact, already-existing schema-37 database to the
 * frozen v0.5.1 runtime. Every other database shape remains owned by the
 * current lifecycle, which already fails closed for unknown or incomplete
 * schemas. Non-active processes never launch a legacy writer.
 */
export function bridgeRuntimeMode(input: Readonly<{
  probe: SchemaProbe;
  releaseRole: ReleaseRole;
  runtimeRole: RuntimeRole;
}>): BridgeRuntimeMode {
  return input.releaseRole === "bridge" && input.runtimeRole === "active" &&
      input.probe.ok && input.probe.schemaVersion === 37 && input.probe.standby
    ? "legacy-schema37"
    : "current";
}
