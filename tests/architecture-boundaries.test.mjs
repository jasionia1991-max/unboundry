import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { analyzeArchitecture } from "../scripts/check-architecture.mjs";

function safeTestRoot() {
  const configured = process.env.UNBOUNDRY_TEST_ROOT;
  assert.ok(configured, "UNBOUNDRY_TEST_ROOT is required; use scripts/run-safe-tests.mjs");
  return realpathSync(configured);
}

function baseConfiguration() {
  return {
    schemaVersion: 1,
    tsconfig: "tsconfig.json",
    scanGlobs: ["src/**/*.ts"],
    uiSources: ["src/ui/**"],
    serverTargets: ["src/server/**"],
    providerAdapterSources: ["src/provider/**"],
    storageConcreteTargets: ["src/storage/**"],
    mediaSources: ["src/media/**"],
    generationWriteTargets: ["src/generation/write.ts"],
    internalBoundaries: [
      {
        name: "generation",
        internalTargets: ["src/server/internal.ts"],
        ownerSources: ["src/server/owner/**"],
      },
    ],
    sqlDomains: [
      { domain: "auth", sources: ["src/auth/**"] },
      { domain: "generation", sources: ["src/generation/**"] },
    ],
    sqlExemptSources: [],
    tableOwners: [{ owner: "generation", tables: ["generation_tasks"] }],
    baseline: [],
  };
}

function fixture(files, mutateConfiguration = () => {}) {
  const root = mkdtempSync(join(safeTestRoot(), "architecture-fixture-"));
  const configuration = baseConfiguration();
  mutateConfiguration(configuration);
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      module: "ESNext",
      moduleResolution: "Bundler",
      paths: { "@server/*": ["src/server/*"] },
      target: "ES2022",
    },
    include: ["src/**/*.ts"],
  }, null, 2));
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  const configPath = join(root, "architecture.json");
  writeFileSync(configPath, JSON.stringify(configuration, null, 2));
  return {
    analyze: () => analyzeArchitecture({ configPath, root, today: "2026-08-22" }),
    configPath,
    configuration,
    dispose: () => rmSync(root, { force: true, recursive: true }),
    root,
  };
}

test("Compiler API graph distinguishes type edges and resolves aliases, re-exports, and dynamic imports", () => {
  const subject = fixture({
    "src/server/contracts.ts": "export default interface DefaultContract { value: string }\nexport interface Contract { value: string }\nexport const runtime = 1;\n",
    "src/server/lazy.ts": "export const lazy = true;\n",
    "src/shared/reexport.ts": "export type { Contract } from '@server/contracts';\n",
    "src/shared/reexport-all.ts": "export type * from '@server/contracts';\n",
    "src/shared/import-type.ts": "import type { Contract } from '@server/contracts';\nexport type Imported = Contract;\n",
    "src/shared/import-default-type.ts": "import type DefaultContract from '@server/contracts';\nexport type ImportedDefault = DefaultContract;\n",
    "src/shared/types.ts": "import { type Contract } from '@server/contracts';\nexport type Alias = Contract;\n",
    "src/shared/runtime.ts": "import { runtime } from '@server/contracts';\nexport { runtime as forwarded } from '@server/contracts';\nexport const value = runtime;\nvoid import('@server/lazy', { with: { type: 'json' } });\n",
  });
  try {
    const result = subject.analyze();
    const typeEdges = result.edges.filter((edge) => edge.kind === "type");
    const runtimeEdges = result.edges.filter((edge) => edge.kind === "runtime");
    assert.equal(typeEdges.length, 5);
    assert.equal(runtimeEdges.length, 3);
    assert.ok(typeEdges.every((edge) => edge.to === "src/server/contracts.ts"));
    assert.ok(runtimeEdges.some((edge) => edge.syntax === "dynamic-import"));
    assert.deepEqual(result.newViolations, []);
  } finally {
    subject.dispose();
  }
});

test("UI to server imports fail closed for static and dynamic runtime edges", () => {
  const subject = fixture({
    "src/server/api.ts": "export const api = true;\n",
    "src/server/lazy.ts": "export const lazy = true;\n",
    "src/ui/view.ts": "import { api } from '../server/api';\nvoid api;\nvoid import('../server/lazy');\n",
  });
  try {
    const violations = subject.analyze().newViolations.filter(
      (violation) => violation.rule === "UI_SERVER",
    );
    assert.equal(violations.length, 2);
  } finally {
    subject.dispose();
  }
});

test("a module importing another domain internal target fails closed", () => {
  const subject = fixture({
    "src/server/internal.ts": "export const internal = true;\n",
    "src/consumer/use.ts": "import { internal } from '../server/internal';\nvoid internal;\n",
  });
  try {
    assert.equal(
      subject.analyze().newViolations.filter(
        (violation) => violation.rule === "CROSS_DOMAIN_INTERNAL",
      ).length,
      1,
    );
  } finally {
    subject.dispose();
  }
});

test("Provider adapters importing concrete Storage targets fail closed", () => {
  const subject = fixture({
    "src/provider/adapter.ts": "import { put } from '../storage/local';\nvoid put;\n",
    "src/storage/local.ts": "export const put = true;\n",
  });
  try {
    assert.equal(
      subject.analyze().newViolations.filter(
        (violation) => violation.rule === "PROVIDER_STORAGE",
      ).length,
      1,
    );
  } finally {
    subject.dispose();
  }
});

test("type-only Provider to Storage and Media to Generation edges are also forbidden", () => {
  const subject = fixture({
    "src/generation/write.ts": "export interface GenerationWriter { complete(): void }\n",
    "src/media/publication.ts": "import type { GenerationWriter } from '../generation/write';\nexport type Writer = GenerationWriter;\n",
    "src/provider/adapter.ts": "import type { BlobStore } from '../storage/local';\nexport type Store = BlobStore;\n",
    "src/storage/local.ts": "export interface BlobStore { put(): void }\n",
  });
  try {
    const violations = subject.analyze().newViolations;
    assert.equal(
      violations.filter((violation) => violation.rule === "PROVIDER_STORAGE").length,
      1,
    );
    assert.equal(
      violations.filter((violation) => violation.rule === "MEDIA_GENERATION_WRITE").length,
      1,
    );
    assert.ok(violations.every((violation) => violation.kind === "type"));
  } finally {
    subject.dispose();
  }
});

test("Media importing a Generation write entry fails closed", () => {
  const subject = fixture({
    "src/generation/write.ts": "export const complete = true;\n",
    "src/media/publication.ts": "import { complete } from '../generation/write';\nvoid complete;\n",
  });
  try {
    assert.equal(
      subject.analyze().newViolations.filter(
        (violation) => violation.rule === "MEDIA_GENERATION_WRITE",
      ).length,
      1,
    );
  } finally {
    subject.dispose();
  }
});

test("cross-domain SQL reads and writes fail closed", () => {
  const subject = fixture({
    "src/auth/delete.ts": [
      "export const read = `SELECT * FROM generation_tasks`;",
      "export const write = `UPDATE generation_tasks SET state = 'failed'`;",
    ].join("\n"),
  });
  try {
    const violations = subject.analyze().newViolations.filter(
      (violation) => violation.rule === "CROSS_DOMAIN_SQL",
    );
    assert.deepEqual(violations.map((violation) => violation.kind).sort(), ["read", "write"]);
  } finally {
    subject.dispose();
  }
});

test("SQL in an unclassified source fails closed instead of escaping ownership", () => {
  const subject = fixture({
    "src/unknown/query.ts": "export const query = `SELECT * FROM generation_tasks`;\n",
  });
  try {
    assert.equal(
      subject.analyze().newViolations.filter(
        (violation) => violation.rule === "UNCLASSIFIED_SQL",
      ).length,
      1,
    );
  } finally {
    subject.dispose();
  }
});

test("runtime cycles fail while type-only cycles remain legal", () => {
  const subject = fixture({
    "src/cycle/a.ts": "import { b } from './b';\nexport const a = b;\n",
    "src/cycle/b.ts": "export const b = () => import('./a');\n",
    "src/types/a.ts": "import type { B } from './b';\nexport interface A { b: B }\n",
    "src/types/b.ts": "import type { A } from './a';\nexport interface B { a: A }\n",
  });
  try {
    const cycles = subject.analyze().newViolations.filter(
      (violation) => violation.rule === "RUNTIME_CYCLE",
    );
    assert.equal(cycles.length, 1);
    assert.match(cycles[0].detail, /src\/cycle\/a\.ts/);
    assert.doesNotMatch(cycles[0].detail, /src\/types/);
  } finally {
    subject.dispose();
  }
});

test("the baseline is exact and requires owner, reason, and non-expired expiry", () => {
  const subject = fixture({
    "src/server/api.ts": "export const api = true;\n",
    "src/ui/view.ts": "import { api } from '../server/api';\nvoid api;\n",
  });
  try {
    const violation = subject.analyze().newViolations[0];
    subject.configuration.baseline = [{
      expiry: "2027-08-22",
      fingerprint: violation.fingerprint,
      owner: "architecture-owner",
      reason: "Frozen legacy edge awaiting its owning migration stage.",
    }];
    writeFileSync(subject.configPath, JSON.stringify(subject.configuration, null, 2));
    let result = subject.analyze();
    assert.deepEqual(result.newViolations, []);
    assert.deepEqual(result.staleBaseline, []);
    assert.deepEqual(result.invalid, []);

    subject.configuration.baseline.push({
      expiry: "2026-01-01",
      fingerprint: "UI_SERVER|stale|target|runtime",
      owner: "",
      reason: "short",
    });
    writeFileSync(subject.configPath, JSON.stringify(subject.configuration, null, 2));
    result = subject.analyze();
    assert.ok(result.invalid.length >= 3);
    assert.deepEqual(result.staleBaseline, ["UI_SERVER|stale|target|runtime"]);
  } finally {
    subject.dispose();
  }
});
