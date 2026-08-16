import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as createHttpRequest,
  type IncomingMessage,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { expect, test } from "./safe-test";
import {
  clearThumbnailStripCache,
  thumbnailStrip,
} from "../client/src/canvas/thumbnailStrip";
import {
  BoundedBodyError,
  consumeBoundedReadableStream,
  readBoundedBody,
  rejectUnreadRequestBody,
} from "../server/boundedBody";
import {
  MediaProcessError,
  MediaProcessPool,
  runMediaProcess,
} from "../server/mediaProcess";
import {
  BoundedConnectionAdmission,
  BoundedTokenBuckets,
  boundedLoginAdmissionKey,
  createLoginAdmission,
  RequestAdmissionError,
  trustedClientAddress,
} from "../server/requestAdmission";
import {
  mediaResourceBudget,
  ResourceBudget,
  ResourceBudgetError,
} from "../server/resourceBudget";
import { saveGeneratedAudio } from "../server/audioStorage";
import { saveGeneratedPng } from "../server/assetStorage";
import { validateThumbnailSourceProbe } from "../server/playlistThumbnails";
import {
  assertPlaylistOutputDuration,
  playlistPartOutputLimit,
} from "../server/playlistExport";
import { authApi, authGate } from "../server/auth";
import { versionApi } from "../server/version";

function bodyRequest(
  chunks: Buffer[],
  headers: Record<string, string> = {},
) {
  const stream = Readable.from(chunks) as IncomingMessage;
  Object.assign(stream, { aborted: false, headers });
  return stream;
}

test("bounded token bucket keeps the same maxKeys=1 bucket", () => {
  let now = 0;
  const buckets = new BoundedTokenBuckets({
    capacity: 2,
    idleTtlMs: 60_000,
    maxKeys: 1,
    now: () => now,
    refillTokensPerSecond: 1 / 60,
  });
  expect(buckets.consume("global").allowed).toBe(true);
  expect(buckets.consume("global").allowed).toBe(true);
  expect(buckets.consume("global")).toMatchObject({ allowed: false });
  now += 60_000;
  expect(buckets.consume("global").allowed).toBe(true);
});

test("invalid login names share one bounded admission key", () => {
  expect(boundedLoginAdmissionKey(" Valid.Name ")).toBe("valid.name");
  expect(boundedLoginAdmissionKey("x".repeat(64 * 1_024))).toBe("<invalid>");
  expect(boundedLoginAdmissionKey("invalid/name")).toBe("<invalid>");
});

test("thumbnail generation rejects oversized source frames before encoding", () => {
  expect(validateThumbnailSourceProbe(7_680, 4_320, "60")).toEqual({
    duration: 60,
    height: 4_320,
    width: 7_680,
  });
  expect(() => validateThumbnailSourceProbe(7_681, 4_320, "60")).toThrow(
    /画面尺寸超出限制/,
  );
  expect(() => validateThumbnailSourceProbe(1, 1, "NaN")).toThrow(
    /没有可用画面/,
  );
});

test("playlist output caps reject truncation instead of accepting a short file", () => {
  expect(playlistPartOutputLimit(0)).toBe(500 * 1_024 * 1_024 + 1);
  expect(playlistPartOutputLimit(500 * 1_024 * 1_024 - 1)).toBe(2);
  expect(() => playlistPartOutputLimit(500 * 1_024 * 1_024)).toThrow(
    /500MiB/,
  );
  expect(() => assertPlaylistOutputDuration(58, 60, 1)).toThrow(
    /时长不完整/,
  );
  expect(() => assertPlaylistOutputDuration(60.02, 60, 1)).not.toThrow();
});

test("full token table does not reset an existing key", () => {
  const buckets = new BoundedTokenBuckets({
    capacity: 1,
    idleTtlMs: 60_000,
    maxKeys: 2,
    now: () => 0,
    refillTokensPerSecond: 1 / 60,
  });
  expect(buckets.consume("left").allowed).toBe(true);
  expect(buckets.consume("right").allowed).toBe(true);
  expect(buckets.consume("left").allowed).toBe(false);
  expect(buckets.size).toBe(2);
});

test("login verification concurrency fails fast without a queue", () => {
  const admission = createLoginAdmission({
    combo: {
      capacity: 100,
      idleTtlMs: 60_000,
      maxKeys: 10,
      refillTokensPerSecond: 1,
    },
    concurrency: 1,
    global: {
      capacity: 100,
      idleTtlMs: 60_000,
      maxKeys: 1,
      refillTokensPerSecond: 1,
    },
    ip: {
      capacity: 100,
      idleTtlMs: 60_000,
      maxKeys: 10,
      refillTokensPerSecond: 1,
    },
  });
  const release = admission.admit("127.0.0.1", "owner");
  expect(() => admission.admit("127.0.0.1", "owner")).toThrow(
    RequestAdmissionError,
  );
  expect(admission.passwordChecks.activeCount).toBe(1);
  release();
  expect(admission.passwordChecks.activeCount).toBe(0);
});

test("connection admission releases every permit exactly once", () => {
  const admission = new BoundedConnectionAdmission(2, 1);
  const release = admission.tryAcquire("127.0.0.1")!;
  expect(admission.tryAcquire("127.0.0.1")).toBeUndefined();
  release();
  release();
  expect(admission.activeCount).toBe(0);
  expect(admission.countFor("127.0.0.1")).toBe(0);
});

test("trusted proxy rejects a client-prepended multi-value forwarded chain", () => {
  const previous = process.env.UNBOUNDRY_TRUST_PROXY;
  process.env.UNBOUNDRY_TRUST_PROXY = "1";
  try {
    const request = {
      headers: { "x-forwarded-for": "203.0.113.8, 198.51.100.4" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    expect(trustedClientAddress(request)).toBe("127.0.0.1");
    request.headers["x-forwarded-for"] = "203.0.113.8";
    expect(trustedClientAddress(request)).toBe("203.0.113.8");
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_TRUST_PROXY;
    else process.env.UNBOUNDRY_TRUST_PROXY = previous;
  }
});

test("bounded body rejects declared and streamed overflow without large allocation", async () => {
  await expect(readBoundedBody(
    bodyRequest([], { "content-length": "9" }),
    { maximumBytes: 8 },
  )).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    statusCode: 413,
  } satisfies Partial<BoundedBodyError>);
  await expect(readBoundedBody(
    bodyRequest([Buffer.alloc(5), Buffer.alloc(4)]),
    { maximumBytes: 8 },
  )).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
});

test("provider result stream is cancelled exactly once when its writer fails", async () => {
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancellations += 1;
    },
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
  });
  await expect(consumeBoundedReadableStream(stream, 8, () => {
    throw new Error("injected write failure");
  })).rejects.toThrow("injected write failure");
  expect(cancellations).toBe(1);
});

test("generated media cancels its provider body when resource admission rejects", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m90-admission-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const releases: Array<() => void> = [];
  let cancellations = 0;
  try {
    releases.push(await mediaResourceBudget.reserve({
      bytes: 1,
      directory: dataDirectory,
      ownerId: "m90-budget-owner",
    }));
    releases.push(await mediaResourceBudget.reserve({
      bytes: 1,
      directory: dataDirectory,
      ownerId: "m90-budget-owner",
    }));
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    await expect(saveGeneratedAudio({
      body,
      contentType: "audio/mpeg",
      label: "resource rejection",
      ownerId: "m90-budget-owner",
    })).rejects.toMatchObject({ code: "RESOURCE_BUSY", statusCode: 429 });
    expect(cancellations).toBe(1);
    await expect(saveGeneratedPng({
      bytes: Buffer.from([1]),
      label: "resource rejection",
      ownerId: "m90-budget-owner",
    })).rejects.toMatchObject({ code: "RESOURCE_BUSY", statusCode: 429 });
  } finally {
    for (const release of releases) release();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("bounded body idle timeout forfeits keep-alive without preempting the response", async () => {
  const stream = new PassThrough() as unknown as IncomingMessage;
  Object.assign(stream, { aborted: false, headers: {} });
  await expect(readBoundedBody(stream, {
    idleTimeoutMs: 20,
    maximumBytes: 8,
    totalTimeoutMs: 40,
  })).rejects.toMatchObject({ code: "BODY_TIMEOUT", statusCode: 408 });
  expect(stream.destroyed).toBe(false);
  expect((stream as IncomingMessage & { shouldKeepAlive: boolean }).shouldKeepAlive)
    .toBe(false);
  stream.destroy();
});

test("real HTTP slow and oversized bodies receive structured close responses", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m90-auth-body-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const server = createServer(async (request, response) => {
    if (request.url === "/early") {
      rejectUnreadRequestBody(request, response);
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: "EARLY_REJECTION" }));
      return;
    }
    if (request.url === "/login" || request.url === "/logout") {
      await authApi(request, response);
      return;
    }
    if (request.url === "/protected") {
      authGate(request, response, () => {
        response.statusCode = 204;
        response.end();
      });
      return;
    }
    if (request.url === "/version") {
      versionApi(request, response, "version");
      return;
    }
    try {
      await readBoundedBody(request, {
        idleTimeoutMs: 30,
        maximumBytes: 8,
        totalTimeoutMs: 60,
      });
      response.statusCode = 200;
      response.end("{}");
    } catch (error) {
      const bounded = error as BoundedBodyError;
      response.statusCode = bounded.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: bounded.code }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const send = (
    headers: Record<string, string>,
    bytes: Buffer,
    finish: boolean,
    path = "/body",
  ) => new Promise<{
    body: string;
    closed: boolean;
    connection: string | undefined;
    status: number;
  }>((resolve, reject) => {
    let responseBody = "";
    let responseEnded = false;
    let requestClosed = false;
    let status = 0;
    let connection: string | undefined;
    const complete = () => {
      if (!responseEnded || !requestClosed) return;
      resolve({
        body: responseBody,
        closed: requestClosed,
        connection,
        status,
      });
    };
    const client = createHttpRequest({
      agent: false,
      headers,
      host: "127.0.0.1",
      method: "POST",
      path,
      port,
    }, (response) => {
      status = response.statusCode ?? 0;
      connection = response.headers.connection;
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        responseEnded = true;
        complete();
      });
    });
    client.on("close", () => {
      requestClosed = true;
      complete();
    });
    client.on("error", (error) => {
      if (!responseEnded) reject(error);
    });
    client.write(bytes);
    if (finish) client.end();
  });
  try {
    const oversized = await send({ "Content-Length": "9" }, Buffer.alloc(9), true);
    expect(oversized).toMatchObject({
      body: JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }),
      closed: true,
      connection: "close",
      status: 413,
    });
    const slow = await send({ "Transfer-Encoding": "chunked" }, Buffer.from("x"), false);
    expect(slow).toMatchObject({
      body: JSON.stringify({ code: "BODY_TIMEOUT" }),
      closed: true,
      connection: "close",
      status: 408,
    });
    const early = await send(
      { "Transfer-Encoding": "chunked" },
      Buffer.from("still-streaming"),
      false,
      "/early",
    );
    expect(early).toMatchObject({
      body: JSON.stringify({ code: "EARLY_REJECTION" }),
      closed: true,
      connection: "close",
      status: 400,
    });
    const rejectedLogin = await send(
      {
        Origin: "https://evil.invalid",
        "Transfer-Encoding": "chunked",
      },
      Buffer.from("still-streaming"),
      false,
      "/login",
    );
    expect(rejectedLogin).toMatchObject({
      closed: true,
      connection: "close",
      status: 403,
    });
    const logout = await send(
      { "Transfer-Encoding": "chunked" },
      Buffer.from("still-streaming"),
      false,
      "/logout",
    );
    expect(logout).toMatchObject({
      closed: true,
      connection: "close",
      status: 200,
    });
    const unauthenticatedMutation = await send(
      { "Transfer-Encoding": "chunked" },
      Buffer.from("still-streaming"),
      false,
      "/protected",
    );
    expect(unauthenticatedMutation).toMatchObject({
      closed: true,
      connection: "close",
      status: 401,
    });
    const versionMutation = await send(
      { "Transfer-Encoding": "chunked" },
      Buffer.from("still-streaming"),
      false,
      "/version",
    );
    expect(versionMutation).toMatchObject({
      closed: true,
      connection: "close",
      status: 405,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("resource budget preserves the exact 500MiB contract and releases idempotently", async () => {
  const maxVideoBytes = 500 * 1_024 * 1_024;
  const budget = new ResourceBudget({
    globalBytes: 2 * 1_024 * 1_024 * 1_024,
    globalJobs: 2,
    minimumFreeBytes: 0,
    perOwnerJobs: 1,
    statFileSystem: async () => ({ bavail: 4_096, bsize: 1_024 * 1_024 }),
  });
  const release = await budget.reserve({
    bytes: maxVideoBytes,
    directory: "/virtual",
    ownerId: "owner",
  });
  expect(budget.snapshot()).toMatchObject({
    activeJobs: 1,
    reservedBytes: maxVideoBytes,
  });
  release();
  release();
  expect(budget.snapshot()).toMatchObject({ activeJobs: 0, reservedBytes: 0 });
});

test("resource budget rejects low disk and rolls back its tentative claim", async () => {
  const budget = new ResourceBudget({
    globalBytes: 1_000,
    globalJobs: 1,
    minimumFreeBytes: 500,
    perOwnerJobs: 1,
    statFileSystem: async () => ({ bavail: 5, bsize: 100 }),
  });
  await expect(budget.reserve({
    bytes: 1,
    directory: "/virtual",
    ownerId: "owner",
  })).rejects.toBeInstanceOf(ResourceBudgetError);
  expect(budget.snapshot()).toMatchObject({ activeJobs: 0, reservedBytes: 0 });
});

test("concurrent disk reservations share one aggregate free-space promise", async () => {
  let releaseStats!: () => void;
  const statsBarrier = new Promise<void>((resolve) => {
    releaseStats = resolve;
  });
  const checkedDirectories: string[] = [];
  let statsCalls = 0;
  const budget = new ResourceBudget({
    globalBytes: 2 * 1_024 * 1_024 * 1_024,
    globalJobs: 2,
    minimumFreeBytes: 1_024 * 1_024 * 1_024,
    perOwnerJobs: 2,
    statFileSystem: async (directory) => {
      checkedDirectories.push(directory);
      statsCalls += 1;
      await statsBarrier;
      return { bavail: 1_536, bsize: 1_024 * 1_024 };
    },
  });
  const input = {
    bytes: 500 * 1_024 * 1_024,
    directory: "/checked-workspace",
    ownerId: "owner",
  };
  const first = budget.reserve(input);
  const second = budget.reserve(input);
  const secondRejected = expect(second).rejects.toMatchObject({
    code: "INSUFFICIENT_STORAGE",
    statusCode: 507,
  });
  await expect.poll(() => statsCalls).toBe(2);
  releaseStats();
  const releaseFirst = await first;
  await secondRejected;
  expect(checkedDirectories).toEqual([
    "/checked-workspace",
    "/checked-workspace",
  ]);
  releaseFirst();
  expect(budget.snapshot()).toMatchObject({ activeJobs: 0, reservedBytes: 0 });
});

test("thumbnail leases revoke uncached resolved object URLs", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const originalFetch = globalThis.fetch;
  const created: string[] = [];
  const revoked: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://resource.test" } },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      const value = `blob:m90-${created.length}`;
      created.push(value);
      return value;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (value: string) => revoked.push(value),
  });
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {
    headers: {
      "X-Thumbnail-Columns": "1",
      "X-Thumbnail-Count": "1",
      "X-Thumbnail-Frame-Height": "1",
      "X-Thumbnail-Frame-Width": "1",
      "X-Thumbnail-Interval": "1",
      "X-Thumbnail-Rows": "1",
    },
    status: 200,
  });
  try {
    const leases = Array.from({ length: 25 }, (_, index) =>
      thumbnailStrip(`/api/video-assets/m90-${index}.mp4`));
    await Promise.all(leases.map((lease) => lease.result));
    leases.forEach((lease) => lease.release());
    clearThumbnailStripCache();
    expect(revoked.sort()).toEqual(created.sort());
  } finally {
    clearThumbnailStripCache();
    globalThis.fetch = originalFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete (globalThis as { window?: unknown }).window;
    if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
    if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
  }
});

test("media process queue is bounded and releases aborted waiters", async () => {
  const pool = new MediaProcessPool(1, 1);
  const first = await pool.acquire();
  const controller = new AbortController();
  const waiting = pool.acquire(controller.signal);
  await expect(pool.acquire()).rejects.toMatchObject({
    code: "PROCESS_QUEUE_FULL",
  });
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
  first();
  expect(pool.snapshot()).toEqual({ active: 0, queued: 0 });
});

test("media process timeout kills its owned process group and releases capacity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m90-process-"));
  const script = join(directory, "ignore-term.mjs");
  const childPidFile = join(directory, "child.pid");
  await writeFile(script, [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    `writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));`,
    'process.on("SIGTERM", () => undefined);',
    'setInterval(() => {}, 1000);',
  ].join("\n"));
  const pool = new MediaProcessPool(1, 0);
  try {
    await expect(runMediaProcess(process.execPath, [script], {
      killGraceMs: 30,
      pool,
      timeoutMs: 300,
    })).rejects.toMatchObject({ code: "TIMEOUT" } satisfies Partial<MediaProcessError>);
    expect(pool.snapshot()).toEqual({ active: 0, queued: 0 });
    const childPid = Number(await readFile(childPidFile, "utf8"));
    await expect.poll(() => {
      try {
        process.kill(childPid, 0);
        return "alive";
      } catch {
        return "gone";
      }
    }).toBe("gone");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("media process bounds stderr capture", async () => {
  const pool = new MediaProcessPool(1, 0);
  await expect(runMediaProcess(process.execPath, [
    "-e",
    'process.stderr.write("x".repeat(4096)); setInterval(() => {}, 1000)',
  ], {
    killGraceMs: 20,
    pool,
    stderrLimitBytes: 128,
    timeoutMs: 2_000,
  })).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  expect(pool.snapshot()).toEqual({ active: 0, queued: 0 });
});
