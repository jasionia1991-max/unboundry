import { mkdir, statfs } from "node:fs/promises";

type StatFsLike = Readonly<{
  bavail: bigint | number;
  bsize: bigint | number;
}>;

export class ResourceBudgetError extends Error {
  constructor(
    readonly code: "INSUFFICIENT_STORAGE" | "RESOURCE_BUSY",
    readonly statusCode: 429 | 507,
    message: string,
  ) {
    super(message);
    this.name = "ResourceBudgetError";
  }
}

export type ResourceBudgetOptions = Readonly<{
  globalBytes: number;
  globalJobs: number;
  minimumFreeBytes: number;
  perOwnerJobs: number;
  statFileSystem?: (directory: string) => Promise<StatFsLike>;
}>;

export type ResourceReservationInput = Readonly<{
  bytes: number;
  directory: string;
  ownerId: string;
  /**
   * External-object publications still consume process memory/concurrency but
   * do not need a second local copy. Local writers keep the disk fence.
   */
  requiresLocalStorage?: boolean;
}>;

export type ResourceProcessReservation = Readonly<{
  release: () => void;
  verifyLocalStorage: (directory: string) => Promise<void>;
}>;

/** In-memory admission for this single-process deployment. */
export class ResourceBudget {
  private activeJobs = 0;
  private reservedBytes = 0;
  private readonly ownerJobs = new Map<string, number>();
  private readonly statFileSystem: (directory: string) => Promise<StatFsLike>;

  constructor(readonly options: ResourceBudgetOptions) {
    if (
      !Number.isSafeInteger(options.globalBytes) ||
      options.globalBytes < 1 ||
      !Number.isSafeInteger(options.globalJobs) ||
      options.globalJobs < 1 ||
      !Number.isSafeInteger(options.minimumFreeBytes) ||
      options.minimumFreeBytes < 0 ||
      !Number.isSafeInteger(options.perOwnerJobs) ||
      options.perOwnerJobs < 1
    ) {
      throw new TypeError("Invalid resource budget options");
    }
    this.statFileSystem = options.statFileSystem ?? statfs;
  }

  snapshot() {
    return {
      activeJobs: this.activeJobs,
      owners: this.ownerJobs.size,
      reservedBytes: this.reservedBytes,
    };
  }

  reserveProcess(
    input: Pick<ResourceReservationInput, "bytes" | "ownerId">,
  ): ResourceProcessReservation {
    if (
      !input.ownerId ||
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > this.options.globalBytes
    ) {
      throw new ResourceBudgetError(
        "RESOURCE_BUSY",
        429,
        "Media resource request exceeds the process budget",
      );
    }
    const ownerCount = this.ownerJobs.get(input.ownerId) ?? 0;
    if (
      this.activeJobs >= this.options.globalJobs ||
      ownerCount >= this.options.perOwnerJobs ||
      this.reservedBytes + input.bytes > this.options.globalBytes
    ) {
      throw new ResourceBudgetError(
        "RESOURCE_BUSY",
        429,
        "Media processing capacity is busy",
      );
    }

    // Claim process capacity before the asynchronous disk check so concurrent
    // callers cannot all pass the same snapshot.
    this.activeJobs += 1;
    this.reservedBytes += input.bytes;
    const claimedBytes = this.reservedBytes;
    this.ownerJobs.set(input.ownerId, ownerCount + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.reservedBytes = Math.max(0, this.reservedBytes - input.bytes);
      const remaining = (this.ownerJobs.get(input.ownerId) ?? 1) - 1;
      if (remaining > 0) this.ownerJobs.set(input.ownerId, remaining);
      else this.ownerJobs.delete(input.ownerId);
    };

    const verifyLocalStorage = async (directory: string) => {
      try {
        const info = await this.statFileSystem(directory);
        const available = BigInt(info.bavail) * BigInt(info.bsize);
        const required = BigInt(claimedBytes + this.options.minimumFreeBytes);
        if (available < required) {
          throw new ResourceBudgetError(
            "INSUFFICIENT_STORAGE",
            507,
            "Insufficient storage for media processing",
          );
        }
      } catch (error) {
        release();
        if (error instanceof ResourceBudgetError) throw error;
        throw new ResourceBudgetError(
          "INSUFFICIENT_STORAGE",
          507,
          "Storage capacity could not be verified",
        );
      }
    };
    return { release, verifyLocalStorage };
  }

  async reserve(input: ResourceReservationInput) {
    const reservation = this.reserveProcess(input);
    if (input.requiresLocalStorage !== false) {
      await reservation.verifyLocalStorage(input.directory);
    }
    return reservation.release;
  }
}

const gibibyte = 1_024 * 1_024 * 1_024;
export const mediaResourceBudget = new ResourceBudget({
  globalBytes: 2 * gibibyte,
  globalJobs: 2,
  minimumFreeBytes: gibibyte,
  perOwnerJobs: 2,
});

export async function reserveMediaResources(
  input: ResourceReservationInput,
) {
  await mkdir(input.directory, { recursive: true });
  return mediaResourceBudget.reserve(input);
}

export function reserveMediaProcessResources(
  input: Pick<ResourceReservationInput, "bytes" | "ownerId">,
) {
  return mediaResourceBudget.reserveProcess(input);
}
