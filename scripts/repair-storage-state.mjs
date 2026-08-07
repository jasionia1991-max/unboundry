import { resolve } from "node:path";
import {
  appDataDirectory,
  openAppDatabase,
} from "../server/database.ts";
import {
  repairStorageProfileState,
} from "../server/secureStorageProfiles.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataDirectory = resolve(
  argument("--data-dir") ?? appDataDirectory(),
);

const previousDataDirectory = process.env.TAPNOW_DATA_DIR;
process.env.TAPNOW_DATA_DIR = dataDirectory;
let repair;
try {
  repair = await repairStorageProfileState();
} finally {
  if (previousDataDirectory === undefined) {
    delete process.env.TAPNOW_DATA_DIR;
  } else {
    process.env.TAPNOW_DATA_DIR = previousDataDirectory;
  }
}
console.log(
  JSON.stringify({
    activeProfileId: repair.activeProfileId,
    changed: repair.changed,
    mediaRoutingEnabled: repair.mediaRoutingEnabled,
    profile: repair.profile,
  }),
);

const store = openAppDatabase(dataDirectory);
try {
  const admin = store
    .prepare(`
      SELECT id FROM users
      WHERE role = 'admin' AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get();
  if (admin) {
    store
      .prepare(`
        INSERT INTO admin_audit_events (
          actor_user_id, action, target_user_id, details, created_at
        ) VALUES (?, ?, NULL, ?, ?)
      `)
      .run(
        admin.id,
        "repair_storage_profile_state",
        JSON.stringify({
          changed: repair.changed,
          mediaRoutingEnabled: repair.mediaRoutingEnabled,
          profileId: repair.activeProfileId,
        }),
        new Date().toISOString(),
      );
  }

  if (process.argv.includes("--backfill")) {
    const columns = store
      .prepare("PRAGMA table_info(media_assets)")
      .all()
      .map((column) => column.name);
    if (!columns.includes("storage_profile_id")) {
      console.log(
        JSON.stringify({
          backfill: "skipped",
          reason: "storage_profile_id 列不存在，请先用新代码重启服务完成 v34 迁移",
        }),
      );
    } else if (!repair.activeProfileId) {
      console.log(
        JSON.stringify({
          backfill: "skipped",
          reason: "没有可用的正式 OSS 配置",
        }),
      );
    } else {
      const result = store
        .prepare(`
          UPDATE media_assets
          SET storage_profile_id = ?
          WHERE storage_backend = 'oss' AND storage_profile_id IS NULL
        `)
        .run(repair.activeProfileId);
      if (admin) {
        store
          .prepare(`
            INSERT INTO admin_audit_events (
              actor_user_id, action, target_user_id, details, created_at
            ) VALUES (?, ?, NULL, ?, ?)
          `)
          .run(
            admin.id,
            "backfill_storage_profile_ids",
            JSON.stringify({
              changes: Number(result.changes),
              profileId: repair.activeProfileId,
            }),
            new Date().toISOString(),
          );
      }
      console.log(
        JSON.stringify({
          backfill: "done",
          changes: Number(result.changes),
          profileId: repair.activeProfileId,
        }),
      );
    }
  }
} finally {
  store.close();
}
