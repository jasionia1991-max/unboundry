import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE = "22.23.1";
if (process.versions.node !== REQUIRED_NODE) {
  throw new Error(`Node ${REQUIRED_NODE} required, got ${process.versions.node}`);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(repositoryRoot, "scripts/offline-network-guard.mjs");
const root = mkdtempSync(join(tmpdir(), "unboundry-network-guard-control-"));

function auditEvents(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function childEnvironment(auditFile, home) {
  return {
    HOME: home,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: `--import=${guard}`,
    PATH: dirname(process.execPath),
    TEMP: home,
    TMP: home,
    TMPDIR: home,
    UNBOUNDRY_SAFE_TEST: "1",
    UNBOUNDRY_TEST_NETWORK_AUDIT: auditFile,
  };
}

function runCase(name, source, { blocked }) {
  const caseRoot = join(root, name);
  const home = join(caseRoot, "home");
  const auditFile = join(caseRoot, "audit.jsonl");
  mkdirSync(home, { recursive: true });
  writeFileSync(auditFile, "", "utf8");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: childEnvironment(auditFile, home),
      maxBuffer: 1_048_576,
      timeout: 10_000,
    },
  );
  if (result.error) throw result.error;
  const events = auditEvents(auditFile);
  const loaded = events.some((event) => event.event === "node_guard_loaded");
  const denials = events.filter((event) => event.event === "node_network_blocked");
  if (!loaded) throw new Error(`${name}: guard did not load`);
  if (blocked) {
    if (result.status === 0 || denials.length === 0) {
      throw new Error(
        `${name}: expected audited non-zero denial; status=${result.status}\n${
          result.stdout ?? ""
        }${result.stderr ?? ""}`,
      );
    }
  } else if (result.status !== 0 || denials.length !== 0) {
    throw new Error(
      `${name}: legal loopback failed; status=${result.status}\n${
        result.stdout ?? ""
      }${result.stderr ?? ""}`,
    );
  }
  return { denials: denials.length, name, status: result.status };
}

const legalLoopback = String.raw`
  import dgram from "node:dgram";
  import http from "node:http";
  import http2 from "node:http2";
  import net from "node:net";
  import tls from "node:tls";
  import { lookup } from "node:dns/promises";

  await lookup("127.0.0.1");
  const listenZero = (server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string" || !address.port) {
        reject(new Error("port-zero listener has no numeric address"));
        return;
      }
      resolve(address.port);
    });
  });

  const server = http.createServer((_request, response) => response.end("ok"));
  const port = await listenZero(server);
  try {
    const body = await new Promise((resolve, reject) => {
      http.get("http://127.0.0.1:" + port + "/", (response) => {
        let value = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { value += chunk; });
        response.once("end", () => resolve(value));
      }).once("error", reject);
    });
    if (body !== "ok") throw new Error("unexpected loopback body: " + body);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const bindUdpZero = (socket) => new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      socket.removeListener("error", reject);
      const address = socket.address();
      if (!address || !address.port) {
        reject(new Error("port-zero UDP socket has no numeric address"));
        return;
      }
      resolve(address.port);
    });
  });

  const udpServer = dgram.createSocket("udp4");
  const udpClient = dgram.createSocket("udp4");
  try {
    const udpPort = await bindUdpZero(udpServer);
    await bindUdpZero(udpClient);
    const received = new Promise((resolve) => {
      udpServer.once("message", (message) => resolve(message.toString("utf8")));
    });
    await new Promise((resolve, reject) => {
      udpClient.send(Buffer.from("udp"), udpPort, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (await received !== "udp") throw new Error("unexpected UDP loopback body");
  } finally {
    udpClient.close();
    udpServer.close();
  }

  const http2Server = http2.createServer();
  http2Server.on("stream", (stream) => {
    stream.respond({ ":status": 200 });
    stream.end("h2");
  });
  const http2Port = await listenZero(http2Server);
  const http2Client = http2.connect("http://127.0.0.1:" + http2Port);
  try {
    const body = await new Promise((resolve, reject) => {
      const request = http2Client.request({ ":path": "/" });
      let value = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { value += chunk; });
      request.once("end", () => resolve(value));
      request.once("error", reject);
      request.end();
    });
    if (body !== "h2") throw new Error("unexpected HTTP/2 loopback body");
  } finally {
    http2Client.close();
    await new Promise((resolve) => http2Server.close(resolve));
  }

  const tlsProbeServer = net.createServer((socket) => socket.destroy());
  const tlsProbePort = await listenZero(tlsProbeServer);
  try {
    await new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: tlsProbePort,
        rejectUnauthorized: false,
      });
      socket.once("secureConnect", () => {
        socket.destroy();
        reject(new Error("TLS control unexpectedly completed a handshake"));
      });
      socket.once("error", (error) => {
        if (error?.code === "UNBOUNDRY_OFFLINE_NETWORK_BLOCKED") reject(error);
        else resolve();
      });
    });
  } finally {
    await new Promise((resolve) => tlsProbeServer.close(resolve));
  }
`;

const blockedCases = [
  [
    "caught-denial-still-fails",
    'const { lookup } = await import("node:dns/promises"); try { await lookup("example.invalid"); } catch {}',
  ],
  [
    "dns-callback",
    'const { lookup } = await import("node:dns"); lookup("example.invalid", () => {});',
  ],
  [
    "dns-promises",
    'const { lookup } = await import("node:dns/promises"); await lookup("example.invalid");',
  ],
  [
    "net-connect",
    'const { connect } = await import("node:net"); connect({ host: "192.0.2.1", port: 9999 });',
  ],
  [
    "forbidden-4173-bind",
    'const { createServer } = await import("node:net"); createServer().listen(4173, "127.0.0.1");',
  ],
  [
    "forbidden-4173-connect",
    'const { connect } = await import("node:net"); connect({ host: "127.0.0.1", port: 4173 });',
  ],
  [
    "unregistered-loopback-net",
    'const { connect } = await import("node:net"); connect({ host: "127.0.0.1", port: 45231 });',
  ],
  [
    "unregistered-loopback-http",
    'const http = await import("node:http"); http.get("http://127.0.0.1:45231/");',
  ],
  [
    "unregistered-loopback-tls",
    'const { connect } = await import("node:tls"); connect({ host: "127.0.0.1", port: 45231 });',
  ],
  [
    "unregistered-loopback-http2",
    'const { connect } = await import("node:http2"); connect("http://127.0.0.1:45231");',
  ],
  [
    "unregistered-loopback-dgram",
    'const { createSocket } = await import("node:dgram"); const socket = createSocket("udp4"); await new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(0, "127.0.0.1", resolve); }); const ownPort = socket.address().port; socket.send(Buffer.from("x"), ownPort === 45231 ? 45232 : 45231, "127.0.0.1");',
  ],
  [
    "closed-listener-port-is-removed",
    'const { createServer, connect } = await import("node:net"); const server = createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); connect({ host: "127.0.0.1", port });',
  ],
  [
    "closed-dgram-port-is-removed",
    'const dgram = await import("node:dgram"); const socket = dgram.createSocket("udp4"); await new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(0, "127.0.0.1", resolve); }); const port = socket.address().port; await new Promise((resolve) => socket.close(resolve)); const { connect } = await import("node:net"); connect({ host: "127.0.0.1", port });',
  ],
  [
    "tls",
    'const { connect } = await import("node:tls"); connect({ host: "example.invalid", port: 443 });',
  ],
  [
    "http2",
    'const { connect } = await import("node:http2"); connect("https://example.invalid");',
  ],
  [
    "dgram-send",
    'const { createSocket } = await import("node:dgram"); createSocket("udp4").send(Buffer.from("x"), 9999, "192.0.2.1");',
  ],
  [
    "dgram-implicit-bind",
    'const { createSocket } = await import("node:dgram"); createSocket("udp4").bind(0);',
  ],
  [
    "unix-socket",
    'const { connect } = await import("node:net"); connect("/tmp/unboundry-forbidden.sock");',
  ],
  [
    "implicit-listen",
    'const { createServer } = await import("node:net"); createServer().listen(0);',
  ],
  [
    "nonloopback-listen",
    'const { createServer } = await import("node:net"); createServer().listen(45231, "0.0.0.0");',
  ],
  [
    "http-unix-socket",
    'const http = await import("node:http"); http.request({ socketPath: "/tmp/unboundry-forbidden.sock", path: "/" }).end();',
  ],
  [
    "http-host-override",
    'const http = await import("node:http"); http.request("http://127.0.0.1:45231", { hostname: "example.invalid" }).end();',
  ],
  [
    "http-custom-lookup",
    'const http = await import("node:http"); http.request({ hostname: "127.0.0.1", port: 45231, lookup() {} }).end();',
  ],
  [
    "http-custom-connection",
    'const http = await import("node:http"); http.request({ hostname: "127.0.0.1", port: 45231, createConnection() {} }).end();',
  ],
];

try {
  const results = [
    runCase("legal-loopback", legalLoopback, { blocked: false }),
    ...blockedCases.map(([name, source]) =>
      runCase(name, source, { blocked: true })
    ),
  ];
  console.log(
    JSON.stringify({
      blockedCases: results.filter((result) => result.denials > 0).length,
      legalLoopback: "pass",
      node: process.versions.node,
      status: "pass",
    }),
  );
} finally {
  rmSync(root, { force: true, recursive: true });
}
