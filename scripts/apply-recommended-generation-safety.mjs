import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const RECOMMENDED = {
  per_user_concurrency: 20,
  image_concurrency: 10,
  video_concurrency: 2,
  audio_concurrency: 2,
  text_concurrency: 10,
  requests_per_minute: 120,
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  let dataDirectory;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") {
      apply = true;
      continue;
    }
    if (option === "--data-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || dataDirectory) {
        fail("SAFETY_ARGUMENT_INVALID", "Missing or duplicate --data-dir value");
      }
      dataDirectory = value;
      index += 1;
      continue;
    }
    fail("SAFETY_ARGUMENT_INVALID", `Unknown argument: ${option}`);
  }
  if (!dataDirectory) {
    fail("SAFETY_ARGUMENT_INVALID", "--data-dir is required");
  }
  return { apply, dataDirectory };
}

const { apply, dataDirectory } = parseArguments(process.argv.slice(2));
const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
try {
  const row = database
    .prepare("SELECT * FROM generation_safety_settings WHERE id = 1")
    .get();
  if (!row) fail("SAFETY_SETTINGS_MISSING", "generation_safety_settings row 1 is missing");
  const before = {
    per_user_concurrency: Number(row.per_user_concurrency),
    image_concurrency: Number(row.image_concurrency),
    video_concurrency: Number(row.video_concurrency),
    audio_concurrency: Number(row.audio_concurrency),
    text_concurrency: Number(row.text_concurrency),
    requests_per_minute: Number(row.requests_per_minute),
  };
  for (const [key, value] of Object.entries(RECOMMENDED)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
      fail("SAFETY_VALUE_INVALID", `${key} must be an integer between 1 and 1000`);
    }
  }
  if (!apply) {
    console.log(JSON.stringify({
      before,
      dryRun: true,
      recommended: RECOMMENDED,
    }, null, 2));
  } else {
    database
      .prepare(`
        UPDATE generation_safety_settings
        SET
          per_user_concurrency = ?,
          image_concurrency = ?,
          video_concurrency = ?,
          audio_concurrency = ?,
          text_concurrency = ?,
          requests_per_minute = ?,
          updated_at = ?
        WHERE id = 1
      `)
      .run(
        RECOMMENDED.per_user_concurrency,
        RECOMMENDED.image_concurrency,
        RECOMMENDED.video_concurrency,
        RECOMMENDED.audio_concurrency,
        RECOMMENDED.text_concurrency,
        RECOMMENDED.requests_per_minute,
        new Date().toISOString(),
      );
    console.log(JSON.stringify({ applied: true, before, after: RECOMMENDED }, null, 2));
  }
} finally {
  database.close();
}
