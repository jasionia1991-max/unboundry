export type ProviderRequestOperation =
  | "cancel"
  | "poll"
  | "result-download"
  | "submit";

export const providerRequestTimeoutMsByOperation = {
  cancel: 30_000,
  poll: 30_000,
  "result-download": 180_000,
  submit: 180_000,
} as const satisfies Record<ProviderRequestOperation, number>;

export type ProviderRequestDeadlineScheduler = {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, timeoutMs: number): unknown;
};

export type ProviderRequestDeadlineOverrides = {
  /** Bounds initial response wait and later time without nonempty body bytes. */
  idleTimeoutMs?: number;
  scheduler?: ProviderRequestDeadlineScheduler;
  timeoutMs?: number;
};

export type ProviderRequestDeadlineOptions =
  & ProviderRequestDeadlineOverrides
  & {
    operation: ProviderRequestOperation;
    signal?: AbortSignal;
  };

export class ProviderRequestDeadlineError extends Error {
  constructor(
    readonly code: "CANCELLED" | "TIMEOUT",
    readonly operation: ProviderRequestOperation,
  ) {
    super(code === "TIMEOUT" ? "Provider request timed out" : "Provider request cancelled");
    this.name = "ProviderRequestDeadlineError";
  }
}

export type ProviderRequestDeadline = {
  complete(): void;
  race<T>(operation: PromiseLike<T>): Promise<T>;
  readonly signal: AbortSignal;
  throwIfAborted(): void;
  wrapStream(
    stream: ReadableStream<Uint8Array>,
    mapError?: (error: unknown) => unknown,
  ): ReadableStream<Uint8Array>;
};

const systemScheduler: ProviderRequestDeadlineScheduler = {
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout(callback, timeoutMs) {
    return setTimeout(callback, timeoutMs);
  },
};

function resolvedTimeoutMs(options: ProviderRequestDeadlineOptions) {
  const timeoutMs = options.timeoutMs ??
    providerRequestTimeoutMsByOperation[options.operation];
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Provider request timeout must be a positive integer");
  }
  return timeoutMs;
}

function resolvedIdleTimeoutMs(options: ProviderRequestDeadlineOptions) {
  // Result downloads bound both the initial response wait and body inactivity.
  // Only a nonempty body chunk renews that window. Keeping the
  // default undefined for submit, poll and cancel preserves their existing
  // request-only hard-deadline behavior.
  if (options.operation !== "result-download") return undefined;
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1) {
    throw new RangeError("Provider request idle timeout must be a positive integer");
  }
  return idleTimeoutMs;
}

function deadlineReason(
  signal: AbortSignal,
  operation: ProviderRequestOperation,
) {
  return signal.reason instanceof ProviderRequestDeadlineError
    ? signal.reason
    : new ProviderRequestDeadlineError("CANCELLED", operation);
}

/**
 * Starts one hard deadline that owns the request and, when wrapStream() is
 * returned, the complete response stream. complete() is idempotent and removes
 * both the timer and the caller abort listener.
 */
export function createProviderRequestDeadline(
  options: ProviderRequestDeadlineOptions,
): ProviderRequestDeadline {
  const timeoutMs = resolvedTimeoutMs(options);
  const idleTimeoutMs = resolvedIdleTimeoutMs(options);
  const scheduler = options.scheduler ?? systemScheduler;
  const controller = new AbortController();
  let completed = false;
  let timer: unknown;
  let idleTimer: unknown;

  const detach = () => {
    if (timer !== undefined) {
      scheduler.clearTimeout(timer);
      timer = undefined;
    }
    if (idleTimer !== undefined) {
      scheduler.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    options.signal?.removeEventListener("abort", onCallerAbort);
  };
  const abort = (code: "CANCELLED" | "TIMEOUT") => {
    if (completed || controller.signal.aborted) return;
    detach();
    controller.abort(new ProviderRequestDeadlineError(code, options.operation));
  };
  const onCallerAbort = () => abort("CANCELLED");
  const armIdleTimer = () => {
    if (
      idleTimeoutMs === undefined ||
      completed ||
      controller.signal.aborted
    ) {
      return;
    }
    if (idleTimer !== undefined) {
      scheduler.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    idleTimer = scheduler.setTimeout(() => abort("TIMEOUT"), idleTimeoutMs);
    if ((completed || controller.signal.aborted) && idleTimer !== undefined) {
      scheduler.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  if (options.signal?.aborted) {
    abort("CANCELLED");
  } else {
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = scheduler.setTimeout(() => abort("TIMEOUT"), timeoutMs);
    armIdleTimer();
    if (controller.signal.aborted && timer !== undefined) {
      scheduler.clearTimeout(timer);
      timer = undefined;
    }
  }

  const complete = () => {
    if (completed) return;
    completed = true;
    detach();
  };

  const throwIfAborted = () => {
    if (controller.signal.aborted) {
      throw deadlineReason(controller.signal, options.operation);
    }
  };

  const race = <T>(operation: PromiseLike<T>) => {
    try {
      throwIfAborted();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => finish(() => {
        reject(deadlineReason(controller.signal, options.operation));
      });
      controller.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(operation).then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  };

  const wrapStream = (
    stream: ReadableStream<Uint8Array>,
    mapError: (error: unknown) => unknown = (error) => error,
  ) => {
    const reader = stream.getReader();
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      complete();
      return true;
    };
    return new ReadableStream<Uint8Array>({
      async cancel(reason) {
        if (!settle()) return;
        await reader.cancel(reason);
      },
      async pull(streamController) {
        if (settled) return;
        try {
          const result = await race(reader.read());
          if (result.done) {
            settle();
            streamController.close();
            return;
          }
          if (result.value.byteLength > 0) armIdleTimer();
          streamController.enqueue(result.value);
        } catch (error) {
          if (!settle()) return;
          void reader.cancel(error).catch(() => undefined);
          streamController.error(mapError(error));
        }
      },
    });
  };

  return {
    complete,
    race,
    signal: controller.signal,
    throwIfAborted,
    wrapStream,
  };
}

export async function withProviderRequestDeadline<T>(
  options: ProviderRequestDeadlineOptions,
  operation: (deadline: ProviderRequestDeadline) => Promise<T>,
) {
  const deadline = createProviderRequestDeadline(options);
  try {
    deadline.throwIfAborted();
    return await deadline.race(operation(deadline));
  } finally {
    deadline.complete();
  }
}

/** A polling delay with deterministic timer injection and no retained listener. */
export function waitForProviderDelay(
  milliseconds: number,
  signal: AbortSignal,
  scheduler: ProviderRequestDeadlineScheduler = systemScheduler,
) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    return Promise.reject(new RangeError("Provider delay must be a non-negative integer"));
  }
  if (signal.aborted) {
    return Promise.reject(new ProviderRequestDeadlineError("CANCELLED", "poll"));
  }
  return new Promise<void>((resolve, reject) => {
    let timer: unknown;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => {
      reject(new ProviderRequestDeadlineError("CANCELLED", "poll"));
    });
    signal.addEventListener("abort", onAbort, { once: true });
    timer = scheduler.setTimeout(() => finish(resolve), milliseconds);
    if (settled && timer !== undefined) {
      scheduler.clearTimeout(timer);
      timer = undefined;
    }
  });
}
