import { spawn } from "node:child_process";
import { basename } from "node:path";

export type MediaProcessErrorCode =
  | "ABORTED"
  | "EXIT_FAILED"
  | "OUTPUT_LIMIT"
  | "PROCESS_QUEUE_FULL"
  | "SPAWN_FAILED"
  | "TIMEOUT";

export class MediaProcessError extends Error {
  constructor(
    readonly code: MediaProcessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MediaProcessError";
  }
}

type QueueEntry = {
  onAbort?: () => void;
  reject: (error: Error) => void;
  resolve: (release: () => void) => void;
  signal?: AbortSignal;
};

export class MediaProcessPool {
  private active = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(
    readonly concurrency: number,
    readonly queueLimit: number,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isSafeInteger(queueLimit) ||
      queueLimit < 0
    ) {
      throw new TypeError("Invalid media process pool limits");
    }
  }

  snapshot() {
    return { active: this.active, queued: this.queue.length };
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new MediaProcessError("ABORTED", "Media process aborted"));
    }
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(this.releaseHandle());
    }
    if (this.queue.length >= this.queueLimit) {
      return Promise.reject(new MediaProcessError(
        "PROCESS_QUEUE_FULL",
        "Media process capacity is busy",
      ));
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = { reject, resolve, signal };
      if (signal) {
        entry.onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new MediaProcessError("ABORTED", "Media process aborted"));
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.queue.push(entry);
    });
  }

  private releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      while (this.queue.length) {
        const entry = this.queue.shift()!;
        if (entry.signal?.aborted) {
          entry.signal.removeEventListener("abort", entry.onAbort!);
          entry.reject(new MediaProcessError("ABORTED", "Media process aborted"));
          continue;
        }
        if (entry.onAbort) {
          entry.signal?.removeEventListener("abort", entry.onAbort);
        }
        this.active += 1;
        entry.resolve(this.releaseHandle());
        break;
      }
    };
  }
}

const probePool = new MediaProcessPool(4, 16);
const encodePool = new MediaProcessPool(2, 8);

export type RunMediaProcessOptions = Readonly<{
  killGraceMs?: number;
  kind?: "encode" | "probe";
  pool?: MediaProcessPool;
  signal?: AbortSignal;
  stderrLimitBytes?: number;
  stdoutLimitBytes?: number;
  timeoutMs?: number;
}>;

function killProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
) {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function processArguments(command: string, args: readonly string[]) {
  const executable = basename(command).toLocaleLowerCase();
  if (
    executable === "ffmpeg" &&
    !args.includes("-nostdin")
  ) {
    return ["-nostdin", ...args];
  }
  return [...args];
}

/** Run an owned media child with bounded queue, output and process-tree life. */
export async function runMediaProcess(
  command: string,
  args: readonly string[],
  options: RunMediaProcessOptions = {},
) {
  const timeoutMs = options.timeoutMs ??
    (options.kind === "probe" ? 20_000 : 10 * 60_000);
  const killGraceMs = options.killGraceMs ?? 750;
  const stdoutLimitBytes = options.stdoutLimitBytes ?? 64 * 1_024;
  const stderrLimitBytes = options.stderrLimitBytes ?? 64 * 1_024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(killGraceMs) ||
    killGraceMs < 1 ||
    !Number.isSafeInteger(stdoutLimitBytes) ||
    stdoutLimitBytes < 1 ||
    !Number.isSafeInteger(stderrLimitBytes) ||
    stderrLimitBytes < 1
  ) {
    throw new TypeError("Invalid media process limits");
  }

  const pool = options.pool ??
    (options.kind === "probe" ? probePool : encodePool);
  const release = await pool.acquire(options.signal);
  try {
    if (options.signal?.aborted) {
      throw new MediaProcessError("ABORTED", "Media process aborted");
    }
    const child = spawn(command, processArguments(command, args), {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let failure: MediaProcessError | undefined;
    let escalation: NodeJS.Timeout | undefined;

    const terminate = (nextFailure: MediaProcessError) => {
      if (failure) return;
      failure = nextFailure;
      try {
        killProcessTree(child, "SIGTERM");
      } catch {
        // SIGKILL below is the final owned-tree cleanup attempt.
      }
      escalation = setTimeout(() => {
        try {
          killProcessTree(child, "SIGKILL");
        } catch {
          // The close/error event remains the completion authority.
        }
      }, killGraceMs);
      escalation.unref?.();
    };
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
      limit: number,
      label: "stderr" | "stdout",
    ) => {
      if (current.length + chunk.length > limit) {
        const remaining = Math.max(0, limit - current.length);
        terminate(new MediaProcessError(
          "OUTPUT_LIMIT",
          `Media process ${label} exceeded ${limit} bytes`,
        ));
        return remaining > 0
          ? Buffer.concat([current, chunk.subarray(0, remaining)])
          : current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, Buffer.from(chunk), stdoutLimitBytes, "stdout");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, Buffer.from(chunk), stderrLimitBytes, "stderr");
    });
    const onAbort = () => terminate(new MediaProcessError(
      "ABORTED",
      "Media process aborted",
    ));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => terminate(new MediaProcessError(
      "TIMEOUT",
      `Media process exceeded ${timeoutMs}ms`,
    )), timeoutMs);
    timeout.unref?.();

    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", (error) => reject(new MediaProcessError(
            "SPAWN_FAILED",
            error.message,
          )));
          child.once("close", (code, signal) => resolve({ code, signal }));
        },
      );
      if (failure) throw failure;
      if (result.code !== 0) {
        throw new MediaProcessError(
          "EXIT_FAILED",
          stderr.toString("utf8").trim() ||
            `${command} exited with ${result.code ?? result.signal ?? "unknown"}`,
        );
      }
      return {
        stderr: stderr.toString("utf8"),
        stdout: stdout.toString("utf8"),
      };
    } finally {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    release();
  }
}
