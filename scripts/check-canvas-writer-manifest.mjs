import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API as TypeScriptCompilerAPI } from "typescript/unstable/sync";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(scriptPath), ".."));
const manifestRelativePath =
  "spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_WRITER_MANIFEST_2026-09-03.json";
const manifestPath = join(repositoryRoot, manifestRelativePath);
const protectedExactExclusions = Object.freeze([
  "spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json",
  "spec/public-templates-director-split-revision.json",
]);
const includeGlobs = Object.freeze([
  "client/src/**/*.ts",
  "client/src/**/*.tsx",
  "server/**/*.ts",
  "types/**/*.ts",
  "vite.config.ts",
]);
const testIncludeGlobs = Object.freeze(["tests/**/*.ts", "tests/**/*.mjs"]);
const parserVersion = "typescript-compiler-api@7.0.2/canvas-writer-v2";

const STATE_CLASSES = Object.freeze([
  "Durable User",
  "Durable Server",
  "Ephemeral View",
  "Migration/Legacy",
  "control-only",
  "unknown",
]);
const SIDES = Object.freeze(["client", "server", "test"]);
const FIELD_OWNERS = Object.freeze([
  "durable-user",
  "durable-server",
  "ephemeral-view",
  "migration",
  "control-only",
  "unknown",
  "test-fixture",
]);
const EXCEPTION_KINDS = Object.freeze([
  null,
  "bootstrap",
  "schema-migration",
  "account-delete-cascade",
  "test-double",
  "time-bounded-legacy-adapter",
]);

function fail(message) {
  throw new Error(`[canvas-writer-manifest] ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) fail(`git ${args.join(" ")} could not start`);
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function repositoryPath(absolutePath) {
  const candidate = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (candidate === ".." || candidate.startsWith("../") || isAbsolute(candidate)) {
    return undefined;
  }
  return candidate;
}

function relativeProjectPath(projectRoot, absolutePath) {
  const candidate = relative(projectRoot, absolutePath).split(sep).join("/");
  if (candidate === ".." || candidate.startsWith("../") || isAbsolute(candidate)) {
    return undefined;
  }
  return candidate;
}

function isProtectedPath(path) {
  return protectedExactExclusions.includes(path);
}

function escapeRegularExpression(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globRegularExpression(pattern) {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character !== "*") {
      output += escapeRegularExpression(character);
      continue;
    }
    if (pattern[index + 1] !== "*") {
      output += "[^/]*";
      continue;
    }
    index += 1;
    if (pattern[index + 1] === "/") {
      index += 1;
      output += "(?:.*/)?";
    } else {
      output += ".*";
    }
  }
  return new RegExp(`${output}$`);
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => globRegularExpression(pattern).test(path));
}

function sourceTreeHash(files, projectRoot = repositoryRoot) {
  const hash = createHash("sha256");
  for (const file of files) {
    if (isProtectedPath(file)) fail("protected path reached source hash: " + file);
    hash.update(Buffer.from(file, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(join(projectRoot, file)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function sourceFiles(options = {}) {
  const projectRoot = options.projectRoot ?? repositoryRoot;
  const tsconfigPath = options.tsconfigPath ??
    join(projectRoot, projectRoot === repositoryRoot
      ? "tsconfig.check.json"
      : "tsconfig.json");
  const api = new TypeScriptCompilerAPI({ cwd: projectRoot });
  const snapshot = api.updateSnapshot({ openProjects: [tsconfigPath] });
  const project = snapshot.getProject(tsconfigPath) ?? snapshot.getProjects()[0];
  if (!project) {
    snapshot.dispose();
    api.close();
    fail("TypeScript Compiler API did not open tsconfig.check.json");
  }
  const files = project.program.getSourceFileNames()
    .map((fileName) => {
      const absolutePath = resolve(projectRoot, fileName);
      const path = relativeProjectPath(projectRoot, absolutePath);
      if (!path || isProtectedPath(path)) return undefined;
      if (!existsSync(absolutePath)) return undefined;
      const realPath = realpathSync(absolutePath);
      const realProjectPath = relativeProjectPath(projectRoot, realPath);
      if (!realProjectPath || isProtectedPath(realProjectPath)) return undefined;
      return {
        path: realProjectPath,
        sourceFile: project.program.getSourceFile(fileName),
      };
    })
    .filter(Boolean)
    .filter(({ path, sourceFile }) => sourceFile && (
      matchesAny(path, includeGlobs) || matchesAny(path, testIncludeGlobs)
    ));
  return {
    close() {
      snapshot.dispose();
      api.close();
    },
    files,
  };
}

function syntaxName(node) {
  return ts.SyntaxKind[node.kind] ?? String(node.kind);
}

function namedNodeSymbol(node, sourceFile) {
  let current = node;
  while (current && current !== sourceFile) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) ||
        ts.isFunctionExpression(current) || ts.isClassDeclaration(current)) &&
      current.name
    ) return current.name.getText(sourceFile);
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent && ts.isVariableDeclaration(current.parent)
    ) return current.parent.name.getText(sourceFile);
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent && ts.isCallExpression(current.parent) &&
      current.parent.parent && ts.isVariableDeclaration(current.parent.parent)
    ) return current.parent.parent.name.getText(sourceFile);
    if (ts.isJsxAttribute(current)) {
      return `jsx.${current.name.getText(sourceFile)}`;
    }
    current = current.parent;
  }
  return "module";
}

function location(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { column: position.character + 1, line: position.line + 1 };
}

function normalizedAnchor(sourceFile, node) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function callName(node, sourceFile) {
  return node.expression.getText(sourceFile).replace(/\s+/g, "");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function literalValue(node, sourceFile) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) return node.getText(sourceFile);
  return undefined;
}

function legacyAddHit(hits, sourceFile, path, node, category, detail = "") {
  const anchor = normalizedAnchor(sourceFile, node);
  const point = location(sourceFile, node);
  const symbol = namedNodeSymbol(node, sourceFile);
  hits.push({
    astKind: `${category}:${syntaxName(node)}`,
    category,
    column: point.column,
    detail,
    file: path,
    line: point.line,
    startColumn: point.column,
    startLine: point.line,
    side: path.startsWith("tests/")
      ? "test"
      : path.startsWith("client/")
        ? "client"
        : "server",
    sourceAnchorHash: sha256(`${category}\0${symbol}\0${anchor}`),
    symbol,
  });
}

function addHit(
  hits,
  sourceFile,
  path,
  node,
  category,
  detail = "",
  options = {},
) {
  const anchor = options.anchor ?? normalizedAnchor(sourceFile, node);
  const point = location(sourceFile, node);
  const symbol = namedNodeSymbol(node, sourceFile);
  const normalizedAnchorHash = sha256(anchor);
  const astKind = category + ":" + syntaxName(node) +
    (options.kindSuffix ? ":" + options.kindSuffix : "");
  hits.push({
    astKind,
    category,
    column: point.column,
    detail,
    file: path,
    line: point.line,
    normalizedAnchorHash,
    startColumn: point.column,
    startLine: point.line,
    side: path.startsWith("tests/")
      ? "test"
      : path.startsWith("client/")
        ? "client"
        : "server",
    sourceAnchorHash: normalizedAnchorHash,
    symbol,
    ...(options.fields ? { fields: options.fields } : {}),
    ...(options.controlFlowContext
      ? { controlFlowContext: options.controlFlowContext }
      : {}),
  });
}

function hitDedupeKey(hit) {
  return [
    hit.side,
    hit.file,
    hit.startLine,
    hit.startColumn,
    hit.astKind,
    hit.normalizedAnchorHash,
  ].join("\0");
}

function dedupeHits(hits) {
  const sorted = [...hits].sort((left, right) =>
    compareText(left.file, right.file) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    compareText(left.astKind, right.astKind) ||
    compareText(left.normalizedAnchorHash, right.normalizedAnchorHash) ||
    compareText(left.detail, right.detail)
  );
  const seen = new Set();
  return sorted.filter((hit) => {
    const key = hitDedupeKey(hit);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canvasRouteIn(node, sourceFile, routeBindings = new Set()) {
  if (/\/api\/canvases?\//.test(node.getText(sourceFile))) return true;
  if (!ts.isCallExpression(node)) return false;
  const firstArgument = node.arguments[0];
  return ts.isIdentifier(firstArgument) && routeBindings.has(firstArgument.text);
}

function httpMethod(node, sourceFile) {
  const name = callName(node, sourceFile).split(".").at(-1);
  if (name === "sendBeacon") return "POST";
  for (const argument of node.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property) ||
          property.name.getText(sourceFile) !== "method") continue;
      const method = literalValue(property.initializer, sourceFile) ??
        property.initializer.getText(sourceFile);
      if (/^(GET|POST|PUT|PATCH|DELETE)$/i.test(method)) {
        return method.toUpperCase();
      }
    }
  }
  if (["post", "put", "patch", "delete"].includes(String(name).toLowerCase())) {
    return String(name).toUpperCase();
  }
  return undefined;
}

function declarationName(node, sourceFile) {
  if (!ts.isVariableDeclaration(node)) return undefined;
  if (ts.isIdentifier(node.name)) return node.name.text;
  return node.name.getText(sourceFile);
}

function isChangeHandlerName(name) {
  return name === "onNodesChange" || name === "onEdgesChange";
}

function scanClientOrTest(sourceFile, path, hits) {
  const canvasRouteBindings = new Set();
  function collectRouteBindings(node) {
    if (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        /\/api\/canvases?\//.test(node.initializer.getText(sourceFile))) {
      canvasRouteBindings.add(node.name.text);
    }
    node.forEachChild(collectRouteBindings);
  }
  collectRouteBindings(sourceFile);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = callName(node, sourceFile);
      const leaf = name.split(".").at(-1);
      if (leaf === "setNodes") {
        addHit(hits, sourceFile, path, node, "raw-node-setter", name);
      } else if (leaf === "trySetNodes") {
        addHit(hits, sourceFile, path, node, "try-node-setter", name);
      } else if (leaf === "setEdges" || leaf === "trySetEdges") {
        addHit(hits, sourceFile, path, node, "raw-edge-setter", name);
      } else if (leaf === "tryAdoptNodes") {
        addHit(hits, sourceFile, path, node, "try-node-adoption", name);
      } else if (leaf === "adoptUploadedAsset") {
        addHit(hits, sourceFile, path, node, "uploaded-asset-adoption", name);
      } else if (leaf === "mutateGraph") {
        addHit(hits, sourceFile, path, node, "graph-mutate", name);
      } else if (
        leaf === "apply" &&
        /(?:^|\.)graph(?:CommandPort)?\.apply$/.test(name)
      ) {
        addHit(hits, sourceFile, path, node, "graph-command-apply", name);
      } else if (leaf === "commit" && /(?:^|\.)input\.commit$/.test(name)) {
        addHit(hits, sourceFile, path, node, "graph-command-commit", name);
      } else if (leaf === "applyViewPatch" || leaf === "commitView") {
        addHit(hits, sourceFile, path, node, "view-patch", name);
      } else if (leaf === "setGraphState") {
        addHit(hits, sourceFile, path, node, "graph-state-sink", name);
      } else if (leaf === "commitCanvasGraphAtomic") {
        addHit(hits, sourceFile, path, node, "graph-state-commit", name);
      } else if (leaf === "put" && /(?:transport|save|persistence)/i.test(name)) {
        addHit(hits, sourceFile, path, node, "canvas-transport-write", name);
      }
      if (isChangeHandlerName(leaf)) {
        addHit(hits, sourceFile, path, node, "change-handler-dispatch", name);
      }
      if ([
        "enqueueGroupResultProjection",
        "reconcileGroupResultProjection",
      ].includes(String(leaf))) {
        addHit(hits, sourceFile, path, node, "browser-result-projection", name);
      }
      if (leaf === "detachLegacyTerminalGeneration") {
        addHit(hits, sourceFile, path, node, "legacy-terminal-detach", name);
      }
      if (leaf === "decode" || leaf === "decodeAudioData") {
        addHit(hits, sourceFile, path, node, "media-callback", name);
      }
      if (leaf === "addEventListener" &&
          literalValue(node.arguments[0], sourceFile) === "pagehide") {
        addHit(hits, sourceFile, path, node, "pagehide", "pagehide");
      }
      const eventName = literalValue(node.arguments[0], sourceFile)?.toLowerCase();
      if (leaf === "addEventListener" && eventName && [
        "load",
        "loadedmetadata",
        "durationchange",
        "error",
      ].includes(eventName)) {
        addHit(hits, sourceFile, path, node, "media-callback", eventName);
      }
      const method = httpMethod(node, sourceFile);
      if (method && canvasRouteIn(node, sourceFile, canvasRouteBindings) &&
          method !== "GET") {
        addHit(
          hits,
          sourceFile,
          path,
          node,
          "canvas-http-write",
          method + ":" + node.getText(sourceFile).slice(0, 240),
        );
      }
    } else if (ts.isNewExpression(node)) {
      const name = node.expression.getText(sourceFile);
      if (name === "BroadcastChannel") {
        addHit(hits, sourceFile, path, node, "broadcast-channel", name);
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (["onLoad", "onLoadedMetadata", "onError", "onDurationChange"].includes(name)) {
        addHit(hits, sourceFile, path, node, "media-callback", name);
      }
      if (isChangeHandlerName(name)) {
        addHit(hits, sourceFile, path, node, "change-handler-prop", name);
      }
    } else if (ts.isVariableDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      if (isChangeHandlerName(name)) {
        addHit(hits, sourceFile, path, node, "change-handler-definition", name);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile);
      if (isChangeHandlerName(name)) {
        addHit(hits, sourceFile, path, node, "change-handler-property", name);
      }
      if (["onLoad", "onLoadedMetadata", "onDurationChange", "onError"].includes(name)) {
        addHit(hits, sourceFile, path, node, "media-callback", name);
      }
    } else if (ts.isShorthandPropertyAssignment(node) &&
        isChangeHandlerName(node.name.text)) {
      addHit(
        hits,
        sourceFile,
        path,
        node,
        "change-handler-property",
        node.name.text,
      );
    } else if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ["onload", "onloadedmetadata", "ondurationchange", "onerror"].includes(
          node.left.name.text.toLowerCase(),
        )) {
      addHit(
        hits,
        sourceFile,
        path,
        node,
        "media-callback",
        node.left.name.text,
      );
    }
    const literal = literalValue(node, sourceFile);
    if (literal && /\/api\/canvases?\//.test(literal)) {
      addHit(hits, sourceFile, path, node, "canvas-http-route", literal);
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
}

const canvasSqlWritePattern = new RegExp(
  "\\b(?:insert\\s+(?:or\\s+\\w+\\s+)?into|replace\\s+into|update|delete\\s+from)\\s+[\\\"`[]?" +
    "canvas_(?:documents|operation_receipts|save_session_high_water)\\b",
  "i",
);
const canvasSqlDdlPattern = new RegExp(
  "\\b(?:create\\s+(?:temp\\s+)?table(?:\\s+if\\s+not\\s+exists)?|alter\\s+table|drop\\s+table)\\s+[\\\"`[]?" +
    "canvas_(?:documents|operation_receipts|save_session_high_water)\\b",
  "i",
);

function legacyScanServer(sourceFile, path, hits) {
  function visit(node) {
    const literal = literalValue(node, sourceFile);
    if (literal && canvasSqlWritePattern.test(literal)) {
      const table = literal.match(
        /\bcanvas_(?:documents|operation_receipts|save_session_high_water)\b/i,
      )?.[0]?.toLowerCase() ?? "canvas-table";
      const verb = literal.match(
        /\b(?:insert|replace|update|delete)\b/i,
      )?.[0]?.toLowerCase() ?? "write";
      addHit(hits, sourceFile, path, node, "canvas-sql-write", literal.match(
        /\b(?:insert|replace|update|delete)\b/i,
      ) ? `${verb}:${table}` : `write:${table}`);
    }
    if (literal && canvasSqlDdlPattern.test(literal)) {
      addHit(hits, sourceFile, path, node, "canvas-sql-ddl", literal.match(
        /\b(?:create|alter|drop)\b/i,
      )?.[0]?.toLowerCase() ?? "ddl");
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node, sourceFile);
      const leaf = name.split(".").at(-1);
      if (leaf === "canvasRevisionTransition") {
        addHit(hits, sourceFile, path, node, "revision-transition", name);
      }
      if ([
        "applyCanvasUserCommandInTransaction",
        "applyGenerationProjectionInTransaction",
        "applyLegacyCanvasPutInTransaction",
        "detachLegacyTerminalInTransaction",
      ].includes(String(leaf))) {
        addHit(hits, sourceFile, path, node, "server-writer-call", String(leaf));
      }
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
}

const canvasTablePattern = /\bcanvas_(?:documents|operation_receipts|save_session_high_water)\b/i;
const canvasDmlPattern =
  /\b(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from)\s+["\x60[]?canvas_(?:documents|operation_receipts|save_session_high_water)\b/i;
const canvasDdlPattern =
  /\b(?:create\s+(?:temp\s+)?table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table)\s+["\x60[]?canvas_(?:documents|operation_receipts|save_session_high_water)\b/i;

function splitSqlStatements(value) {
  const statements = [];
  let start = 0;
  let quote = undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === "\"" || character === "\x60") {
      quote = character;
      continue;
    }
    if (character === ";") {
      const statement = value.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function sqlVerb(statement) {
  return statement.match(/\b(insert|replace|update|delete|create|alter|drop)\b/i)?.[1]
    ?.toLowerCase();
}

function sqlTable(statement) {
  return statement.match(
    /\b(canvas_(?:documents|operation_receipts|save_session_high_water))\b/i,
  )?.[1]?.toLowerCase();
}

function sqlControlFlowContext(node, sourceFile) {
  const segments = [];
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  let current = node.parent;
  while (current && current !== sourceFile) {
    if (ts.isIfStatement(current)) {
      const condition = current.expression.getText(sourceFile)
        .replace(/\s+/g, "")
        .trim();
      const inThen = start >= current.thenStatement.getStart(sourceFile) &&
        end <= current.thenStatement.getEnd();
      const inElse = current.elseStatement &&
        start >= current.elseStatement.getStart(sourceFile) &&
        end <= current.elseStatement.getEnd();
      segments.push(
        `if(${condition}):${inThen ? "then" : inElse ? "else" : "nested"}`,
      );
    }
    current = current.parent;
  }
  return segments.reverse().join(">");
}

function scanServer(sourceFile, path, hits) {
  function visit(node) {
    const literal = literalValue(node, sourceFile);
    if (literal && (canvasDmlPattern.test(literal) || canvasDdlPattern.test(literal))) {
      const statements = splitSqlStatements(literal);
      const matching = statements.filter((statement) =>
        canvasDmlPattern.test(statement) || canvasDdlPattern.test(statement)
      );
      matching.forEach((statement, index) => {
        const dml = canvasDmlPattern.test(statement);
        const category = dml ? "canvas-sql-write" : "canvas-sql-ddl";
        const verb = sqlVerb(statement) ?? "write";
        const table = sqlTable(statement) ?? "canvas-table";
        addHit(
          hits,
          sourceFile,
          path,
          node,
          category,
          verb + ":" + table,
          {
            anchor: statement.replace(/\s+/g, " ").trim(),
            controlFlowContext: sqlControlFlowContext(node, sourceFile),
            kindSuffix: "statement-" + index + "-" + verb + "-" + table,
          },
        );
      });
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node, sourceFile);
      const leaf = name.split(".").at(-1);
      if (leaf === "canvasRevisionTransition") {
        addHit(hits, sourceFile, path, node, "revision-transition", name);
      }
      if ([
        "applyCanvasUserCommandInTransaction",
        "applyGenerationProjectionInTransaction",
        "applyLegacyCanvasPutInTransaction",
        "detachLegacyTerminalInTransaction",
        "projectSingleNodeGenerationResultInTransaction",
        "projectWorkflowResultInTransaction",
      ].includes(String(leaf))) {
        addHit(hits, sourceFile, path, node, "server-writer-call", String(leaf));
      }
      if (leaf === "addColumnIfMissing") {
        const table = literalValue(node.arguments[1], sourceFile);
        if (table && canvasTablePattern.test(table)) {
          addHit(
            hits,
            sourceFile,
            path,
            node,
            "canvas-sql-dynamic",
            "addColumnIfMissing:" + table,
          );
        }
      }
      if (leaf === "executeTransactionScopedCommand") {
        const command = node.arguments[1]?.getText(sourceFile) ?? "";
        if (/canvas/i.test(command)) {
          addHit(
            hits,
            sourceFile,
            path,
            node,
            "server-transaction-command",
            command,
          );
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === "addColumnIfMissing") {
      addHit(
        hits,
        sourceFile,
        path,
        node,
        "server-dynamic-sql-helper",
        "addColumnIfMissing",
      );
    } else if (ts.isVariableDeclaration(node) &&
        declarationName(node, sourceFile) === "addColumnIfMissing" &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      addHit(
        hits,
        sourceFile,
        path,
        node,
        "server-dynamic-sql-helper",
        "addColumnIfMissing",
      );
    }
    const route = literalValue(node, sourceFile);
    if (route && /\/api\/canvases?\//.test(route)) {
      addHit(hits, sourceFile, path, node, "canvas-http-route", route);
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
}

function commonEntry(hit, overrides) {
  return {
    id: "CWW-" + sha256([
      hit.side,
      hit.file,
      hit.symbol,
      hit.astKind,
      hit.sourceAnchorHash,
    ].join("\0")).slice(0, 16),
    side: hit.side,
    file: hit.file,
    symbol: hit.symbol,
    astKind: hit.astKind,
    sourceAnchorHash: hit.sourceAnchorHash,
    line: hit.line,
    column: hit.column,
    writeTarget: overrides.writeTarget,
    stateClass: overrides.stateClass,
    fieldOwner: overrides.fieldOwner,
    transactionOwner: overrides.transactionOwner,
    currentEntry: overrides.currentEntry,
    targetEntry: overrides.targetEntry,
    primaryPhase: overrides.primaryPhase,
    removalPhase: overrides.removalPhase,
    exceptionKind: overrides.exceptionKind ?? null,
    exceptionReason: overrides.exceptionReason ?? null,
    tests: overrides.tests,
    violation: overrides.violation === true,
  };
}

function legacyClassifyTest(hit) {
  return commonEntry(hit, {
    currentEntry: `test.${hit.category}`,
    exceptionKind: "test-double",
    exceptionReason:
      "Exact test callsite is inventoried separately and cannot authorize a product writer.",
    fieldOwner: "test-fixture",
    primaryPhase: "R0",
    removalPhase: "retain-while-test-exists",
    stateClass: "control-only",
    targetEntry: `test.${hit.category}`,
    tests: [hit.file],
    transactionOwner: "test-owned",
    writeTarget: hit.detail || hit.category,
  });
}

const clientNodeFiles = new Set([
  "client/src/canvas/AudioNode.tsx",
  "client/src/canvas/GroupNode.tsx",
  "client/src/canvas/ImageNode.tsx",
  "client/src/canvas/PlaylistNode.tsx",
  "client/src/canvas/TextNode.tsx",
  "client/src/canvas/VideoNode.tsx",
]);

function legacyClassifyClient(hit) {
  const base = {
    exceptionKind: null,
    exceptionReason: null,
    primaryPhase: "R4",
    removalPhase: "retained",
    tests: ["tests/m100-modular-ports.spec.ts"],
    violation: false,
  };
  if (["raw-node-setter", "raw-edge-setter", "try-node-setter"].includes(hit.category)) {
    if (hit.file === "client/src/canvas/CanvasSurface.tsx") {
      return commonEntry(hit, {
        ...base,
        currentEntry: "CanvasSurface.document-view-adapter",
        fieldOwner: "mixed-validated-by-adapter",
        stateClass: "control-only",
        targetEntry: "CanvasSurface.document-view-adapter",
        transactionOwner: "canvas-command-journal-or-view-only",
        writeTarget: hit.category.includes("edge") ? "react-flow.edges" : "react-flow.nodes",
      });
    }
    if (clientNodeFiles.has(hit.file) ||
        hit.file === "client/src/generation/WorkflowExecutionProvider.tsx") {
      return commonEntry(hit, {
        ...base,
        currentEntry: `business.${hit.category}`,
        fieldOwner: "unknown-unvalidated-business-setter",
        stateClass: "unknown",
        targetEntry: "CanvasGraphMutationContext.typed-command-or-view-patch",
        transactionOwner: "none",
        writeTarget: hit.category.includes("edge") ? "react-flow.edges" : "react-flow.nodes",
        violation: true,
      });
    }
    return commonEntry(hit, {
      ...base,
      currentEntry: `unregistered.${hit.category}`,
      fieldOwner: "unknown",
      stateClass: "unknown",
      targetEntry: "registered-canvas-adapter",
      transactionOwner: "unknown",
      writeTarget: hit.category,
      violation: true,
    });
  }
  if (hit.category === "canvas-http-route") {
    if (hit.file === "client/src/canvas/canvasPersistenceFacade.ts") {
      const modern = hit.detail.includes("/commands");
      return commonEntry(hit, {
        ...base,
        currentEntry: modern
          ? "createFetchCanvasPersistenceTransport.post"
          : "createFetchCanvasPersistenceTransport.load",
        fieldOwner: modern ? "durable-user" : "read-only",
        primaryPhase: modern ? "R3" : "R2",
        stateClass: modern ? "Durable User" : "control-only",
        targetEntry: modern ? "POST command-v1" : "GET authoritative-document",
        tests: ["tests/m3-persistence.spec.ts", "tests/m85-canvas-persistence-server.spec.ts"],
        transactionOwner: modern ? "canvasMutationGateway" : "none-read",
        writeTarget: hit.detail,
      });
    }
    if (hit.file === "client/src/generation/legacyTerminalGenerationReconciler.ts") {
      return commonEntry(hit, {
        ...base,
        currentEntry: "legacyTerminalGenerationReconciler",
        exceptionKind: "time-bounded-legacy-adapter",
        exceptionReason:
          "Server-classified C-only compatibility route remains until the production legacy census reaches zero.",
        fieldOwner: "migration",
        primaryPhase: "R7",
        removalPhase: "post-production-zero-observation-window",
        stateClass: "Migration/Legacy",
        targetEntry: hit.detail.includes("policy")
          ? "GET legacy-policy"
          : "POST identity-only-terminal-detach",
        tests: ["tests/m22-group-execution.spec.ts"],
        transactionOwner: "canvasMutationGateway.detachLegacyTerminalInTransaction",
        writeTarget: hit.detail,
      });
    }
    if (hit.file === "client/src/canvas/GroupNode.tsx" &&
        hit.detail.includes("group-download")) {
      return commonEntry(hit, {
        ...base,
        currentEntry: "GroupNode.export",
        fieldOwner: "read-only-export",
        stateClass: "control-only",
        targetEntry: "group-download",
        tests: ["tests/m2-group-node.spec.ts"],
        transactionOwner: "none-read",
        writeTarget: hit.detail,
      });
    }
    return commonEntry(hit, {
      ...base,
      currentEntry: "unregistered-canvas-http",
      fieldOwner: "unknown",
      stateClass: "unknown",
      targetEntry: "route-allowlist",
      transactionOwner: "unknown",
      writeTarget: hit.detail,
      violation: true,
    });
  }
  if (hit.category === "browser-result-projection" ||
      hit.category === "legacy-terminal-detach") {
    return commonEntry(hit, {
      ...base,
      currentEntry: hit.category,
      exceptionKind: "time-bounded-legacy-adapter",
      exceptionReason:
        "Code is guarded away from generationIdentityVersion 2 and retained only for exact historical C objects.",
      fieldOwner: "migration",
      primaryPhase: "R7",
      removalPhase: "post-production-zero-observation-window",
      stateClass: "Migration/Legacy",
      targetEntry: hit.category === "legacy-terminal-detach"
        ? "server-classified-C identity signal"
        : "server projection or exact legacy C adapter",
      tests: ["tests/m22-group-execution.spec.ts"],
      transactionOwner: "canvasMutationGateway",
      writeTarget: hit.detail,
    });
  }
  if (hit.category === "canvas-transport-write") {
    const legacy = hit.file === "client/src/generation/groupResultProjection.ts";
    const allowed = hit.file === "client/src/canvas/canvasPersistenceFacade.ts" || legacy;
    return commonEntry(hit, {
      ...base,
      currentEntry: hit.detail,
      exceptionKind: legacy ? "time-bounded-legacy-adapter" : null,
      exceptionReason: legacy
        ? "The exact historical C projection fallback is disabled by default and retained only through its bounded legacy caller."
        : null,
      fieldOwner: legacy ? "migration" : allowed ? "durable-user" : "unknown",
      primaryPhase: legacy ? "R7" : "R3",
      removalPhase: legacy ? "post-production-zero-observation-window" : "retained",
      stateClass: legacy ? "Migration/Legacy" : allowed ? "Durable User" : "unknown",
      targetEntry: legacy ? "server projection" : "command-v1-transport",
      transactionOwner: allowed ? "canvasMutationGateway" : "unknown",
      writeTarget: "Canvas HTTP write",
      violation: !allowed,
    });
  }
  if (hit.category === "graph-command-apply" || hit.category === "view-patch" ||
      hit.category === "graph-mutate") {
    return commonEntry(hit, {
      ...base,
      currentEntry: hit.detail,
      fieldOwner: hit.category === "view-patch" ? "ephemeral-view" : "typed-by-port",
      stateClass: hit.category === "view-patch" ? "Ephemeral View" : "control-only",
      targetEntry: hit.category === "view-patch"
        ? "CanvasGraphCommandPort.applyViewPatch"
        : "CanvasGraphCommandPort.apply",
      transactionOwner: hit.category === "view-patch"
        ? "none-view-only"
        : "canvas-command-journal",
      writeTarget: hit.detail,
    });
  }
  if (["media-callback", "pagehide", "broadcast-channel"].includes(hit.category)) {
    return commonEntry(hit, {
      ...base,
      currentEntry: hit.detail || hit.category,
      fieldOwner: "ephemeral-view-or-transport-control",
      stateClass: hit.category === "media-callback" ? "Ephemeral View" : "control-only",
      targetEntry: hit.category === "media-callback"
        ? "view-state-only"
        : "command-journal-control",
      tests: [
        "tests/m2-image-node.spec.ts",
        "tests/m2-video-node.spec.ts",
        "tests/m2-audio-node.spec.ts",
        "tests/m3-persistence.spec.ts",
      ],
      transactionOwner: "none",
      writeTarget: hit.detail || hit.category,
    });
  }
  return commonEntry(hit, {
    ...base,
    currentEntry: `unregistered.${hit.category}`,
    fieldOwner: "unknown",
    stateClass: "unknown",
    targetEntry: "registered-canvas-entry",
    transactionOwner: "unknown",
    writeTarget: hit.detail || hit.category,
    violation: true,
  });
}

function legacyClassifyServer(hit) {
  const base = {
    currentEntry: hit.symbol,
    exceptionKind: null,
    exceptionReason: null,
    fieldOwner: "durable-server",
    primaryPhase: "R5",
    removalPhase: "retained",
    stateClass: "Durable Server",
    targetEntry: hit.symbol,
    tests: ["tests/m104-canvas-command-gateway.spec.ts"],
    transactionOwner: "caller-BEGIN-IMMEDIATE",
    violation: false,
    writeTarget: hit.detail || hit.category,
  };
  if (hit.category === "canvas-sql-ddl") {
    if (hit.file === "server/database.ts") {
      return commonEntry(hit, {
        ...base,
        exceptionKind: "bootstrap",
        exceptionReason:
          "Greenfield schema creation owns table lifecycle before ordinary Canvas transactions exist.",
        fieldOwner: "lifecycle",
        primaryPhase: "R1.5",
        stateClass: "control-only",
        transactionOwner: "database.bootstrap",
      });
    }
    if (/^server\/schema\d+To\d+Migration\.ts$/.test(hit.file) ||
        hit.file === "server/schemaMigration.ts") {
      return commonEntry(hit, {
        ...base,
        exceptionKind: "schema-migration",
        exceptionReason:
          "Exact-version offline migration owns DDL under its migration transaction and marker fence.",
        fieldOwner: "migration",
        primaryPhase: "R1.5",
        stateClass: "Migration/Legacy",
        transactionOwner: "schema-migration-transaction",
      });
    }
    if (hit.file === "server/canvasPersistence.ts") {
      return commonEntry(hit, {
        ...base,
        currentEntry: "legacyCanvasPutAdapter.temp-high-water",
        exceptionKind: "time-bounded-legacy-adapter",
        exceptionReason:
          "The connection-local TEMP high-water table serves cached legacy PUT ordering only and is not a durable operation receipt.",
        fieldOwner: "migration",
        primaryPhase: "R3",
        removalPhase: "post-production-zero-observation-window",
        stateClass: "Migration/Legacy",
        targetEntry: "durable canvas_operation_receipts",
        transactionOwner: "legacy-put-connection",
      });
    }
    return commonEntry(hit, {
      ...base,
      fieldOwner: "unknown",
      stateClass: "unknown",
      targetEntry: "database-bootstrap-or-exact-schema-migration",
      transactionOwner: "unknown",
      violation: true,
    });
  }
  if (hit.category === "canvas-sql-write") {
    if (hit.file === "server/database.ts") {
      return commonEntry(hit, {
        ...base,
        exceptionKind: "bootstrap",
        exceptionReason:
          "Greenfield/bootstrap normalization is version-locked and cannot pass through a runtime gateway.",
        fieldOwner: "lifecycle",
        primaryPhase: "R1.5",
        stateClass: "control-only",
        transactionOwner: "database.bootstrap",
      });
    }
    if (/^server\/schema\d+To\d+Migration\.ts$/.test(hit.file) ||
        hit.file === "server/schemaMigration.ts") {
      return commonEntry(hit, {
        ...base,
        exceptionKind: "schema-migration",
        exceptionReason:
          "Exact-version offline migration owns its DML and does not serve an application request.",
        fieldOwner: "migration",
        primaryPhase: "R1.5",
        stateClass: "Migration/Legacy",
        transactionOwner: "schema-migration-transaction",
      });
    }
    if (hit.file === "server/accountTransactionCommands.ts") {
      return commonEntry(hit, {
        ...base,
        exceptionKind: "account-delete-cascade",
        exceptionReason:
          "Account deletion owns an all-domain tombstone transaction and cannot call an ordinary owner request gateway.",
        fieldOwner: "lifecycle",
        stateClass: "Migration/Legacy",
        transactionOwner: "account-delete-transaction",
      });
    }
    if (hit.file === "server/canvasMutationGateway.ts" ||
        hit.file === "server/canvasTransactionCommands.ts") {
      return commonEntry(hit, {
        ...base,
        currentEntry: hit.file === "server/canvasMutationGateway.ts"
          ? "canvasMutationGateway"
          : "canvasTransactionCommands",
        targetEntry: "canvasMutationGateway",
        transactionOwner: "gateway-caller-transaction",
      });
    }
    if (hit.file === "server/canvasPersistence.ts") {
      const canvasDocumentDelete = hit.detail === "delete:canvas_documents";
      const legacyAuxiliary = !canvasDocumentDelete;
      return commonEntry(hit, {
        ...base,
        currentEntry: canvasDocumentDelete
          ? "canvasPersistence.DELETE"
          : "legacyCanvasPutAdapter",
        exceptionKind: legacyAuxiliary ? "time-bounded-legacy-adapter" : null,
        exceptionReason: legacyAuxiliary
          ? "The cached-client full-document route is capability fenced, receipt backed, and removed after its observation window."
          : null,
        fieldOwner: canvasDocumentDelete ? "lifecycle" : "migration",
        primaryPhase: canvasDocumentDelete ? "R5" : "R3",
        removalPhase: canvasDocumentDelete ? "R5" : "post-production-zero-observation-window",
        stateClass: canvasDocumentDelete ? "control-only" : "Migration/Legacy",
        targetEntry: canvasDocumentDelete
          ? "canvasTransactionCommands.deleteCanvasDocumentCommand"
          : "canvasMutationGateway.applyLegacyCanvasPutInTransaction",
        transactionOwner: canvasDocumentDelete ? "canvasPersistence" : "canvasMutationGateway",
        violation: canvasDocumentDelete,
      });
    }
    return commonEntry(hit, {
      ...base,
      fieldOwner: "unknown",
      stateClass: "unknown",
      targetEntry: "canvasMutationGateway-or-reviewed-lifecycle-exception",
      transactionOwner: "unknown",
      violation: true,
    });
  }
  if (hit.category === "revision-transition") {
    const allowed = hit.file === "server/canvasMutationGateway.ts" ||
      hit.file === "server/canvasTransactionCommands.ts";
    return commonEntry(hit, {
      ...base,
      fieldOwner: "revision-state-machine",
      stateClass: "control-only",
      targetEntry: "types/canvasFingerprint.canvasRevisionTransition",
      transactionOwner: allowed ? "gateway-caller-transaction" : "unknown",
      violation: !allowed,
    });
  }
  if (hit.category === "server-writer-call") {
    const allowedFiles = new Set([
      "server/canvasCommandsApi.ts",
      "server/canvasLegacyGenerationReconciliation.ts",
      "server/canvasPersistence.ts",
      "server/canvasWorkflowProjection.ts",
      "server/generationCanvasProjectionService.ts",
    ]);
    const allowed = hit.file === "server/canvasMutationGateway.ts" ||
      allowedFiles.has(hit.file);
    return commonEntry(hit, {
      ...base,
      fieldOwner: hit.detail === "applyGenerationProjectionInTransaction"
        ? "durable-server"
        : hit.detail === "applyCanvasUserCommandInTransaction"
          ? "durable-user"
          : "migration",
      stateClass: "control-only",
      targetEntry: `canvasMutationGateway.${hit.detail}`,
      transactionOwner: "caller-BEGIN-IMMEDIATE",
      violation: !allowed,
    });
  }
  return commonEntry(hit, {
    ...base,
    fieldOwner: "unknown",
    stateClass: "unknown",
    targetEntry: "registered-server-writer",
    transactionOwner: "unknown",
    violation: true,
  });
}

const normalizedStateClasses = new Set(STATE_CLASSES);
const normalizedFieldOwners = new Set(FIELD_OWNERS);
const normalizedExceptionKinds = new Set(EXCEPTION_KINDS);

function manifestEntry(hit, overrides = {}) {
  const stateClass = overrides.stateClass ?? "unknown";
  const fieldOwner = overrides.fieldOwner ?? "unknown";
  const violation = overrides.violation ?? stateClass === "unknown";
  if (!normalizedStateClasses.has(stateClass)) {
    fail("classifier produced invalid stateClass: " + stateClass);
  }
  if (!normalizedFieldOwners.has(fieldOwner)) {
    fail("classifier produced invalid fieldOwner: " + fieldOwner);
  }
  const exceptionKind = overrides.exceptionKind ?? null;
  if (!normalizedExceptionKinds.has(exceptionKind)) {
    fail("classifier produced invalid exceptionKind: " + String(exceptionKind));
  }
  const id = "CWW-" + sha256(hitDedupeKey(hit)).slice(0, 16);
  return {
    id,
    side: hit.side,
    file: hit.file,
    symbol: hit.symbol,
    astKind: hit.astKind,
    sourceAnchorHash: hit.sourceAnchorHash,
    normalizedAnchorHash: hit.normalizedAnchorHash,
    line: hit.line,
    column: hit.column,
    startLine: hit.line,
    startColumn: hit.column,
    writeTarget: overrides.writeTarget ?? hit.detail ?? hit.category,
    stateClass,
    fieldOwner,
    transactionOwner: overrides.transactionOwner ?? "none",
    currentEntry: overrides.currentEntry ?? hit.detail ?? hit.category,
    targetEntry: overrides.targetEntry ?? "unclassified-canvas-writer",
    targetCommand: overrides.targetCommand ?? null,
    fields: overrides.fields ?? hit.fields ?? [],
    revisionImpact: overrides.revisionImpact ?? "unknown",
    primaryPhase: overrides.primaryPhase ?? "R0",
    removalPhase: overrides.removalPhase ?? "review",
    exceptionKind,
    exceptionReason: overrides.exceptionReason ?? null,
    tests: overrides.tests ?? ["tests/m105-canvas-writer-manifest.spec.ts"],
    violation,
  };
}

function productClientBase(hit) {
  return {
    tests: [
      "tests/m104-canvas-command-gateway.spec.ts",
      "tests/m3-persistence.spec.ts",
    ],
    primaryPhase: "R0",
  };
}

const surfaceViewNodeSymbols = new Set([
  "applyPassiveNodeChanges",
  "applyViewUpdate",
  "workflowGraphPort",
]);
const surfaceViewEdgeSymbols = new Set([
  "applyPassiveEdgeChanges",
  "applyEdgeViewUpdate",
]);
const surfaceServerNodeSymbols = new Set([
  "receiveWorkflowResults",
  "load",
  "refreshAuthoritativeCanvasDocument",
  "adoptAuthoritativeGenerationMutation",
  "adoptAuthoritativeNodeData",
]);
const surfaceServerEdgeSymbols = new Set([
  "load",
  "refreshAuthoritativeCanvasDocument",
  "adoptAuthoritativeGenerationMutation",
]);
const surfaceControlNodeSymbols = new Set(["guardedSetNodes"]);
const surfaceControlEdgeSymbols = new Set(["guardedSetEdges"]);

function durableUserEntry(hit, targetCommand, fields, currentEntry, violation = false) {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: currentEntry ?? "raw-browser-durable-user-write",
    fieldOwner: "durable-user",
    fields,
    primaryPhase: "R5",
    removalPhase: "R5",
    revisionImpact: targetCommand === "commit-user-layout" ? "document-only" : "document-and-input-graph",
    stateClass: "Durable User",
    targetCommand,
    targetEntry: "CanvasUserCommand via POST /api/canvases/{canvasId}/commands",
    transactionOwner: "CanvasMutationGateway.applyCanvasUserCommandInTransaction",
    violation,
    writeTarget: targetCommand,
  });
}

function viewEntry(hit, fields = []) {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: "local-view-or-passive-media-update",
    fieldOwner: "ephemeral-view",
    fields,
    primaryPhase: "R4",
    removalPhase: "retain-view-only",
    revisionImpact: "none",
    stateClass: "Ephemeral View",
    targetEntry: "local view state; no durable Canvas command",
    targetCommand: null,
    transactionOwner: "none",
    violation: false,
    writeTarget: "local-view-state",
  });
}

function serverClientEntry(hit, fields = []) {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: "authoritative-server-document-ingestion",
    fieldOwner: "durable-server",
    fields,
    primaryPhase: "R2",
    removalPhase: "retain-authority-ingestion",
    revisionImpact: "server-revision-observed",
    stateClass: "Durable Server",
    targetEntry: "authoritative GET/result projection; no browser durable write",
    transactionOwner: "server-canvas-gateway",
    violation: false,
    writeTarget: "authoritative-canvas-document",
  });
}

function legacyClientEntry(hit, targetEntry, fields = []) {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: "legacy-browser-generation-or-recovery-writer",
    exceptionKind: "time-bounded-legacy-adapter",
    exceptionReason:
      "Retained only for exact historical legacy objects; modern generationIdentityVersion 2 must not reach this browser writer.",
    fieldOwner: "migration",
    fields,
    primaryPhase: "R7",
    removalPhase: "post-production-zero-observation-window",
    revisionImpact: "document-only",
    stateClass: "Migration/Legacy",
    targetEntry,
    transactionOwner: "CanvasMutationGateway",
    violation: false,
    writeTarget: "legacy-canvas-adapter",
  });
}

function controlEntry(hit, targetEntry, fields = [], exceptionKind = null) {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: "control-or-adapter-boundary",
    exceptionKind,
    exceptionReason: exceptionKind
      ? "Explicit control/test boundary; it is not an ordinary browser document writer."
      : null,
    fieldOwner: "control-only",
    fields,
    primaryPhase: "R0",
    removalPhase: "retain-control-boundary",
    revisionImpact: "none",
    stateClass: "control-only",
    targetEntry,
    transactionOwner: "none",
    violation: false,
    writeTarget: "control-only",
  });
}

function unknownEntry(hit, reason = "No exact field/owner/route binding") {
  return manifestEntry(hit, {
    ...productClientBase(hit),
    currentEntry: "unclassified-canvas-writer",
    fieldOwner: "unknown",
    primaryPhase: "R0",
    removalPhase: "blocked-on-classification",
    revisionImpact: "unknown",
    stateClass: "unknown",
    targetEntry: "classify exact command or view-only branch",
    transactionOwner: "unknown",
    violation: true,
    writeTarget: reason,
  });
}

function classifyClientV2(hit) {
  if (["raw-node-setter", "try-node-setter", "raw-edge-setter"].includes(hit.category)) {
    if (hit.file === "client/src/canvas/CanvasSurface.tsx") {
      if (hit.category === "raw-node-setter" &&
          surfaceViewNodeSymbols.has(hit.symbol)) {
        return viewEntry(hit, ["view-only-node-fields"]);
      }
      if (hit.category === "raw-edge-setter" &&
          surfaceViewEdgeSymbols.has(hit.symbol)) {
        return viewEntry(hit, ["view-only-edge-fields"]);
      }
      if (hit.category === "raw-node-setter" &&
          surfaceServerNodeSymbols.has(hit.symbol)) {
        return serverClientEntry(hit);
      }
      if (hit.category === "raw-edge-setter" &&
          surfaceServerEdgeSymbols.has(hit.symbol)) {
        return serverClientEntry(hit);
      }
      if (hit.category === "raw-node-setter" &&
          surfaceControlNodeSymbols.has(hit.symbol)) {
        return controlEntry(hit, "guarded/local React state adapter");
      }
      if (hit.category === "raw-edge-setter" &&
          surfaceControlEdgeSymbols.has(hit.symbol)) {
        return controlEntry(hit, "guarded/local React state adapter");
      }
      if (hit.category === "raw-node-setter" && hit.symbol === "tryAdoptNodes") {
        return legacyClientEntry(
          hit,
          "server projection or exact legacy C result adapter",
          ["generation-state"],
        );
      }
      if (hit.category === "raw-node-setter" &&
          hit.symbol === "adoptUploadedAsset") {
        return durableUserEntry(
          hit,
          "adopt-uploaded-asset",
          ["assetId", "validated-media-metadata", "generation-proof-invalidation"],
          "validated uploaded media adoption",
        );
      }
      return unknownEntry(hit, "CanvasSurface mixed setter/change-handler branch");
    }
    return unknownEntry(hit, "unregistered business setter");
  }

  if (hit.category === "try-node-adoption") {
    if ([
      "applyGeneratedAudio",
      "applyGeneratedImage",
      "applyGeneratedText",
      "applyGeneratedVideo",
    ].includes(hit.symbol)) {
      return legacyClientEntry(hit, "server projection or legacy terminal recovery", ["generation-state"]);
    }
    return unknownEntry(hit, "tryAdoptNodes caller not bound to upload, view, or legacy result");
  }

  if (hit.category === "uploaded-asset-adoption") {
    if (["loadFile", "uploadFile"].includes(hit.symbol) ||
        [
          "client/src/canvas/AudioNode.tsx",
          "client/src/canvas/ImageNode.tsx",
          "client/src/canvas/VideoNode.tsx",
        ].includes(hit.file)) {
      return durableUserEntry(
        hit,
        "adopt-uploaded-asset",
        ["assetId", "validated-media-metadata", "generation-proof-invalidation"],
        "validated uploaded media adoption",
      );
    }
    return unknownEntry(hit, "adoptUploadedAsset caller outside reviewed media upload components");
  }

  if (hit.category === "graph-mutate") {
    if (hit.file.startsWith("client/src/canvas/")) {
      const layout = hit.file === "client/src/canvas/CanvasSurface.tsx" &&
        ["finishLayoutGesture", "jsx.onNodesChange"].includes(hit.symbol);
      const topology = !layout && (
        hit.file === "client/src/canvas/CanvasSurface.tsx" ||
        hit.file === "client/src/canvas/GroupNode.tsx" &&
          ["ungroup", "layout"].includes(hit.symbol) ||
        hit.symbol === "jsx.onClick" && hit.file === "client/src/canvas/CanvasSurface.tsx"
      );
      return durableUserEntry(
        hit,
        layout
          ? "commit-user-layout"
          : topology ? "apply-topology" : "apply-user-field-changes",
        layout ? ["position", "width", "height", "style"]
          : topology ? ["nodes", "edges"] : ["data"],
        "typed graph mutation adapter",
      );
    }
    return unknownEntry(hit, "mutateGraph caller not bound to a Canvas command");
  }

  if (hit.category === "graph-command-apply") {
    if (hit.file.startsWith("client/src/imageTools/") ||
        hit.file === "client/src/canvas/ImageNode.tsx") {
      return durableUserEntry(hit, "edit-result-and-invalidate-proof", ["image-tool-result"], "typed image-tool graph command");
    }
    if (hit.file === "client/src/generation/singleNodeGenerationLifecycle.ts" &&
        hit.symbol === "apply") {
      return legacyClientEntry(hit, "server projection for legacy terminal generation", ["generation-state"]);
    }
    if (hit.file === "client/src/generation/workflowNodeExecutors.ts" &&
        hit.symbol === "applyFencedNodeUpdate") {
      return legacyClientEntry(hit, "server workflow projection / legacy browser adapter", ["generation-state"]);
    }
    if (hit.file === "client/src/generation/workflowNodeExecutors.ts" &&
        hit.symbol === "persistExecutionContract") {
      return unknownEntry(hit, "generation contract graph.apply mixes server-owned fields");
    }
    return unknownEntry(hit, "graph.apply caller not bound to a typed command");
  }

  if (hit.category === "graph-command-commit") {
    if (hit.file.startsWith("client/src/imageTools/")) {
      return durableUserEntry(hit, "edit-result-and-invalidate-proof", ["image-tool-result"], "typed image-tool commit");
    }
    if (hit.file === "client/src/canvas/CanvasGraphMutationContext.ts") {
      return legacyClientEntry(
        hit,
        "legacy generated-result adoption sink",
        ["generation-state"],
      );
    }
    if (hit.file === "client/src/canvas/canvasPorts.ts") {
      return durableUserEntry(hit, "edit-result-and-invalidate-proof", ["nodes", "edges"], "Canvas graph command commit sink");
    }
    return unknownEntry(hit, "generic input.commit sink");
  }

  if (hit.category === "graph-state-sink") {
    return controlEntry(hit, "local React graph state sink");
  }

  if (hit.category === "graph-state-commit") {
    if (hit.file === "client/src/canvas/CanvasSurface.tsx") {
      if (hit.symbol === "commit") return controlEntry(hit, "mutateGraph React state commit");
      return durableUserEntry(hit, "apply-topology", ["nodes", "edges"], "Canvas atomic graph commit");
    }
    return unknownEntry(hit, "commitCanvasGraphAtomic caller outside CanvasSurface");
  }

  if (hit.category === "view-patch") return viewEntry(hit, ["generation-view-patch"]);

  if (hit.category.startsWith("change-handler")) {
    if (hit.category === "change-handler-dispatch" && hit.line === 6075) {
      return unknownEntry(hit, "mixed React Flow node change dispatch");
    }
    if (hit.category === "change-handler-dispatch" && hit.line === 5857) {
      return viewEntry(hit, ["selected"]);
    }
    if (hit.category === "change-handler-dispatch" && hit.line === 6036) {
      return viewEntry(hit, ["dimensions", "selected"]);
    }
    return controlEntry(hit, "React Flow change-handler boundary");
  }

  if (hit.category === "canvas-http-route" || hit.category === "canvas-http-write") {
    const text = hit.detail;
    if (hit.file === "client/src/canvas/canvasPersistenceFacade.ts" &&
        text.includes("/commands")) {
      return manifestEntry(hit, {
        ...productClientBase(hit),
        currentEntry: "command-v1 Canvas transport",
        fieldOwner: "durable-user",
        primaryPhase: "R3",
        removalPhase: "retain-command-transport",
        revisionImpact: "document-and-input-graph",
        stateClass: "Durable User",
        targetCommand: "command-v1",
        targetEntry: "POST /api/canvases/{canvasId}/commands",
        transactionOwner: "CanvasMutationGateway",
        violation: false,
        writeTarget: "Canvas command HTTP transport",
      });
    }
    if (hit.file === "client/src/canvas/canvasPersistenceFacade.ts") {
      return controlEntry(hit, "GET authoritative Canvas document");
    }
    if (hit.file === "client/src/generation/legacyTerminalGenerationReconciler.ts") {
      return legacyClientEntry(hit, "server-classified C policy/detach adapter", ["legacyTerminalDetachApplicationId"]);
    }
    if (hit.file === "client/src/canvas/GroupNode.tsx" &&
        text.includes("group-download")) {
      return controlEntry(hit, "read-only group export route");
    }
    return unknownEntry(hit, "unregistered Canvas HTTP route/write");
  }

  if (hit.category === "browser-result-projection" ||
      hit.category === "legacy-terminal-detach") {
    return legacyClientEntry(
      hit,
      hit.category === "legacy-terminal-detach"
        ? "server-classified C identity-only terminal detach"
        : "server-authoritative generation projection",
      ["generationProjection"],
    );
  }

  if (hit.category === "canvas-transport-write") {
    if (hit.file === "client/src/generation/groupResultProjection.ts") {
      return legacyClientEntry(hit, "server-authoritative generation projection", ["generationProjection"]);
    }
    if (hit.file === "client/src/canvas/canvasPersistenceFacade.ts") {
      if (hit.symbol === "putHydrationDocument") {
        return controlEntry(hit, "bounded hydration/pagehide replay through command transport");
      }
      if (hit.symbol === "drainPersistenceQueue") {
        return manifestEntry(hit, {
          ...productClientBase(hit),
          currentEntry: "Canvas persistence autosave transport",
          fieldOwner: "durable-user",
          primaryPhase: "R3",
          removalPhase: "retain-command-transport",
          revisionImpact: "document-and-input-graph",
          stateClass: "Durable User",
          targetCommand: "command-v1",
          targetEntry: "POST /api/canvases/{canvasId}/commands",
          transactionOwner: "CanvasMutationGateway",
          violation: false,
          writeTarget: "Canvas command HTTP transport",
        });
      }
      if (hit.symbol === "flushBeforeReload") {
        return controlEntry(hit, "pagehide keepalive command transport");
      }
    }
    return unknownEntry(hit, "unregistered Canvas transport write");
  }

  if (hit.category === "media-callback") return viewEntry(hit, ["media"]);
  if (hit.category === "pagehide") return controlEntry(hit, "pagehide transport control");
  if (hit.category === "broadcast-channel") return controlEntry(hit, "cross-tab save notification");
  return unknownEntry(hit);
}

function classifyServerV2(hit) {
  const base = {
    tests: [
      "tests/m104-canvas-command-gateway.spec.ts",
      "tests/m20-api-contract.spec.ts",
    ],
    primaryPhase: "R0",
  };
  if (hit.category === "canvas-http-route") {
    return manifestEntry(hit, {
      ...base,
      currentEntry: "server Canvas route registration",
      fieldOwner: "control-only",
      primaryPhase: "R1",
      removalPhase: "retain-route-registration",
      revisionImpact: "none",
      stateClass: "control-only",
      targetEntry: "route dispatch to typed gateway or exact legacy adapter",
      transactionOwner: "none",
      violation: false,
      writeTarget: "Canvas HTTP route",
    });
  }
  if (hit.category === "server-dynamic-sql-helper" ||
      hit.category === "canvas-sql-dynamic") {
    return manifestEntry(hit, {
      ...base,
      currentEntry: "versioned schema migration helper",
      exceptionKind: "schema-migration",
      exceptionReason: "Dynamic Canvas schema changes are version-locked migrations, not request writers.",
      fieldOwner: "migration",
      primaryPhase: "R1.5",
      removalPhase: "retain-schema-migration",
      revisionImpact: "schema-only",
      stateClass: "Migration/Legacy",
      targetEntry: "exact schema migration transaction",
      transactionOwner: "database.schema-migration",
      violation: false,
      writeTarget: "Canvas schema",
    });
  }
  if (hit.category === "canvas-sql-ddl") {
    const databaseBootstrap = hit.file === "server/database.ts" && hit.line < 100;
    return manifestEntry(hit, {
      ...base,
      currentEntry: databaseBootstrap ? "Canvas bootstrap DDL" : "Canvas schema migration DDL",
      exceptionKind: databaseBootstrap ? "bootstrap" : "schema-migration",
      exceptionReason: databaseBootstrap
        ? "Greenfield schema creation owns Canvas table lifecycle."
        : "Exact-version schema migration owns Canvas DDL under its migration fence.",
      fieldOwner: "migration",
      primaryPhase: "R1.5",
      removalPhase: "retain-schema-lifecycle",
      revisionImpact: "schema-only",
      stateClass: "Migration/Legacy",
      targetEntry: databaseBootstrap ? "database bootstrap" : "database schema migration",
      transactionOwner: databaseBootstrap ? "database.bootstrap" : "database.schema-migration",
      violation: false,
      writeTarget: hit.detail || "Canvas DDL",
    });
  }
  if (hit.category === "canvas-sql-write") {
    if (hit.file === "server/database.ts") {
      return manifestEntry(hit, {
        ...base,
        currentEntry: "versioned Canvas schema migration DML",
        exceptionKind: "schema-migration",
        exceptionReason: "Canvas DML in server/database.ts is executed only by the versioned migration ledger.",
        fieldOwner: "migration",
        primaryPhase: "R1.5",
        removalPhase: "retain-schema-migration",
        revisionImpact: "schema-only",
        stateClass: "Migration/Legacy",
        targetEntry: "exact schema migration transaction",
        transactionOwner: "database.schema-migration",
        violation: false,
        writeTarget: hit.detail || "Canvas migration DML",
      });
    }
    if (hit.file === "server/canvasMutationGateway.ts") {
      const receipt = ["insertReceipt", "insertInternalReceipt"].includes(hit.symbol);
      const legacyProjectionReplay = hit.symbol === "applyGenerationProjectionCore" &&
        hit.controlFlowContext?.includes("if(existing):then");
      const serverProjection = receipt || hit.symbol === "bindSingleNodeGenerationCore" ||
        (hit.symbol === "applyGenerationProjectionCore" && !legacyProjectionReplay);
      const legacy = [
        "applyLegacyCanvasPutCore",
        "detachLegacyTerminalCore",
      ].includes(hit.symbol) || legacyProjectionReplay;
      const user = hit.symbol === "applyCanvasUserCommandCore";
      return manifestEntry(hit, {
        ...base,
        currentEntry: "Canvas mutation gateway SQL",
        exceptionKind: legacy ? "time-bounded-legacy-adapter" : null,
        exceptionReason: legacy
          ? "Legacy PUT adapter is receipt-backed and time-bounded."
          : null,
        fieldOwner: receipt || serverProjection ? "durable-server" : legacy ? "migration" : user ? "durable-user" : "unknown",
        primaryPhase: receipt || serverProjection ? "R2" : legacy ? "R7" : "R1",
        removalPhase: legacy ? "post-production-zero-observation-window" : "retain-gateway",
        revisionImpact: "fenced-revision-transition",
        stateClass: receipt || serverProjection ? "Durable Server" : legacy ? "Migration/Legacy" : user ? "Durable User" : "unknown",
        targetEntry: "retain gateway-owned SQL and durable receipt",
        transactionOwner: "CanvasMutationGateway",
        violation: !(receipt || serverProjection || legacy || user),
        writeTarget: hit.detail || "canvas_documents",
      });
    }
    if (hit.file === "server/canvasTransactionCommands.ts") {
      const accountDelete = hit.line === 559;
      const migration = hit.line === 576;
      return manifestEntry(hit, {
        ...base,
        currentEntry: "transaction-scoped Canvas lifecycle command",
        exceptionKind: accountDelete ? "account-delete-cascade" : migration ? "schema-migration" : null,
        exceptionReason: accountDelete
          ? "Account deletion owns the cross-domain Canvas cascade."
          : migration
            ? "Legacy unowned Canvas rows are claimed during migration."
            : null,
        fieldOwner: migration ? "migration" : "control-only",
        primaryPhase: migration ? "R1.5" : "R1",
        removalPhase: "retain-transaction-command",
        revisionImpact: "lifecycle",
        stateClass: migration ? "Migration/Legacy" : "control-only",
        targetEntry: "retain transaction-scoped lifecycle command",
        transactionOwner: "transaction-scoped-command",
        violation: false,
        writeTarget: hit.detail || "canvas_documents",
      });
    }
    if (hit.file === "server/canvasPersistence.ts") {
      if (hit.detail.endsWith(":canvas_documents")) {
        return manifestEntry(hit, {
          ...base,
          currentEntry: "uncapable legacy full-document PUT",
          exceptionKind: "time-bounded-legacy-adapter",
          exceptionReason: "Uncapable full-document PUT must be removed after the legacy observation window.",
          fieldOwner: "migration",
          primaryPhase: "R7",
          removalPhase: "post-production-zero-observation-window",
          revisionImpact: "document-and-input-graph",
          stateClass: "Migration/Legacy",
          targetEntry: "remove direct PUT; use typed command gateway",
          transactionOwner: "canvasPersistence",
          violation: false,
          writeTarget: "legacy Canvas PUT",
        });
      }
      return controlEntry(hit, "bounded high-water/lifecycle adapter", [], "time-bounded-legacy-adapter");
    }
    return unknownServerEntry(hit);
  }
  if (hit.category === "revision-transition") {
    return manifestEntry(hit, {
      ...base,
      currentEntry: "pure Canvas revision transition calculation",
      fieldOwner: "control-only",
      primaryPhase: "R1",
      removalPhase: "retain-revision-algorithm",
      revisionImpact: "revision-calculation",
      stateClass: "control-only",
      targetEntry: "types/canvasFingerprint.canvasRevisionTransition",
      transactionOwner: "none",
      violation: false,
      writeTarget: "revision state machine",
    });
  }
  if (hit.category === "server-transaction-command") {
    return manifestEntry(hit, {
      ...base,
      currentEntry: "transaction-scoped Canvas lifecycle command invocation",
      fieldOwner: "control-only",
      primaryPhase: "R1",
      removalPhase: "retain-transaction-command",
      revisionImpact: "lifecycle",
      stateClass: "control-only",
      targetEntry: hit.detail,
      transactionOwner: "transaction-scoped-command",
      violation: false,
      writeTarget: "Canvas lifecycle transaction",
    });
  }
  if (hit.category === "server-writer-call") {
    const detail = hit.detail;
    const serverProjection = detail.includes("Generation") ||
      detail.includes("projectSingle") || detail.includes("projectWorkflow");
    const legacy = detail.includes("Legacy") || detail.includes("detach");
    const user = detail.includes("UserCommand");
    const allowedFiles = new Set([
      "server/canvasMutationGateway.ts",
      "server/canvasCommandsApi.ts",
      "server/canvasLegacyGenerationReconciliation.ts",
      "server/canvasPersistence.ts",
      "server/canvasWorkflowProjection.ts",
      "server/generationCanvasProjectionService.ts",
      "server/generationResultCommit.ts",
      "server/workflowRunService.ts",
    ]);
    const allowed = allowedFiles.has(hit.file);
    return manifestEntry(hit, {
      ...base,
      currentEntry: "server Canvas writer/projection call",
      exceptionKind: legacy ? "time-bounded-legacy-adapter" : null,
      exceptionReason: legacy
        ? "Legacy C-only path retained until the exact production observation window closes."
        : null,
      fieldOwner: serverProjection ? "durable-server" : user ? "durable-user" : legacy ? "migration" : "unknown",
      primaryPhase: serverProjection ? "R2" : legacy ? "R7" : user ? "R1" : "R0",
      removalPhase: legacy ? "post-production-zero-observation-window" : "retain-writer-call",
      revisionImpact: "fenced-revision-transition",
      stateClass: serverProjection ? "Durable Server" : user ? "Durable User" : legacy ? "Migration/Legacy" : "unknown",
      targetEntry: "CanvasMutationGateway typed writer",
      transactionOwner: "caller-BEGIN-IMMEDIATE",
      violation: !allowed,
      writeTarget: detail,
    });
  }
  return unknownServerEntry(hit);
}

function unknownServerEntry(hit) {
  return manifestEntry(hit, {
    currentEntry: "unclassified-server-Canvas-writer",
    fieldOwner: "unknown",
    primaryPhase: "R0",
    removalPhase: "blocked-on-classification",
    stateClass: "unknown",
    targetEntry: "registered Canvas transaction owner",
    transactionOwner: "unknown",
    violation: true,
    writeTarget: hit.detail || hit.category,
  });
}

function classifyTestV2(hit) {
  return manifestEntry(hit, {
    currentEntry: "test-only writer fixture",
    exceptionKind: "test-double",
    exceptionReason: "Test code is inventoried separately and cannot authorize a product writer.",
    fieldOwner: "test-fixture",
    primaryPhase: "R0",
    removalPhase: "retain-test-fixture",
    stateClass: "control-only",
    targetEntry: "test-only fixture",
    transactionOwner: "test-owned",
    violation: false,
    writeTarget: hit.detail || hit.category,
    tests: [hit.file],
  });
}

function classifyV2(hit) {
  if (hit.side === "test") return classifyTestV2(hit);
  if (hit.side === "client") return classifyClientV2(hit);
  return classifyServerV2(hit);
}

function legacyClassify(hit) {
  if (hit.side === "test") return classifyTest(hit);
  if (hit.side === "client") return classifyClient(hit);
  return classifyServer(hit);
}

function legacyBuildManifest(generatedAt) {
  const parsed = sourceFiles();
  try {
    const hits = [];
    for (const { path, sourceFile } of parsed.files) {
      if (path.startsWith("server/") || path === "vite.config.ts") {
        scanServer(sourceFile, path, hits);
      } else {
        scanClientOrTest(sourceFile, path, hits);
      }
    }
    hits.sort((left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line ||
      left.column - right.column || left.category.localeCompare(right.category)
    );
    const entries = hits.map(classify);
    const duplicateIds = entries.filter((entry, index) =>
      entries.findIndex((candidate) => candidate.id === entry.id) !== index
    );
    if (duplicateIds.length > 0) {
      fail(`scanner produced duplicate entry ids: ${duplicateIds.map(({ id }) => id).join(", ")}`);
    }
    const productEntries = entries.filter(({ side }) => side !== "test");
    const exceptionEntries = entries.filter(({ exceptionKind }) => exceptionKind !== null);
    const violationEntries = entries.filter(({ violation }) => violation);
    const scannedProductFiles = parsed.files
      .map(({ path }) => path)
      .filter((path) => matchesAny(path, includeGlobs))
      .sort();
    const scannedTestFiles = parsed.files
      .map(({ path }) => path)
      .filter((path) => matchesAny(path, testIncludeGlobs))
      .sort();
    return {
      schemaVersion: 1,
      status: {
        phase: "R0",
        state: violationEntries.length === 0 &&
            entries.every(({ stateClass }) => stateClass !== "unknown")
          ? "PASS"
          : "FAIL",
        failClosed: true,
      },
      baseline: {
        gitRoot: repositoryRoot,
        branch: git(["branch", "--show-current"]),
        head: git(["rev-parse", "HEAD"]),
        sourceTreeHash: sourceTreeHash([...scannedProductFiles, ...scannedTestFiles]),
        generatedAt,
      },
      scan: {
        commands: [
          "/Users/mymy/.hermes/node/bin/node scripts/check-canvas-writer-manifest.mjs --check",
          "/Users/mymy/.hermes/node/bin/node scripts/check-canvas-writer-manifest.mjs --print",
        ],
        includeGlobs: [...includeGlobs],
        testIncludeGlobs: [...testIncludeGlobs],
        exactExclusions: [...protectedExactExclusions],
        parserVersion,
      },
      entries,
      summary: {
        scannedFiles: scannedProductFiles.length,
        scannedTestFiles: scannedTestFiles.length,
        rawHits: entries.length,
        productHits: productEntries.length,
        classified: entries.filter(({ stateClass }) => stateClass !== "unknown").length,
        exceptions: exceptionEntries.length,
        violations: violationEntries.length,
        violationIds: violationEntries.map(({ id }) => id),
      },
    };
  } finally {
    parsed.close();
  }
}

function buildManifest(generatedAt, options = {}) {
  const projectRoot = options.projectRoot ?? repositoryRoot;
  const parsed = sourceFiles({
    projectRoot,
    tsconfigPath: options.tsconfigPath,
  });
  try {
    const rawHits = [];
    for (const item of parsed.files) {
      const path = item.path;
      const sourceFile = item.sourceFile;
      if (path.startsWith("server/") || path === "vite.config.ts") {
        scanServer(sourceFile, path, rawHits);
      } else {
        scanClientOrTest(sourceFile, path, rawHits);
      }
    }
    const hits = dedupeHits(rawHits);
    const entries = hits.map(classifyV2);
    const ids = new Set();
    for (const entry of entries) {
      if (ids.has(entry.id)) fail("scanner produced duplicate entry id: " + entry.id);
      ids.add(entry.id);
    }
    const scannedProductFiles = [...new Set(parsed.files
      .map(({ path }) => path)
      .filter((path) => matchesAny(path, includeGlobs))
      .filter((path) => !isProtectedPath(path)))].sort();
    const scannedTestFiles = [...new Set(parsed.files
      .map(({ path }) => path)
      .filter((path) => matchesAny(path, testIncludeGlobs))
      .filter((path) => !isProtectedPath(path)))].sort();
    const productEntries = entries.filter(({ side }) => side !== "test");
    const exceptionEntries = entries.filter(({ exceptionKind }) => exceptionKind !== null);
    const violationEntries = entries.filter(({ violation }) => violation);
    const countsBy = (values) => Object.fromEntries(
      [...new Set(values)].sort().map((value) => [
        value,
        values.filter((candidate) => candidate === value).length,
      ]),
    );
    const baseline = options.baseline ?? {};
    const branch = baseline.branch ?? (options.noGit ? "UNRECORDED" : git(["branch", "--show-current"]));
    const head = baseline.head ?? (options.noGit ? "UNRECORDED" : git(["rev-parse", "HEAD"]));
    const gitRoot = baseline.gitRoot ?? (projectRoot === repositoryRoot
      ? repositoryRoot
      : "fixture:" + projectRoot);
    return {
      schemaVersion: 1,
      status: {
        phase: "R0",
        state: violationEntries.length === 0 &&
            entries.every(({ stateClass }) => stateClass !== "unknown")
          ? "PASS"
          : "FAIL",
        failClosed: true,
      },
      baseline: {
        gitRoot,
        branch,
        head,
        sourceTreeHash: sourceTreeHash(
          [...scannedProductFiles, ...scannedTestFiles],
          projectRoot,
        ),
        generatedAt,
      },
      scan: {
        commands: [
          "node scripts/check-canvas-writer-manifest.mjs --check",
          "node scripts/check-canvas-writer-manifest.mjs --print --no-git",
          "node scripts/check-canvas-writer-manifest.mjs --write",
        ],
        includeGlobs: [...includeGlobs],
        testIncludeGlobs: [...testIncludeGlobs],
        exactExclusions: [...protectedExactExclusions],
        parserVersion,
        dedupeKey: "side+file+startLine+startColumn+astKind+normalizedAnchorHash",
      },
      entries,
      summary: {
        scannedFiles: scannedProductFiles.length,
        scannedTestFiles: scannedTestFiles.length,
        rawHits: entries.length,
        productHits: productEntries.length,
        classified: entries.filter(({ stateClass }) => stateClass !== "unknown").length,
        exceptions: exceptionEntries.length,
        violations: violationEntries.length,
        violationIds: violationEntries.map(({ id }) => id),
        bySide: countsBy(entries.map(({ side }) => side)),
        byCategory: countsBy(entries.map(({ astKind }) => astKind.split(":")[0])),
        byStateClass: countsBy(entries.map(({ stateClass }) => stateClass)),
        byFile: countsBy(entries.map(({ file }) => file)),
      },
    };
  } finally {
    parsed.close();
  }
}

function legacyAssertManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("manifest must be an object");
  }
  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!manifest.status || manifest.status.phase !== "R0" ||
      !["PASS", "FAIL"].includes(manifest.status.state) ||
      manifest.status.failClosed !== true) {
    fail("status must be R0 fail-closed PASS/FAIL");
  }
  if (!manifest.baseline || typeof manifest.baseline.generatedAt !== "string" ||
      Number.isNaN(Date.parse(manifest.baseline.generatedAt))) {
    fail("baseline.generatedAt must be an ISO timestamp");
  }
  if (!Array.isArray(manifest.entries) || !manifest.summary || !manifest.scan) {
    fail("manifest entries, summary and scan are required");
  }
  const allowedExceptions = new Set([
    null,
    "bootstrap",
    "schema-migration",
    "account-delete-cascade",
    "test-double",
    "time-bounded-legacy-adapter",
  ]);
  for (const entry of manifest.entries) {
    for (const field of [
      "id", "side", "file", "symbol", "astKind", "sourceAnchorHash",
      "writeTarget", "stateClass", "fieldOwner", "transactionOwner",
      "currentEntry", "targetEntry", "primaryPhase", "removalPhase",
    ]) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) {
        fail(`${entry.id ?? "entry"}.${field} must be a non-empty string`);
      }
    }
    if (!allowedExceptions.has(entry.exceptionKind)) {
      fail(`${entry.id}.exceptionKind is not an allowed exact exception`);
    }
    if (entry.exceptionKind && typeof entry.exceptionReason !== "string") {
      fail(`${entry.id}.exceptionReason is required`);
    }
    if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
      fail(`${entry.id}.tests must contain exact evidence specs`);
    }
  }
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("manifest must be an object");
  }
  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!manifest.status || manifest.status.phase !== "R0" ||
      !["PASS", "FAIL"].includes(manifest.status.state) ||
      manifest.status.failClosed !== true) {
    fail("status must be R0 fail-closed PASS/FAIL");
  }
  if (!manifest.baseline || typeof manifest.baseline !== "object") {
    fail("baseline is required");
  }
  for (const field of ["gitRoot", "branch", "head", "sourceTreeHash", "generatedAt"]) {
    if (typeof manifest.baseline[field] !== "string" || manifest.baseline[field].length === 0) {
      fail("baseline." + field + " must be a non-empty string");
    }
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.baseline.sourceTreeHash)) {
    fail("baseline.sourceTreeHash must be lowercase SHA-256");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.baseline.generatedAt) ||
      Number.isNaN(Date.parse(manifest.baseline.generatedAt))) {
    fail("baseline.generatedAt must be an ISO-8601 UTC timestamp");
  }
  if (!manifest.scan || typeof manifest.scan !== "object") fail("scan is required");
  for (const field of ["commands", "includeGlobs", "testIncludeGlobs", "exactExclusions"]) {
    if (!Array.isArray(manifest.scan[field]) || manifest.scan[field].length === 0 ||
        manifest.scan[field].some((value) => typeof value !== "string" || value.length === 0)) {
      fail("scan." + field + " must contain non-empty strings");
    }
  }
  if (manifest.scan.parserVersion !== parserVersion) fail("scan.parserVersion is stale");
  if (manifest.scan.dedupeKey !==
      "side+file+startLine+startColumn+astKind+normalizedAnchorHash") {
    fail("scan.dedupeKey is invalid");
  }
  if (JSON.stringify(manifest.scan.exactExclusions) !==
      JSON.stringify(protectedExactExclusions)) {
    fail("scan.exactExclusions must match the protected exact exclusions");
  }
  if (manifest.scan.includeGlobs.some((pattern) => pattern.startsWith("spec/"))) {
    fail("scan.includeGlobs may not include spec/");
  }
  if (!Array.isArray(manifest.entries)) fail("entries must be an array");
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("each entry must be an object");
    }
    for (const field of [
      "id", "side", "file", "symbol", "astKind", "sourceAnchorHash",
      "normalizedAnchorHash", "writeTarget", "stateClass", "fieldOwner",
      "transactionOwner", "currentEntry", "targetEntry", "primaryPhase",
      "removalPhase",
    ]) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) {
        fail((entry.id ?? "entry") + "." + field + " must be a non-empty string");
      }
    }
    if (!SIDES.includes(entry.side)) fail(entry.id + ".side is invalid");
    if (!normalizedStateClasses.has(entry.stateClass)) fail(entry.id + ".stateClass is invalid");
    if (!normalizedFieldOwners.has(entry.fieldOwner)) fail(entry.id + ".fieldOwner is invalid");
    if (entry.file.startsWith("/") || entry.file.split("/").includes("..")) {
      fail(entry.id + ".file must be a repository-relative path");
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sourceAnchorHash) ||
        entry.sourceAnchorHash !== entry.normalizedAnchorHash) {
      fail(entry.id + ".sourceAnchorHash must equal normalizedAnchorHash");
    }
    for (const field of ["line", "column", "startLine", "startColumn"]) {
      if (!Number.isSafeInteger(entry[field]) || entry[field] < 1) {
        fail(entry.id + "." + field + " must be a positive integer");
      }
    }
    if (entry.startLine !== entry.line || entry.startColumn !== entry.column) {
      fail(entry.id + ".start location must match line/column");
    }
    const dedupeKey = [
      entry.side,
      entry.file,
      entry.startLine,
      entry.startColumn,
      entry.astKind,
      entry.normalizedAnchorHash,
    ].join("\0");
    const expectedId = "CWW-" + sha256(dedupeKey).slice(0, 16);
    if (entry.id !== expectedId) fail(entry.id + " does not match its deterministic id");
    if (ids.has(entry.id)) fail("duplicate entry id: " + entry.id);
    ids.add(entry.id);
    if (isProtectedPath(entry.file)) fail("protected path present in entries: " + entry.file);
    if (!Array.isArray(entry.fields) ||
        entry.fields.some((value) => typeof value !== "string" || value.length === 0)) {
      fail(entry.id + ".fields must be a string array");
    }
    if (entry.targetCommand !== null &&
        (typeof entry.targetCommand !== "string" || entry.targetCommand.length === 0)) {
      fail(entry.id + ".targetCommand must be string or null");
    }
    if (!normalizedExceptionKinds.has(entry.exceptionKind)) {
      fail(entry.id + ".exceptionKind is invalid");
    }
    if (entry.exceptionKind === null) {
      if (entry.exceptionReason !== null) fail(entry.id + ".exceptionReason must be null without exception");
    } else if (typeof entry.exceptionReason !== "string" || entry.exceptionReason.length === 0) {
      fail(entry.id + ".exceptionReason is required");
    }
    if (entry.stateClass === "unknown" && entry.violation !== true) {
      fail(entry.id + ".unknown stateClass must fail closed as a violation");
    }
    if (entry.stateClass === "Migration/Legacy" && entry.exceptionKind === null) {
      fail(entry.id + ".Migration/Legacy requires an explicit exceptionKind");
    }
    if (!Array.isArray(entry.tests) || entry.tests.length === 0 ||
        entry.tests.some((value) => typeof value !== "string" || value.length === 0)) {
      fail(entry.id + ".tests must contain exact evidence specs");
    }
    for (const testPath of entry.tests) {
      if (isProtectedPath(testPath)) fail(entry.id + " references protected test path");
      if (testPath.startsWith("tests/") && !existsSync(join(repositoryRoot, testPath))) {
        fail(entry.id + " references missing test: " + testPath);
      }
    }
    if (typeof entry.violation !== "boolean") fail(entry.id + ".violation must be boolean");
  }
  if (!manifest.summary || typeof manifest.summary !== "object") fail("summary is required");
  for (const field of [
    "scannedFiles", "scannedTestFiles", "rawHits", "productHits",
    "classified", "exceptions", "violations",
  ]) {
    if (!Number.isSafeInteger(manifest.summary[field]) || manifest.summary[field] < 0) {
      fail("summary." + field + " must be a non-negative integer");
    }
  }
  if (!Array.isArray(manifest.summary.violationIds) ||
      manifest.summary.violationIds.some((value) => typeof value !== "string")) {
    fail("summary.violationIds must be a string array");
  }
  const entries = manifest.entries;
  const expectedSummary = {
    rawHits: entries.length,
    productHits: entries.filter(({ side }) => side !== "test").length,
    classified: entries.filter(({ stateClass }) => stateClass !== "unknown").length,
    exceptions: entries.filter(({ exceptionKind }) => exceptionKind !== null).length,
    violations: entries.filter(({ violation }) => violation).length,
    violationIds: entries.filter(({ violation }) => violation).map(({ id }) => id),
  };
  for (const field of [
    "rawHits", "productHits", "classified", "exceptions", "violations",
  ]) {
    if (manifest.summary[field] !== expectedSummary[field]) {
      fail("summary." + field + " does not match entries");
    }
  }
  if (JSON.stringify(manifest.summary.violationIds) !==
      JSON.stringify(expectedSummary.violationIds)) {
    fail("summary.violationIds does not match entries");
  }
  const countValues = (values) => Object.fromEntries(
    [...new Set(values)].sort().map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  );
  for (const [field, values] of [
    ["bySide", entries.map(({ side }) => side)],
    ["byCategory", entries.map(({ astKind }) => astKind.split(":")[0])],
    ["byStateClass", entries.map(({ stateClass }) => stateClass)],
    ["byFile", entries.map(({ file }) => file)],
  ]) {
    if (JSON.stringify(manifest.summary[field]) !== JSON.stringify(countValues(values))) {
      fail("summary." + field + " does not match entries");
    }
  }
  const expectedStatus = expectedSummary.violations === 0 &&
    expectedSummary.classified === expectedSummary.rawHits ? "PASS" : "FAIL";
  if (manifest.status.state !== expectedStatus) {
    fail("status.state does not match fail-closed summary");
  }
}

function legacyCheck() {
  if (!existsSync(manifestPath)) fail(`${manifestRelativePath} is missing`);
  let actual;
  try {
    actual = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
  assertManifestShape(actual);
  const expected = buildManifest(actual.baseline.generatedAt);
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    fail(
      `manifest is stale; regenerate with --print and review every entry ` +
        `(expected hash ${sha256(expectedText)}, actual hash ${sha256(actualText)})`,
    );
  }
  if (actual.summary.classified !== actual.summary.rawHits) {
    fail(`only ${actual.summary.classified}/${actual.summary.rawHits} hits are classified`);
  }
  if (actual.summary.violations !== 0) {
    fail(`writer boundary has ${actual.summary.violations} violation(s): ${actual.summary.violationIds.join(", ")}`);
  }
  process.stdout.write(JSON.stringify({
    clientProductHits: actual.entries.filter(({ side }) => side === "client").length,
    exceptions: actual.summary.exceptions,
    manifestSha256: sha256(actualText),
    productHits: actual.summary.productHits,
    rawHits: actual.summary.rawHits,
    scannedFiles: actual.summary.scannedFiles,
    scannedTestFiles: actual.summary.scannedTestFiles,
    serverProductHits: actual.entries.filter(({ side }) => side === "server").length,
    status: "pass",
    violations: 0,
  }) + "\n");
}

function checkV2() {
  if (!existsSync(manifestPath)) fail(manifestRelativePath + " is missing");
  let actual;
  try {
    actual = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("manifest is not valid JSON: " + error.message);
  }
  assertManifestShape(actual);
  const expected = buildManifest(actual.baseline.generatedAt, {
    baseline: actual.baseline,
    noGit: true,
  });
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    fail(
      "manifest is stale; regenerate with --print and review every entry " +
      "(expected hash " + sha256(expectedText) +
      ", actual hash " + sha256(actualText) + ")",
    );
  }
  if (actual.summary.classified !== actual.summary.rawHits) {
    fail("only " + actual.summary.classified + "/" + actual.summary.rawHits +
      " hits are classified");
  }
  if (actual.summary.violations !== 0) {
    fail("writer boundary has " + actual.summary.violations +
      " violation(s): " + actual.summary.violationIds.join(", "));
  }
  process.stdout.write(JSON.stringify({
    clientProductHits: actual.entries.filter(({ side }) => side === "client").length,
    exceptions: actual.summary.exceptions,
    manifestSha256: sha256(actualText),
    productHits: actual.summary.productHits,
    rawHits: actual.summary.rawHits,
    scannedFiles: actual.summary.scannedFiles,
    scannedTestFiles: actual.summary.scannedTestFiles,
    serverProductHits: actual.entries.filter(({ side }) => side === "server").length,
    status: "pass",
    violations: 0,
  }) + "\n");
}

function parseCli(argv) {
  let mode = "--check";
  let noGit = false;
  let projectRoot = repositoryRoot;
  let tsconfigPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check" || argument === "--print" || argument === "--write") {
      mode = argument;
    } else if (argument === "--no-git") {
      noGit = true;
    } else if (argument === "--fixture-root") {
      const value = argv[++index];
      if (!value) fail("--fixture-root requires a directory");
      projectRoot = realpathSync(resolve(value));
      tsconfigPath = join(projectRoot, "tsconfig.json");
      noGit = true;
    } else {
      fail("usage: check-canvas-writer-manifest.mjs --check|--print|--write [--no-git] [--fixture-root DIR]");
    }
  }
  return { mode, noGit, projectRoot, tsconfigPath };
}

const isMain = process.argv[1] && existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(scriptPath);
if (isMain) {
  const options = parseCli(process.argv.slice(2));
  if (options.mode === "--print") {
    process.stdout.write(JSON.stringify(buildManifest(
      new Date().toISOString(),
      options,
    ), null, 2) + "\n");
  } else if (options.mode === "--write" &&
      options.projectRoot === repositoryRoot && !options.noGit) {
    const manifest = buildManifest(new Date().toISOString(), options);
    assertManifestShape(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    process.stdout.write(JSON.stringify({
      entries: manifest.entries.length,
      manifest: manifestRelativePath,
      sourceTreeHash: manifest.baseline.sourceTreeHash,
      status: manifest.status.state,
      violations: manifest.summary.violations,
    }) + "\n");
  } else if (options.mode === "--check" && options.projectRoot === repositoryRoot) {
    checkV2();
  } else {
    fail("--check is only supported for the repository root");
  }
}

export {
  assertManifestShape,
  buildManifest,
  dedupeHits,
  hitDedupeKey,
  isProtectedPath,
  scanClientOrTest,
  scanServer,
};
