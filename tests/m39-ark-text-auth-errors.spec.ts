import { expect, test } from "./safe-test";
import type { ProviderProfile } from "../server/providerProfiles";
import type { ProviderRequestDeadlineScheduler } from "../server/providerRequestDeadline";
import { createVolcengineArkTextResponse } from "../server/volcengineArkTextProvider";

const profile: ProviderProfile = {
  apiKey: "fake-key-never-sent",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "volcengine-ark",
  id: "ark-text-error-test",
  label: "Ark Text Error Test",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  model: "doubao-seed-2-0-lite-260428",
  prompt: "只检查错误分类，不访问真实Provider",
} as const;

function manualDeadline() {
  let callback: (() => void) | undefined;
  const scheduler: ProviderRequestDeadlineScheduler = {
    clearTimeout() {
      callback = undefined;
    },
    setTimeout(value) {
      callback = value;
      return "manual-deadline";
    },
  };
  return {
    expire() {
      const current = callback;
      if (!current) throw new Error("deadline is not armed");
      current();
    },
    options: { scheduler, timeoutMs: 10_000 },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("Ark Text distinguishes invalid credentials from missing model permission", async () => {
  let fakeCalls = 0;

  await expect(createVolcengineArkTextResponse(
    profile,
    input,
    async () => {
      fakeCalls += 1;
      return new Response("{}", { status: 401 });
    },
  )).rejects.toMatchObject({
    code: "AUTH",
    message: "火山方舟API Key无效或已失效，请由管理员更新平台连接",
  });

  await expect(createVolcengineArkTextResponse(
    profile,
    input,
    async () => {
      fakeCalls += 1;
      return new Response("{}", { status: 403 });
    },
  )).rejects.toMatchObject({
    code: "PERMISSION",
    message: "当前API Key没有所选文字模型权限，请在方舟控制台开通模型服务并更新平台连接",
  });

  expect(fakeCalls).toBe(2);
});

test("Ark Text hard deadline covers a response body that hangs after headers", async () => {
  const timer = manualDeadline();
  const bodyStarted = deferred<void>();
  let requestSignal: AbortSignal | null | undefined;
  const body = {
    getReader() {
      bodyStarted.resolve(undefined);
      return {
        cancel: async () => undefined,
        read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
  const pending = createVolcengineArkTextResponse(
    profile,
    input,
    async (_request, init) => {
      requestSignal = init?.signal;
      return {
        body,
        ok: true,
        status: 200,
      } as Response;
    },
    undefined,
    undefined,
    timer.options,
  );

  await bodyStarted.promise;
  timer.expire();
  await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(requestSignal?.aborted).toBe(true);
});

test("Ark Text maps caller abort to CANCELLED instead of TIMEOUT", async () => {
  const timer = manualDeadline();
  const controller = new AbortController();
  const requestStarted = deferred<void>();
  const pending = createVolcengineArkTextResponse(
    profile,
    input,
    async () => {
      requestStarted.resolve(undefined);
      return await new Promise<Response>(() => undefined);
    },
    controller.signal,
    undefined,
    timer.options,
  );

  await requestStarted.promise;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
});
