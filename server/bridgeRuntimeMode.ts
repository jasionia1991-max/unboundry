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
        packageVersion === "0.6.16"
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
