import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaVersion,
  databaseMatchesSchemaContract,
} from "../server/database";
import { createSeedanceCharacterComplianceApplication } from
  "../server/seedanceCharacterComplianceApplication";
import { createFakeSeedanceCharacterCompliancePort } from
  "../server/fakeSeedanceCharacterCompliancePort";
import { SeedanceCharacterComplianceProviderError } from
  "../server/seedanceCharacterCompliancePort";
import { createSeedanceCharacterComplianceStore } from
  "../server/seedanceCharacterComplianceStore";
import { createSeedanceCharacterReferenceResolver } from
  "../server/seedanceCharacterReferences";

const complianceIdentity = Object.freeze({
  accountFingerprint: "a".repeat(64),
  configurationVersion: 1,
  credentialVersion: 1,
  policyRevision: "policy-2026-08-25",
  profileId: "compliance-fake",
  region: "test",
});
const complianceModel = () => Object.freeze({
  configurationRevision: "model-revision-1",
});
const generationIdentity = Object.freeze({
  credentialVersion: 1,
  modelId: "seedance-2",
  providerConfigurationVersion: 1,
  providerProfileId: "compliance-fake",
});

function database() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    BEGIN IMMEDIATE;
  `);
  applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 0 });
  database.exec("COMMIT");
  const timestamp = "2026-08-25T00:00:00.000Z";
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at, protected
    ) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, 0)
  `).run("owner-1", "owner-1", "Owner", "hash", timestamp, timestamp);
  database.prepare(`
    INSERT INTO provider_profiles (
      id, display_name, driver, status, created_at, updated_at
    ) VALUES (?, ?, 'relay', 'enabled', ?, ?)
  `).run("compliance-fake", "Compliance fake", timestamp, timestamp);
  return database;
}

function readyImage(database: DatabaseSync, id: string, bytes = id) {
  const timestamp = "2026-08-25T00:00:00.000Z";
  const checksum = createHash("sha256").update(bytes).digest("hex");
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_status, media_width, media_height
    ) VALUES (
      'image', ?, 'owner-1', ?, ?, ?, ?, 'local', NULL, 'image/png', ?,
      'ready', 'not-applicable', 1024, 1536
    )
  `).run(id, `${id}.png`, bytes.length, timestamp, timestamp, checksum);
  return checksum;
}

test("schema 41 owns independent character-compliance checks, attempts and disclosures", () => {
  const db = database();
  try {
    expect(currentSchemaVersion).toBe(44);
    expect(databaseMatchesSchemaContract(db)).toBe(true);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version).toBe(44);
    const tables = new Set((db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
    `).all() as Array<{ name: string }>).map(({ name }) => name));
    expect([...tables]).toEqual(expect.arrayContaining([
      "seedance_character_compliance_checks",
      "seedance_character_compliance_attempts",
      "seedance_character_compliance_disclosures",
    ]));
  } finally {
    db.close();
  }
});

test("branch C is accurately closed without creating a check or Provider request", async () => {
  const db = database();
  try {
    readyImage(db, "closed-image");
    const store = createSeedanceCharacterComplianceStore(db);
    const application = createSeedanceCharacterComplianceApplication({
      context: async () => undefined,
      media: (ownerId, assetId) => ownerId === "owner-1" && assetId === "closed-image"
        ? { checksumSha256: readyImageChecksum(db, assetId), contentType: "image/png", storageStatus: "ready" }
        : undefined,
      model: complianceModel,
      store,
    });
    await expect(application.capability("owner-1")).resolves.toMatchObject({
      available: false,
      branch: "C",
      canCreateChecks: false,
      formalSeedanceTicketAccepted: false,
      productName: "角色风险预检",
      reasonCode: "NO_COMPLIANT_PROVIDER",
    });
    await expect(application.createCheck({
      assetId: "closed-image",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    expect(store.currentForSource("owner-1", "closed-image")).toBeUndefined();
  } finally {
    db.close();
  }
});

function readyImageChecksum(database: DatabaseSync, assetId: string) {
  return String((database.prepare(`
    SELECT checksum_sha256 FROM media_assets
    WHERE owner_id = 'owner-1' AND kind = 'image' AND id = ?
  `).get(assetId) as { checksum_sha256: string }).checksum_sha256);
}

test("fake Provider proves disclosure, idempotency, terminal mapping, staleness and retry safety", async () => {
  const db = database();
  try {
    const checksum = readyImage(db, "synthetic-adult-ai");
    const store = createSeedanceCharacterComplianceStore(db);
    let creates = 0;
    const port = createFakeSeedanceCharacterCompliancePort({
      fixtures: {
        "synthetic-adult-ai": {
          decision: "APPROVED",
          riskCodes: [],
        },
      },
      onCreate: () => { creates += 1; },
    });
    const media = () => ({
      checksumSha256: readyImageChecksum(db, "synthetic-adult-ai"),
      contentType: "image/png",
      storageStatus: "ready" as const,
    });
    const application = createSeedanceCharacterComplianceApplication({
      context: async () => ({
        identity: complianceIdentity,
        port,
      }),
      media,
      model: complianceModel,
      now: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 7, 25, 0, 0, tick++));
      })(),
      store,
    });

    await expect(application.createCheck({
      assetId: "synthetic-adult-ai",
      disclosureAccepted: false,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    })).rejects.toMatchObject({ code: "DISCLOSURE_REQUIRED" });

    const first = await application.createCheck({
      assetId: "synthetic-adult-ai",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    });
    expect(first).toMatchObject({
      state: "APPROVED",
      source: {
        assetId: "synthetic-adult-ai",
        checksumSha256: checksum,
        modelConfigurationRevision: "model-revision-1",
        modelId: "seedance-2",
      },
    });
    const duplicate = await application.createCheck({
      assetId: "synthetic-adult-ai",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    });
    expect(duplicate.id).toBe(first.id);
    expect(creates).toBe(1);

    readyImage(db, "unknown-response-ai");
    const unknownFake = createFakeSeedanceCharacterCompliancePort({
      fixtures: {
        "unknown-response-ai": { decision: "APPROVED", riskCodes: [] },
      },
    });
    let unknownCreates = 0;
    const unknownApplication = createSeedanceCharacterComplianceApplication({
      context: async () => ({
        identity: complianceIdentity,
        port: Object.freeze({
          ...unknownFake,
          async create(input: Parameters<typeof unknownFake.create>[0]) {
            unknownCreates += 1;
            await unknownFake.create(input);
            throw new SeedanceCharacterComplianceProviderError(
              "NETWORK",
              true,
              "outcome-unknown",
            );
          },
        }),
      }),
      media: (_ownerId, assetId) => ({
        checksumSha256: readyImageChecksum(db, assetId),
        contentType: "image/png",
        storageStatus: "ready" as const,
      }),
      model: complianceModel,
      store,
    });
    const unknown = await unknownApplication.createCheck({
      assetId: "unknown-response-ai",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    });
    expect(unknown.state).toBe("FAILED_TERMINAL");
    await expect(unknownApplication.readCheck({
      checkId: unknown.id,
      ownerId: "owner-1",
    })).resolves.toMatchObject({ state: "APPROVED" });
    expect(unknownCreates).toBe(1);

    readyImage(db, "retry-safe-ai");
    const retryFake = createFakeSeedanceCharacterCompliancePort({
      fixtures: { "retry-safe-ai": { decision: "APPROVED", riskCodes: [] } },
    });
    let retryCreates = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const retryApplication = createSeedanceCharacterComplianceApplication({
      context: async () => ({
        identity: complianceIdentity,
        port: Object.freeze({
          ...retryFake,
          async create(input: Parameters<typeof retryFake.create>[0]) {
            retryCreates += 1;
            if (retryCreates === 1) {
              throw new SeedanceCharacterComplianceProviderError(
                "RATE_LIMIT",
                true,
                "definitive-not-accepted",
              );
            }
            await retryGate;
            return retryFake.create(input);
          },
        }),
      }),
      media: (_ownerId, assetId) => ({
        checksumSha256: readyImageChecksum(db, assetId),
        contentType: "image/png",
        storageStatus: "ready" as const,
      }),
      model: complianceModel,
      store,
    });
    const retryable = await retryApplication.createCheck({
      assetId: "retry-safe-ai",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    });
    expect(retryable.state).toBe("FAILED_RETRYABLE");
    const retryResultsPromise = Promise.allSettled([
      retryApplication.retryCheck({ checkId: retryable.id, ownerId: "owner-1" }),
      retryApplication.retryCheck({ checkId: retryable.id, ownerId: "owner-1" }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseRetry();
    const retryResults = await retryResultsPromise;
    expect(retryResults.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(retryResults.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(retryCreates).toBe(2);
    expect(store.attemptsForCheck("owner-1", retryable.id).map((item) =>
      [item.attemptNumber, item.outcome])).toEqual([
        [1, "provider-failed"],
        [2, "response-received"],
      ]);

    db.prepare(`
      UPDATE media_assets SET checksum_sha256 = ?
      WHERE owner_id = 'owner-1' AND kind = 'image' AND id = ?
    `).run("f".repeat(64), "synthetic-adult-ai");
    const stale = await application.readCheck({ checkId: first.id, ownerId: "owner-1" });
    expect(stale?.state).toBe("STALE_SOURCE");
    expect(store.attemptsForCheck("owner-1", first.id)).toHaveLength(1);
    expect(store.attemptsForCheck("owner-1", first.id)[0]).toMatchObject({
      attemptNumber: 1,
      operation: "create",
      outcome: "response-received",
    });
    expect(JSON.stringify(store.attemptsForCheck("owner-1", first.id)))
      .not.toMatch(/body|secret|token|image/i);
    db.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = 'owner-1' AND kind = 'image' AND id = ?
    `).run("synthetic-adult-ai");
    expect(store.checkById("owner-1", first.id)).toMatchObject({
      id: first.id,
      state: "STALE_SOURCE",
    });
  } finally {
    db.close();
  }
});

test("Generation character references fail before task admission and recheck a formal B snapshot at Provider boundary", async () => {
  const db = database();
  try {
    const checksum = readyImage(db, "formal-b-synthetic-ai");
    const store = createSeedanceCharacterComplianceStore(db);
    let complianceInspects = 0;
    const fake = createFakeSeedanceCharacterCompliancePort({
      fixtures: {
        "formal-b-synthetic-ai": { decision: "APPROVED", riskCodes: [] },
      },
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });
    const port = Object.freeze({
      ...fake,
      async capability() {
        return Object.freeze({
          available: true,
          branch: "B" as const,
          canCreateChecks: true,
          formalSeedanceTicketAccepted: true,
          productName: "角色风险预检" as const,
          providerDisplayName: "Fake formal B contract",
          reason: "仅用于零请求合同测试",
          reasonCode: "AVAILABLE" as const,
        });
      },
      async inspect(input: Parameters<typeof fake.inspect>[0]) {
        complianceInspects += 1;
        return fake.inspect(input);
      },
    });
    const media = (ownerId: string, assetId: string) =>
      ownerId === "owner-1" && assetId === "formal-b-synthetic-ai"
        ? {
            checksumSha256: readyImageChecksum(db, assetId),
            contentType: "image/png",
            storageStatus: "ready" as const,
          }
        : undefined;
    const context = async (ownerId: string) => ownerId === "owner-1"
      ? { identity: complianceIdentity, port }
      : undefined;
    const application = createSeedanceCharacterComplianceApplication({
      context,
      media,
      model: complianceModel,
      now: () => new Date("2026-08-25T00:00:01.000Z"),
      store,
    });
    const check = await application.createCheck({
      assetId: "formal-b-synthetic-ai",
      disclosureAccepted: true,
      disclosureVersion: "2026-08-25",
      modelConfigurationRevision: "model-revision-1",
      modelId: "seedance-2",
      ownerId: "owner-1",
    });
    expect(check.branch).toBe("B");
    const resolve = createSeedanceCharacterReferenceResolver({
      context,
      media,
      model: complianceModel,
      now: () => new Date("2026-08-25T00:00:02.000Z"),
      store,
    });
    const inputs = [{
      assetId: "formal-b-synthetic-ai",
      kind: "image" as const,
      order: 1,
      role: "subject" as const,
      sourceNodeId: "source-image",
    }];
    const frozen = await resolve({
      generation: generationIdentity,
      inputs,
      ownerId: "owner-1",
      phase: "task-create",
    });
    expect(frozen[0]?.characterCompliance).toMatchObject({
      branch: "B",
      checkId: check.id,
      sourceChecksumSha256: checksum,
    });
    expect(complianceInspects).toBe(0);
    await expect(resolve({
      generation: generationIdentity,
      inputs: frozen,
      ownerId: "other-owner",
      phase: "provider-submit",
    })).rejects.toMatchObject({ code: "OWNER_MISMATCH" });
    await expect(resolve({
      generation: {
        ...generationIdentity,
        providerConfigurationVersion: 2,
      },
      inputs: frozen,
      ownerId: "owner-1",
      phase: "provider-submit",
    })).rejects.toMatchObject({ code: "FORMAL_BYPASS_UNAVAILABLE" });
    await expect(resolve({
      generation: generationIdentity,
      inputs: frozen,
      ownerId: "owner-1",
      phase: "provider-submit",
    })).resolves.toEqual(frozen);
    expect(complianceInspects).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM generation_tasks").get() as {
      count: number;
    }).count).toBe(0);
  } finally {
    db.close();
  }
});
