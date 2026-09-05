import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";

type ManifestEntry = {
  astKind: string;
  file: string;
  id: string;
  line: number;
  stateClass: string;
  violation: boolean;
  [key: string]: unknown;
};

type WriterManifest = {
  entries: ManifestEntry[];
  scan: { exactExclusions: string[] };
  status: { failClosed: boolean; phase: string; state: string };
  summary: {
    classified: number;
    rawHits: number;
    [key: string]: unknown;
  };
};

type WriterBuildOptions = {
  noGit?: boolean;
  projectRoot?: string;
  tsconfigPath?: string;
};

type DedupeHit = {
  astKind: string;
  detail?: string;
  file: string;
  normalizedAnchorHash: string;
  side: string;
  startColumn: number;
  startLine: number;
};

type WriterManifestModule = {
  assertManifestShape(manifest: WriterManifest): void;
  buildManifest(generatedAt: string, options?: WriterBuildOptions): WriterManifest;
  dedupeHits(hits: DedupeHit[]): DedupeHit[];
  hitDedupeKey(hit: DedupeHit): string;
  isProtectedPath(path: string): boolean;
};

// The scanner is intentionally a JavaScript module; keep its public contract typed here
// without widening the repository TypeScript configuration just for this focused fixture.
// @ts-expect-error TS7016: the executable scanner has no emitted declaration file.
import * as writerManifestUntyped from "../scripts/check-canvas-writer-manifest.mjs";

const {
  assertManifestShape,
  buildManifest,
  dedupeHits,
  hitDedupeKey,
  isProtectedPath,
} = writerManifestUntyped as unknown as WriterManifestModule;

const fixtureTsconfig = JSON.stringify({
  compilerOptions: {
    allowJs: true,
    jsx: "preserve",
    module: "ESNext",
    skipLibCheck: true,
    target: "ES2022",
  },
  include: ["client/src/**/*.ts", "client/src/**/*.tsx", "server/**/*.ts"],
}, null, 2);

const clientFixture = `
declare const id: string;
declare const command: unknown;
declare const payload: string;
declare function tryAdoptNodes(id: string, update: unknown): unknown;
declare function trySetNodes(update: unknown): unknown;
declare function mutateGraph(update: unknown): unknown;
declare function setGraphState(update: unknown): unknown;
declare function commitCanvasGraphAtomic(update: unknown): unknown;
declare function useState<T>(value: T): [T, (value: T) => void];

export function fixture() {
  const [nodes, setNodes] = useState<unknown[]>([]);
  const [edges, setEdges] = useState<unknown[]>([]);
  const onNodesChange = (changes: unknown[]) => changes;
  const onEdgesChange = (changes: unknown[]) => changes;
  const handlers = { onNodesChange, onEdgesChange };
  setNodes(nodes);
  setNodes(nodes);
  setEdges(edges);
  trySetNodes(nodes);
  tryAdoptNodes(id, nodes);
  mutateGraph(() => ({ nodes, edges }));
  const input = { commit: (_command: unknown) => undefined };
  input.commit(command);
  const graph = { apply: (_command: unknown) => undefined };
  graph.apply(command);
  setGraphState({ nodes, edges });
  commitCanvasGraphAtomic({ nodes, edges });
  onNodesChange([]);
  onEdgesChange([]);
  void fetch(\`/api/canvases/\${id}/commands\`, { method: "POST", body: payload });
  navigator.sendBeacon(\`/api/canvases/\${id}/generation-terminal-detach\`, payload);
  window.addEventListener("pagehide", () => undefined);
  return (
    <audio
      onError={() => undefined}
      onLoad={() => undefined}
      onLoadedMetadata={() => undefined}
    />
  );
}
`;

const serverFixture = `
declare const database: any;
declare const command: unknown;
declare function addColumnIfMissing(...args: unknown[]): void;
declare function executeTransactionScopedCommand(...args: unknown[]): void;
declare function projectWorkflowResultInTransaction(...args: unknown[]): void;

export function fixture() {
  database.exec(\`
    UPDATE canvas_documents SET revision = revision + 1;
    INSERT INTO canvas_operation_receipts (operation_id) VALUES ('fixture');
  \`);
  addColumnIfMissing(database, "canvas_documents", "fixture_column", "TEXT");
  executeTransactionScopedCommand(database, "canvas-command", {});
  projectWorkflowResultInTransaction(database, command);
}
`;

function entryCategory(entry: { astKind: string }) {
  return entry.astKind.split(":", 1)[0];
}

test("canvas writer manifest scanner is exhaustive and fail-closed on fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-canvas-writer-manifest-"));
  try {
    await mkdir(join(root, "client/src"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), fixtureTsconfig, "utf8");
    await writeFile(join(root, "client/src/fixture.tsx"), clientFixture, "utf8");
    await writeFile(join(root, "server/fixture.ts"), serverFixture, "utf8");

    const manifest = buildManifest("2026-09-04T00:00:00.000Z", {
      noGit: true,
      projectRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
    });
    assertManifestShape(manifest);

    const categories = new Set(manifest.entries.map(entryCategory));
    for (const category of [
      "raw-node-setter",
      "raw-edge-setter",
      "try-node-setter",
      "try-node-adoption",
      "graph-command-commit",
      "graph-command-apply",
      "graph-state-sink",
      "graph-state-commit",
      "change-handler-definition",
      "change-handler-dispatch",
      "change-handler-property",
      "canvas-http-write",
      "canvas-http-route",
      "pagehide",
      "media-callback",
      "canvas-sql-write",
      "canvas-sql-dynamic",
      "server-dynamic-sql-helper",
      "server-transaction-command",
      "server-writer-call",
    ]) {
      expect(categories.has(category), category).toBe(true);
    }

    const unknown = manifest.entries.find((entry) =>
      entry.file === "client/src/fixture.tsx" && entry.stateClass === "unknown"
    );
    expect(unknown?.violation).toBe(true);
    expect(manifest.status).toEqual({ phase: "R0", state: "FAIL", failClosed: true });
    expect(manifest.summary.classified).toBeLessThan(manifest.summary.rawHits);

    const first = buildManifest("2026-09-04T00:00:00.000Z", {
      noGit: true,
      projectRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
    });
    expect(first.entries.map((entry) => entry.id)).toEqual(
      manifest.entries.map((entry) => entry.id),
    );

    const duplicate = {
      astKind: "raw-node-setter:CallExpression",
      detail: "fixture",
      file: "client/src/fixture.tsx",
      line: 1,
      column: 1,
      normalizedAnchorHash: "a".repeat(64),
      side: "client",
      startLine: 1,
      startColumn: 1,
    };
    expect(hitDedupeKey(duplicate)).toBe(
      "client\u0000client/src/fixture.tsx\u00001\u00001\u0000raw-node-setter:CallExpression\u0000" + "a".repeat(64),
    );
    expect(dedupeHits([duplicate, { ...duplicate, detail: "duplicate" }])).toHaveLength(1);

    expect(isProtectedPath("spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json")).toBe(true);
    expect(isProtectedPath("spec/public-templates-director-split-revision.json")).toBe(true);
    expect(isProtectedPath("spec/not-protected-fixture.json")).toBe(false);
    expect(manifest.scan.exactExclusions).toEqual([
      "spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json",
      "spec/public-templates-director-split-revision.json",
    ]);
    expect(manifest.entries.some((entry) => entry.file.startsWith("spec/"))).toBe(false);

    const repositoryManifest = buildManifest("2026-09-04T00:00:00.000Z", {
      noGit: true,
    });
    expect(repositoryManifest.status).toEqual({
      failClosed: true,
      phase: "R0",
      state: "PASS",
    });
    expect(repositoryManifest.entries.filter(({ violation }) => violation))
      .toEqual([]);
    const surfaceEntries = repositoryManifest.entries.filter(({ file }) =>
      file === "client/src/canvas/CanvasSurface.tsx"
    );
    const entriesFor = (symbol: string, category: string) =>
      surfaceEntries.filter((entry) =>
        entry.symbol === symbol && entryCategory(entry) === category
      );
    expect(entriesFor("applyPassiveNodeChanges", "raw-node-setter"))
      .toEqual([expect.objectContaining({ stateClass: "Ephemeral View" })]);
    expect(entriesFor("load", "raw-node-setter"))
      .toEqual([expect.objectContaining({ stateClass: "Durable Server" })]);
    expect(entriesFor("receiveWorkflowResults", "raw-node-setter"))
      .toEqual([expect.objectContaining({ stateClass: "Durable Server", violation: false })]);
    expect(entriesFor("guardedSetNodes", "raw-node-setter"))
      .toEqual([expect.objectContaining({ stateClass: "control-only" })]);
    expect(entriesFor("tryAdoptNodes", "raw-node-setter"))
      .toEqual([expect.objectContaining({ stateClass: "Migration/Legacy" })]);
    expect(entriesFor("adoptUploadedAsset", "raw-node-setter"))
      .toEqual([
        expect.objectContaining({
          stateClass: "Durable User",
          targetCommand: "adopt-uploaded-asset",
        }),
        expect.objectContaining({
          stateClass: "Durable User",
          targetCommand: "adopt-uploaded-asset",
        }),
      ]);
    expect(entriesFor("finishLayoutGesture", "graph-mutate"))
      .toEqual([expect.objectContaining({ targetCommand: "commit-user-layout" })]);
    expect(entriesFor("jsx.onNodesChange", "graph-mutate"))
      .toEqual([expect.objectContaining({ targetCommand: "commit-user-layout" })]);

    const projectionSql = repositoryManifest.entries.filter((entry) =>
      entry.file === "server/canvasMutationGateway.ts" &&
      entry.symbol === "applyGenerationProjectionCore" &&
      entryCategory(entry) === "canvas-sql-write"
    );
    expect(projectionSql).toHaveLength(2);
    expect(projectionSql.filter((entry) => entry.stateClass === "Durable Server"))
      .toHaveLength(1);
    expect(projectionSql.filter((entry) =>
      entry.stateClass === "Migration/Legacy" &&
      entry.exceptionKind === "time-bounded-legacy-adapter"
    )).toHaveLength(1);

    const invalid = {
      ...manifest,
      entries: manifest.entries.map((entry, index) =>
        index === 0 ? { ...entry, stateClass: "mixed" } : entry,
      ),
    };
    expect(() => assertManifestShape(invalid)).toThrow(/stateClass is invalid/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
