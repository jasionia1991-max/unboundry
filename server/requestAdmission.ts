import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

type Clock = () => number;

export class RequestAdmissionError extends Error {
  constructor(
    readonly code:
      | "LOGIN_BUSY"
      | "LOGIN_RATE_LIMITED"
      | "STREAM_LIMIT_REACHED",
    readonly statusCode: 429 | 503,
    readonly retryAfterSeconds: number,
  ) {
    super(
      code === "STREAM_LIMIT_REACHED"
        ? "Too many update streams"
        : "Too many login attempts",
    );
    this.name = "RequestAdmissionError";
  }
}

type TokenBucketOptions = Readonly<{
  capacity: number;
  idleTtlMs: number;
  maxKeys: number;
  now?: Clock;
  refillTokensPerSecond: number;
}>;

type Bucket = {
  lastRefill: number;
  lastSeen: number;
  tokens: number;
};

/** A single-process, bounded-memory token bucket collection. */
export class BoundedTokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: Clock;

  constructor(private readonly options: TokenBucketOptions) {
    if (
      !Number.isFinite(options.capacity) ||
      options.capacity < 1 ||
      !Number.isFinite(options.refillTokensPerSecond) ||
      options.refillTokensPerSecond <= 0 ||
      !Number.isSafeInteger(options.idleTtlMs) ||
      options.idleTtlMs < 1 ||
      !Number.isSafeInteger(options.maxKeys) ||
      options.maxKeys < 1
    ) {
      throw new TypeError("Invalid token bucket options");
    }
    this.now = options.now ?? Date.now;
  }

  get size() {
    return this.buckets.size;
  }

  consume(key: string, cost = 1) {
    if (!key || !Number.isFinite(cost) || cost <= 0) {
      throw new TypeError("Invalid token bucket key or cost");
    }
    const now = this.now();
    this.prune(now, key);
    const previous = this.buckets.get(key);
    const bucket = previous ?? {
      lastRefill: now,
      lastSeen: now,
      tokens: this.options.capacity,
    };
    const elapsed = Math.max(0, now - bucket.lastRefill);
    bucket.tokens = Math.min(
      this.options.capacity,
      bucket.tokens + elapsed * this.options.refillTokensPerSecond / 1_000,
    );
    bucket.lastRefill = now;
    bucket.lastSeen = now;
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true as const, retryAfterSeconds: 0 };
    }
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (cost - bucket.tokens) /
            this.options.refillTokensPerSecond,
        ),
      ),
    };
  }

  private prune(now: number, incomingKey: string) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeen <= this.options.idleTtlMs) break;
      this.buckets.delete(key);
    }
    if (this.buckets.has(incomingKey)) return;
    while (this.buckets.size >= this.options.maxKeys) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/** A fail-fast semaphore: callers never form an unbounded wait queue. */
export class FailFastSemaphore {
  private active = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("Semaphore limit must be positive");
    }
  }

  get activeCount() {
    return this.active;
  }

  tryAcquire() {
    if (this.active >= this.limit) return undefined;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
    };
  }
}

export type LoginAdmission = ReturnType<typeof createLoginAdmission>;

export function createLoginAdmission(options: {
  combo?: TokenBucketOptions;
  concurrency?: number;
  global?: TokenBucketOptions;
  ip?: TokenBucketOptions;
} = {}) {
  const global = new BoundedTokenBuckets(options.global ?? {
    capacity: 120,
    idleTtlMs: 10 * 60_000,
    maxKeys: 1,
    refillTokensPerSecond: 2,
  });
  const ip = new BoundedTokenBuckets(options.ip ?? {
    capacity: 30,
    idleTtlMs: 30 * 60_000,
    maxKeys: 4_096,
    refillTokensPerSecond: 0.5,
  });
  const combo = new BoundedTokenBuckets(options.combo ?? {
    capacity: 8,
    idleTtlMs: 30 * 60_000,
    maxKeys: 8_192,
    refillTokensPerSecond: 0.1,
  });
  const passwordChecks = new FailFastSemaphore(options.concurrency ?? 4);

  return {
    combo,
    global,
    ip,
    passwordChecks,
    admit(clientKey: string, loginName: string) {
      const normalizedClient = clientKey || "unknown";
      const normalizedLogin = loginName.trim().toLocaleLowerCase() || "invalid";
      const results = [
        global.consume("global"),
        ip.consume(normalizedClient),
        combo.consume(`${normalizedClient}\0${normalizedLogin}`),
      ];
      const denied = results.find((result) => !result.allowed);
      if (denied) {
        throw new RequestAdmissionError(
          "LOGIN_RATE_LIMITED",
          429,
          denied.retryAfterSeconds,
        );
      }
      const release = passwordChecks.tryAcquire();
      if (!release) {
        throw new RequestAdmissionError("LOGIN_BUSY", 503, 1);
      }
      return release;
    },
  };
}

export class BoundedConnectionAdmission {
  private active = 0;
  private readonly perKey = new Map<string, number>();

  constructor(
    readonly globalLimit: number,
    readonly perKeyLimit: number,
    readonly maxKeys = 4_096,
  ) {
    if (
      !Number.isSafeInteger(globalLimit) ||
      globalLimit < 1 ||
      !Number.isSafeInteger(perKeyLimit) ||
      perKeyLimit < 1 ||
      !Number.isSafeInteger(maxKeys) ||
      maxKeys < 1
    ) {
      throw new TypeError("Invalid connection admission limits");
    }
  }

  get activeCount() {
    return this.active;
  }

  countFor(key: string) {
    return this.perKey.get(key || "unknown") ?? 0;
  }

  tryAcquire(key: string) {
    const normalized = key || "unknown";
    const keyCount = this.perKey.get(normalized) ?? 0;
    if (
      this.active >= this.globalLimit ||
      keyCount >= this.perKeyLimit ||
      (keyCount === 0 && this.perKey.size >= this.maxKeys)
    ) {
      return undefined;
    }
    this.active += 1;
    this.perKey.delete(normalized);
    this.perKey.set(normalized, keyCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const remaining = (this.perKey.get(normalized) ?? 1) - 1;
      if (remaining > 0) this.perKey.set(normalized, remaining);
      else this.perKey.delete(normalized);
    };
  }
}

function normalizedIp(value: string) {
  const candidate = value.trim().replace(/^\[|\]$/g, "");
  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const ipv4 = candidate.slice("::ffff:".length);
    if (isIP(ipv4) === 4) return ipv4;
  }
  return isIP(candidate) ? candidate.toLowerCase() : "";
}

export function loopbackAddress(value: string) {
  const address = normalizedIp(value);
  return address === "127.0.0.1" || address === "::1";
}

/** Forwarded addresses are honored only from the explicitly enabled loopback proxy. */
export function trustedClientAddress(request: IncomingMessage) {
  const peer = normalizedIp(request.socket.remoteAddress ?? "") || "unknown";
  if (
    process.env.UNBOUNDRY_TRUST_PROXY === "1" &&
    loopbackAddress(peer)
  ) {
    const forwarded = String(request.headers["x-forwarded-for"] ?? "").trim();
    // The deployed loopback proxy contract has exactly one client hop. A
    // multi-value chain is ambiguous and could contain a client-prepended hop.
    if (forwarded.includes(",")) return peer;
    const address = normalizedIp(forwarded);
    if (address) return address;
  }
  return peer;
}

const loginAdmission = createLoginAdmission();
const versionStreamAdmission = new BoundedConnectionAdmission(128, 8);

export function boundedLoginAdmissionKey(loginName: string) {
  const normalized = loginName.trim().toLocaleLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,39}$/i.test(normalized)
    ? normalized
    : "<invalid>";
}

export function admitLoginAttempt(
  request: IncomingMessage,
  loginName: string,
) {
  return loginAdmission.admit(
    trustedClientAddress(request),
    boundedLoginAdmissionKey(loginName),
  );
}

export function admitVersionStream(request: IncomingMessage) {
  const release = versionStreamAdmission.tryAcquire(
    trustedClientAddress(request),
  );
  if (!release) {
    throw new RequestAdmissionError("STREAM_LIMIT_REACHED", 429, 5);
  }
  return release;
}
