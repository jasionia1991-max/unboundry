throw new Error(
  "LEGACY_DEPLOY_DISABLED: scripts/deploy.mjs is frozen because it mutates, tags, deploys, restarts, and pushes in one command. Build an immutable offline package with scripts/build-release.mjs; switching and publishing require a separate rehearsed command and explicit production authorization.",
);
