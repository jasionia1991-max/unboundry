import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inImmediateTransaction, recordAudit } from "./audit";
import { modelReleaseBootstrapActorUserId } from "./modelReleaseBootstrap";
import {
  modelReleaseDocumentForId,
  type ModelReleaseSeed,
} from "./modelReleaseDefaults";
import {
  currentModelReleasePolicyDrift,
  inspectModelReleaseDocument,
  modelContractState,
  upgradeModelContractRevision,
} from "./modelReleaseRevisionStore";
import {
  modelContractUpgradeSeeds,
  modelReferenceCounts,
} from "./modelCatalog";
import { modelContractUpgradeCredentialSeeds } from "./accountCredentials";
import {
  publishedTemplateGraphs,
  publishedTemplateIdsUsingModel,
} from "./templateContractQueries";
import {
  analyzeModelContractTemplateCompatibility,
} from "./modelContractTemplateCompatibility";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
} from "../types/modelParameters";
import type { ModelReleaseDocument } from "../types/modelReleaseRevisions";

type SeedRow = Omit<ModelReleaseSeed, "capabilitySchema"> & Readonly<{
  archived_at: string | null;
  catalogCredentialRevision: string | null;
  default_parameters: string;
  id: string;
  providerConfigurationVersion: number;
  providerKeyStatus: string;
  providerStatus: string;
  status: string;
}>;

const expectedProviderModelIds = Object.freeze([
  "doubao-seed-2-0-lite-260428",
  "gemini-3-pro-image-preview",
  "gpt-image-2",
  "doubao-seedance-2-0-mini-260615",
  "grok-imagine-video-1.5-preview",
  "kling-v3-omni-cankao",
  "mureka-9",
  "doubao-tts-2.0",
  "suno-v4.5",
  "grok-video-3",
  "kwvideo-v2",
].sort());

function snapshotHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fileSha256(path: string) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function schema(row: SeedRow) {
  const fallback = knownModelParameterSchema({
    capability: row.capability,
    providerDriver: row.providerDriver,
    providerModelId: row.providerModelId,
  });
  return validateParameterSchemaConstraints(
    cleanParameterSchema(
      row.capability,
      JSON.parse(row.default_parameters),
      fallback,
    ),
    providerParameterSchema({
      capability: row.capability,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
    }),
  );
}

function targetDocument(row: SeedRow) {
  return modelReleaseDocumentForId({
    capability: row.capability,
    capabilitySchema: schema(row),
    modelId: row.id,
    providerDriver: row.providerDriver,
    providerModelId: row.providerModelId,
    providerProfileId: row.providerProfileId,
    providerProtocol: row.providerProtocol,
  });
}

function modeSummary(document: ModelReleaseDocument) {
  return document.executionContract.modes.map((mode) => ({
    evidence: mode.evidence ?? document.evidence,
    id: mode.id,
    roles: mode.roles.map((role) => ({
      id: role.id,
      maxItems: role.maxItems,
      minItems: role.minItems,
    })),
    runtime: mode.runtime ?? document.runtime,
  }));
}

function hasTextFoundation(document: ModelReleaseDocument) {
  return document.executionContract.modes.some((mode) =>
    mode.prompt === "required" &&
    mode.roles.every((role) => role.minItems === 0) &&
    (mode.runtime ?? document.runtime) !== "blocked" &&
    (mode.evidence ?? document.evidence) !== "UNKNOWN"
  );
}

function seedRows(store: DatabaseSync): SeedRow[] {
  return modelContractUpgradeSeeds(store).map((value) => {
    return {
      archived_at: value.archived_at,
      capability: value.capability,
      catalogCredentialRevision: value.catalog_credential_revision,
      default_parameters: value.default_parameters,
      id: value.id,
      providerConfigurationVersion: value.provider_configuration_version,
      providerDriver: value.provider_driver,
      providerKeyStatus: value.provider_key_status,
      providerModelId: value.provider_model_id,
      providerProfileId: value.provider_profile_id,
      providerProtocol: value.provider_protocol,
      providerStatus: value.provider_status,
      status: value.status,
    };
  });
}

export function planModelContractUpgrade(store: DatabaseSync) {
  const rows = seedRows(store);
  const credentials = modelContractUpgradeCredentialSeeds(store);
  const templates = publishedTemplateGraphs(store);
  const models = rows.map((row) => {
    const state = modelContractState(store, row.id);
    const active = state.active;
    if (!active) throw new Error(`模型 ${row.id} 没有活动revision`);
    const frozen = inspectModelReleaseDocument(active.document);
    if (
      frozen.documentHash !== active.hash ||
      frozen.compilerHash !== active.validation.compilerHash
    ) throw new Error(`模型 ${row.id} 的活动revision完整性失败`);
    const proposed = targetDocument(row);
    const proposedProof = inspectModelReleaseDocument(proposed);
    const drift = currentModelReleasePolicyDrift(active.document);
    const semantic = active.document.runtime === "declarative" &&
        proposed.runtime === "declarative" &&
        active.document.connectorFamily === proposed.connectorFamily
      ? analyzeModelContractTemplateCompatibility({
          active: active.document,
          proposed,
          rows: templates,
        })
      : undefined;
    const action = row.providerModelId === "grok-video-3" &&
        active.hash !== proposedProof.documentHash
      ? "publish-revision"
      : row.providerModelId === "kwvideo-v2" && !row.archived_at &&
          !hasTextFoundation(active.document)
        ? "archive"
        : "none";
    const profileCredentials = credentials.filter((credential) =>
      credential.provider_profile_id === row.providerProfileId
    ).map((credential) => ({
      accountId: credential.account_id,
      credentialVersion: credential.credential_version,
      keyStatus: credential.key_status,
      updatedAt: credential.updated_at,
    }));
    return Object.freeze({
      action,
      activeCompilerHash: active.validation.compilerHash,
      activeDocumentHash: active.hash,
      activeModes: modeSummary(active.document),
      activeRevisionId: active.revisionId,
      activeRevisionNumber: active.revisionNumber,
      capability: row.capability,
      currentPolicyDrift: drift.drifted,
      currentPolicyDriftCode: drift.code,
      hasTextFoundation: hasTextFoundation(active.document),
      modelId: row.id,
      archived: Boolean(row.archived_at),
      proposedCompilerHash: proposedProof.compilerHash,
      proposedDocumentHash: proposedProof.documentHash,
      proposedModes: modeSummary(proposed),
      proposed,
      templateImpact: semantic
        ? {
            incompatibleTemplateIds: semantic.incompatibleTemplateIds,
            nodeMatrix: semantic.nodes,
            preexistingIncompatibleTemplateIds:
              semantic.preexistingIncompatibleTemplateIds,
            templateIds: semantic.templateIds,
          }
        : {
            incompatibleTemplateIds: [],
            nodeMatrix: [],
            preexistingIncompatibleTemplateIds: [],
            templateIds: [],
          },
      providerModelId: row.providerModelId,
      providerSnapshot: Object.freeze({
        accountCredentialCount: profileCredentials.length,
        accountCredentialSnapshotHash: snapshotHash(profileCredentials),
        invalidAccountCredentialCount: profileCredentials.filter((credential) =>
          credential.keyStatus !== "valid"
        ).length,
        catalogCredentialRevision: row.catalogCredentialRevision,
        configurationVersion: row.providerConfigurationVersion,
        driver: row.providerDriver,
        keyStatus: row.providerKeyStatus,
        profileId: row.providerProfileId,
        status: row.providerStatus,
      }),
    });
  });
  const providerModelIds = models.map((model) => model.providerModelId).sort();
  const baselineSnapshotHash = snapshotHash({
    models: models.map((model) => ({
      activeCompilerHash: model.activeCompilerHash,
      activeDocumentHash: model.activeDocumentHash,
      activeRevisionId: model.activeRevisionId,
      archived: model.archived,
      modelId: model.modelId,
      providerModelId: model.providerModelId,
      providerSnapshot: model.providerSnapshot,
    })),
    providerModelIds,
    schemaVersion: Number(store.prepare("PRAGMA user_version").get()!.user_version),
  });
  return Object.freeze({
    auditedModelCount: rows.length,
    archivedKwvideo: models.some((model) =>
      model.providerModelId === "kwvideo-v2" && model.archived
    ),
    models: Object.freeze(models),
    baselineSnapshotHash,
    providerModelIds: Object.freeze(providerModelIds),
    providerModelSetHash: snapshotHash(providerModelIds),
    paidProviderRequests: 0 as const,
    publishedModelCount: models.filter((model) => !model.archived).length,
    schemaVersion: Number(store.prepare("PRAGMA user_version").get()!.user_version),
  });
}

function activateRelease(
  store: DatabaseSync,
  modelId: string,
  document: ModelReleaseDocument,
) {
  const timestamp = new Date().toISOString();
  const model = store.prepare(`
    UPDATE model_profiles
    SET default_parameters = ?, status = 'published',
        published_at = COALESCE(published_at, ?), updated_at = ?
    WHERE id = ? AND archived_at IS NULL
  `).run(JSON.stringify(document.capabilitySchema), timestamp, timestamp, modelId);
  if (model.changes !== 1) throw new Error("模型发布状态已变化，升级已阻断");
  const binding = store.prepare(`
    UPDATE node_model_bindings SET enabled = 1, updated_at = ?
    WHERE node_type = ? AND model_id = ?
  `).run(timestamp, document.capability, modelId);
  if (binding.changes !== 1) throw new Error("模型能力绑定不存在，升级已阻断");
}

function archiveKwvideo(
  store: DatabaseSync,
  actorUserId: string,
  modelId: string,
) {
  const operation = () => {
    const row = store.prepare(`
      SELECT models.status, models.archived_at, bindings.enabled, bindings.is_default
      FROM model_profiles AS models
      JOIN node_model_bindings AS bindings
        ON bindings.model_id = models.id AND bindings.node_type = models.capability
      WHERE models.id = ?
    `).get(modelId) as {
      archived_at: string | null;
      enabled: number;
      is_default: number;
      status: string;
    } | undefined;
    if (!row) throw new Error("kwvideo-v2模型不存在");
    if (row.archived_at) return false;
    const templateCount = publishedTemplateIdsUsingModel(store, modelId).length;
    const references = modelReferenceCounts(store, modelId);
    if (row.is_default || templateCount || references.activeTasks) {
      throw new Error("kwvideo-v2仍有默认、模板或活动任务引用，下架已阻断");
    }
    const timestamp = new Date().toISOString();
    const model = store.prepare(`
      UPDATE model_profiles
      SET status = 'disabled', archived_at = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NULL
    `).run(timestamp, timestamp, modelId);
    const binding = store.prepare(`
      UPDATE node_model_bindings
      SET enabled = 0, is_default = 0, updated_at = ?
      WHERE model_id = ?
    `).run(timestamp, modelId);
    if (model.changes !== 1 || binding.changes !== 1) {
      throw new Error("kwvideo-v2下架状态已变化");
    }
    recordAudit(store, actorUserId, "model_contract.archive_policy", null, {
      modelId,
      paidProviderRequests: 0,
      reason: "NO_VERIFIABLE_TEXT_FOUNDATION",
      retainedHistoricalCanvasReferences: true,
    });
    return true;
  };
  return store.isTransaction
    ? operation()
    : inImmediateTransaction(store, operation);
}

export function applyModelContractUpgrade(
  store: DatabaseSync,
  actorUserId: string,
  input: Readonly<{ expectedBaselineSnapshotHash: string }>,
) {
  return inImmediateTransaction(store, () => {
    const before = planModelContractUpgrade(store);
    if (before.baselineSnapshotHash !== input.expectedBaselineSnapshotHash) {
      throw new Error("dry-run基线快照已变化，升级CAS已阻断");
    }
    if (
      before.schemaVersion !== 41 ||
      before.auditedModelCount !== 11 ||
      !(
        before.publishedModelCount === 11 ||
        (before.publishedModelCount === 10 && before.archivedKwvideo)
      )
    ) {
      throw new Error("升级只允许在已核验的schema41/11模型基线上执行");
    }
    if (JSON.stringify(before.providerModelIds) !== JSON.stringify(expectedProviderModelIds)) {
      throw new Error("升级模型身份集合与核准的11模型基线不一致");
    }
    if (before.models.some((model) =>
      model.providerSnapshot.status !== "enabled" ||
      model.providerSnapshot.keyStatus !== "valid" ||
      !Number.isSafeInteger(model.providerSnapshot.configurationVersion) ||
      model.providerSnapshot.configurationVersion < 1
    )) throw new Error("Provider状态或配置版本不满足升级基线");
    const unexpected = before.models.filter((model) =>
      model.currentPolicyDrift && model.providerModelId !== "grok-video-3"
    );
    if (unexpected.length) throw new Error("存在GK以外的当前政策漂移，升级已阻断");
    const gk = before.models.find((model) => model.providerModelId === "grok-video-3");
    if (!gk) throw new Error("缺少grok-video-3活动合同");
    if (
      gk.templateImpact.incompatibleTemplateIds.length ||
      gk.templateImpact.nodeMatrix.length !== 34 ||
      gk.templateImpact.templateIds.length !== 22
    ) throw new Error("GK生产模板语义矩阵未达到22模板/34节点兼容门");
    const kw = before.models.find((model) => model.providerModelId === "kwvideo-v2");
    const archivedKwvideo = kw?.action === "archive"
      ? archiveKwvideo(store, actorUserId, kw.modelId)
      : false;
    const release = gk.action === "publish-revision"
      ? upgradeModelContractRevision(store, actorUserId, {
          document: gk.proposed,
          expectedActiveRevisionId: gk.activeRevisionId,
          impact: gk.templateImpact,
        }, (revision) => activateRelease(store, gk.modelId, revision.document))
      : { changed: false as const, revision: modelContractState(store, gk.modelId).active! };
    return Object.freeze({
      archivedKwvideo,
      gkRevisionChanged: release.changed,
      gkRevisionId: release.revision.revisionId,
      gkRevisionNumber: release.revision.revisionNumber,
      paidProviderRequests: 0 as const,
    });
  });
}

function parseCli(argv: readonly string[]) {
  let apply = false;
  let dataDirectory: string | undefined;
  let expectedAttestationSha256: string | undefined;
  let expectedPlanHash: string | undefined;
  let stagingRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if ([
      "--data-dir",
      "--expected-attestation-sha256",
      "--expected-plan-hash",
      "--staging-root",
    ].includes(item) && argv[index + 1]) {
      const value = argv[++index];
      if (value.startsWith("--")) throw new Error("合同升级参数无效");
      if (item === "--data-dir" && !dataDirectory) dataDirectory = value;
      else if (item === "--staging-root" && !stagingRoot) stagingRoot = value;
      else if (item === "--expected-plan-hash" && !expectedPlanHash) expectedPlanHash = value;
      else if (item === "--expected-attestation-sha256" && !expectedAttestationSha256) {
        expectedAttestationSha256 = value;
      }
      else throw new Error("合同升级参数无效");
      continue;
    }
    throw new Error("合同升级参数无效");
  }
  if (!dataDirectory || !isAbsolute(dataDirectory)) {
    throw new Error("必须用--data-dir提供绝对隔离数据目录");
  }
  if (apply && (!stagingRoot || !isAbsolute(stagingRoot))) {
    throw new Error("apply必须用--staging-root声明绝对恢复暂存根目录");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedPlanHash ?? "")) {
    throw new Error("apply必须提供dry-run输出的--expected-plan-hash");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedAttestationSha256 ?? "")) {
    throw new Error("apply必须提供可信--expected-attestation-sha256");
  }
  return {
    apply,
    dataDirectory,
    expectedAttestationSha256,
    expectedPlanHash,
    stagingRoot,
  };
}

function attestApplyDirectory(
  dataDirectory: string,
  stagingRoot: string,
  databaseIdentity: Stats,
  expectedAttestationSha256: string,
) {
  const stagingIdentity = lstatSync(stagingRoot);
  if (stagingIdentity.isSymbolicLink() || !stagingIdentity.isDirectory()) {
    throw new Error("恢复暂存根目录身份无效");
  }
  const realData = realpathSync(dataDirectory);
  const dataIdentity = lstatSync(realData);
  if ((dataIdentity.mode & 0o077) !== 0) {
    throw new Error("恢复暂存数据目录必须为私有目录");
  }
  const realRoot = realpathSync(stagingRoot);
  const fixedLocalTemporaryRoot = process.platform === "darwin"
    ? "/private/var/folders"
    : "/tmp";
  const realTemporaryRoot = realpathSync(fixedLocalTemporaryRoot);
  if (
    realRoot !== "/var/lib/unboundry-rollbacks" &&
    realRoot !== realTemporaryRoot &&
    !realRoot.startsWith(`${realTemporaryRoot}${sep}`)
  ) throw new Error("恢复暂存根目录不在固定隔离allowlist");
  const withinRoot = relative(realRoot, realData);
  if (!withinRoot || withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    throw new Error("apply数据目录必须是恢复暂存根目录的直接隔离后代");
  }
  const configuredData = process.env.UNBOUNDRY_DATA_DIR &&
      isAbsolute(process.env.UNBOUNDRY_DATA_DIR)
    ? resolve(process.env.UNBOUNDRY_DATA_DIR)
    : undefined;
  const forbidden = [
    resolve(process.cwd(), "data"),
    "/var/lib/unboundry",
    "/opt/unboundry",
    ...(configuredData
      ? [existsSync(configuredData) ? realpathSync(configuredData) : configuredData]
      : []),
  ];
  if (forbidden.some((path) => realData === path || realData.startsWith(`${path}${sep}`))) {
    throw new Error("禁止对应用或生产数据目录直接执行合同升级");
  }
  const attestationPath = join(realData, ".model-contract-upgrade-recovery.json");
  if (!existsSync(attestationPath)) throw new Error("恢复暂存证明文件不存在");
  const identity = lstatSync(attestationPath);
  if (
    identity.isSymbolicLink() || !identity.isFile() || identity.nlink !== 1 ||
    (identity.mode & 0o277) !== 0
  ) {
    throw new Error("恢复暂存证明文件身份无效");
  }
  const attestationBytes = readFileSync(attestationPath);
  if (createHash("sha256").update(attestationBytes).digest("hex") !== expectedAttestationSha256) {
    throw new Error("恢复暂存证明摘要与核准manifest不一致");
  }
  const parsed = JSON.parse(attestationBytes.toString("utf8")) as Record<string, unknown>;
  const databasePath = join(realData, "unboundry.sqlite");
  if (
    parsed.purpose !== "MODEL-CONTRACT-002" ||
    parsed.schemaVersion !== 41 ||
    parsed.dataDirectoryRealPath !== realData ||
    parsed.databaseFileName !== "unboundry.sqlite" ||
    parsed.databaseSizeBytes !== databaseIdentity.size ||
    parsed.databaseSha256 !== fileSha256(databasePath) ||
    typeof parsed.snapshotId !== "string" || !parsed.snapshotId.trim()
  ) throw new Error("恢复暂存证明与待升级数据库不匹配");
}

export function runModelContractUpgradeCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const dataIdentity = lstatSync(options.dataDirectory);
  const databasePath = join(options.dataDirectory, "unboundry.sqlite");
  const databaseIdentity = lstatSync(databasePath);
  if (
    dataIdentity.isSymbolicLink() ||
    !dataIdentity.isDirectory() ||
    databaseIdentity.isSymbolicLink() ||
    !databaseIdentity.isFile() ||
    databaseIdentity.nlink !== 1 ||
    realpathSync(databasePath) !== join(realpathSync(options.dataDirectory), "unboundry.sqlite")
  ) throw new Error("合同升级数据目录身份无效");
  if (options.apply) {
    attestApplyDirectory(
      options.dataDirectory,
      options.stagingRoot!,
      databaseIdentity,
      options.expectedAttestationSha256!,
    );
  }
  const store = new DatabaseSync(databasePath, {
    readOnly: !options.apply,
    timeout: 5_000,
  });
  try {
    const plan = planModelContractUpgrade(store);
    const result = options.apply
      ? applyModelContractUpgrade(
          store,
          modelReleaseBootstrapActorUserId(store),
          { expectedBaselineSnapshotHash: options.expectedPlanHash! },
        )
      : undefined;
    const report = {
      mode: options.apply ? "apply" : "dry-run",
      paidProviderRequests: 0,
      plan,
      ...(result ? { result } : {}),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    store.close();
  }
}
