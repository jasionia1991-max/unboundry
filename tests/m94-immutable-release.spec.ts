import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import {
  attestReleaseSourcePair,
  RELEASE_SOURCE_PAIR_MODES,
// @ts-expect-error Release source-pair logic is intentionally shared with Node scripts.
} from "../scripts/lib/release-source-pair.mjs";

test.describe.configure({ mode: "serial" });

const execute = promisify(execFile);
const releaseBuilder = join(process.cwd(), "scripts/build-release.mjs");
const npmCli = join(dirname(dirname(process.execPath)), "lib/node_modules/npm/bin/npm-cli.js");
const runtimeReport = process.report?.getReport() as {
  header?: { glibcVersionRuntime?: string };
} | undefined;
const runtimeLibc = process.platform === "linux"
  ? (runtimeReport?.header?.glibcVersionRuntime ? "glibc" : "musl")
  : "none";

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

async function commit(repository: string, message: string) {
  const result = await command(
    "git",
    [
      "-c",
      "user.name=M94",
      "-c",
      "user.email=m94@example.invalid",
      "commit",
      "--quiet",
      "-am",
      message,
    ],
    repository,
  );
  expect(result.exitCode).toBe(0);
  const identity = await command("git", ["rev-parse", "HEAD"], repository);
  expect(identity.exitCode).toBe(0);
  return identity.stdout.trim();
}

async function command(
  command: string,
  arguments_: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  try {
    const result = await execute(command, arguments_, {
      cwd,
      env: {
        ...process.env,
        ...environment,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string; stdout?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : -1,
      stderr: String(failure.stderr ?? ""),
      stdout: String(failure.stdout ?? ""),
    };
  }
}

async function write(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
}

async function createSyntheticRepository(options: {
  forbiddenPath?: string;
  symlink?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m94-release-"));
  await chmod(root, 0o700);
  const repository = join(root, "repo");
  const releases = join(root, "releases");
  const scratch = join(root, "scratch");
  const npmCache = join(root, "npm-cache");
  const setupCache = join(root, "setup-cache");
  const tools = join(root, "tools");
  await Promise.all([
    mkdir(repository, { mode: 0o700 }),
    mkdir(releases, { mode: 0o700 }),
    mkdir(scratch, { mode: 0o700 }),
    mkdir(npmCache, { mode: 0o700 }),
    mkdir(setupCache, { mode: 0o700 }),
    mkdir(tools, { mode: 0o700 }),
  ]);
  const ffmpegExecutable = join(tools, "ffmpeg");
  const ffprobeExecutable = join(tools, "ffprobe");
  await write(ffmpegExecutable, "#!/bin/sh\nprintf 'ffmpeg version m94-synthetic\\n'\n");
  await write(ffprobeExecutable, "#!/bin/sh\nprintf 'ffprobe version m94-synthetic\\n'\n");
  await chmod(ffmpegExecutable, 0o500);
  await chmod(ffprobeExecutable, 0o500);
  await command("git", ["init", "--quiet"], repository);
  await write(
    join(repository, "scripts/build-release.mjs"),
    await readFile(releaseBuilder, "utf8"),
  );
  await write(
    join(repository, "scripts/offline-network-guard.mjs"),
    await readFile(join(process.cwd(), "scripts/offline-network-guard.mjs"), "utf8"),
  );
  await write(join(repository, ".env.example"), "DOCUMENTED_ONLY=1\n");
  await write(join(repository, "package.json"), `${JSON.stringify({
    dependencies: {
      "@vitejs/plugin-react": "file:vendor/vitejs-plugin-react-1.0.0.tgz",
      vite: "file:vendor/vite-1.0.0.tgz",
    },
    devDependencies: {
      "@playwright/test": "file:vendor/playwright-test-1.0.0.tgz",
      typescript: "file:vendor/typescript-1.0.0.tgz",
    },
    engines: { node: ">=22.23.1 <23", npm: "10.9.8" },
    name: "m94-immutable-fixture",
    packageManager: "npm@10.9.8",
    private: true,
    scripts: { build: "tsc --noEmit && vite build" },
    type: "module",
    version: "0.6.0",
  }, null, 2)}\n`);
  await write(
    join(repository, "scripts/migrate-schema37-to39.mjs"),
    "throw new Error('synthetic migration is never executed');\n",
  );
  await write(
    join(repository, "scripts/node-typescript-runtime.mjs"),
    "export {};\n",
  );
  await write(join(repository, "vendor/typescript/package.json"), `${JSON.stringify({
    bin: { tsc: "bin/tsc" },
    name: "typescript",
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(repository, "vendor/playwright-test/package.json"), `${JSON.stringify({
    name: "@playwright/test",
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(repository, "vendor/typescript/bin/tsc"), `
    import { access } from "node:fs/promises";
    await access("tsconfig.json");
  `);
  await write(join(repository, "vendor/vite/package.json"), `${JSON.stringify({
    bin: { vite: "bin/vite.js" },
    name: "vite",
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(repository, "vendor/vite/bin/vite.js"), `
    import { mkdir, writeFile } from "node:fs/promises";
    await mkdir("dist/client", { recursive: true });
    await writeFile("dist/client/index.html", "immutable fixture\\n");
  `);
  await write(join(repository, "vendor/plugin-react/package.json"), `${JSON.stringify({
    exports: "./dist/index.js",
    name: "@vitejs/plugin-react",
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(repository, "vendor/plugin-react/dist/index.js"), "export default function react() { return {}; }\n");
  await write(join(repository, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      strict: true,
      target: "ES2022",
    },
    include: ["server", "types", "vite.config.ts"],
  }, null, 2)}\n`);
  await write(join(repository, "vite.config.ts"), `
    import { defineConfig } from "vite";
    export default defineConfig({ root: "client", build: { outDir: "../dist/client" } });
  `);
  await write(join(repository, "client/index.html"), "<!doctype html><title>immutable fixture</title>\n");
  await write(join(repository, "server/runtime.ts"), "export const fixture = true;\n");
  await write(join(repository, "types/runtime.ts"), "export type Fixture = true;\n");
  await write(
    join(repository, "spec/unboundry-state-fixtures.json"),
    '{"fixtures":[]}\n',
  );
  if (options.forbiddenPath) {
    await write(join(repository, options.forbiddenPath), "must never ship\n");
  }
  if (options.symlink) {
    await symlink("package.json", join(repository, "unsafe-link"));
  }
  const setupEnvironment = {
    npm_config_cache: setupCache,
    npm_config_userconfig: join(root, "empty-npmrc"),
  };
  await writeFile(setupEnvironment.npm_config_userconfig, "", { mode: 0o600 });
  for (const packagePath of [
    "./vendor/playwright-test",
    "./vendor/typescript",
    "./vendor/vite",
    "./vendor/plugin-react",
  ]) {
    const packed = await command(process.execPath, [
      npmCli,
      "pack",
      packagePath,
      "--pack-destination",
      "vendor",
      "--ignore-scripts",
      "--offline",
    ], repository, setupEnvironment);
    if (packed.exitCode !== 0) {
      throw new Error(`Unable to prepare the offline fixture package: ${packed.stderr}`);
    }
  }
  const locked = await command(process.execPath, [
    npmCli,
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
  ], repository, setupEnvironment);
  if (locked.exitCode !== 0) throw new Error("Unable to prepare the offline fixture lock");
  await command("git", ["add", "--all"], repository);
  await command("git", [
    "-c", "user.name=M94",
    "-c", "user.email=m94@example.invalid",
    "commit", "--quiet", "-m", "fixture",
  ], repository);
  const commit = (await command("git", ["rev-parse", "HEAD"], repository)).stdout.trim();
  await writeFile(join(repository, ".git/info/exclude"), "working-copy-only.txt\n", {
    flag: "a",
  });
  return {
    commit,
    ffmpegExecutable,
    ffprobeExecutable,
    npmCache,
    releases,
    repository,
    root,
    scratch,
  };
}

function builderArguments(fixture: Awaited<ReturnType<typeof createSyntheticRepository>>) {
  return [
    releaseBuilder,
    "--artifact-class", "synthetic-test",
    "--commit", fixture.commit,
    "--expected-version", "0.6.0",
    "--formal-release-commit", "false",
    "--ffmpeg-executable", fixture.ffmpegExecutable,
    "--ffprobe-executable", fixture.ffprobeExecutable,
    "--release-root", fixture.releases,
    "--scratch-root", fixture.scratch,
    "--npm-cache", fixture.npmCache,
    "--release-id", "v0.6.0",
    "--release-role", "final",
    "--target-platform", process.platform,
    "--target-arch", process.arch,
    "--target-libc", runtimeLibc,
  ];
}

async function runBuilder(fixture: Awaited<ReturnType<typeof createSyntheticRepository>>) {
  const arguments_ = builderArguments(fixture);
  arguments_[0] = join(fixture.repository, "scripts/build-release.mjs");
  return command(process.execPath, arguments_, fixture.repository);
}

async function entries(path: string) {
  return (await readdir(path)).sort();
}

test("safe runner owns the clean, repeat, and malicious synthetic release executions", async () => {
  test.setTimeout(120_000);
  const fixture = await createSyntheticRepository();
  try {
    const fixtureLock = JSON.parse(await readFile(
      join(fixture.repository, "package-lock.json"),
      "utf8",
    )) as { packages: Record<string, { resolved?: string }> };
    const fixtureResolutions = Object.values(fixtureLock.packages)
      .map((entry) => entry.resolved)
      .filter((entry): entry is string => typeof entry === "string");
    expect(fixtureResolutions).toEqual(expect.arrayContaining([
      "file:vendor/playwright-test-1.0.0.tgz",
      "file:vendor/typescript-1.0.0.tgz",
      "file:vendor/vite-1.0.0.tgz",
      "file:vendor/vitejs-plugin-react-1.0.0.tgz",
    ]));
    expect(fixtureResolutions.some((entry) => entry.startsWith("https://registry.npmjs.org/")))
      .toBe(false);
    await writeFile(join(fixture.repository, "package.json"), "{\"dirty\":true}\n");
    const dirtyResult = await runBuilder(fixture);
    expect(dirtyResult.exitCode).not.toBe(0);
    expect(JSON.parse(dirtyResult.stderr.trim())).toMatchObject({
      code: "RELEASE_INPUT_DIRTY",
    });
    expect(await entries(fixture.releases)).toEqual([]);
    const runner = await readFile(join(process.cwd(), "scripts/run-safe-tests.mjs"), "utf8");
    expect(runner).toContain("immutable-release-builder");
    expect(runner).toContain("Full snapshot bridge/final fixtures prove the release closure");
    expect(runner).toContain("specs.includes(IMMUTABLE_RELEASE_SPEC)");
    expect(runner).toContain("createSnapshotImmutableReleasePairFixture");
    const snapshotFixture = runner.slice(
      runner.indexOf("async function createSnapshotImmutableReleaseFixture"),
      runner.indexOf("function immutableReleaseBuilderArguments"),
    );
    expect(snapshotFixture).toContain("await sandboxedNode(");
    expect(snapshotFixture).toContain("RELEASE_SOURCE_PAIR_MODES.formal");
    expect(snapshotFixture).toContain("repository: repositoryRoot");
    expect(snapshotFixture).toContain("sourceRecordsFingerprint(finalCommit");
    expect(runner).toContain("bridgeSourceVersion");
    expect(runner).toContain("expectedBuilderInvocations: immutableReleaseSelected ? options.repeat * 5 : 0");
    expect(runner).toContain("immutableReleaseBuilderInvocations");
    expect(runner).toContain("builderInvocations += 1");
    expect(runner).toContain("await invokeBuilder(final)");
    expect(runner).toContain("await invokeBuilder(bridge)");
    expect(runner).toContain("await invokeBuilder(malicious)");
    expect(runner).toContain("[bridge, final, malicious].filter(Boolean)");
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("release builder makes its private umask independent of the caller", async () => {
  test.setTimeout(120_000);
  const fixture = await createSyntheticRepository();
  try {
    const result = await command(
      "/bin/sh",
      [
        "-c",
        'umask 0002; exec "$@"',
        "unboundry-m94-umask",
        process.execPath,
        ...builderArguments(fixture),
      ],
      fixture.repository,
    );
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout.trim()) as {
      admission?: { incompleteMarkerAbsent?: boolean };
      releaseDirectory?: string;
    };
    expect(summary.admission?.incompleteMarkerAbsent).toBe(true);
    expect(summary.releaseDirectory).toBe(join(fixture.releases, "v0.6.0"));
    expect((await lstat(summary.releaseDirectory!)).mode & 0o777).toBe(0o500);
    expect(await entries(fixture.scratch)).toEqual([]);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("release source-pair proof binds a synthetic direct child to exactly three version fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m94-source-pair-"));
  await chmod(root, 0o700);
  const lexicalRepository = join(root, "repo");
  await mkdir(lexicalRepository, { mode: 0o700 });
  const repository = await realpath(lexicalRepository);
  try {
    expect((await command("git", ["init", "--quiet"], repository)).exitCode).toBe(0);
    const packageDocument = {
      name: "m94-release-source-pair",
      private: true,
      version: "0.5.2",
    };
    const lockDocument = {
      lockfileVersion: 3,
      name: "m94-release-source-pair",
      packages: { "": { name: "m94-release-source-pair", version: "0.5.2" } },
      requires: true,
      version: "0.5.2",
    };
    await write(
      join(repository, "package.json"),
      `${JSON.stringify(packageDocument, null, 2)}\n`,
    );
    await write(
      join(repository, "package-lock.json"),
      `${JSON.stringify(lockDocument, null, 2)}\n`,
    );
    expect((await command("git", ["add", "--all"], repository)).exitCode).toBe(0);
    const bridgeCommit = await commit(repository, "bridge 0.5.2");
    packageDocument.version = "0.6.0";
    lockDocument.version = "0.6.0";
    lockDocument.packages[""].version = "0.6.0";
    await write(
      join(repository, "package.json"),
      `${JSON.stringify(packageDocument, null, 2)}\n`,
    );
    await write(
      join(repository, "package-lock.json"),
      `${JSON.stringify(lockDocument, null, 2)}\n`,
    );
    const finalCommit = await commit(repository, "final 0.6.0");
    const relationship = await attestReleaseSourcePair({
      finalCommit,
      mode: RELEASE_SOURCE_PAIR_MODES.synthetic,
      repository,
    });
    expect(relationship).toMatchObject({
      bridgeCommit,
      bridgeSourceVersion: "0.5.2",
      changedPaths: ["package-lock.json", "package.json"],
      crossCommitProof: false,
      finalCommit,
      finalParentIsBridgeCommit: true,
      finalSourceVersion: "0.6.0",
      mode: RELEASE_SOURCE_PAIR_MODES.synthetic,
      proofSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("synthetic fixture rejects invalid inputs before sandboxed build execution", async () => {
  test.setTimeout(120_000);
  const ordinary = await createSyntheticRepository();
  try {
    const partialArguments = builderArguments(ordinary);
    partialArguments[0] = join(ordinary.repository, "scripts/build-release.mjs");
    partialArguments[partialArguments.indexOf("--commit") + 1] = ordinary.commit.slice(0, 12);
    const partial = await command(process.execPath, partialArguments, ordinary.repository);
    expect(partial.exitCode).not.toBe(0);
    expect(JSON.parse(partial.stderr.trim())).toMatchObject({ code: "RELEASE_COMMIT_INVALID" });
    const wrongTargetArguments = builderArguments(ordinary);
    wrongTargetArguments[0] = join(ordinary.repository, "scripts/build-release.mjs");
    wrongTargetArguments[wrongTargetArguments.indexOf("--target-arch") + 1] = "not-this-arch";
    const wrongTarget = await command(process.execPath, wrongTargetArguments, ordinary.repository);
    expect(wrongTarget.exitCode).not.toBe(0);
    expect(JSON.parse(wrongTarget.stderr.trim())).toMatchObject({ code: "RELEASE_TARGET_INVALID" });
    expect(await entries(ordinary.releases)).toEqual([]);
    await chmod(ordinary.releases, 0o777);
    const unsafeRoot = await runBuilder(ordinary);
    expect(unsafeRoot.exitCode).not.toBe(0);
    expect(JSON.parse(unsafeRoot.stderr.trim())).toMatchObject({ code: "RELEASE_PATH_UNSAFE" });
  } finally {
    await chmod(ordinary.releases, 0o700).catch(() => {});
    await rm(ordinary.root, { force: true, recursive: true });
  }

  for (const candidate of [
    { forbiddenPath: "data/private.sqlite" },
    { forbiddenPath: "secrets/runtime.json" },
    { forbiddenPath: "test-results/result.json" },
    { forbiddenPath: ".env.production" },
    { forbiddenPath: "server/private-key.pem" },
    { symlink: true },
  ]) {
    const fixture = await createSyntheticRepository(candidate);
    try {
      const result = await runBuilder(fixture);
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr.trim()).code).toMatch(/^RELEASE_(INPUT|OUTPUT)_UNSAFE$/);
      expect(await entries(fixture.releases)).toEqual([]);
      expect(await entries(fixture.scratch)).toEqual([]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }

});

test("tracked source snapshot pins registry inputs without claiming a Git HEAD or prepared production cache", async () => {
  const requiredSourcePaths = [
    "vite.config.ts",
    "server/runtimeLifecycle.ts",
    "server/runtimeRole.ts",
    "server/publicTemplateSeeds.json",
    "types/modelParameters.ts",
    "spec/unboundry-state-fixtures.json",
  ];
  for (const path of requiredSourcePaths) {
    const details = await lstat(join(process.cwd(), path));
    expect(details.isFile()).toBe(true);
    expect(details.isSymbolicLink()).toBe(false);
  }
  const packageDocument = JSON.parse(await readFile(
    join(process.cwd(), "package.json"),
    "utf8",
  )) as { name?: string; version?: string };
  const packageLock = JSON.parse(await readFile(
    join(process.cwd(), "package-lock.json"),
    "utf8",
  )) as { packages: Record<string, { integrity?: string; resolved?: string }> };
  const registryPackages = Object.entries(packageLock.packages)
    .filter(([path]) => path.startsWith("node_modules/"));
  expect(packageDocument).toMatchObject({
    name: "unboundry-private-replica",
    version: expect.stringMatching(/^0\.(?:5\.2|6\.0)$/),
  });
  expect(registryPackages.length).toBeGreaterThan(0);
  expect(registryPackages.every(([, entry]) =>
    typeof entry.resolved !== "string" || (
      entry.resolved.startsWith("https://registry.npmjs.org/") &&
      typeof entry.integrity === "string" && entry.integrity.length > 0
    )
  )).toBe(true);
  expect(packageLock.packages["node_modules/typescript"]?.resolved)
    .toMatch(/^https:\/\/registry\.npmjs\.org\//);
  expect(packageLock.packages["node_modules/vite"]?.resolved)
    .toMatch(/^https:\/\/registry\.npmjs\.org\//);
  const builder = await readFile(releaseBuilder, "utf8");
  expect(builder).toContain("const PRIVATE_BUILD_UMASK = 0o077;");
  expect(builder).toContain("async function main() {\n  process.umask(PRIVATE_BUILD_UMASK);");
  expect(builder).toContain('const runtimeSourceRoots = Object.freeze(["client", "server", "types"]);');
  expect(builder).toContain('new Set(["production", "synthetic-test"])');
  expect(builder).toContain('"--ffmpeg-executable"');
  expect(builder).toContain('"--ffprobe-executable"');
  expect(builder).toContain("hostPrerequisites");
  expect(builder).toContain('"--omit=dev"');
  expect(builder).toContain('"spec/unboundry-state-fixtures.json"');
  expect(builder).toContain('"node_modules/vite/bin/vite.js"');
  expect(builder).toContain('"--configLoader"');
  expect(builder).toContain('entry.name === ".bin"');
  expect(builder).toContain('entry.path.startsWith("@playwright/")');
  expect(builder).toContain('entry.path === "@playwright" && entry.type !== "directory"');
  expect(builder).toContain("assertEmptyPlaywrightScopeDirectory");
  expect(builder).toContain('entry.name === "@playwright"');
  expect(builder).toContain("npm cache must be an isolated external directory");
  const bubblewrapIsolation = builder.match(
    /const bubblewrapIsolationArguments = Object\.freeze\(\[([\s\S]*?)\]\);/,
  )?.[1];
  expect(bubblewrapIsolation).toBeDefined();
  for (const requiredArgument of [
    '"--die-with-parent"',
    '"--new-session"',
    '"--unshare-all"',
    '"--uid", "0"',
    '"--gid", "0"',
    '"--clearenv"',
  ]) {
    expect(bubblewrapIsolation).toContain(requiredArgument);
  }
  expect(bubblewrapIsolation).not.toContain("--share-net");
  expect(builder).not.toContain("--share-net");
  expect(builder).toContain('const BUBBLEWRAP_EXECUTABLE = "/usr/bin/bwrap";');
  expect(builder).toContain("details.uid !== 0 || (details.mode & 0o022) !== 0");
  expect(builder).toContain('result.push("--ro-bind", entry.source, entry.destination)');
  expect(builder).toContain('result.push("--ro-bind", path, path)');
  expect(builder).toContain('result.push("--bind", path, path)');
  expect(builder).toContain('result.push("--proc", "/proc", "--dev", "/dev")');
  expect(builder).toContain('{ ...options, env: sourceControlEnvironment() }');
  expect(builder).toContain("const readOnly = [source, npmCache]");
  expect(builder).toContain("const readOnlySandboxPaths = [...new Set([source, npmCache])]");
  expect(builder).toContain("const writable = [...new Set([home, auditFile, ...writablePaths])]");
  expect(builder).toContain("options.timeout ?? 20 * 60_000");
  expect(builder).toContain("await assertProcessGroupStopped(processGroupId)");
  expect(builder).toContain("Production releases require the clean Linux x64 glibc builder");
  expect(builder).toContain("Production artifacts require a formal release commit");
  expect(builder).toContain('path: "legacy-runtime/dist/client/index.html"');
  expect(builder).toContain("parentDependencyConfigLoadSmoke");
  expect(builder).toContain("legacy parent dependency config-load smoke");
  expect(builder).toContain("exact-v0.5.1-version-overlay");
  expect(builder).toContain("originalLockSha256");
  expect(builder).toContain(
    "cd98d90aaae56de756164fa0434dfb6bb144598183536c6d91067308e8d24517",
  );
  expect(builder).toContain("productionDependencies");
  expect(builder).toContain("RELEASE_SCRATCH_CLEANUP_FAILED");
  expect(builder).toContain("removePrivateBuildScratch");
  const prePublicationCleanup = builder.indexOf(
    "await cleanupPrivateBuildScratch(workRoot, roots.scratch);",
  );
  const terminalPublication = builder.indexOf("await rm(incompleteMarker);");
  expect(prePublicationCleanup).toBeGreaterThan(-1);
  expect(terminalPublication).toBeGreaterThan(prePublicationCleanup);
  expect(
    builder.slice(prePublicationCleanup, terminalPublication),
  ).toContain("workRoot = undefined;");
});
