import { execFileSync } from "node:child_process";
import { hasPendingGeneratedMediaPublications, hasPendingMediaDeletions,
  hasPendingUploadMediaPublications, pendingGeneratedMediaPublications } from "../server/mediaLifecycle";
import { retrySingleNodeCanvasProjections } from "../server/generationCanvasProjectionService";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { WorkflowRunSummary } from "../types/workflowRuns";
import type { AuthoritativeCanvasDocument } from "../types/canvasCommands";
import { mergeWorkflowResultNodes, planCanvasCommandIntents } from "../client/src/canvas/canvasCommandJournal";
import { HistoryPreviewCache } from "../server/mediaEditSource";
import { createHistoryImagePreview } from "../server/providerImageNormalization";
import { mediaResourceBudget } from "../server/resourceBudget";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { expect, test } from "./safe-test";
import {
  migrationIncompleteMarker,
  openAppDatabase,
  readAppDatabaseSnapshot,
  resetVerifiedCurrentDatabasesForTests,
  setDuringCurrentDatabaseOpenForTests,
  createRuntimeDatabaseTransactionRunner,
  closeRuntimeDatabaseTransactions,
} from "../server/database";
import { generationTaskApplication } from "../server/generationTasks";

async function temporaryDatabase(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "m107-performance-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    openAppDatabase(directory).close();
    await work(directory);
  } finally {
    closeRuntimeDatabaseTransactions();
    setDuringCurrentDatabaseOpenForTests(undefined);
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("capability queries never reopen a writer or mutate an unavailable model catalogue", async () => {
  await temporaryDatabase(async (directory) => {
    const before = readAppDatabaseSnapshot((db) => ({
      models: db.prepare("SELECT count(*) AS n FROM model_profiles").get(),
      tasks: db.prepare("SELECT count(*) AS n FROM generation_tasks").get(),
    }), directory);
    setDuringCurrentDatabaseOpenForTests((checkpoint) => {
      if (checkpoint === "before-writer-sidecar-validation") {
        throw new Error("capability query tried to open a writer");
      }
    });
    const { availability, model } = await generationTaskApplication.imageToolAvailability("performance-owner");
    expect(availability.providerConfigured).toBe(false);
    expect(model).toBeUndefined();
    expect(await generationTaskApplication.generationAvailability("other-owner"))
      .toEqual(availability);
    expect(readAppDatabaseSnapshot((db) => ({
      models: db.prepare("SELECT count(*) AS n FROM model_profiles").get(),
      tasks: db.prepare("SELECT count(*) AS n FROM generation_tasks").get(),
    }), directory)).toEqual(before);
  });
});

test("runtime transaction lane reuses its validated connection and rolls back failures", async () => {
  await temporaryDatabase(async () => {
    const lane = createRuntimeDatabaseTransactionRunner();
    const insert = (id: string) => lane.run((db) => db.prepare(
      "INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES (NULL,?,?,1)",
    ).run(id, "synthetic"));
    insert("first");
    setDuringCurrentDatabaseOpenForTests((checkpoint) => {
      if (checkpoint === "before-writer-sidecar-validation") throw new Error("unexpected reopen");
    });
    insert("second");
    expect(() => lane.run((db) => {
      db.prepare("DELETE FROM project_metadata WHERE id='first'").run();
      throw new Error("synthetic failure");
    })).toThrow("synthetic failure");
    expect(readAppDatabaseSnapshot((db) => db.prepare(
      "SELECT count(*) AS n FROM project_metadata WHERE id IN ('first','second')",
    ).get())).toEqual({ n: 2 });
  });
});

test("runtime transaction lane preserves DELETE journal mode across committed and rolled-back writes", async () => {
  await temporaryDatabase(async (directory) => {
    const path = join(directory, "unboundry.sqlite");
    const setup = new DatabaseSync(path);
    expect(setup.prepare("PRAGMA journal_mode=DELETE").get()).toEqual({ journal_mode: "delete" });
    setup.close();
    const lane = createRuntimeDatabaseTransactionRunner();
    for (const id of ["delete-first", "delete-second"]) {
      lane.run((db) => {
        db.prepare("INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,?,'synthetic',1)").run(id);
        expect(existsSync(`${path}-journal`)).toBe(true);
      });
      expect(existsSync(`${path}-journal`)).toBe(false);
    }
    expect(() => lane.run((db) => {
      db.exec("DELETE FROM project_metadata WHERE id='delete-first'");
      throw new Error("synthetic DELETE rollback");
    })).toThrow("synthetic DELETE rollback");
    const verify = new DatabaseSync(path, { readOnly: true });
    try {
      expect(verify.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
      expect(verify.prepare("SELECT count(*) AS n FROM project_metadata WHERE id IN ('delete-first','delete-second')").get()).toEqual({ n: 2 });
    } finally { verify.close(); }
  });
});

test("runtime DELETE lane still rejects a journal that predates its transaction", async () => {
  await temporaryDatabase(async (directory) => {
    const path = join(directory, "unboundry.sqlite");
    const setup = new DatabaseSync(path);
    setup.exec("PRAGMA journal_mode=DELETE"); setup.close();
    const lane = createRuntimeDatabaseTransactionRunner();
    lane.run(() => 1);
    writeFileSync(`${path}-journal`, "unexpected journal", { mode: 0o600 });
    let entered = false;
    try {
      expect(() => lane.run(() => { entered = true; })).toThrow("sidecars are incomplete");
      expect(entered).toBe(false);
    } finally { await rm(`${path}-journal`, { force: true }); }
  });
});

test("runtime transaction lane rejects async and nested work before committing", async () => {
  await temporaryDatabase(async () => {
    const lane = createRuntimeDatabaseTransactionRunner();
    expect(() => lane.run((db) => {
      db.exec("INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,'async','pending',1)");
      return Promise.resolve("invalid");
    })).toThrow("synchronous");
    expect(() => lane.run(() => lane.run(() => 1))).toThrow("nested");
    expect(readAppDatabaseSnapshot((db) => db.prepare(
      "SELECT count(*) AS n FROM project_metadata WHERE id='async'",
    ).get())).toEqual({ n: 0 });
  });
});

test("runtime transaction lane fences maintenance entered during a transaction", async () => {
  await temporaryDatabase(async (directory) => {
    const lane = createRuntimeDatabaseTransactionRunner();
    const marker = join(directory, migrationIncompleteMarker);
    expect(() => lane.run((db) => {
      db.exec("INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,'maintenance','pending',1)");
      writeFileSync(marker, "synthetic");
    })).toThrow("maintenance");
    await rm(marker);
    expect(readAppDatabaseSnapshot((db) => db.prepare(
      "SELECT count(*) AS n FROM project_metadata WHERE id='maintenance'",
    ).get())).toEqual({ n: 0 });
  });
});

test("runtime transaction lane does not keep writing a replaced database inode", async () => {
  await temporaryDatabase(async (directory) => {
    const lane = createRuntimeDatabaseTransactionRunner();
    lane.run(() => 1);
    const path = join(directory, "unboundry.sqlite");
    const moved = join(directory, "synthetic-old.sqlite");
    renameSync(path, moved);
    writeFileSync(path, "not-a-database");
    let entered = false;
    expect(() => lane.run(() => { entered = true; })).toThrow();
    expect(entered).toBe(false);
    await rm(path);
    renameSync(moved, path);
  });
});

test("read-only capability queries still reject maintenance and counterfeit schemas", async () => {
  await temporaryDatabase(async (directory) => {
    const marker = join(directory, migrationIncompleteMarker);
    await writeFile(marker, "synthetic-maintenance");
    await expect(generationTaskApplication.imageToolAvailability("performance-owner"))
      .rejects.toThrow("maintenance");
    await rm(marker);
    const db = openAppDatabase(directory);
    db.exec("CREATE TABLE counterfeit_performance_table (id TEXT)");
    db.close();
    await expect(generationTaskApplication.imageToolAvailability("performance-owner"))
      .rejects.toThrow("exact current schema");
  });
});

function resultFixture() {
  const baseline = ["text", "image", "video", "audio"].map((kind) => ({
    id: kind, type: kind, position: { x: 0, y: 0 }, data: { label: kind, content: "before" },
  }));
  const incoming = baseline.map((node) => ({ ...node, data: {
    ...node.data, content: "generated", [`${node.type}Src`]: `/api/assets/${node.id}`,
    groupRunSuccessTaskId: `task-${node.id}`, groupRunSuccessOwnershipKey: "bound-owner",
    groupRunSuccessResultKey: `result-${node.id}`, assetId: `asset-${node.id}`,
  } }));
  const run = { clientSemanticFingerprint: "wf1-test", semanticFingerprint: "wf1-test",
    createdAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:01Z", lockedNodeIds: [],
    id: "run-1", canvasId: "canvas-1", groupId: "group", state: "running",
    nodes: baseline.map((node) => ({ id: node.id, kind: node.type, state: "success",
      projectionState: "applied", taskId: `task-${node.id}` })) } as WorkflowRunSummary;
  return { baseline, incoming, run };
}

test("incremental results preserve drafts and layout and never become generated-text commands", () => {
  const fixture = resultFixture();
  const current = fixture.baseline.map((node) => ({ ...node, selected: true,
    position: { x: 30, y: 40 }, data: { ...node.data, title: "local title" } }));
  const merged = mergeWorkflowResultNodes({ ...fixture, current });
  expect(merged.received).toHaveLength(4);
  const result = merged.nodes as typeof current;
  expect(result[0]!.data.content).toBe("generated");
  expect(result[0]!.data.title).toBe("local title");
  expect(result[0]!.selected).toBe(true);
  expect(result[0]!.position).toEqual({ x: 30, y: 40 });
  const before = { nodes: merged.baseline, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } as unknown as AuthoritativeCanvasDocument;
  const intents = planCanvasCommandIntents(before, { ...before, nodes: merged.nodes });
  expect(JSON.stringify(intents.map((item) => item.entry))).not.toContain('"content"');
  expect(JSON.stringify(intents.map((item) => item.entry))).toContain("local title");
  expect(mergeWorkflowResultNodes({ ...fixture, baseline: merged.baseline, current: merged.nodes }).nodes)
    .toEqual(merged.nodes);
});

test("incremental results reject stale tasks and missing nodes and preserve conflicting text", () => {
  const fixture = resultFixture();
  const current = fixture.baseline.slice(0, 3).map((node) => ({ ...node,
    data: { ...node.data, ...(node.id === "text" ? { content: "typing" } : {}) },
  }));
  fixture.incoming[1]!.data.groupRunSuccessTaskId = "older-task";
  const merged = mergeWorkflowResultNodes({ ...fixture, current });
  expect(merged.received).toEqual(["text", "video"]);
  expect(merged.conflicts).toEqual(["text"]);
  expect((merged.nodes[0] as typeof current[number]).data.content).toBe("typing");
  expect(merged.nodes).toHaveLength(3);
  expect((merged.baseline[0] as typeof current[number]).data.content).toBe("generated");
});

test("preview cache coalesces source reads, bounds memory and cools failed work", async () => {
  test.setTimeout(60_000);
  const cache = new HistoryPreviewCache(20);
  let calls = 0;
  const make = async () => { calls += 1; return Buffer.alloc(12, 1); };
  const both = await Promise.all([cache.get("same", make), cache.get("same", make)]);
  expect(calls).toBe(1);
  expect(both[0]).toEqual(both[1]);
  await cache.get("second", make);
  expect(cache.snapshot()).toMatchObject({ bytes: 12, entries: 1, active: 0, queued: 0, pending: 0 });
  let failures = 0;
  const fail = async () => { failures += 1; throw new Error("synthetic"); };
  await expect(cache.get("bad", fail)).rejects.toThrow("synthetic");
  await expect(cache.get("bad", fail)).rejects.toThrow("cooling down");
  expect(failures).toBe(1);
  expect(cache.snapshot()).toMatchObject({ active: 0, queued: 0, pending: 0 });

  let releaseSaturated!: () => void;
  const saturationReleased = new Promise<void>((resolve) => {
    releaseSaturated = resolve;
  });
  const saturated = new HistoryPreviewCache();
  let activeCreates = 0;
  let maximumActiveCreates = 0;
  let duplicateFactoryCalls = 0;
  let overflowFactoryCalls = 0;
  const saturatedKeys = Array.from({ length: 33 }, (_, index) => `saturated-${index}`);
  const saturatedRequests = saturatedKeys.map((key) => saturated.get(key, async () => {
    activeCreates += 1;
    maximumActiveCreates = Math.max(maximumActiveCreates, activeCreates);
    try {
      await saturationReleased;
      return Buffer.from([1]);
    } finally {
      activeCreates -= 1;
    }
  }));
  await Promise.resolve();
  expect(saturated.snapshot()).toMatchObject({ active: 2, queued: 31, pending: 33 });
  expect(maximumActiveCreates).toBe(2);

  const duplicateRequest = saturated.get(saturatedKeys[0]!, async () => {
    duplicateFactoryCalls += 1;
    return Buffer.from([2]);
  });
  expect(saturated.snapshot()).toMatchObject({ pending: 33 });
  await expect(saturated.get("saturated-overflow", async () => {
    overflowFactoryCalls += 1;
    return Buffer.from([3]);
  })).rejects.toThrow("Preview queue full");
  expect(duplicateFactoryCalls).toBe(0);
  expect(overflowFactoryCalls).toBe(0);

  releaseSaturated();
  const saturatedResults = await Promise.all([
    ...saturatedRequests,
    duplicateRequest,
  ]);
  expect(saturatedResults).toHaveLength(34);
  expect(saturated.snapshot()).toMatchObject({ active: 0, queued: 0, pending: 0 });
  expect(maximumActiveCreates).toBe(2);

  const aborted = new HistoryPreviewCache();
  let maximumAbortActive = 0;
  let abortActive = 0;
  const abortSignals: AbortSignal[] = [];
  const abortRequests = ["a", "b", "c"].map((key) => aborted.get(`aborted-${key}`, async (signal) => {
    abortSignals.push(signal);
    abortActive += 1;
    maximumAbortActive = Math.max(maximumAbortActive, abortActive);
    try {
      await new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new Error("preview signal aborted"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new Error("preview signal aborted"));
        }, { once: true });
      });
      throw new Error("abort work unexpectedly resolved");
    } finally {
      abortActive -= 1;
    }
  }));
  const abortSettled = Promise.allSettled(abortRequests);
  await Promise.resolve();
  expect(aborted.snapshot()).toMatchObject({ active: 2, queued: 1, pending: 3 });
  expect(maximumAbortActive).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 30_250));
  const abortResults = await abortSettled;
  expect(abortResults.every(({ status }) => status === "rejected")).toBe(true);
  expect(abortSignals.length).toBeGreaterThanOrEqual(2);
  expect(abortSignals.every((signal) => signal.aborted)).toBe(true);
  expect(maximumAbortActive).toBe(2);
  expect(aborted.snapshot()).toEqual({
    active: 0,
    bytes: 0,
    entries: 0,
    pending: 0,
    queued: 0,
  });
});

test("real history codec creates bounded PNG without changing the PNG or leaving files", async () => {
  await temporaryDatabase(async (directory) => {
    const bytes = await readFile("spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png");
    const original = Buffer.from(bytes);
    const preview = await createHistoryImagePreview(bytes, "synthetic-preview");
    expect(preview.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(preview.length).toBeLessThanOrEqual(100 * 1024);
    expect(bytes.equals(original)).toBe(true);
    const cache = new HistoryPreviewCache();
    const coldStarted = performance.now();
    let firstMs = 0;
    const batch = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      cache.get(`synthetic-history-${index}`, async (signal) => {
        const result = await createHistoryImagePreview(bytes, "synthetic-preview", signal);
        if (!firstMs) firstMs = performance.now() - coldStarted;
        return result;
      })));
    const coldMs = performance.now() - coldStarted;
    expect(mediaResourceBudget.snapshot()).toEqual({
      activeJobs: 0,
      owners: 0,
      reservedBytes: 0,
    });
    const warmStarted = performance.now();
    await Promise.all(Array.from({ length: 20 }, (_, index) => cache.get(`synthetic-history-${index}`,
      async () => { throw new Error("warm preview unexpectedly reread its source"); })));
    const totalBytes = batch.reduce((sum, item) => sum + item.length, 0);
    expect(totalBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    console.log(JSON.stringify({ performanceEvidence: "local-codec-history-20", coldFirstMs: firstMs,
      coldBatchMs: coldMs, warmBatchMs: performance.now() - warmStarted, totalBytes,
      sourceBytes: bytes.length, network: "in-memory source; excludes directory, OSS and browser" }));

    const { readdir } = await import("node:fs/promises");
    expect((await readdir(directory)).filter((name) => name.startsWith("history-preview-"))).toEqual([]);
  });
});

test("runtime lane revalidates external commits and rejects external schema mutation", async () => {
  await temporaryDatabase(async (directory) => {
    const lane = createRuntimeDatabaseTransactionRunner();
    lane.run(() => 1);
    const external = new DatabaseSync(join(directory, "unboundry.sqlite"));
    try {
      external.exec("INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,'external','ok',1)");
      expect(lane.run((db) => db.prepare("SELECT title FROM project_metadata WHERE id='external'").get()))
        .toEqual({ title: "ok" });
      external.exec("CREATE TABLE unexpected_schema(id TEXT)");
      expect(() => lane.run(() => 1)).toThrow("schema");
    } finally { external.close(); }
  });
});

test("PERF synthetic 50 MiB database separates digest cost from readonly and reused commands", async () => {
  test.setTimeout(120_000);
  await temporaryDatabase(async (directory) => {
    const seed = openAppDatabase(directory);
    seed.exec("BEGIN IMMEDIATE");
    const insert = seed.prepare("INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,?,?,1)");
    const payload = "synthetic-performance-data".repeat(2100);
    for (let i = 0; i < 1000; i += 1) insert.run(`perf-${i}`, payload);
    seed.exec("COMMIT"); seed.close();
    const fullOpen: number[] = [], baseline: number[] = [], readonly: number[] = [], writes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      resetVerifiedCurrentDatabasesForTests();
      const start = performance.now();
      openAppDatabase(directory).close();
      fullOpen.push(performance.now() - start);
    }
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      openAppDatabase(directory).close(); openAppDatabase(directory).close();
      baseline.push(performance.now() - start);
    }
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await generationTaskApplication.imageToolAvailability("synthetic-owner");
      readonly.push(performance.now() - start);
    }
    const lane = createRuntimeDatabaseTransactionRunner();
    const first = performance.now(); lane.run(() => 1);
    const firstWriterMs = performance.now() - first;
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      lane.run((db) => db.prepare("UPDATE project_metadata SET updated_at=? WHERE id=?").run(i + 2, `perf-${i}`));
      writes.push(performance.now() - start);
    }
    const p95 = (samples: number[]) => [...samples].sort((a,b) => a-b)[18]!;
    const fullOpenMedian = [...fullOpen].sort((a,b) => a-b)[2]!;
    console.log(JSON.stringify({ performanceEvidence: "synthetic-50MiB", samples: 20,
      fullOpenMedian, firstWriterMs, baselineP95: p95(baseline), readonlyP95: p95(readonly), writerP95: p95(writes),
      fullOpen, baseline, readonly, writes }));
    // Whole-content verification runs once per database identity; routine
    // reopens, read-only snapshots and the reused writer lane stay well below it.
    expect(p95(baseline)).toBeLessThan(fullOpenMedian / 2);
    expect(p95(readonly)).toBeLessThan(fullOpenMedian / 2);
    expect(p95(writes)).toBeLessThan(fullOpenMedian / 2);
  });
});

test("PERF idle media and projection recovery make no heavyweight writer opens", async () => {
  await temporaryDatabase(async () => {
    setDuringCurrentDatabaseOpenForTests((checkpoint) => {
      if (checkpoint === "before-writer-sidecar-validation") throw new Error("unexpected idle writer");
    });
    expect(hasPendingGeneratedMediaPublications()).toBe(false);
    expect(hasPendingMediaDeletions()).toBe(false);
    expect(hasPendingUploadMediaPublications()).toBe(false);
    expect(pendingGeneratedMediaPublications()).toEqual([]);
    expect(retrySingleNodeCanvasProjections().visited).toBe(0);
  });
});

test("PERF runtime lane survives an uncommitted external process exit without partial data", async () => {
  await temporaryDatabase(async (directory) => {
    const lane = createRuntimeDatabaseTransactionRunner();
    lane.run(() => 1);
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec("BEGIN IMMEDIATE; INSERT INTO project_metadata (owner_id,id,title,updated_at) VALUES(NULL,'crashed','partial',1)");
      process.exit(0);
    `, join(directory, "unboundry.sqlite")], { stdio: "pipe" });
    expect(lane.run((db) => db.prepare("SELECT count(*) AS n FROM project_metadata WHERE id='crashed'").get()))
      .toEqual({ n: 0 });
  });
});
