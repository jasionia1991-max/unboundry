import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { authGate } from "../server/auth";
import { appDataDirectory, openAppDatabase } from "../server/database";
import {
  assertPublicHttpsDestination,
  fetchPublicHttps,
  privateNetworkAddress,
} from "../server/outboundNetwork";
import {
  adminProviderCatalogApi,
  getProviderCatalog,
  getProviderReadOnlyDescriptor,
  importProviderCatalogDrafts,
  readProviderReadOnlyResource,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("outbound destination guard rejects IPv6 transition and mixed private DNS answers", async () => {
  for (const address of [
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "::192.168.1.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "fec0::1",
    "ff02::1",
  ]) {
    expect(privateNetworkAddress(address), address).toBe(true);
  }
  expect(privateNetworkAddress("2001:4860:4860::8888")).toBe(false);
  await expect(assertPublicHttpsDestination(
    "https://mixed.public.invalid/v1/models",
    async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ],
  )).rejects.toMatchObject({ code: "FORMAT" });
});

test("Fake-IP proxy timeout cancels every pending socket without an unhandled abort", async () => {
  const sockets = new Set<Duplex>();
  const proxy = createNetServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => resolve());
  });
  const address = proxy.address();
  expect(address && typeof address === "object").toBe(true);
  try {
    await expect(fetchPublicHttps(
      "https://api.fake-ip-timeout.invalid/v1/models",
      { method: "GET" },
      {
        proxyUrl: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
        resolver: async () => [{ address: "198.18.0.160", family: 4 }],
        timeoutMs: 40,
      },
    )).rejects.toMatchObject({ name: "TimeoutError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("secure HTTPS transport pins the validated IPv4 or IPv6 answer and returns a standard Response", async () => {
  for (const destination of [
    { address: "8.8.8.8", family: 4 as const },
    { address: "2001:4860:4860::8888", family: 6 as const },
  ]) {
    const observed: Array<{
      address: string | unknown[];
      family?: number;
      hostname: string;
    }> = [];
    const requester = ((
      url: URL,
      options: {
        lookup?: (
          hostname: string,
          lookupOptions: { all?: boolean; family?: number },
          callback: (
            error: Error | null,
            address: string | unknown[],
            family?: number,
          ) => void,
        ) => void;
      },
      respond: (response: IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        options.lookup?.(
          url.hostname,
          { family: destination.family },
          (error, address, family) => {
            if (error) {
              request.emit("error", error);
              return;
            }
            observed.push({ address, family, hostname: url.hostname });
            const incoming = Readable.from([
              Buffer.from(JSON.stringify({ pinned: true }), "utf8"),
            ]) as IncomingMessage;
            Object.assign(incoming, {
              rawHeaders: ["Content-Type", "application/json"],
              statusCode: 200,
              statusMessage: "OK",
            });
            respond(incoming);
          },
        );
        return request;
      }) as ClientRequest["end"];
      return request;
    }) as NonNullable<
      Parameters<typeof fetchPublicHttps>[2]
    >["requester"];
    const response = await fetchPublicHttps(
      "https://pinned.relay.invalid/v1/jobs",
      { body: "{}", method: "POST", redirect: "error" },
      {
        requester,
        resolver: async () => [destination],
      },
    );
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pinned: true });
    expect(observed).toEqual([{
      address: destination.address,
      family: destination.family,
      hostname: "pinned.relay.invalid",
    }]);
  }
});

test("secure HTTPS transport aborts unresolved DNS at its timeout without opening a request", async () => {
  let requestCount = 0;
  await expect(fetchPublicHttps(
    "https://timeout.relay.invalid/v1/models",
    { method: "GET" },
    {
      requester: (() => {
        requestCount += 1;
        throw new Error("must not open a request");
      }) as NonNullable<Parameters<typeof fetchPublicHttps>[2]>["requester"],
      resolver: () => new Promise(() => undefined),
      timeoutMs: 5,
    },
  )).rejects.toMatchObject({ name: "TimeoutError" });
  expect(requestCount).toBe(0);
});

class HttpConnectFixtureSocket extends Duplex {
  private connected = false;
  private handledHttpsRequest = false;
  private requestBuffer = Buffer.alloc(0);
  private tlsHostname = "";

  constructor(
    private readonly onConnectRequest: (request: string) => void,
    private readonly onHttpsRequest?: (
      request: string,
      tlsHostname: string,
    ) => unknown,
  ) {
    super();
  }

  override _read() {}

  setTlsHostname(hostname: string) {
    this.tlsHostname = hostname;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (!this.connected) {
      this.connected = true;
      this.onConnectRequest(Buffer.from(chunk).toString("latin1"));
      callback();
      queueMicrotask(() => {
        this.push(Buffer.from(
          "HTTP/1.1 200 Connection established\r\n\r\n",
          "latin1",
        ));
      });
      return;
    }
    this.requestBuffer = Buffer.concat([
      this.requestBuffer,
      Buffer.from(chunk),
    ]);
    callback();
    if (!this.onHttpsRequest || this.handledHttpsRequest) return;
    const boundary = this.requestBuffer.indexOf("\r\n\r\n");
    if (boundary < 0) return;
    const header = this.requestBuffer.subarray(0, boundary).toString("latin1");
    const contentLength = Number(
      /^content-length:\s*(\d+)\s*$/im.exec(header)?.[1] ?? 0,
    );
    const completeLength = boundary + 4 + contentLength;
    if (this.requestBuffer.length < completeLength) return;
    const rawRequest = this.requestBuffer.subarray(0, completeLength)
      .toString("utf8");
    this.handledHttpsRequest = true;
    const body = Buffer.from(JSON.stringify(
      this.onHttpsRequest(rawRequest, this.tlsHostname),
    ), "utf8");
    queueMicrotask(() => {
      this.push(Buffer.concat([
        Buffer.from(
          "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/json\r\n" +
            `Content-Length: ${body.byteLength}\r\n` +
            "Connection: close\r\n\r\n",
          "latin1",
        ),
        body,
      ]));
      this.push(null);
    });
  }
}

function incomingJson(body: unknown, status = 200) {
  const incoming = Readable.from([
    Buffer.from(JSON.stringify(body), "utf8"),
  ]) as IncomingMessage;
  Object.assign(incoming, {
    rawHeaders: ["Content-Type", "application/json"],
    statusCode: status,
    statusMessage: status === 200 ? "OK" : "Error",
  });
  return incoming;
}

function parseFixtureHttpRequest(request: string) {
  const [head, body = ""] = request.split("\r\n\r\n", 2);
  const [requestLine, ...headerLines] = head.split("\r\n");
  const [method, path] = requestLine.split(" ");
  const headers = new Headers();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers.append(
        line.slice(0, separator),
        line.slice(separator + 1).trim(),
      );
    }
  }
  return { body, headers, method, path };
}

async function fixtureDelay(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const finished = () => {
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const timer = setTimeout(finished, milliseconds);
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

test("Fake-IP HTTPS transport resolves through authenticated DoH and CONNECTs only verified IP addresses", async () => {
  const connectRequests: string[] = [];
  const httpsRequests: Array<{ request: string; tlsHostname: string }> = [];
  const proxyUrls: string[] = [];
  const sockets: HttpConnectFixtureSocket[] = [];
  const tlsHostnames: string[] = [];
  let providerRequestCount = 0;

  const response = await fetchPublicHttps(
    "https://api.fake-ip.invalid/v1/skills/models?scope=all&limit=1",
    {
      body: JSON.stringify({ prompt: "fixture-only" }),
      headers: {
        Authorization: "Bearer fixture-secret",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    {
      beforeRequest: () => {
        providerRequestCount += 1;
      },
      proxySocketFactory: async (proxy) => {
        proxyUrls.push(proxy.toString());
        const socket = new HttpConnectFixtureSocket(
          (request) => {
            connectRequests.push(request);
          },
          (request, tlsHostname) => {
            httpsRequests.push({ request, tlsHostname });
            const parsed = parseFixtureHttpRequest(request);
            if (tlsHostname === "cloudflare-dns.com") {
              const type = new URL(
                parsed.path,
                "https://cloudflare-dns.com",
              ).searchParams.get("type");
              return type === "A"
                ? {
                    Answer: [{ data: "8.8.4.4", type: 1 }],
                    Status: 0,
                  }
                : {
                    Answer: [{
                      data: "2001:4860:4860::8844",
                      type: 28,
                    }],
                    Status: 0,
                  };
            }
            return { proxied: true };
          },
        );
        sockets.push(socket);
        return socket;
      },
      proxyUrl: "http://127.0.0.1:49111",
      resolver: async () => [{ address: "198.18.0.160", family: 4 }],
      targetTlsFactory: async (socket, hostname) => {
        tlsHostnames.push(hostname);
        expect(socket).toBeInstanceOf(HttpConnectFixtureSocket);
        (socket as HttpConnectFixtureSocket).setTlsHostname(hostname);
        return socket;
      },
    },
  );

  expect(response).toBeInstanceOf(Response);
  expect(await response.json()).toEqual({ proxied: true });
  expect(connectRequests.map((request) => request.split("\r\n", 1)[0]))
    .toEqual([
      "CONNECT 1.1.1.1:443 HTTP/1.1",
      "CONNECT 1.1.1.1:443 HTTP/1.1",
      "CONNECT 8.8.4.4:443 HTTP/1.1",
      "CONNECT [2001:4860:4860::8844]:443 HTTP/1.1",
    ]);
  expect(connectRequests.join("\n")).not.toContain("cloudflare-dns.com");
  expect(connectRequests.join("\n")).not.toContain("api.fake-ip.invalid");
  expect(proxyUrls).toEqual(Array(4).fill("http://127.0.0.1:49111/"));
  expect(tlsHostnames).toEqual([
    "cloudflare-dns.com",
    "cloudflare-dns.com",
    "api.fake-ip.invalid",
    "api.fake-ip.invalid",
  ]);
  expect(httpsRequests.map((request) => request.tlsHostname)).toEqual([
    "cloudflare-dns.com",
    "cloudflare-dns.com",
    "api.fake-ip.invalid",
  ]);
  const providerRequests = httpsRequests.filter((request) =>
    request.tlsHostname === "api.fake-ip.invalid"
  );
  expect(providerRequests).toHaveLength(1);
  const providerRequest = parseFixtureHttpRequest(providerRequests[0].request);
  expect(providerRequest).toMatchObject({
    body: JSON.stringify({ prompt: "fixture-only" }),
    method: "POST",
    path: "/v1/skills/models?scope=all&limit=1",
  });
  expect(providerRequest.headers.get("authorization"))
    .toBe("Bearer fixture-secret");
  expect(providerRequest.headers.get("content-type")).toBe("application/json");
  expect(providerRequest.headers.get("host")).toBe("api.fake-ip.invalid");
  expect(providerRequestCount).toBe(1);
  await expect.poll(() => sockets.every((socket) => socket.destroyed))
    .toBe(true);
});

test("Fake-IP races 24 target TLS handshakes and sends one Provider request through the later winner", async () => {
  const publicAddresses = Array.from(
    { length: 24 },
    (_, index) => `8.8.4.${index + 1}`,
  );
  const winningAddress = publicAddresses[19];
  const authorityBySocket = new WeakMap<Duplex, string>();
  const connectRequests: string[] = [];
  const httpsRequests: Array<{ request: string; tlsHostname: string }> = [];
  const targetSockets: HttpConnectFixtureSocket[] = [];
  let activeTargetTls = 0;
  let maximumActiveTargetTls = 0;
  let providerBoundaryCount = 0;
  let targetTlsAttempts = 0;
  const targetHostname = "api.fake-ip-failover.invalid";

  const response = await fetchPublicHttps(
    `https://${targetHostname}/v1/generate?fixture=retry-boundary`,
    {
      body: JSON.stringify({ prompt: "send-once" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    {
      beforeRequest: () => {
        providerBoundaryCount += 1;
      },
      proxySocketFactory: async () => {
        let socket: HttpConnectFixtureSocket;
        socket = new HttpConnectFixtureSocket((request) => {
          connectRequests.push(request);
          authorityBySocket.set(
            socket,
            request.split("\r\n", 1)[0].split(" ")[1],
          );
        },
        (request, tlsHostname) => {
          httpsRequests.push({ request, tlsHostname });
          if (tlsHostname === "cloudflare-dns.com") {
            const type = new URL(
              parseFixtureHttpRequest(request).path,
              "https://cloudflare-dns.com",
            ).searchParams.get("type");
            return {
              Answer: type === "A"
                ? publicAddresses.map((address) => ({
                    data: address,
                    type: 1,
                  }))
                : [],
              Status: 0,
            };
          }
          return { generated: true };
        });
        return socket;
      },
      proxyUrl: "http://127.0.0.1:49111",
      resolver: async () => [{ address: "198.18.0.160", family: 4 }],
      targetTlsFactory: async (rawSocket, hostname, signal) => {
        const socket = rawSocket as HttpConnectFixtureSocket;
        if (hostname !== targetHostname) {
          socket.setTlsHostname(hostname);
          return socket;
        }
        targetSockets.push(socket);
        targetTlsAttempts += 1;
        activeTargetTls += 1;
        maximumActiveTargetTls = Math.max(
          maximumActiveTargetTls,
          activeTargetTls,
        );
        try {
          const isWinner = authorityBySocket.get(socket) ===
            `${winningAddress}:443`;
          await fixtureDelay(isWinner ? 10 : 80, signal);
          if (!isWinner) {
            throw new Error("fixture target TLS handshake failed");
          }
          socket.setTlsHostname(hostname);
          return socket;
        } finally {
          activeTargetTls -= 1;
        }
      },
    },
  );

  expect(await response.json()).toEqual({ generated: true });
  const targetConnectAuthorities = connectRequests.slice(2).map((request) =>
    request.split("\r\n", 1)[0].split(" ")[1]
  );
  expect(new Set(targetConnectAuthorities)).toEqual(new Set(
    publicAddresses.map((address) => `${address}:443`),
  ));
  expect(targetTlsAttempts).toBe(24);
  expect(maximumActiveTargetTls).toBe(24);
  expect(providerBoundaryCount).toBe(1);
  const providerRequests = httpsRequests.filter((request) =>
    request.tlsHostname === targetHostname
  );
  expect(providerRequests).toHaveLength(1);
  expect(parseFixtureHttpRequest(providerRequests[0].request)).toMatchObject({
    body: JSON.stringify({ prompt: "send-once" }),
    method: "POST",
    path: "/v1/generate?fixture=retry-boundary",
  });
  await expect.poll(() =>
    targetSockets.every((socket) => socket.destroyed)
  ).toBe(true);
});

test("Fake-IP sends nothing and destroys all 24 target sockets when every TLS handshake fails", async () => {
  const publicAddresses = Array.from(
    { length: 24 },
    (_, index) => `8.8.4.${index + 1}`,
  );
  const authorityBySocket = new WeakMap<Duplex, string>();
  const connectRequests: string[] = [];
  const targetSockets: HttpConnectFixtureSocket[] = [];
  let activeTargetTls = 0;
  let maximumActiveTargetTls = 0;
  let providerBoundaryCount = 0;
  let providerHttpRequestCount = 0;
  let targetTlsAttempts = 0;
  const targetHostname = "api.fake-ip-all-fail.invalid";

  await expect(fetchPublicHttps(
    `https://${targetHostname}/v1/generate`,
    {
      body: JSON.stringify({ prompt: "must-not-send" }),
      method: "POST",
    },
    {
      beforeRequest: () => {
        providerBoundaryCount += 1;
      },
      proxySocketFactory: async () => {
        let socket: HttpConnectFixtureSocket;
        socket = new HttpConnectFixtureSocket((request) => {
          connectRequests.push(request);
          authorityBySocket.set(
            socket,
            request.split("\r\n", 1)[0].split(" ")[1],
          );
        },
        (request, tlsHostname) => {
          if (tlsHostname === targetHostname) {
            providerHttpRequestCount += 1;
          }
          const type = new URL(
            parseFixtureHttpRequest(request).path,
            "https://cloudflare-dns.com",
          ).searchParams.get("type");
          return {
            Answer: type === "A"
              ? publicAddresses.map((address) => ({
                  data: address,
                  type: 1,
                }))
              : [],
            Status: 0,
          };
        });
        return socket;
      },
      proxyUrl: "http://127.0.0.1:49111",
      resolver: async () => [{ address: "198.18.0.160", family: 4 }],
      targetTlsFactory: async (rawSocket, hostname, signal) => {
        const socket = rawSocket as HttpConnectFixtureSocket;
        if (hostname !== targetHostname) {
          socket.setTlsHostname(hostname);
          return socket;
        }
        targetSockets.push(socket);
        targetTlsAttempts += 1;
        activeTargetTls += 1;
        maximumActiveTargetTls = Math.max(
          maximumActiveTargetTls,
          activeTargetTls,
        );
        try {
          const lastOctet = Number(
            authorityBySocket.get(socket)?.split(/[.:]/).at(-2) ?? 0,
          );
          await fixtureDelay(10 + lastOctet % 3, signal);
          throw new Error("fixture target TLS handshake failed");
        } finally {
          activeTargetTls -= 1;
        }
      },
    },
  )).rejects.toMatchObject({ code: "NETWORK" });

  const targetConnectAuthorities = connectRequests.slice(2).map((request) =>
    request.split("\r\n", 1)[0].split(" ")[1]
  );
  expect(new Set(targetConnectAuthorities)).toEqual(new Set(
    publicAddresses.map((address) => `${address}:443`),
  ));
  expect(targetTlsAttempts).toBe(24);
  expect(maximumActiveTargetTls).toBe(24);
  expect(providerBoundaryCount).toBe(0);
  expect(providerHttpRequestCount).toBe(0);
  expect(targetSockets.every((socket) => socket.destroyed)).toBe(true);
});

test("literal Fake-IP URLs and mixed Fake-IP DNS answers never enter the proxy path", async () => {
  let openedSocket = 0;
  let openedRequest = 0;
  const guardedDependencies = {
    proxySocketFactory: async () => {
      openedSocket += 1;
      throw new Error("must not open a proxy socket");
    },
    proxyUrl: "http://127.0.0.1:49111",
    requester: (() => {
      openedRequest += 1;
      throw new Error("must not open an HTTPS request");
    }) as NonNullable<Parameters<typeof fetchPublicHttps>[2]>["requester"],
  };

  await expect(fetchPublicHttps(
    "https://198.18.0.160/v1/models",
    { method: "GET" },
    guardedDependencies,
  )).rejects.toMatchObject({ code: "FORMAT" });

  for (const secondAddress of [
    { address: "10.0.0.1", family: 4 },
    { address: "8.8.8.8", family: 4 },
  ]) {
    await expect(fetchPublicHttps(
      "https://api.mixed-fake-ip.invalid/v1/models",
      { method: "GET" },
      {
        ...guardedDependencies,
        resolver: async () => [
          { address: "198.18.0.160", family: 4 },
          secondAddress,
        ],
      },
    )).rejects.toMatchObject({ code: "FORMAT" });
  }

  expect(openedSocket).toBe(0);
  expect(openedRequest).toBe(0);
});

test("Fake-IP HTTPS transport rejects missing or non-loopback proxy configuration before any request", async () => {
  for (const proxyUrl of [
    null,
    "http://192.168.1.2:8080",
    "http://localhost:8080",
    "socks5://127.0.0.1:1080",
    "http://user:password@127.0.0.1:8080",
    "http://127.0.0.1:8080/proxy-path",
  ]) {
    let openedSocket = 0;
    let openedRequest = 0;
    await expect(fetchPublicHttps(
      "https://api.fake-ip.invalid/v1/models",
      { method: "GET" },
      {
        proxySocketFactory: async () => {
          openedSocket += 1;
          throw new Error("must not open a proxy socket");
        },
        proxyUrl,
        requester: (() => {
          openedRequest += 1;
          throw new Error("must not open an HTTPS request");
        }) as NonNullable<Parameters<typeof fetchPublicHttps>[2]>["requester"],
        resolver: async () => [{ address: "198.18.0.160", family: 4 }],
      },
    )).rejects.toMatchObject({ code: "PROXY_CONFIGURATION" });
    expect(openedSocket).toBe(0);
    expect(openedRequest).toBe(0);
  }
});

test("ordinary DNS failure remains a network error and never falls through to the Fake-IP proxy", async () => {
  let openedSocket = 0;
  await expect(fetchPublicHttps(
    "https://ordinary-dns-failure.invalid/v1/models",
    { method: "GET" },
    {
      proxySocketFactory: async () => {
        openedSocket += 1;
        throw new Error("must not open a proxy socket");
      },
      proxyUrl: "http://127.0.0.1:49111",
      resolver: async () => {
        throw new Error("ENOTFOUND");
      },
    },
  )).rejects.toMatchObject({ code: "NETWORK" });
  expect(openedSocket).toBe(0);
});

test("Fake-IP HTTPS transport fails closed when DoH returns any non-public address", async () => {
  const connectRequests: string[] = [];
  let providerRequestCount = 0;
  let targetRequestCount = 0;
  const requester = ((
    url: URL,
    options: { agent?: false | { createConnection?: () => Duplex } },
    respond: (response: IncomingMessage) => void,
  ) => {
    const request = new EventEmitter() as ClientRequest;
    request.end = (() => {
      expect(options.agent).not.toBe(false);
      expect(options.agent && options.agent.createConnection?.())
        .toBeInstanceOf(Duplex);
      const type = url.searchParams.get("type");
      if (url.hostname !== "cloudflare-dns.com") {
        targetRequestCount += 1;
      }
      respond(incomingJson({
        Answer: type === "A" ? [{ data: "10.0.0.1", type: 1 }] : [],
        Status: 0,
      }));
      return request;
    }) as ClientRequest["end"];
    return request;
  }) as NonNullable<Parameters<typeof fetchPublicHttps>[2]>["requester"];

  await expect(fetchPublicHttps(
    "https://api.fake-ip.invalid/v1/models",
    { method: "GET" },
    {
      beforeRequest: () => {
        providerRequestCount += 1;
      },
      proxySocketFactory: async () =>
        new HttpConnectFixtureSocket((request) => {
          connectRequests.push(request);
        }),
      proxyUrl: "http://127.0.0.1:49111",
      requester,
      resolver: async () => [{ address: "198.18.0.160", family: 4 }],
      targetTlsFactory: async (socket) => socket,
    },
  )).rejects.toMatchObject({ code: "FORMAT" });

  expect(connectRequests).toHaveLength(2);
  expect(targetRequestCount).toBe(0);
  expect(providerRequestCount).toBe(0);
});

async function temporaryDataDirectory<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-server-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    expect(appDataDirectory()).toBe(directory);
    openAppDatabase(directory).close();
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
}

test("multi-protocol relay verifies, syncs enhanced and fallback catalogs, and exposes only bounded read-only summaries", async () => {
  await temporaryDataDirectory(async (directory) => {
    const secret = `relay-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://api.relay.example",
      driver: "multi-protocol-relay",
      label: "Relay",
    });
    const verificationRequests: Array<{
      authorization: string | null;
      method: string | undefined;
      url: string;
    }> = [];
    const verification = await verifyProviderProfile(profile.id, (async (
      input,
      init,
    ) => {
      const headers = new Headers(init?.headers);
      verificationRequests.push({
        authorization: headers.get("Authorization"),
        method: init?.method,
        url: String(input),
      });
      return String(input).endsWith("/skills/models")
        ? jsonResponse({
            models: [{
              display_name: "Zeta Image",
              name: "zeta/image-model",
              output_modalities: ["image"],
              pricing: { currency: "USD", image: "0.02" },
              protocols: ["gpt-image"],
              type: "图片",
            }],
            total: 1,
            type: "list",
          })
        : jsonResponse({ data: [{ id: "zeta/image-model" }] });
    }) as typeof fetch);
    expect(verification.modelCount).toBe(1);
    expect(verificationRequests).toEqual([
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/models",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/models",
      },
    ]);

    const syncRequests: Array<{ method: string | undefined; url: string }> = [];
    const synced = await syncProviderCatalog(profile.id, (async (input, init) => {
      syncRequests.push({ method: init?.method, url: String(input) });
      return String(input).endsWith("/skills/models")
        ? jsonResponse({
        models: [{
          display_name: "Sparse duplicate",
          name: "same/model",
        }, {
          display_name: "Rich duplicate",
          input_modalities: ["image", "text"],
          name: "same/model",
          output_modalities: ["text"],
          pricing_hint: "0.01 / request",
          protocols: ["openai-chat", "claude-messages", "not-supported"],
          type: "chat",
        }, {
          name: "alpha/video-model",
          modalities: ["video"],
          protocol: "media-generate",
          type: "视频",
        }, {
          display_name: "must never be exposed",
          name: secret,
          protocols: ["openai-chat"],
        }],
        total: 4,
        type: "list",
          })
        : jsonResponse({ data: [{ id: "same/model", name: "Basic same" }] });
    }) as typeof fetch);
    expect(syncRequests).toEqual([
      {
        method: "GET",
        url: "https://api.relay.example/v1/skills/models",
      },
      {
        method: "GET",
        url: "https://api.relay.example/v1/models",
      },
    ]);
    expect(synced.controlPlaneRequests).toBe(2);
    expect(synced.catalog.models.map((model) => model.providerModelId)).toEqual([
      "alpha/video-model",
      "same/model",
    ]);
    expect(synced.catalog.models[0]).toMatchObject({
      capability: "video",
      discoveryId: "multi-protocol-relay:alpha/video-model",
      metadata: {
        modalities: ["video"],
        modelType: "视频",
        protocols: ["media-generate"],
      },
      source: "multi-protocol-relay-account-catalog",
    });
    expect(synced.catalog.models[1]).toMatchObject({
      capability: "text",
      displayName: "Rich duplicate",
      metadata: {
        inputModalities: ["image", "text"],
        modelType: "chat",
        outputModalities: ["text"],
        pricingSummary: "0.01 / request",
        protocols: ["openai-chat", "claude-messages"],
      },
    });
    expect(synced.catalog).toMatchObject({
      credentialMode: "profile-api-key",
      keyStatus: "valid",
      modelCount: 2,
      scope: "account",
      supported: true,
      supportsImport: true,
      supportsReadOnlyManagement: true,
      supportsSync: true,
    });
    expect(JSON.stringify(synced)).not.toContain(secret);

    const actorUserId = "relay-admin-fixture";
    const actorStore = new DatabaseSync(join(directory, "unboundry.sqlite"));
    try {
      const timestamp = new Date().toISOString();
      actorStore.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash,
          role, status, created_at, updated_at
        ) VALUES (?, 'relay-admin', 'Relay Admin', 'test-only-hash',
          'admin', 'active', ?, ?)
      `).run(actorUserId, timestamp, timestamp);
    } finally {
      actorStore.close();
    }
    const imported = await importProviderCatalogDrafts(
      profile.id,
      [
        {
          discoveryId: "multi-protocol-relay:same/model",
          providerProtocol: "openai-chat",
        },
        {
          discoveryId: "multi-protocol-relay:same/model",
          providerProtocol: "claude-messages",
        },
        {
          discoveryId: "multi-protocol-relay:alpha/video-model",
          providerProtocol: "media-generate",
        },
      ],
      actorUserId,
    );
    expect(imported).toEqual({ imported: 3, skipped: 0 });
    const importedStore = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(importedStore.prepare(`
        SELECT provider_model_id, provider_protocol, capability, status
        FROM model_profiles
        WHERE provider_profile_id = ?
        ORDER BY provider_model_id, provider_protocol
      `).all(profile.id)).toEqual([
        {
          capability: "video",
          provider_model_id: "alpha/video-model",
          provider_protocol: "media-generate",
          status: "draft",
        },
        {
          capability: "text",
          provider_model_id: "same/model",
          provider_protocol: "claude-messages",
          status: "draft",
        },
        {
          capability: "text",
          provider_model_id: "same/model",
          provider_protocol: "openai-chat",
          status: "draft",
        },
      ]);
    } finally {
      importedStore.close();
    }

    const fallbackProfile = await saveProviderProfile({
      apiKey: `fallback-${randomUUID()}`,
      baseUrl: "https://fallback.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Fallback relay",
    });
    const fallbackRequests: string[] = [];
    const fallback = await syncProviderCatalog(
      fallbackProfile.id,
      (async (input, init) => {
        expect(init?.method).toBe("GET");
        fallbackRequests.push(String(input));
        return fallbackRequests.length === 1
          ? jsonResponse({ error: "not found" }, 404)
          : jsonResponse({ data: [{ id: "basic-only" }] });
      }) as typeof fetch,
    );
    expect(fallbackRequests).toEqual([
      "https://fallback.relay.example/v1/skills/models",
      "https://fallback.relay.example/v1/models",
    ]);
    expect(fallback.controlPlaneRequests).toBe(2);
    expect(fallback.catalog.models).toEqual([{
      capability: "unknown",
      discoveryId: "multi-protocol-relay:basic-only",
      displayName: "basic-only",
      providerModelId: "basic-only",
      source: "multi-protocol-relay-account-catalog",
      status: "available",
    }]);
    expect(await importProviderCatalogDrafts(
      fallbackProfile.id,
      [{
        capability: "text",
        discoveryId: "multi-protocol-relay:basic-only",
        providerProtocol: "openai-chat",
      }],
      actorUserId,
    )).toEqual({ imported: 1, skipped: 0 });
    const fallbackStore = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(fallbackStore.prepare(`
        SELECT capability, provider_model_id, provider_protocol, status
        FROM model_profiles
        WHERE provider_profile_id = ?
      `).get(fallbackProfile.id)).toEqual({
        capability: "text",
        provider_model_id: "basic-only",
        provider_protocol: "openai-chat",
        status: "draft",
      });
    } finally {
      fallbackStore.close();
    }

    const descriptor = await getProviderReadOnlyDescriptor(profile.id);
    expect(descriptor).toEqual({
      available: true,
      paidGenerationRequests: 0,
      providerReadOnlyRequests: 0,
      resources: {
        balance: { supported: true },
        modelDetail: { requiresModel: true, supported: true },
        pricing: { requiresModel: true, supported: true },
        taskStatus: { supported: true },
        usage: { supported: true },
      },
    });

    const managementRequests: Array<{
      authorization: string | null;
      method: string | undefined;
      url: string;
    }> = [];
    const managementFetcher = (async (input, init) => {
      const headers = new Headers(init?.headers);
      managementRequests.push({
        authorization: headers.get("Authorization"),
        method: init?.method,
        url: String(input),
      });
      const url = String(input);
      if (url.endsWith("/skills/balance")) {
        return jsonResponse({
          data: { available_balance: "12.50", currency: "USD" },
          status: secret,
          raw_private_note: secret,
        });
      }
      if (url.endsWith("/skills/usage")) {
        return jsonResponse({ data: { input_tokens: 12, output_tokens: 4 } });
      }
      if (url.endsWith("/skills/task-status")) {
        return jsonResponse({ data: [{ status: "running" }, { status: "done" }] });
      }
      if (url.includes("/pricing")) {
        return jsonResponse({ data: { currency: "USD", price: "0.02", unit: "request" } });
      }
      return jsonResponse({ undocumented_secret: secret });
    }) as typeof fetch;

    const balance = await readProviderReadOnlyResource(
      profile.id,
      "balance",
      {},
      managementFetcher,
    );
    expect(balance).toMatchObject({
      available: true,
      paidGenerationRequests: 0,
      parsed: true,
      providerReadOnlyRequests: 1,
      resource: "balance",
      summary: { balance: "12.50", currency: "USD" },
    });
    expect(JSON.stringify(balance)).not.toContain(secret);

    const usage = await readProviderReadOnlyResource(
      profile.id,
      "usage",
      {},
      managementFetcher,
    );
    expect(usage.summary).toEqual({ inputTokens: 12, outputTokens: 4 });

    const taskStatus = await readProviderReadOnlyResource(
      profile.id,
      "task-status",
      {},
      managementFetcher,
    );
    expect(taskStatus.summary).toEqual({
      itemCount: 2,
      statusCounts: { done: 1, running: 1 },
    });

    const pricing = await readProviderReadOnlyResource(
      profile.id,
      "pricing",
      { model: "vendor/model" },
      managementFetcher,
    );
    expect(pricing.summary).toEqual({
      cost: "0.02",
      currency: "USD",
      unit: "request",
    });

    const unknown = await readProviderReadOnlyResource(
      profile.id,
      "model-detail",
      { model: "vendor/model" },
      managementFetcher,
    );
    expect(unknown).toMatchObject({
      available: true,
      parsed: false,
      providerReadOnlyRequests: 1,
      resource: "model-detail",
    });
    expect(unknown).not.toHaveProperty("summary");
    expect(JSON.stringify(unknown)).not.toContain(secret);
    expect(managementRequests).toEqual([
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/balance",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/usage",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/task-status",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/models/vendor%2Fmodel/pricing",
      },
      {
        authorization: `Bearer ${secret}`,
        method: "GET",
        url: "https://api.relay.example/v1/skills/models/vendor%2Fmodel",
      },
    ]);

    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    const server = createServer((request, response) => {
      void authGate(request, response, () => {
        void adminProviderCatalogApi(request, response);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/${profile.id}/readonly`,
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(secret);
      expect(JSON.parse(text)).toMatchObject({
        available: true,
        paidGenerationRequests: 0,
        providerReadOnlyRequests: 0,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }

    expect(await getProviderCatalog(profile.id)).toMatchObject({ modelCount: 2 });
    await saveProviderProfile({
      apiKey: `${secret}-changed`,
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id);
    await expect(importProviderCatalogDrafts(
      profile.id,
      [{
        discoveryId: "multi-protocol-relay:same/model",
        providerProtocol: "openai-responses",
      }],
      actorUserId,
    )).rejects.toThrow(/synchronized again/);
    const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});

test("relay accepts bounded string model ids, falls back only for a real empty enhanced list, and fails closed otherwise", async () => {
  await temporaryDataDirectory(async () => {
    const stringProfile = await saveProviderProfile({
      apiKey: `string-${randomUUID()}`,
      baseUrl: "https://string-list.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "String list relay",
    });
    const stringCatalog = await syncProviderCatalog(
      stringProfile.id,
      (async (input) => String(input).endsWith("/skills/models")
        ? jsonResponse({ models: ["vendor/string-model"] })
        : jsonResponse({ data: ["vendor/string-model"] })) as typeof fetch,
    );
    expect(stringCatalog.controlPlaneRequests).toBe(2);
    expect(stringCatalog.catalog.models).toMatchObject([{
      providerModelId: "vendor/string-model",
      status: "available",
    }]);

    const fallbackProfile = await saveProviderProfile({
      apiKey: `empty-${randomUUID()}`,
      baseUrl: "https://empty-enhanced.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Empty enhanced relay",
    });
    const requests: string[] = [];
    const fallback = await syncProviderCatalog(
      fallbackProfile.id,
      (async (input) => {
        requests.push(String(input));
        return requests.length === 1
          ? jsonResponse({ models: [], total: 0 })
          : jsonResponse({ data: [{ id: "vendor/basic-model" }] });
      }) as typeof fetch,
    );
    expect(requests).toEqual([
      "https://empty-enhanced.relay.example/v1/skills/models",
      "https://empty-enhanced.relay.example/v1/models",
    ]);
    expect(fallback.controlPlaneRequests).toBe(2);
    expect(fallback.catalog.models).toMatchObject([{
      providerModelId: "vendor/basic-model",
      status: "available",
    }]);

    const malformedProfile = await saveProviderProfile({
      apiKey: `malformed-${randomUUID()}`,
      baseUrl: "https://malformed-enhanced.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Malformed enhanced relay",
    });
    let malformedRequests = 0;
    await expect(syncProviderCatalog(
      malformedProfile.id,
      (async () => {
        malformedRequests += 1;
        return jsonResponse({
          models: [{ unsupported_field: true }],
          total: 1,
        });
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(malformedRequests).toBe(1);

    const networkFallbackProfile = await saveProviderProfile({
      apiKey: `network-${randomUUID()}`,
      baseUrl: "https://network-enhanced.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Network enhanced relay",
    });
    let networkRequests = 0;
    await expect(syncProviderCatalog(
      networkFallbackProfile.id,
      (async () => {
        networkRequests += 1;
        throw new Error("fixture network failure");
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "NETWORK" });
    expect(networkRequests).toBe(1);
  });
});

test("relay authentication failures do not fall back or expose the remote response", async () => {
  await temporaryDataDirectory(async () => {
    const secret = `relay-auth-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://auth.relay.example/v1",
      driver: "multi-protocol-relay",
      label: "Relay auth",
    });
    const requests: string[] = [];
    await expect(verifyProviderProfile(profile.id, (async (input, init) => {
      expect(init?.method).toBe("GET");
      requests.push(String(input));
      return jsonResponse({ error: secret }, 401);
    }) as typeof fetch)).rejects.toMatchObject({ code: "AUTH" });
    expect(requests).toEqual([
      "https://auth.relay.example/v1/skills/models",
    ]);

    const privateProfile = await saveProviderProfile({
      apiKey: `private-${randomUUID()}`,
      baseUrl: "https://127.0.0.1/v1",
      driver: "multi-protocol-relay",
      label: "Private relay",
    });
    let privateRequestCount = 0;
    await expect(verifyProviderProfile(privateProfile.id, (async () => {
      privateRequestCount += 1;
      return jsonResponse({ models: [] });
    }) as typeof fetch)).rejects.toMatchObject({ code: "FORMAT" });
    expect(privateRequestCount).toBe(0);
  });
});
