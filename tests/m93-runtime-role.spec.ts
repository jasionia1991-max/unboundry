import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { createRuntimeLifecycle } from "../server/runtimeLifecycle";
import {
  assertStoppedProcessProof,
  createRuntimeDrainRegistry,
  createRuntimeRoleCoordinator,
  RuntimeRoleError,
  runtimeRoleFromEnvironment,
} from "../server/runtimeRole";
import {
  generationRecoverySweepTimerStateForRuntimeTest,
  prepareGenerationRuntimeRoleTeardown,
  registerGenerationRuntimeRoleCoordinator,
  runGenerationExecutionForRuntimeTest,
  startAllowlistedLegacyTerminalDetachSweepForRuntimeTest,
} from "../server/generationTasks";

test.describe.configure({ mode: "serial" });

const activeRoleChildBootstrap = String.raw`
  import { createServer } from "vite";
  import { DatabaseSync } from "node:sqlite";

  const [dataDirectory, runtimeDirectory] = process.argv.slice(1);
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { hmr: false, middlewareMode: true, ws: false },
  });
  try {
    const module = await server.ssrLoadModule("/server/runtimeRole.ts");
    const lifecycleModule = await server.ssrLoadModule(
      "/server/runtimeLifecycle.ts"
    );
    const coordinator = module.createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    globalThis.__runtimeRoleCoordinator = coordinator;
    process.send?.({ snapshot: coordinator.snapshot(), type: "acquired" });
    process.on("message", async (message) => {
      if (message?.action === "snapshot") {
        process.send?.({
          action: message.action,
          snapshot: coordinator.snapshot(),
          type: "action",
        });
      }
      if (message?.action === "close-failure") {
        const originalClose = DatabaseSync.prototype.close;
        let code;
        DatabaseSync.prototype.close = function () {
          throw new Error("M93 injected close failure");
        };
        try {
          coordinator.close();
        } catch (error) {
          code = error && typeof error === "object" && "code" in error
            ? String(error.code)
            : undefined;
        } finally {
          DatabaseSync.prototype.close = originalClose;
        }
        process.send?.({
          action: message.action,
          code,
          snapshot: coordinator.snapshot(),
          type: "action",
        });
      }
      if (message?.action === "drain-timeout") {
        let code;
        const execution = coordinator.runDetached(
          "provider-request",
          () => new Promise(() => {}),
        );
        globalThis.__runtimeRoleExecution = execution;
        try {
          await coordinator.shutdown(0);
        } catch (error) {
          code = error && typeof error === "object" && "code" in error
            ? String(error.code)
            : undefined;
        }
        process.send?.({
          action: message.action,
          code,
          snapshot: coordinator.snapshot(),
          type: "action",
        });
      }
      if (message?.action === "lifecycle-timeout") {
        const execution = coordinator.runDetached(
          "provider-request",
          () => new Promise(() => {}),
        );
        globalThis.__runtimeRoleExecution = execution;
        const lifecycle = lifecycleModule.createRuntimeLifecycle({
          dataDirectory,
          logger: () => undefined,
          roleCoordinator: coordinator,
          shutdownDeadlineMs: 0,
        });
        let closeCalls = 0;
        let forceCloseCalls = 0;
        const exitCode = await lifecycleModule.coordinateRuntimeShutdown({
          beginShutdown: () => lifecycle.beginShutdown(),
          close: () => { closeCalls += 1; },
          closeAllConnections: () => { forceCloseCalls += 1; },
          deadlineMs: 0,
          hardExitGraceMs: 20,
        });
        process.send?.({
          action: message.action,
          closeCalls,
          exitCode,
          forceCloseCalls,
          snapshot: coordinator.snapshot(),
          type: "action",
        });
      }
    });
    setInterval(() => {}, 1_000);
  } catch (error) {
    process.send?.({
      code: error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined,
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
    await server.close();
    process.exit(2);
  }
`;

type ChildRoleMessage =
  | { snapshot: { activeLeaseHeld: boolean; role: string }; type: "acquired" }
  | {
      action:
        | "close-failure"
        | "drain-timeout"
        | "lifecycle-timeout"
        | "snapshot";
      closeCalls?: number;
      code?: string;
      exitCode?: number;
      forceCloseCalls?: number;
      snapshot: {
        activeLeaseHeld: boolean;
        draining: boolean;
        leaseState: string;
        role: string;
      };
      type: "action";
    }
  | { code?: string; message: string; type: "error" };

function startActiveRoleChild(dataDirectory: string, runtimeDirectory: string) {
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    activeRoleChildBootstrap,
    dataDirectory,
    runtimeDirectory,
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const ready = new Promise<ChildRoleMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Runtime role child timed out: ${stderr}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("message", (message: ChildRoleMessage) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Runtime role child exited ${code}: ${stderr}`));
    });
  });
  return { child, ready };
}

function waitForExit(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}

function childAction(
  child: ChildProcess,
  action:
    | "close-failure"
    | "drain-timeout"
    | "lifecycle-timeout"
    | "snapshot",
) {
  return new Promise<Extract<ChildRoleMessage, { type: "action" }>>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Runtime role child action ${action} timed out`));
      }, 10_000);
      const onMessage = (message: ChildRoleMessage) => {
        if (message.type !== "action" || message.action !== action) return;
        clearTimeout(timer);
        child.off("message", onMessage);
        resolve(message);
      };
      child.on("message", onMessage);
      child.send({ action }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        child.off("message", onMessage);
        reject(error);
      });
    },
  );
}

async function privateDirectories() {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m93-role-"));
  await chmod(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  await mkdir(dataDirectory, { mode: 0o700 });
  await mkdir(runtimeDirectory, { mode: 0o700 });
  return { dataDirectory, root, runtimeDirectory };
}

test("runtime roles are explicit and every non-active role denies writer capabilities", async () => {
  const paths = await privateDirectories();
  try {
    expect(runtimeRoleFromEnvironment({})).toBe("active");
    expect(runtimeRoleFromEnvironment({ UNBOUNDRY_MAINTENANCE_MODE: "1" }))
      .toBe("maintenance");
    expect(runtimeRoleFromEnvironment({ UNBOUNDRY_RUNTIME_ROLE: "standby" }))
      .toBe("standby");
    expect(runtimeRoleFromEnvironment({ UNBOUNDRY_RUNTIME_ROLE: "read-only" }))
      .toBe("read-only");
    expect(() => runtimeRoleFromEnvironment({
      UNBOUNDRY_RUNTIME_ROLE: "active",
      UNBOUNDRY_MAINTENANCE_MODE: "1",
    })).toThrow(RuntimeRoleError);
    expect(() => runtimeRoleFromEnvironment({
      UNBOUNDRY_RUNTIME_ROLE: "writer-primary",
    })).toThrow(RuntimeRoleError);
    expect(() => runtimeRoleFromEnvironment({
      UNBOUNDRY_MAINTENANCE_MODE: "true",
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_INVALID" }));
    expect(() => runtimeRoleFromEnvironment({
      UNBOUNDRY_MAINTENANCE_MODE: "",
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_INVALID" }));

    for (const role of ["standby", "maintenance", "read-only"] as const) {
      const coordinator = createRuntimeRoleCoordinator({
        dataDirectory: paths.dataDirectory,
        role,
      });
      expect(coordinator.snapshot()).toMatchObject({
        activeLeaseHeld: false,
        draining: false,
        role,
      });
      expect(() => coordinator.assertActive("writer")).toThrow(
        expect.objectContaining({ code: "RUNTIME_ROLE_NOT_ACTIVE" }),
      );
      coordinator.close();
    }
  } finally {
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("quiesced preservation reuses an existing lease and requires a stopped-process proof", async () => {
  const paths = await privateDirectories();
  let owner: ChildProcess | undefined;
  let coordinator: ReturnType<typeof createRuntimeRoleCoordinator> | undefined;
  try {
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      requireExistingLease: true,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));
    const ordinaryCoordinator = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    expect(() => ordinaryCoordinator.assertLeaseHeldForBackup()).toThrow(
      expect.objectContaining({ code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE" }),
    );
    ordinaryCoordinator.close();

    const initial = startActiveRoleChild(paths.dataDirectory, paths.runtimeDirectory);
    owner = initial.child;
    await expect(initial.ready).resolves.toMatchObject({
      snapshot: { activeLeaseHeld: true, role: "active" },
      type: "acquired",
    });
    owner.kill("SIGTERM");
    await waitForExit(owner);
    owner = undefined;

    coordinator = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      requireExistingLease: true,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    const probe = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ], { stdio: "ignore" });
    try {
      const pid = probe.pid;
      expect(pid).toBeGreaterThan(1);
      probe.kill("SIGKILL");
      await waitForExit(probe);
      const pidNamespace = process.platform === "linux"
        ? await readlink("/proc/self/ns/pid")
        : `${process.platform}:host`;
      expect(() => assertStoppedProcessProof({
        pid: pid!,
        pidNamespace: "different-namespace",
        startTicks: "1",
      })).toThrow(expect.objectContaining({ code: "RUNTIME_STOP_PROOF_INVALID" }));
      expect(assertStoppedProcessProof({
        pid: pid!,
        pidNamespace,
        startTicks: "1",
      })).toMatchObject({ pid, pidNamespace, startTicks: "1" });

      await expect(coordinator.beginDrain(1_000)).resolves.toEqual({
        activeExecutions: 0,
        drained: true,
      });
      expect(coordinator.assertLeaseHeldForBackup()).toMatchObject({
        dataDirectory: paths.dataDirectory,
        runtimeDirectory: paths.runtimeDirectory,
      });
    } finally {
      if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
      await waitForExit(probe).catch(() => undefined);
    }
    coordinator.releaseAfterDrain();
    coordinator = undefined;
  } finally {
    owner?.kill("SIGKILL");
    if (owner) await waitForExit(owner).catch(() => undefined);
    if (coordinator) {
      try {
        coordinator.close();
      } catch {}
    }
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("only one process owns active and a crashed owner releases the SQLite lease", async () => {
  const paths = await privateDirectories();
  let child: ChildProcess | undefined;
  try {
    const first = startActiveRoleChild(paths.dataDirectory, paths.runtimeDirectory);
    child = first.child;
    await expect(first.ready).resolves.toMatchObject({
      snapshot: { activeLeaseHeld: true, role: "active" },
      type: "acquired",
    });

    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    }));

    await expect(childAction(child, "close-failure")).resolves.toMatchObject({
      action: "close-failure",
      code: "RUNTIME_ACTIVE_LEASE_RELEASE_UNKNOWN",
      snapshot: {
        activeLeaseHeld: false,
        draining: true,
        leaseState: "release-unknown",
      },
      type: "action",
    });
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    }));

    child.kill("SIGKILL");
    await waitForExit(child);
    child = undefined;

    const timedOutOwner = startActiveRoleChild(
      paths.dataDirectory,
      paths.runtimeDirectory,
    );
    child = timedOutOwner.child;
    await expect(timedOutOwner.ready).resolves.toMatchObject({
      snapshot: { activeLeaseHeld: true, role: "active" },
      type: "acquired",
    });
    await expect(childAction(child, "drain-timeout")).resolves.toMatchObject({
      action: "drain-timeout",
      code: "RUNTIME_DRAIN_TIMEOUT",
      snapshot: {
        activeLeaseHeld: true,
        draining: true,
        leaseState: "held",
      },
      type: "action",
    });
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    }));
    child.kill("SIGKILL");
    await waitForExit(child);
    child = undefined;

    const identityOwner = startActiveRoleChild(
      paths.dataDirectory,
      paths.runtimeDirectory,
    );
    child = identityOwner.child;
    await expect(identityOwner.ready).resolves.toMatchObject({
      snapshot: { activeLeaseHeld: true, role: "active" },
      type: "acquired",
    });
    const leaseHardlink = join(paths.root, "active-role-hardlink");
    await link(
      join(paths.runtimeDirectory, "active-role.sqlite"),
      leaseHardlink,
    );
    await expect(childAction(child, "snapshot")).resolves.toMatchObject({
      action: "snapshot",
      snapshot: {
        activeLeaseHeld: false,
        draining: true,
        leaseState: "lost",
      },
      type: "action",
    });
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));
    child.kill("SIGKILL");
    await waitForExit(child);
    child = undefined;
    await rm(leaseHardlink);

    const replacement = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    expect(replacement.snapshot().activeLeaseHeld).toBe(true);
    replacement.close();

    const afterCleanRelease = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    expect(afterCleanRelease.snapshot().activeLeaseHeld).toBe(true);
    afterCleanRelease.close();
  } finally {
    child?.kill("SIGKILL");
    if (child) await waitForExit(child).catch(() => undefined);
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("runtime directory, lease file and data identity attacks fail closed", async () => {
  const paths = await privateDirectories();
  try {
    const unsafeTarget = join(paths.root, "unsafe-runtime-target");
    const unsafeLink = join(paths.root, "unsafe-runtime-link");
    await mkdir(unsafeTarget, { mode: 0o700 });
    await symlink(unsafeTarget, unsafeLink);
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: unsafeLink,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));

    await chmod(paths.runtimeDirectory, 0o777);
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));
    await chmod(paths.runtimeDirectory, 0o700);

    const nestedRuntime = join(paths.dataDirectory, "runtime");
    await mkdir(nestedRuntime, { mode: 0o700 });
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: nestedRuntime,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));
    await rm(nestedRuntime, { recursive: true });

    const leaseTarget = join(paths.root, "lease-target");
    await writeFile(leaseTarget, "not-a-lease", { mode: 0o600 });
    await symlink(leaseTarget, join(paths.runtimeDirectory, "active-role.sqlite"));
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_PATH_UNSAFE" }));
    await rm(join(paths.runtimeDirectory, "active-role.sqlite"));

    const coordinator = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    const original = join(paths.root, "data-original");
    await rename(paths.dataDirectory, original);
    await mkdir(paths.dataDirectory, { mode: 0o700 });
    expect(() => coordinator.assertActive("provider-request")).toThrow(
      expect.objectContaining({ code: "RUNTIME_ACTIVE_LEASE_LOST" }),
    );
    expect(() => coordinator.close()).toThrow(
      expect.objectContaining({ code: "RUNTIME_ACTIVE_LEASE_LOST" }),
    );
  } finally {
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("detached work drain closes admission, aborts once and waits for persistence", async () => {
  const registry = createRuntimeDrainRegistry();
  let aborts = 0;
  let persisted = false;
  let settle!: () => void;
  const execution = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let started = 0;
  const tracked = registry.run(() => {
    started += 1;
    return execution;
  }, () => {
    aborts += 1;
    persisted = true;
    settle();
  });

  await expect(registry.beginDrain(1_000)).resolves.toEqual({
    activeExecutions: 0,
    drained: true,
  });
  expect(aborts).toBe(1);
  expect(started).toBe(1);
  expect(persisted).toBe(true);
  expect(registry.size()).toBe(0);
  let rejectedStart = 0;
  expect(() => registry.run(() => {
    rejectedStart += 1;
    return Promise.resolve();
  })).toThrow(
    expect.objectContaining({ code: "RUNTIME_ROLE_DRAINING" }),
  );
  expect(rejectedStart).toBe(0);
  await tracked;

  const timeoutRegistry = createRuntimeDrainRegistry();
  let finishTimedOut!: () => void;
  const timedOutExecution = timeoutRegistry.run(() => new Promise<void>(
    (resolve) => {
      finishTimedOut = resolve;
    },
  ));
  await expect(timeoutRegistry.beginDrain(0)).resolves.toEqual({
    activeExecutions: 1,
    drained: false,
  });
  finishTimedOut();
  await timedOutExecution;
  await expect.poll(() => timeoutRegistry.size()).toBe(0);

  const paths = await privateDirectories();
  try {
    const coordinator = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    let releaseExecution!: () => void;
    let coordinatedAborts = 0;
    const pending = coordinator.runDetached(
      "provider-request",
      () => new Promise<void>((resolve) => {
        releaseExecution = resolve;
      }),
      () => {
        coordinatedAborts += 1;
        releaseExecution();
      },
    );
    expect(() => coordinator.close()).toThrow(
      expect.objectContaining({ code: "RUNTIME_ROLE_DRAINING" }),
    );
    await expect(coordinator.shutdown(1_000)).resolves.toEqual({
      activeExecutions: 0,
      drained: true,
      leaseReleased: true,
    });
    await pending;
    expect(coordinatedAborts).toBe(1);
    expect(coordinator.snapshot()).toMatchObject({
      activeLeaseHeld: false,
      draining: true,
      leaseState: "released",
    });
  } finally {
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("lifecycle freezes HTTP and generation admission before releasing the active lease", async () => {
  const paths = await privateDirectories();
  const originalDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const originalTerminalMode =
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE;
  const originalTerminalAllowlist =
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
  try {
    process.env.UNBOUNDRY_DATA_DIR = paths.dataDirectory;
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "allowlist";
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST =
      JSON.stringify([{
        accountId: "m93-terminal-owner",
        canvasId: "m93-terminal-canvas",
      }]);
    const coordinator = createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    });
    const unregister = registerGenerationRuntimeRoleCoordinator(coordinator);
    try {
      startAllowlistedLegacyTerminalDetachSweepForRuntimeTest();
      expect(generationRecoverySweepTimerStateForRuntimeTest()).toEqual({
        generation: false,
        terminalDetach: true,
      });
      let persist!: () => void;
      let generationAborts = 0;
      const generation = runGenerationExecutionForRuntimeTest(
        () => new Promise<void>((resolve) => {
          persist = resolve;
        }),
        () => {
          generationAborts += 1;
          // Abort only stops the Provider transport. Durable failure
          // persistence remains part of the tracked execution and settles
          // independently below.
        },
      );
      let releaseHandler!: () => void;
      const lifecycle = createRuntimeLifecycle({
        beforeActiveLeaseRelease: () =>
          prepareGenerationRuntimeRoleTeardown(coordinator),
        dataDirectory: paths.dataDirectory,
        logger: () => undefined,
        roleCoordinator: coordinator,
        shutdownDeadlineMs: 1_000,
      });
      const handler = lifecycle.trackHandler(() => new Promise<void>((resolve) => {
        releaseHandler = resolve;
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(typeof releaseHandler).toBe("function");
      const shutdown = lifecycle.beginShutdown();
      expect(lifecycle.getMode()).toBe("shutting-down");
      expect(coordinator.snapshot()).toMatchObject({
        activeLeaseHeld: true,
        draining: true,
        leaseState: "held",
      });
      expect(generationAborts).toBe(1);
      expect(() => coordinator.assertActive("writer")).toThrow(
        expect.objectContaining({ code: "RUNTIME_ROLE_DRAINING" }),
      );
      expect(() => runGenerationExecutionForRuntimeTest(() => Promise.resolve()))
        .toThrow(expect.objectContaining({ code: "RUNTIME_ROLE_DRAINING" }));

      releaseHandler();
      await handler;
      let settled = false;
      void shutdown.then(() => { settled = true; });
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(coordinator.snapshot().activeLeaseHeld).toBe(true);

      persist();
      await generation;
      await expect(shutdown).resolves.toEqual({
        activeHandlers: 0,
        drained: true,
        inFlightRequests: 0,
      });
      expect(generationRecoverySweepTimerStateForRuntimeTest()).toEqual({
        generation: false,
        terminalDetach: false,
      });
      expect(coordinator.snapshot()).toMatchObject({
        activeLeaseHeld: false,
        draining: true,
        leaseState: "released",
      });
      unregister();
      const nextCoordinator = createRuntimeRoleCoordinator({
        dataDirectory: paths.dataDirectory,
        role: "active",
        runtimeDirectory: paths.runtimeDirectory,
      });
      const unregisterNext = registerGenerationRuntimeRoleCoordinator(
        nextCoordinator,
      );
      await expect(runGenerationExecutionForRuntimeTest(() => undefined))
        .resolves.toBeUndefined();
      await nextCoordinator.beginDrain(1_000);
      prepareGenerationRuntimeRoleTeardown(nextCoordinator);
      nextCoordinator.releaseAfterDrain();
      unregisterNext();
    } finally {
      try {
        unregister();
      } catch {
        // The successful teardown path above already unregistered it.
      }
    }
  } finally {
    if (originalDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = originalDataDirectory;
    }
    if (originalTerminalMode === undefined) {
      delete process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE;
    } else {
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE =
        originalTerminalMode;
    }
    if (originalTerminalAllowlist === undefined) {
      delete process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
    } else {
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST =
        originalTerminalAllowlist;
    }
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("lifecycle timeout fails the shutdown coordinator and never hands off active", async () => {
  const paths = await privateDirectories();
  let child: ChildProcess | undefined;
  try {
    const owner = startActiveRoleChild(
      paths.dataDirectory,
      paths.runtimeDirectory,
    );
    child = owner.child;
    await expect(owner.ready).resolves.toMatchObject({
      snapshot: { activeLeaseHeld: true, role: "active" },
      type: "acquired",
    });
    await expect(childAction(child, "lifecycle-timeout")).resolves.toMatchObject({
      action: "lifecycle-timeout",
      closeCalls: 0,
      exitCode: 1,
      forceCloseCalls: 1,
      snapshot: {
        activeLeaseHeld: true,
        draining: true,
        leaseState: "held",
      },
      type: "action",
    });
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory: paths.dataDirectory,
      role: "active",
      runtimeDirectory: paths.runtimeDirectory,
    })).toThrow(expect.objectContaining({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    }));
  } finally {
    child?.kill("SIGKILL");
    if (child) await waitForExit(child).catch(() => undefined);
    await rm(paths.root, { force: true, recursive: true });
  }
});

test("non-active lifecycle exposes its role while denying active capabilities", async () => {
  const paths = await privateDirectories();
  try {
    for (const role of ["standby", "read-only", "maintenance"] as const) {
      const coordinator = createRuntimeRoleCoordinator({
        dataDirectory: paths.dataDirectory,
        role,
      });
      const lifecycle = createRuntimeLifecycle({
        dataDirectory: paths.dataDirectory,
        logger: () => undefined,
        roleCoordinator: coordinator,
      });
      expect(lifecycle.getMode()).toBe(role);
      expect(coordinator.snapshot()).toMatchObject({
        activeLeaseHeld: false,
        role,
      });
      expect(() => coordinator.assertActive("writer")).toThrow(
        expect.objectContaining({ code: "RUNTIME_ROLE_NOT_ACTIVE" }),
      );
    }
  } finally {
    await rm(paths.root, { force: true, recursive: true });
  }
});


const incidentEnvelopeScenario = String.raw`
  import assert from "node:assert/strict";
  import { generateKeyPairSync } from "node:crypto";
  import { access, chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { pathToFileURL } from "node:url";
  const { captureEnvelope, readAuthenticatedEnvelopeContext, verifyRestoreEnvelope } = await import(pathToFileURL(join(process.cwd(), "ops/production/incident-envelope.mjs")));
  const mode = process.argv[1];
  const root = await realpath(await mkdtemp(join(tmpdir(), "m93-incident-envelope-")));
  const sourceDir = join(root, "source");
  const targetDir = join(root, "package");
  const freshRestoreDir = join(root, "restored");
  const signing = generateKeyPairSync("ed25519");
  const recovery = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const context = { operationId: "synthetic-incident", schemaVersion: 44, states: ["outcome-unknown", "compensating"], finalCandidate: false };
  const fixture = new Map([
    ["unboundry.sqlite", Buffer.from("synthetic schema44 ledger; original attempt; no state rewriting")],
    ["library.sqlite", Buffer.from("synthetic library ledger")],
    ["media/.publication-synthetic.generating", Buffer.alloc(183777, 19)],
    ["media/ready.mp4", Buffer.from("synthetic completed media")],
    ["media/empty", Buffer.alloc(0)],
    ["oss-mirrors/synthetic-cloud-asset", Buffer.from("synthetic cloud-only media bytes")],
    ["secrets/config-master.key", Buffer.from("SYNTHETIC_MASTER_SECRET_DO_NOT_EXPOSE")],
    ["secrets/provider-profiles.enc.json", Buffer.from("SYNTHETIC_ENCRYPTED_PROFILES")],
  ]);
  const capture = (changes={}) => captureEnvelope({sourceDir, targetDir, signingPrivateKey: signing.privateKey, recoveryPublicKey: recovery.publicKey, context, ...changes});
  const restore = (changes={}) => verifyRestoreEnvelope({packageDir: targetDir, freshRestoreDir, trustedSigningPublicKey: signing.publicKey, recoveryPrivateKey: recovery.privateKey, expectedContext: context, ...changes});
  async function absent(path) { await assert.rejects(access(path)); }
  try {
    await chmod(root, 0o700);
    await mkdir(sourceDir, { mode: 0o700 });
    await mkdir(join(sourceDir, "media"), { mode: 0o700 });
    await mkdir(join(sourceDir, "secrets"), { mode: 0o700 });
    await mkdir(join(sourceDir, "oss-mirrors"), { mode: 0o700 });
    for (const [path, bytes] of fixture) await writeFile(join(sourceDir, path), bytes, {mode:0o600,flag:"wx"});
    const receipt = await capture();
    assert.equal(receipt.captureMode, "incident-active-preservation");
    assert.equal(receipt.finalCandidate, false);
    assert.equal(receipt.fileCount, fixture.size);
    if (mode === "roundtrip") {
      const recoveredContext = await readAuthenticatedEnvelopeContext({packageDir:targetDir,trustedSigningPublicKey:signing.publicKey,recoveryPrivateKey:recovery.privateKey});
      assert.deepEqual(recoveredContext,context);
      const result = await restore({expectedContext:recoveredContext});
      assert.equal(result.fileCount, fixture.size);
      assert.equal(result.finalCandidate, false);
      for (const [path, bytes] of fixture) {
        assert.deepEqual(await readFile(join(freshRestoreDir, path)), bytes);
        assert.deepEqual(await readFile(join(sourceDir, path)), bytes);
      }
      const packageNames = await readdir(targetDir);
      assert.deepEqual(packageNames.sort(), ["envelope.json", "manifest.bin", "objects"]);
      for (const name of packageNames.filter(name=>name!=="objects")) {
        const content = await readFile(join(targetDir, name));
        assert.equal(content.includes(fixture.get("secrets/config-master.key")), false);
        assert.equal(content.includes(Buffer.from("original attempt")), false);
      }
      for (const name of await readdir(join(targetDir, "objects"))) {
        const content = await readFile(join(targetDir, "objects", name));
        assert.equal(content.includes(fixture.get("secrets/config-master.key")), false);
      }
      await assert.rejects(restore());
      for (const [path, bytes] of fixture) assert.deepEqual(await readFile(join(freshRestoreDir, path)), bytes);
    } else {
      await assert.rejects(restore({expectedContext:{...context, operationId:"another-incident"}}));
      await absent(freshRestoreDir);
      const otherSigning = generateKeyPairSync("ed25519");
      await assert.rejects(restore({trustedSigningPublicKey:otherSigning.publicKey}));
      await assert.rejects(readAuthenticatedEnvelopeContext({packageDir:targetDir,trustedSigningPublicKey:otherSigning.publicKey,recoveryPrivateKey:recovery.privateKey}));
      await absent(freshRestoreDir);
      const object = join(targetDir, "objects", (await readdir(join(targetDir, "objects")))[0]);
      const original = await readFile(object);
      const changed = Buffer.from(original); if (changed.length) changed[0] ^= 1;
      await writeFile(object, changed.length ? changed : Buffer.from([1]));
      await assert.rejects(restore()); await absent(freshRestoreDir);
      await writeFile(object, original);
      const extra = join(targetDir, "unexpected.txt");
      await writeFile(extra,"unexpected",{mode:0o600});
      await assert.rejects(restore()); await absent(freshRestoreDir);
      await unlink(extra);
      await unlink(object);
      await assert.rejects(restore()); await absent(freshRestoreDir);
      await writeFile(object, original, {mode:0o600,flag:"wx"});
      await assert.rejects(capture());
      await assert.rejects(capture({targetDir:join(sourceDir,"nested")}));
      const alias = join(root,"alias");
      await symlink(root, alias);
      await assert.rejects(capture({targetDir:join(alias,"unexpected-parent","package")}));
      await absent(join(root,"unexpected-parent"));
      await assert.rejects(restore({freshRestoreDir:join(alias,"restore-through-alias")}));
      await absent(join(root,"restore-through-alias"));
      await unlink(alias);
      await unlink(join(sourceDir,"library.sqlite"));
      await assert.rejects(capture({targetDir:join(root,"missing-library")}));
      await absent(join(root,"missing-library"));
      await writeFile(join(sourceDir,"library.sqlite"),fixture.get("library.sqlite"),{mode:0o600,flag:"wx"});
      const outside = join(root,"outside");
      await writeFile(outside,"sentinel",{mode:0o600});
      const sourceLink = join(sourceDir,"media/link");
      await symlink(outside,sourceLink);
      await assert.rejects(capture({targetDir:join(root,"unsafe-link")}));
      assert.equal(await readFile(outside,"utf8"),"sentinel");
      await unlink(sourceLink);
      await link(outside,sourceLink);
      await assert.rejects(capture({targetDir:join(root,"unsafe-hardlink")}));
      assert.equal(await readFile(outside,"utf8"),"sentinel");
      await unlink(sourceLink);
      await restore();
      for (const [path,bytes] of fixture) assert.deepEqual(await readFile(join(freshRestoreDir,path)),bytes);
    }
    console.log(JSON.stringify({status:"pass", mode, files:fixture.size, providerRequests:0}));
  } finally { await rm(root,{recursive:true,force:true}); }
`;

for (const scenario of ["roundtrip", "refusals"] as const) {
  test(`incident envelope preserves partial downloads and rejects unsafe restore: ${scenario}`, async () => {
    const result = await promisify(execFile)(process.execPath, [
      "--input-type=module", "-e", incidentEnvelopeScenario, scenario,
    ], { cwd: process.cwd(), timeout: 60_000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(result.stdout)).toEqual({status: "pass", mode: scenario, files: 8, providerRequests: 0});
  });
}
