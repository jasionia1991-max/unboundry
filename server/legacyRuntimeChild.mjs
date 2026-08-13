import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isIP } from "node:net";
import "../scripts/node-typescript-runtime.mjs";
import { acquireLegacyChildGuardian } from "./legacyChildGuardian.ts";

const legacyRoot = String(process.argv[2] ?? "");
const nonce = String(process.argv[3] ?? "");
const expectedParentPid = Number(process.env.UNBOUNDRY_LEGACY_PARENT_PID);
const hardShutdownDeadlineMs = 10_000;
let emergencyExitTimer;

function exitForDeadParent() {
  // A dead parent no longer holds the active lease. Do not wait for Vite's
  // graceful drain and leave an overlap window with the next lease owner.
  process.exit(1);
}

// Install orphan protection before asynchronous module/config loading. A
// parent crash during startup must not leave a child that later binds SQLite.
process.once("disconnect", exitForDeadParent);

function send(message) {
  return new Promise((resolveSend, rejectSend) => {
    if (!process.connected || !process.send) {
      rejectSend(new Error("Legacy child IPC is disconnected"));
      return;
    }
    process.send({ ...message, nonce }, (error) => {
      if (error) rejectSend(error);
      else resolveSend();
    });
  });
}

function receiveProxyNonce() {
  return new Promise((resolveNonce, rejectNonce) => {
    const timeout = setTimeout(() => {
      process.removeListener("message", onMessage);
      rejectNonce(new Error("Legacy child private proxy capability timed out"));
    }, 5_000);
    const onMessage = (message) => {
      if (
        !message || typeof message !== "object" ||
        message.type !== "initialize" || message.nonce !== nonce ||
        !/^[a-f0-9]{64}$/.test(String(message.proxyNonce ?? ""))
      ) return;
      clearTimeout(timeout);
      process.removeListener("message", onMessage);
      resolveNonce(String(message.proxyNonce));
    };
    process.on("message", onMessage);
  });
}

function warmLegacyDatabase(port, proxyNonce) {
  return new Promise((resolveWarmup, rejectWarmup) => {
    const request = httpRequest({
      agent: false,
      headers: {
        Host: `127.0.0.1:${port}`,
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "http",
        "X-Real-IP": "127.0.0.1",
        "X-Unboundry-Legacy-Proxy": proxyNonce,
      },
      host: "127.0.0.1",
      method: "GET",
      path: "/api/auth/status",
      port,
    }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1_024) response.destroy();
      });
      response.once("error", rejectWarmup);
      response.once("end", () => {
        if (response.statusCode !== 200 || bytes > 64 * 1_024) {
          rejectWarmup(new Error("Legacy database warm-up was rejected"));
        } else {
          resolveWarmup();
        }
      });
    });
    request.once("error", rejectWarmup);
    request.setTimeout(20_000, () =>
      request.destroy(new Error("Legacy database warm-up timed out")));
    request.end();
  });
}

async function main() {
  const dataDirectory = String(process.env.UNBOUNDRY_DATA_DIR ?? "");
  const runtimeDirectory = String(process.env.UNBOUNDRY_RUNTIME_DIR ?? "");
  const expectedLegacyPath = join(
    runtimeDirectory,
    ".unboundry-legacy-no-tools",
  );
  const controlledPathDetails = lstatSync(expectedLegacyPath);
  if (
    process.env.UNBOUNDRY_LEGACY_CHILD !== "1" || !process.send ||
    process.env.UNBOUNDRY_TRUST_PROXY !== "1" ||
    !Number.isInteger(expectedParentPid) || expectedParentPid < 1 ||
    process.ppid !== expectedParentPid ||
    process.env.PATH !== expectedLegacyPath ||
    realpathSync(expectedLegacyPath) !== expectedLegacyPath ||
    controlledPathDetails.isSymbolicLink() ||
    !controlledPathDetails.isDirectory() ||
    controlledPathDetails.uid !== process.getuid() ||
    (controlledPathDetails.mode & 0o777) !== 0o500 ||
    readdirSync(expectedLegacyPath).length !== 0 ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    !isAbsolute(legacyRoot) ||
    resolve(legacyRoot) !== legacyRoot || realpathSync(legacyRoot) !== legacyRoot ||
    !lstatSync(legacyRoot).isDirectory()
  ) throw new Error("Legacy child attestation failed");

  const proxyNonce = await receiveProxyNonce();

  // This lock is intentionally acquired before importing Vite or any legacy
  // application module. It is independent of the parent's active-role lease,
  // so a replacement parent/migrator cannot overlap an orphaned exact runtime.
  const guardian = acquireLegacyChildGuardian({
    dataDirectory,
    runtimeDirectory,
  });
  guardian.assertHeld();

  const exactSafeTestRuntime =
    process.env.UNBOUNDRY_LEGACY_SAFE_TEST === "1" &&
    process.env.UNBOUNDRY_LEGACY_SAFE_TEST_EXACT_ROOT === legacyRoot;
  const releaseRoot = resolve(legacyRoot, "..");
  if (!exactSafeTestRuntime && join(releaseRoot, "legacy-runtime") !== legacyRoot) {
    throw new Error("Legacy child root is not release-bound");
  }
  const viteEntry = realpathSync(join(
    exactSafeTestRuntime ? legacyRoot : releaseRoot,
    "node_modules/vite/dist/node/index.js",
  ));
  const { preview } = await import(pathToFileURL(viteEntry).href);
  const cacheRoot = String(process.env.UNBOUNDRY_VITE_CACHE_DIR ?? "");
  if (!isAbsolute(cacheRoot) || resolve(cacheRoot) !== cacheRoot) {
    throw new Error("Legacy child cache root is invalid");
  }
  const safeTestPort = process.env.UNBOUNDRY_LEGACY_SAFE_TEST === "1"
    ? Number(process.env.UNBOUNDRY_LEGACY_SAFE_TEST_PORT)
    : 0;
  if (
    process.env.UNBOUNDRY_LEGACY_SAFE_TEST === "1" &&
    (!Number.isInteger(safeTestPort) || safeTestPort < 1 ||
      safeTestPort > 65_535 || safeTestPort === 4173)
  ) throw new Error("Legacy child safe-test auxiliary port is invalid");
  // Production always asks the kernel for a private port. The safe runner's
  // preload authorizes only its predeclared ports across process boundaries,
  // so isolated tests bind the already-attested auxiliary port instead.
  const proxyGate = (request, response, next) => {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() ===
        "x-unboundry-legacy-proxy") {
        values.push(request.rawHeaders[index + 1] ?? "");
      }
    }
    const peer = String(request.socket.remoteAddress ?? "");
    if (
      values.length !== 1 || values[0] !== proxyNonce ||
      (isIP(peer) !== 4 && isIP(peer) !== 6) ||
      (peer !== "127.0.0.1" && peer !== "::1")
    ) {
      request.resume();
      response.statusCode = 403;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Connection", "close");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: "LEGACY_PROXY_AUTH_REQUIRED" }));
      return;
    }
    delete request.headers["x-unboundry-legacy-proxy"];
    request.rawHeaders = request.rawHeaders.filter((_, index, values) => {
      const nameIndex = index % 2 === 0 ? index : index - 1;
      return values[nameIndex]?.toLowerCase() !== "x-unboundry-legacy-proxy";
    });
    next();
  };
  const server = await preview({
    cacheDir: join(cacheRoot, "legacy"),
    clearScreen: false,
    configFile: join(legacyRoot, "vite.config.ts"),
    configLoader: "runner",
    logLevel: "info",
    plugins: [{
      configurePreviewServer(previewServer) {
        previewServer.middlewares.use(proxyGate);
      },
      enforce: "pre",
      name: "unboundry-legacy-private-proxy-gate",
    }],
    preview: {
      host: "127.0.0.1",
      port: safeTestPort,
      strictPort: true,
    },
    root: join(legacyRoot, "client"),
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string" || address.port < 1) {
    await server.close();
    throw new Error("Legacy child did not bind a private TCP port");
  }

  let closing;
  let normalShutdown = false;
  const armHardExit = (milliseconds = hardShutdownDeadlineMs) => {
    if (emergencyExitTimer) clearTimeout(emergencyExitTimer);
    emergencyExitTimer = setTimeout(() => process.exit(1), milliseconds);
  };
  const close = (exitCode, forceConnections = false) => {
    if (closing) return closing;
    armHardExit(forceConnections ? 1_000 : hardShutdownDeadlineMs);
    closing = (async () => {
      try {
        if (forceConnections) server.httpServer.closeAllConnections?.();
        await server.close();
        guardian.assertHeld();
        if (process.connected) await send({ type: "stopped" });
      } finally {
        if (normalShutdown) process.removeListener("disconnect", exitForDeadParent);
        // Do not manually release the guardian. The exact-old module may keep
        // a global application-DB descriptor alive after Vite closes. OS
        // process exit atomically closes both descriptors; the parent waits
        // for this exit before releasing its independent active-role lease.
        process.disconnect?.();
        process.exit(exitCode);
      }
    })();
    return closing;
  };
  process.on("message", (message) => {
    if (
      message && typeof message === "object" &&
      message.type === "shutdown" && message.nonce === nonce
    ) {
      normalShutdown = true;
      process.removeListener("disconnect", exitForDeadParent);
      void close(0);
    }
  });
  process.removeListener("disconnect", exitForDeadParent);
  // Parent-controlled shutdown is authenticated IPC. SIGTERM/SIGINT on the
  // child are abnormal and use the default synchronous termination semantics.
  process.once("disconnect", exitForDeadParent);
  const parentWatchdog = setInterval(() => {
    if (!process.connected || process.ppid !== expectedParentPid) {
      exitForDeadParent();
      return;
    }
    try {
      process.kill(expectedParentPid, 0);
    } catch {
      exitForDeadParent();
    }
  }, 1_000);
  parentWatchdog.unref();
  // Exact v0.5.1 performs legacy metadata work on the first ordinary database
  // open. The child PATH intentionally excludes ffprobe/ffmpeg, so this warmup
  // can complete only deterministic checksums; duration remains pending for
  // the explicit one-shot migrator.
  await warmLegacyDatabase(address.port, proxyNonce);
  guardian.assertHeld();
  await send({
    databaseWarmup: "legacy-media-checksum-backfill",
    host: "127.0.0.1",
    port: address.port,
    providerRequests: 0,
    type: "ready",
  });
}

main().catch((error) => {
  void send({
    message: error instanceof Error ? error.message : "unknown",
    type: "failed",
  }).finally(() => process.exit(1));
});
