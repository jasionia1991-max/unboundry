import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { saveAccountCredential } from "../server/accountCredentials";
import {
  ArkFilesError,
  prepareArkImageFile,
  readArkImageBytes,
  uploadArkImageFile,
} from "../server/arkFileUploader";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { executeTextTaskWithDependencies } from "../server/generationTasks";
import {
  acquireProviderGenerationSnapshot,
  saveProviderProfile,
  verifyProviderProfile,
  type ProviderGenerationSnapshot,
  type ProviderProfile,
} from "../server/providerProfiles";
import {
  createVolcengineArkTextResponse,
  type ArkTextInput,
} from "../server/volcengineArkTextProvider";

const snapshot: ProviderGenerationSnapshot = {
  apiKey: "sk-test-ark-files",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  configurationVersion: 1,
  credentialRevision: 1,
  profileId: "ark-files-test",
};

function largePngBytes(byteSize: number) {
  const bytes = Buffer.alloc(byteSize, 0xaa);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

function fileObject(id: string, status: "active" | "failed" | "processing") {
  const body: Record<string, unknown> = {
    bytes: 1,
    id,
    object: "file",
    purpose: "user_data",
    status,
  };
  if (status === "failed") {
    body.error = { code: "invalid_file", message: "文件处理失败", type: "invalid_request_error" };
  }
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function completedResponse(text = "识别结果：红色连衣裙") {
  return new Response(JSON.stringify({
    output: [{
      content: [{ text, type: "output_text" }],
      status: "completed",
      type: "message",
    }],
    status: "completed",
    usage: { input_tokens: 120, output_tokens: 18, total_tokens: 138 },
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

const textProfile: ProviderProfile = {
  apiKey: "test-secret-never-returned",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "volcengine-ark",
  id: "ark-files-test",
  label: "Ark Files Test",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

test("Ark text serializes file_id instead of image_url and rejects mixed inputs", async () => {
  const inputs: ArkTextInput[] = [
    {
      fileId: "file-20260820-test123",
      kind: "image",
      order: 1,
      role: "context-image",
    },
  ];
  let providerBody = "";
  await createVolcengineArkTextResponse(
    textProfile,
    {
      inputs,
      model: "doubao-seed-2-0-lite-260428",
      prompt: "识别参考图",
      thinkingLevel: "minimal",
    },
    async (_input, init) => {
      providerBody = String(init?.body ?? "");
      return completedResponse();
    },
  );
  const parsed = JSON.parse(providerBody) as {
    input: Array<{ content: Array<Record<string, unknown>> }>;
  };
  expect(parsed.input[0].content).toEqual([
    { text: "识别参考图", type: "input_text" },
    { file_id: "file-20260820-test123", type: "input_image" },
  ]);
  expect(JSON.stringify(parsed)).not.toContain("image_url");
  expect(JSON.stringify(parsed)).not.toContain("base64");

  await expect(createVolcengineArkTextResponse(
    textProfile,
    {
      inputs: [{
        fileId: "file-x",
        kind: "image",
        order: 1,
        role: "context-image",
        url: "data:image/png;base64,AAAA",
      }],
      model: "doubao-seed-2-0-lite-260428",
      prompt: "非法组合",
    },
    async () => completedResponse(),
  )).rejects.toMatchObject({ code: "FORMAT" });

  await expect(createVolcengineArkTextResponse(
    textProfile,
    {
      inputs: [{
        fileId: "file-x",
        kind: "audio",
        order: 1,
        role: "context-audio",
      }],
      model: "doubao-seed-2-0-lite-260428",
      prompt: "非图片不能用fileId",
    },
    async () => completedResponse(),
  )).rejects.toMatchObject({ code: "FORMAT" });
});

test("uploadArkImageFile uploads multipart, polls active and deletes on cleanup", async () => {
  const calls: Array<{ method: string; url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ init, method: init?.method ?? "GET", url });
    if (init?.method === "POST") return fileObject("file-upload-active", "processing");
    if (init?.method === "GET") return fileObject("file-upload-active", "active");
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  const uploaded = await uploadArkImageFile({
    bytes,
    fileName: "reference.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-upload-1",
    snapshot,
  });
  expect(uploaded.fileId).toBe("file-upload-active");
  const post = calls.find((call) => call.method === "POST");
  expect(post?.url).toBe("https://ark.cn-beijing.volces.com/api/v3/files");
  const form = post?.init?.body as FormData;
  expect(form.get("purpose")).toBe("user_data");
  expect((form.get("file") as File).name).toBe("reference.png");
  expect(new Headers(post?.init?.headers).get("Authorization"))
    .toBe("Bearer sk-test-ark-files");
  expect(calls.some((call) => call.method === "GET" &&
    call.url.endsWith("/files/file-upload-active"))).toBe(true);

  await Promise.all([uploaded.cleanup(), uploaded.cleanup()]);
  expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  expect(calls.some((call) => call.method === "DELETE" &&
    call.url.endsWith("/files/file-upload-active"))).toBe(true);
});

test("upload maps auth and failed file status to clear errors", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  let deleteCalls = 0;
  await expect(uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher: async () => new Response("{}", { status: 401 }),
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-auth-1",
    snapshot,
  })).rejects.toMatchObject({ code: "AUTH" });

  await expect(uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher: async (_input, init) => {
      if (init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(null, { status: 200 });
      }
      if (init?.method === "POST") {
        return fileObject("file-failed-status", "failed");
      }
      return fileObject("file-failed-status", "failed");
    },
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-failed-1",
    snapshot,
  })).rejects.toMatchObject({ code: "FORMAT", message: "文件处理失败" });
  expect(deleteCalls).toBe(1);
});

test("poll cancellation and a hung poll both abort transport and delete the owned file", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  for (const mode of ["cancel", "timeout"] as const) {
    const controller = new AbortController();
    let getAborted = false;
    let deleteCalls = 0;
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return fileObject(`file-poll-${mode}`, "processing");
      if (init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(null, { status: 200 });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          getAborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    };
    const pending = uploadArkImageFile({
      bytes,
      fileName: `${mode}.png`,
      fetcher,
      mimeType: "image/png",
      ownerId: "__test__",
      pollTimeoutMs: mode === "timeout" ? 25 : 5_000,
      profileId: `profile-poll-${mode}`,
      signal: controller.signal,
      snapshot,
    });
    if (mode === "cancel") setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({
      code: mode === "cancel" ? "CANCELLED" : "TIMEOUT",
    });
    expect(getAborted).toBe(true);
    expect(deleteCalls).toBe(1);
  }
});

test("upload deadline aborts the underlying POST instead of only winning a race", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  let postAborted = false;
  await expect(uploadArkImageFile({
    bytes,
    fileName: "upload-timeout.png",
    fetcher: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          postAborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-upload-timeout",
    snapshot,
    uploadTimeoutMs: 20,
  })).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(postAborted).toBe(true);
});

test("OSS reads abort on deadline and reject streamed overflow before upload", async () => {
  const declaredSize = 10 * 1024 * 1024 + 1;
  const base = {
    assetId: "oss-large-reference",
    byteSize: declaredSize,
    checksumSha256: "0".repeat(64),
    contentType: "image/png",
    objectKey: "private/oss-large-reference.png",
    ossReadUrl: "https://oss.example.test/signed",
    ownerId: "__test__",
    storageBackend: "oss" as const,
    storageName: "private/oss-large-reference.png",
  };
  let readAborted = false;
  await expect(readArkImageBytes({
    ...base,
    fetcher: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          readAborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    readTimeoutMs: 20,
  })).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(readAborted).toBe(true);

  const overflow = largePngBytes(20 * 1024 * 1024 + 1);
  await expect(readArkImageBytes({
    ...base,
    fetcher: async () => new Response(overflow),
  })).rejects.toMatchObject({ code: "FORMAT" });
});

test("account-scoped preparation acquires its slot before reading the third image", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let imageReads = 0;
  const pendingPosts: Array<() => void> = [];
  const arkFetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      const index = pendingPosts.length;
      return new Promise<Response>((resolve) => {
        pendingPosts.push(() => resolve(fileObject(`file-prepare-${index}`, "processing")));
      });
    }
    if (init?.method === "GET") return fileObject("file-prepare-active", "active");
    return new Response(null, { status: 200 });
  };
  const prepare = (assetId: string, ownerId = "owner-a") => prepareArkImageFile({
    fetcher: arkFetcher,
    image: {
      assetId,
      byteSize: bytes.byteLength,
      checksumSha256: checksum,
      contentType: "image/png",
      fetcher: async () => {
        imageReads += 1;
        return new Response(bytes);
      },
      objectKey: `private/${assetId}.png`,
      ossReadUrl: `https://oss.example.test/${assetId}`,
      ownerId,
      storageBackend: "oss",
      storageName: `private/${assetId}.png`,
    },
    mimeType: "image/png",
    ownerId,
    profileId: "shared-profile",
    queueTimeoutMs: 1_000,
    snapshot,
  });

  const first = prepare("prepare-a");
  const second = prepare("prepare-b");
  for (let attempt = 0; attempt < 80 && pendingPosts.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(imageReads).toBe(2);
  const third = prepare("prepare-c");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(imageReads).toBe(2);

  // A different account using the same profile gets its own two-slot gate.
  const otherAccount = prepare("prepare-other", "owner-b");
  for (let attempt = 0; attempt < 80 && imageReads < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(imageReads).toBe(3);

  pendingPosts[0]();
  for (let attempt = 0; attempt < 80 && imageReads < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(imageReads).toBe(4);
  for (const release of pendingPosts) release();
  await Promise.all([first, second, third, otherAccount]);

  const controller = new AbortController();
  let uploadCalls = 0;
  let readAborted = false;
  const cancelledRead = prepareArkImageFile({
    fetcher: async () => {
      uploadCalls += 1;
      return new Response(null, { status: 500 });
    },
    image: {
      assetId: "prepare-cancelled-read",
      byteSize: bytes.byteLength,
      checksumSha256: checksum,
      contentType: "image/png",
      fetcher: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            readAborted = true;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        }),
      objectKey: "private/prepare-cancelled-read.png",
      ossReadUrl: "https://oss.example.test/prepare-cancelled-read",
      ownerId: "owner-cancelled-read",
      storageBackend: "oss",
      storageName: "private/prepare-cancelled-read.png",
    },
    mimeType: "image/png",
    ownerId: "owner-cancelled-read",
    profileId: "shared-profile",
    signal: controller.signal,
    snapshot,
  });
  setTimeout(() => controller.abort(), 20);
  await expect(cancelledRead).rejects.toMatchObject({ code: "CANCELLED" });
  expect(readAborted).toBe(true);
  expect(uploadCalls).toBe(0);
});

test("upload poll timeout and queue timeout are bounded and explicit", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  await expect(uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher: async () => fileObject("file-processing", "processing"),
    mimeType: "image/png",
    ownerId: "__test__",
    pollTimeoutMs: 60,
    profileId: "profile-poll-timeout",
    snapshot,
  })).rejects.toMatchObject({ code: "TIMEOUT" });

  const pendingPosts: Array<() => void> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Promise<Response>((resolve) => {
        pendingPosts.push(() => resolve(fileObject("file-queued", "processing")));
      });
    }
    return fileObject("file-queued", "active");
  };
  const first = uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-queue-timeout",
    snapshot,
  });
  const second = uploadArkImageFile({
    bytes,
    fileName: "b.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-queue-timeout",
    snapshot,
  });
  for (let attempt = 0; attempt < 50 && pendingPosts.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(pendingPosts.length).toBe(2);
  await expect(uploadArkImageFile({
    bytes,
    fileName: "c.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-queue-timeout",
    queueTimeoutMs: 30,
    snapshot,
  })).rejects.toMatchObject({ code: "RATE_LIMIT" });
  pendingPosts[0]();
  pendingPosts[1]();
  await Promise.all([first, second]);
});

test("third upload waits for a per-profile slot instead of a global queue", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  let postCalls = 0;
  const pendingPosts: Array<() => void> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      postCalls += 1;
      return new Promise<Response>((resolve) => {
        pendingPosts.push(() => resolve(fileObject("file-gate", "processing")));
      });
    }
    return fileObject("file-gate", "active");
  };
  const first = uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-gate-1",
    snapshot,
  });
  const second = uploadArkImageFile({
    bytes,
    fileName: "b.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-gate-1",
    snapshot,
  });
  for (let attempt = 0; attempt < 50 && pendingPosts.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const third = uploadArkImageFile({
    bytes,
    fileName: "c.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-gate-1",
    queueTimeoutMs: 500,
    snapshot,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(postCalls).toBe(2);
  pendingPosts[0]();
  for (let attempt = 0; attempt < 50 && postCalls < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(postCalls).toBe(3);
  pendingPosts[1]();
  pendingPosts[2]?.();
  await Promise.all([first, second, third]);
});

test("timed-out gate waiters cannot consume slots needed by a later valid upload", async () => {
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  let postCalls = 0;
  const pendingPosts: Array<() => void> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      postCalls += 1;
      const fileId = `file-gate-stale-${postCalls}`;
      if (postCalls <= 2) {
        return new Promise<Response>((resolve) => {
          pendingPosts.push(() => resolve(fileObject(fileId, "processing")));
        });
      }
      return fileObject(fileId, "processing");
    }
    if (init?.method === "GET") return fileObject("file-gate-active", "active");
    return new Response(null, { status: 200 });
  };
  const start = (fileName: string, queueTimeoutMs = 500) =>
    uploadArkImageFile({
      bytes,
      fileName,
      fetcher,
      mimeType: "image/png",
      ownerId: "__test__",
      profileId: "profile-gate-stale",
      queueTimeoutMs,
      snapshot,
    });
  const first = start("a.png");
  const second = start("b.png");
  for (let attempt = 0; attempt < 50 && pendingPosts.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(pendingPosts).toHaveLength(2);
  const staleOne = start("stale-one.png", 20);
  const staleTwo = start("stale-two.png", 20);
  await expect(staleOne).rejects.toMatchObject({ code: "RATE_LIMIT" });
  await expect(staleTwo).rejects.toMatchObject({ code: "RATE_LIMIT" });

  const valid = start("valid.png", 500);
  pendingPosts[0]();
  pendingPosts[1]();
  await Promise.all([first, second, valid]);
  expect(postCalls).toBe(3);
});

test("upload cancels when the task signal aborts", async () => {
  const controller = new AbortController();
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  const fetcher = async () => new Promise<Response>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  const pending = uploadArkImageFile({
    bytes,
    fileName: "a.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-cancel-1",
    signal: controller.signal,
    snapshot,
  });
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
});

test("response-body abort and disconnect keep their distinct error classes", async () => {
  const controller = new AbortController();
  const bytes = largePngBytes(10 * 1024 * 1024 + 1);
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("{"));
        init?.signal?.addEventListener("abort", () => {
          stream.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    });
    return new Response(body, { status: 200 });
  };
  const pending = uploadArkImageFile({
    bytes,
    fileName: "body-abort.png",
    fetcher,
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-body-abort",
    signal: controller.signal,
    snapshot,
  });
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });

  await expect(uploadArkImageFile({
    bytes,
    fileName: "body-network-error.png",
    fetcher: async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("{"));
        setTimeout(() => stream.error(new TypeError("socket disconnected")), 5);
      },
    }), { status: 200 }),
    mimeType: "image/png",
    ownerId: "__test__",
    profileId: "profile-body-network-error",
    snapshot,
  })).rejects.toMatchObject({ code: "NETWORK" });
});

test("readArkImageBytes rejects missing, mismatched or invalid local files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-read-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    await mkdir(join(directory, "media"), { recursive: true });
    const bytes = largePngBytes(10 * 1024 * 1024 + 1);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(directory, "media", "read-reference.png"), bytes);
    await symlink(
      "read-reference.png",
      join(directory, "media", "read-reference-link.png"),
    );
    const base = {
      assetId: "read-reference",
      checksumSha256: checksum,
      contentType: "image/png",
      objectKey: "",
      ownerId: "__test__",
      storageBackend: "local" as const,
      storageName: "read-reference.png",
    };
    await expect(readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength,
      storageName: "missing-reference.png",
    })).rejects.toMatchObject({ code: "FORMAT" });
    await expect(readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength - 1,
    })).rejects.toMatchObject({ code: "FORMAT" });
    await expect(readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength,
      checksumSha256: "0".repeat(64),
    })).rejects.toMatchObject({ code: "FORMAT" });
    await expect(readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength,
      storageName: "read-reference-link.png",
    })).rejects.toMatchObject({ code: "FORMAT" });
    const controller = new AbortController();
    controller.abort("test-cancelled-local-read");
    await expect(readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "CANCELLED" });
    const loaded = await readArkImageBytes({
      ...base,
      byteSize: bytes.byteLength,
    });
    expect(loaded.bytes.byteLength).toBe(bytes.byteLength);
    expect(loaded.fileName).toBe("read-reference.png");
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    await rm(directory, { force: true, recursive: true });
  }
});

async function bootstrapTestDatabase(directory: string) {
  const bootstrap = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    bootstrap.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      "__test__",
      "test",
      "Test User",
      "test-only-password-hash",
      timestamp,
      timestamp,
    );
  } finally {
    bootstrap.close();
  }
}

async function insertLocalPng(directory: string, id: string, bytes: Buffer) {
  await bootstrapTestDatabase(directory);
  await mkdir(join(directory, "media"), { recursive: true });
  const storageName = `${id}.png`;
  await writeFile(join(directory, "media", storageName), bytes);
  const database = openAppDatabase(directory);
  try {
    database.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
    `).run(id);
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_status, media_width, media_height,
        storage_profile_id
      ) VALUES (
        'image', ?, '__test__', ?, ?, ?, ?, 'local', '', 'image/png', ?,
        'ready', 'not-applicable', 1, 1, NULL
      )
    `).run(
      id,
      storageName,
      bytes.byteLength,
      new Date().toISOString(),
      new Date().toISOString(),
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    database.close();
  }
  return storageName;
}

test("large PNG text task uses Files and cleanup failure cannot reverse Provider success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-task-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  const previousFlag = process.env.UNBOUNDRY_ARK_FILES_API;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  process.env.UNBOUNDRY_ARK_FILES_API = "1";
  try {
    const bytes = largePngBytes(10 * 1024 * 1024 + 1);
    await insertLocalPng(directory, "large-reference", bytes);
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "ark-files-large-0001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-files-target",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "large-reference",
          kind: "image",
          order: 1,
          role: "context-image",
          sourceNodeId: "upstream-image",
        }],
        outputCount: 1,
        responseFormat: "text",
        thinkingLevel: "minimal",
      },
      prompt: "识别参考图",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: textProfile.id,
    });
    const uploadedFileNames: string[] = [];
    const cleaned: string[] = [];
    let mediaUrlCalls = 0;
    let providerBody = "";
    await executeTextTaskWithDependencies(created.task.id, {
      acquireGenerationSnapshot: async () => snapshot,
      acquireProfile: async () => ({ profile: textProfile, release() {} }),
      fetcher: async (_input, init) => {
        providerBody = String(init?.body ?? "");
        return completedResponse();
      },
      mediaUrlForOwner: async () => {
        mediaUrlCalls += 1;
        return "unused";
      },
      ossReadUrlForMedia: async () => {
        throw new Error("local media must not need an OSS read URL");
      },
      store,
      prepareArkImage: async (input) => {
        uploadedFileNames.push(`${input.image.assetId}.png`);
        return {
          cleanup: async () => {
            cleaned.push("file-large-1");
            throw new ArkFilesError("NETWORK", "测试清理失败");
          },
          fileId: "file-large-1",
        };
      },
    });
    expect(uploadedFileNames).toEqual(["large-reference.png"]);
    expect(mediaUrlCalls).toBe(0);
    const parsed = JSON.parse(providerBody) as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(parsed.input[0].content).toContainEqual({
      file_id: "file-large-1",
      type: "input_image",
    });
    expect(JSON.stringify(parsed)).not.toContain("base64");
    expect(cleaned).toEqual(["file-large-1"]);
    expect(store.get(created.task.id)).toMatchObject({ state: "success" });
    store.close();
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    if (previousFlag === undefined) delete process.env.UNBOUNDRY_ARK_FILES_API;
    else process.env.UNBOUNDRY_ARK_FILES_API = previousFlag;
    await rm(directory, { force: true, recursive: true });
  }
});

test("flag off keeps the old base64 path for the same large PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-off-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  const previousFlag = process.env.UNBOUNDRY_ARK_FILES_API;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  delete process.env.UNBOUNDRY_ARK_FILES_API;
  try {
    const bytes = largePngBytes(10 * 1024 * 1024 + 1);
    await insertLocalPng(directory, "off-reference", bytes);
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "ark-files-off-0001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-off-target",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "off-reference",
          kind: "image",
          order: 1,
          role: "context-image",
          sourceNodeId: "upstream-image",
        }],
        outputCount: 1,
        responseFormat: "text",
      },
      prompt: "识别参考图",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: textProfile.id,
    });
    let mediaUrlCalls = 0;
    let uploaded = false;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireGenerationSnapshot: async () => snapshot,
      acquireProfile: async () => ({ profile: textProfile, release() {} }),
      fetcher: async (_input, init) => completedResponse(String(init?.body ?? "")),
      mediaUrlForOwner: async () => {
        mediaUrlCalls += 1;
        return `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
      },
      ossReadUrlForMedia: async () => "https://oss.example.test/signed",
      store,
      prepareArkImage: async () => {
        uploaded = true;
        return { cleanup: async () => undefined, fileId: "file-off" };
      },
    });
    expect(mediaUrlCalls).toBe(1);
    expect(uploaded).toBe(false);
    store.close();
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    if (previousFlag === undefined) delete process.env.UNBOUNDRY_ARK_FILES_API;
    else process.env.UNBOUNDRY_ARK_FILES_API = previousFlag;
    await rm(directory, { force: true, recursive: true });
  }
});

test("upload failure never reaches the Provider boundary or attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-fail-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  const previousFlag = process.env.UNBOUNDRY_ARK_FILES_API;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  process.env.UNBOUNDRY_ARK_FILES_API = "1";
  try {
    const bytes = largePngBytes(10 * 1024 * 1024 + 1);
    await insertLocalPng(directory, "fail-reference", bytes);
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "ark-files-fail-0001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-fail-target",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "fail-reference",
          kind: "image",
          order: 1,
          role: "context-image",
          sourceNodeId: "upstream-image",
        }],
        outputCount: 1,
        responseFormat: "text",
      },
      prompt: "识别参考图",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: textProfile.id,
    });
    let providerCalls = 0;
    let cleaned = false;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireGenerationSnapshot: async () => snapshot,
      acquireProfile: async () => {
        providerCalls += 1;
        return { profile: textProfile, release() {} };
      },
      fetcher: async () => {
        providerCalls += 1;
        return completedResponse();
      },
      mediaUrlForOwner: async () => "unused",
      store,
      prepareArkImage: async () => {
        throw new ArkFilesError("AUTH", "测试上传失败");
      },
    });
    expect(providerCalls).toBe(0);
    expect(cleaned).toBe(false);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "AUTH",
      state: "failed",
    });
    store.close();
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    if (previousFlag === undefined) delete process.env.UNBOUNDRY_ARK_FILES_API;
    else process.env.UNBOUNDRY_ARK_FILES_API = previousFlag;
    await rm(directory, { force: true, recursive: true });
  }
});

test("configuration change after upload blocks the request and still cleans the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-version-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  const previousFlag = process.env.UNBOUNDRY_ARK_FILES_API;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  process.env.UNBOUNDRY_ARK_FILES_API = "1";
  try {
    const bytes = largePngBytes(10 * 1024 * 1024 + 1);
    await insertLocalPng(directory, "version-reference", bytes);
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "ark-files-version-0001",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-version-target",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "version-reference",
          kind: "image",
          order: 1,
          role: "context-image",
          sourceNodeId: "upstream-image",
        }],
        outputCount: 1,
        responseFormat: "text",
      },
      prompt: "识别参考图",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: textProfile.id,
    });
    let providerCalls = 0;
    const cleaned: string[] = [];
    await executeTextTaskWithDependencies(created.task.id, {
      acquireGenerationSnapshot: async () => snapshot,
      acquireProfile: async () => {
        throw new (await import("../server/providerProfiles"))
          .ProviderGenerationConfigurationError(
            "PROVIDER_CONFIGURATION_MISMATCH",
            "平台连接配置已变化，已阻止旧任务继续请求",
          );
      },
      fetcher: async () => {
        providerCalls += 1;
        return completedResponse();
      },
      mediaUrlForOwner: async () => "unused",
      store,
      prepareArkImage: async () => ({
        cleanup: async () => { cleaned.push("file-version-1"); },
        fileId: "file-version-1",
      }),
    });
    expect(providerCalls).toBe(0);
    expect(cleaned).toEqual(["file-version-1"]);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "PROVIDER_CONFIGURATION_MISMATCH",
      state: "failed",
    });
    store.close();
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    if (previousFlag === undefined) delete process.env.UNBOUNDRY_ARK_FILES_API;
    else process.env.UNBOUNDRY_ARK_FILES_API = previousFlag;
    await rm(directory, { force: true, recursive: true });
  }
});

test("read-only generation snapshot reads consistent profile and credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-files-snapshot-"));
  const previousData = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    await bootstrapTestDatabase(directory);
    const profile = await saveProviderProfile({
      apiKey: "",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Snapshot Test",
    });
    const credentialStore = openAppDatabase(directory);
    await saveAccountCredential(
      credentialStore,
      "__test__",
      profile.id,
      "sk-snapshot-1234",
    );
    credentialStore.close();
    await verifyProviderProfile(profile.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const read = await acquireProviderGenerationSnapshot(
      profile.id,
      "__test__",
    );
    expect(read).toMatchObject({
      apiKey: "sk-snapshot-1234",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      credentialRevision: 1,
      profileId: profile.id,
    });
    expect(read.configurationVersion).toBeGreaterThanOrEqual(1);
  } finally {
    if (previousData === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousData;
    await rm(directory, { force: true, recursive: true });
  }
});
