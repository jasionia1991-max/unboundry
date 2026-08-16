import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const bridgePackageVersion = "0.5.2";
const defaultStartupDeadlineMs = 20_000;

export type LegacyRuntimeTarget = Readonly<{
  host: "127.0.0.1";
  port: number;
  proxyNonce: string;
}>;

export type LegacyRuntimeLaunchContext = Readonly<{
  dataDirectory: string;
  runtimeDirectory: string;
}>;

export type LegacyRuntimeProcess = Readonly<{
  child: ChildProcess;
  nonce: string;
  target: LegacyRuntimeTarget;
  warmup: Readonly<{
    expectedDatabaseMutation: "legacy-media-checksum-backfill";
    providerRequests: 0;
  }>;
}>;

export type LegacyRuntimeLauncher = Readonly<{
  launch: (
    legacyRoot: string,
    context: LegacyRuntimeLaunchContext,
  ) => Promise<LegacyRuntimeProcess>;
}>;

export class LegacyRuntimeTerminationUnknownError extends Error {
  readonly code = "LEGACY_RUNTIME_TERMINATION_UNKNOWN";

  constructor() {
    super(
      "LEGACY_RUNTIME_TERMINATION_UNKNOWN: legacy child exit could not be confirmed",
    );
    this.name = "LegacyRuntimeTerminationUnknownError";
  }
}

function boundedDeadline(value: number | undefined) {
  if (!Number.isFinite(value)) return defaultStartupDeadlineMs;
  return Math.min(120_000, Math.max(1_000, Math.trunc(value!)));
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function controlledLegacyChildPath(runtimeDirectory: string) {
  const runtimeRoot = realpathSync(runtimeDirectory);
  const controlledPath = join(runtimeRoot, ".unboundry-legacy-no-tools");
  try {
    mkdirSync(controlledPath, { mode: 0o500 });
  } catch (error) {
    if (
      !error || typeof error !== "object" || !("code" in error) ||
      error.code !== "EEXIST"
    ) throw error;
  }
  const details = lstatSync(controlledPath);
  if (
    realpathSync(controlledPath) !== controlledPath ||
    details.isSymbolicLink() || !details.isDirectory() ||
    typeof process.getuid !== "function" || details.uid !== process.getuid() ||
    (details.mode & 0o777) !== 0o500 ||
    readdirSync(controlledPath).length !== 0
  ) {
    throw new Error(
      "LEGACY_RUNTIME_PATH_UNSAFE: controlled child PATH must be an empty owned directory",
    );
  }
  return controlledPath;
}

export function validatedLegacyRuntimeRoot(rawRoot: string) {
  if (!rawRoot || !isAbsolute(rawRoot) || resolve(rawRoot) !== rawRoot) {
    throw new Error(
      "LEGACY_RUNTIME_ROOT_UNSAFE: legacy runtime root must be a normalized absolute path",
    );
  }
  const root = realpathSync(rawRoot);
  const details = lstatSync(rawRoot);
  if (
    root !== rawRoot || details.isSymbolicLink() || !details.isDirectory() ||
    typeof process.getuid !== "function" || details.uid !== process.getuid() ||
    (details.mode & 0o022) !== 0
  ) {
    throw new Error(
      "LEGACY_RUNTIME_ROOT_UNSAFE: legacy runtime root must be an owned physical directory",
    );
  }
  const packagePath = join(root, "package.json");
  const packageDetails = lstatSync(packagePath);
  if (
    packageDetails.isSymbolicLink() || !packageDetails.isFile() ||
    packageDetails.nlink !== 1 || packageDetails.uid !== process.getuid() ||
    (packageDetails.mode & 0o022) !== 0
  ) {
    throw new Error("LEGACY_RUNTIME_ROOT_UNSAFE: legacy package is unsafe");
  }
  let packageDocument: { version?: unknown };
  try {
    packageDocument = JSON.parse(readFileSync(packagePath, "utf8")) as {
      version?: unknown;
    };
  } catch {
    throw new Error("LEGACY_RUNTIME_INVALID: legacy package is unreadable");
  }
  const exactSafeTestRuntime = process.env.UNBOUNDRY_SAFE_TEST === "1" &&
    process.env.UNBOUNDRY_V051_RUNTIME_ROOT === root &&
    packageDocument.version === "0.5.1";
  if (packageDocument.version !== bridgePackageVersion && !exactSafeTestRuntime) {
    throw new Error(
      `LEGACY_RUNTIME_INVALID: expected bridge v${bridgePackageVersion} legacy package overlay`,
    );
  }
  const releaseRoot = realpathSync(resolve(root, ".."));
  if (!exactSafeTestRuntime && join(releaseRoot, "legacy-runtime") !== root) {
    throw new Error(
      "LEGACY_RUNTIME_ROOT_UNSAFE: legacy runtime must be the release legacy-runtime child",
    );
  }
  const rootIdentity = lstatSync(root, { bigint: true });
  const releaseIdentity = lstatSync(releaseRoot, { bigint: true });
  if (
    rootIdentity.isSymbolicLink() || !rootIdentity.isDirectory() ||
    releaseIdentity.isSymbolicLink() || !releaseIdentity.isDirectory() ||
    rootIdentity.uid !== BigInt(process.getuid()) ||
    releaseIdentity.uid !== BigInt(process.getuid()) ||
    (rootIdentity.mode & 0o022n) !== 0n ||
    (releaseIdentity.mode & 0o022n) !== 0n
  ) {
    throw new Error("LEGACY_RUNTIME_ROOT_UNSAFE: release identity is unsafe");
  }
  for (const required of [
    "client",
    "dist/client/index.html",
    ...(exactSafeTestRuntime ? ["node_modules/vite/package.json"] : []),
    "server",
    "vite.config.ts",
  ]) {
    const path = realpathSync(join(root, required));
    if (!containsPath(root, path)) {
      throw new Error("LEGACY_RUNTIME_ROOT_UNSAFE: legacy input escaped its root");
    }
    const input = lstatSync(path);
    if (
      input.isSymbolicLink() || input.uid !== process.getuid() ||
      (input.mode & 0o022) !== 0
    ) {
      throw new Error("LEGACY_RUNTIME_ROOT_UNSAFE: legacy input is unsafe");
    }
  }
  for (const required of exactSafeTestRuntime ? [] : [
    "node_modules/@vitejs/plugin-react/package.json",
    "node_modules/vite/package.json",
  ]) {
    const path = realpathSync(join(releaseRoot, required));
    if (!containsPath(releaseRoot, path)) {
      throw new Error(
        "LEGACY_RUNTIME_ROOT_UNSAFE: shared runtime dependency escaped release root",
      );
    }
    const input = lstatSync(path);
    if (
      input.isSymbolicLink() || !input.isFile() || input.nlink !== 1 ||
      input.uid !== process.getuid() || (input.mode & 0o022) !== 0
    ) {
      throw new Error(
        "LEGACY_RUNTIME_ROOT_UNSAFE: shared runtime dependency is unsafe",
      );
    }
  }
  // Close path-replacement windows after walking every required descendant.
  const rootAfter = lstatSync(root, { bigint: true });
  const releaseAfter = lstatSync(releaseRoot, { bigint: true });
  if (
    rootAfter.dev !== rootIdentity.dev || rootAfter.ino !== rootIdentity.ino ||
    rootAfter.uid !== rootIdentity.uid || rootAfter.mode !== rootIdentity.mode ||
    releaseAfter.dev !== releaseIdentity.dev ||
    releaseAfter.ino !== releaseIdentity.ino ||
    releaseAfter.uid !== releaseIdentity.uid ||
    releaseAfter.mode !== releaseIdentity.mode
  ) {
    throw new Error(
      "LEGACY_RUNTIME_ROOT_UNSAFE: release identity changed during validation",
    );
  }
  return root;
}

export function createLegacyRuntimeLauncher(
  options: Readonly<{
    childEnvironment?: NodeJS.ProcessEnv;
    launcherPath?: string;
    skipRuntimeRootValidation?: boolean;
    startupDeadlineMs?: number;
  }> = {},
): LegacyRuntimeLauncher {
  const startupDeadlineMs = boundedDeadline(options.startupDeadlineMs);
  const launcherPath = options.launcherPath ?? fileURLToPath(
    new URL("./legacyRuntimeChild.mjs", import.meta.url),
  );

  async function launch(
    rawLegacyRoot: string,
    context: LegacyRuntimeLaunchContext,
  ): Promise<LegacyRuntimeProcess> {
    const legacyRoot = options.skipRuntimeRootValidation
      ? rawLegacyRoot
      : validatedLegacyRuntimeRoot(rawLegacyRoot);
    const nonce = randomUUID();
    const proxyNonce = randomBytes(32).toString("hex");
    const controlledPath = controlledLegacyChildPath(context.runtimeDirectory);
    const childEnvironment = {
      ...process.env,
      ...(options.childEnvironment ?? {}),
    };
    delete childEnvironment.UNBOUNDRY_LEGACY_RUNTIME_ROOT;
    delete childEnvironment.UNBOUNDRY_PORT;
    delete childEnvironment.UNBOUNDRY_RELEASE_ROLE;
    childEnvironment.UNBOUNDRY_LEGACY_CHILD = "1";
    childEnvironment.UNBOUNDRY_LEGACY_PARENT_PID = String(process.pid);
    childEnvironment.UNBOUNDRY_DATA_DIR = context.dataDirectory;
    childEnvironment.UNBOUNDRY_RUNTIME_DIR = context.runtimeDirectory;
    // Exact v0.5.1 performs a best-effort ffprobe duration migration during
    // startup. An empty, release-controlled PATH makes that probe unavailable
    // while leaving checksum backfill enabled for the bridge warm-up.
    childEnvironment.PATH = controlledPath;
    // The parent supplies one validated client/protocol chain. The exact child
    // must consume that rebuilt chain instead of treating the parent loopback
    // socket as the browser identity.
    childEnvironment.UNBOUNDRY_TRUST_PROXY = "1";
    const safeTest = childEnvironment.UNBOUNDRY_SAFE_TEST === "1";
    if (safeTest) {
      // Vite's production preview rejects test-only variables. Translate the
      // runner-attested port to a launcher-private name after config setup.
      childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST = "1";
      childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST_PORT = String(
        childEnvironment.UNBOUNDRY_TEST_AUX_PORT ?? "",
      );
      childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST_EXACT_ROOT = legacyRoot;
    } else {
      delete childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST;
      delete childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST_PORT;
      delete childEnvironment.UNBOUNDRY_LEGACY_SAFE_TEST_EXACT_ROOT;
    }
    const child = fork(launcherPath, [legacyRoot, nonce], {
      cwd: legacyRoot,
      env: childEnvironment,
      execArgv: [],
      execPath: process.execPath,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    // The same-host proxy capability must never appear in argv, environment,
    // logs, or a filesystem object. Deliver it only over the anonymous IPC
    // channel that fork created; the child will not import Vite before receipt.
    let initializationError: Error | undefined;
    child.send({ nonce, proxyNonce, type: "initialize" }, (error) => {
      if (!error) return;
      initializationError = new Error(
        "LEGACY_RUNTIME_START_FAILED: private proxy capability IPC failed",
      );
      try {
        child.kill("SIGKILL");
      } catch {}
    });
    // An abnormal parent exit must not leave an unsupervised schema-37 writer.
    const killAtParentExit = () => {
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    process.once("exit", killAtParentExit);

    try {
      const target = await new Promise<LegacyRuntimeTarget>((accept, reject) => {
        let settled = false;
        const finish = (
          error?: Error,
          ready?: LegacyRuntimeTarget,
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          child.removeListener("error", onError);
          child.removeListener("exit", onExit);
          child.removeListener("message", onMessage);
          if (error) reject(error);
          else accept(ready!);
        };
        const onError = () => finish(new Error(
          "LEGACY_RUNTIME_START_FAILED: legacy child process failed",
        ));
        const onExit = () => finish(new Error(
          initializationError?.message ??
            "LEGACY_RUNTIME_START_FAILED: legacy child exited before readiness",
        ));
        const onMessage = (message: unknown) => {
          if (!message || typeof message !== "object") return;
          const record = message as Record<string, unknown>;
          if (record.nonce !== nonce) return;
          if (record.type === "failed") {
            finish(new Error(
              "LEGACY_RUNTIME_START_FAILED: legacy child rejected startup",
            ));
            return;
          }
          if (
            record.type !== "ready" || record.host !== "127.0.0.1" ||
            record.databaseWarmup !== "legacy-media-checksum-backfill" ||
            record.providerRequests !== 0 ||
            !Number.isInteger(record.port) || Number(record.port) < 1 ||
            Number(record.port) > 65_535
          ) return;
          finish(undefined, Object.freeze({
            host: "127.0.0.1",
            port: Number(record.port),
            proxyNonce,
          }));
        };
        const timeout = setTimeout(() => finish(new Error(
          "LEGACY_RUNTIME_START_TIMEOUT: legacy child did not become ready",
        )), startupDeadlineMs);
        child.once("error", onError);
        child.once("exit", onExit);
        child.on("message", onMessage);
      });
      child.once("exit", () => process.removeListener("exit", killAtParentExit));
      return Object.freeze({
        child,
        nonce,
        target,
        warmup: Object.freeze({
          expectedDatabaseMutation: "legacy-media-checksum-backfill" as const,
          providerRequests: 0 as const,
        }),
      });
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch {}
      if (child.exitCode === null && child.signalCode === null) {
        const exited = await Promise.race([
          new Promise<true>((resolve) => child.once("exit", () => resolve(true))),
          new Promise<false>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5_000);
            timeout.unref?.();
          }),
        ]);
        if (!exited) throw new LegacyRuntimeTerminationUnknownError();
      }
      process.removeListener("exit", killAtParentExit);
      throw error;
    }
  }

  return Object.freeze({ launch });
}
