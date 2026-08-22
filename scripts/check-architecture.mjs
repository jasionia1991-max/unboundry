import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API as TypeScriptCompilerAPI } from "typescript/unstable/sync";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(scriptPath), ".."));
const defaultConfigPath = join(repositoryRoot, "scripts/architecture-boundaries.json");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new Error(`[architecture] ${message}`);
}

function repositoryPath(root, absolutePath) {
  const path = relative(root, absolutePath).split(sep).join("/");
  if (path === ".." || path.startsWith("../") || isAbsolute(path)) return null;
  return path;
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

function matchesAny(path, patterns = []) {
  return patterns.some((pattern) => globRegularExpression(pattern).test(path));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(`${label} must be an array of strings`);
  }
}

function loadConfiguration(configPath) {
  if (!existsSync(configPath)) fail(`configuration is missing: ${configPath}`);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    fail(`configuration is not valid JSON: ${error.message}`);
  }
  assertPlainObject(config, "configuration");
  if (config.schemaVersion !== 1) fail("configuration schemaVersion must be 1");
  if (typeof config.tsconfig !== "string" || config.tsconfig.length === 0) {
    fail("configuration tsconfig must be a non-empty string");
  }
  assertStringArray(config.scanGlobs, "configuration.scanGlobs");
  assertStringArray(config.uiSources, "configuration.uiSources");
  assertStringArray(config.serverTargets, "configuration.serverTargets");
  assertStringArray(config.providerAdapterSources, "configuration.providerAdapterSources");
  assertStringArray(config.storageConcreteTargets, "configuration.storageConcreteTargets");
  assertStringArray(config.mediaSources, "configuration.mediaSources");
  assertStringArray(config.generationWriteTargets, "configuration.generationWriteTargets");
  if (!Array.isArray(config.internalBoundaries)) {
    fail("configuration.internalBoundaries must be an array");
  }
  if (!Array.isArray(config.sqlDomains)) fail("configuration.sqlDomains must be an array");
  assertStringArray(config.sqlExemptSources, "configuration.sqlExemptSources");
  if (!Array.isArray(config.tableOwners)) fail("configuration.tableOwners must be an array");
  if (!Array.isArray(config.baseline)) fail("configuration.baseline must be an array");
  return config;
}

function parseProject(root, config) {
  const tsconfigPath = resolve(root, config.tsconfig);
  const api = new TypeScriptCompilerAPI({ cwd: root });
  const snapshot = api.updateSnapshot({ openProjects: [tsconfigPath] });
  const project = snapshot.getProject(tsconfigPath) ?? snapshot.getProjects()[0];
  if (!project) {
    snapshot.dispose();
    api.close();
    fail(`TypeScript Compiler API did not open ${tsconfigPath}`);
  }
  return {
    api,
    checker: project.checker,
    program: project.program,
    project,
    snapshot,
  };
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function importDeclarationIsTypeOnly(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node) {
  if (node.isTypeOnly) return true;
  return Boolean(node.exportClause && ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly));
}

function moduleReferences(sourceFile) {
  const references = [];
  function record(node, specifier, kind, syntax) {
    if (typeof specifier !== "string" || specifier.length === 0) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({
      kind,
      line: position.line + 1,
      node: syntax === "import-equals" ? node.moduleReference.expression :
        syntax === "dynamic-import" ? node.arguments[0] : node.moduleSpecifier,
      specifier,
      syntax,
    });
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      record(
        node,
        node.moduleSpecifier.text,
        importDeclarationIsTypeOnly(node) ? "type" : "runtime",
        "import",
      );
    } else if (
      ts.isExportDeclaration(node) && node.moduleSpecifier &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(
        node,
        node.moduleSpecifier.text,
        exportDeclarationIsTypeOnly(node) ? "type" : "runtime",
        "re-export",
      );
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 && isStringLiteralLike(node.arguments[0])
    ) {
      record(node, node.arguments[0].text, "runtime", "dynamic-import");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && isStringLiteralLike(node.moduleReference.expression)
    ) {
      record(
        node,
        node.moduleReference.expression.text,
        node.isTypeOnly ? "type" : "runtime",
        "import-equals",
      );
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return references;
}

function resolveReference(root, checker, project, reference) {
  const symbol = checker.getSymbolAtLocation(reference.node);
  const declaration = symbol?.declarations?.[0]?.resolve(project);
  const fileName = declaration?.getSourceFile().fileName;
  if (!fileName || !existsSync(fileName)) return null;
  return repositoryPath(root, realpathSync(fileName));
}

function edgeFingerprint(rule, edge, detail = edge.kind) {
  return `${rule}|${edge.from}|${edge.to}|${detail}`;
}

function sourceDomain(path, domains) {
  const matches = domains.filter((record) => matchesAny(path, record.sources));
  if (matches.length > 1) {
    fail(`SQL source belongs to multiple domains: ${path}`);
  }
  return matches[0]?.domain ?? null;
}

function tableOwnerMap(tableOwners) {
  const map = new Map();
  for (const record of tableOwners) {
    if (typeof record.owner !== "string" || !Array.isArray(record.tables)) {
      fail("each tableOwners record requires owner and tables");
    }
    for (const table of record.tables) {
      const normalizedTable = table.toLowerCase();
      if (map.has(normalizedTable)) fail(`table has multiple owners: ${table}`);
      map.set(normalizedTable, record.owner);
    }
  }
  return map;
}

function literalText(node) {
  if (isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  return null;
}

function sqlReferences(sourceFile, owners) {
  const references = new Set();
  function visit(node) {
    const text = literalText(node);
    if (text && /\b(?:select|insert|update|delete|replace|from|join)\b/i.test(text)) {
      for (const table of owners.keys()) {
        const escaped = escapeRegularExpression(table);
        const writePattern = new RegExp(
          `\\b(?:insert\\s+(?:or\\s+\\w+\\s+)?into|replace\\s+into|update|delete\\s+from)\\s+[\\\"\\\`\\[]?${escaped}\\b`,
          "i",
        );
        const readPattern = new RegExp(
          `\\b(?:from|join)\\s+[\\\"\\\`\\[]?${escaped}\\b`,
          "i",
        );
        if (writePattern.test(text)) references.add(`${table}:write`);
        if (readPattern.test(text)) references.add(`${table}:read`);
      }
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return [...references].sort();
}

function stronglyConnectedComponents(nodes, adjacency) {
  let index = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  function connect(node) {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        connect(neighbor);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbor)));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(neighbor)));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component.sort());
  }
  for (const node of [...nodes].sort()) {
    if (!indices.has(node)) connect(node);
  }
  return components;
}

function architectureViolations(root, config, program, checker, project) {
  const sourceFiles = program.getSourceFileNames()
    .map((fileName) => program.getSourceFile(fileName))
    .filter(Boolean)
    .map((sourceFile) => ({
      path: existsSync(sourceFile.fileName)
        ? repositoryPath(root, realpathSync(sourceFile.fileName))
        : null,
      sourceFile,
    }))
    .filter((record) => record.path && matchesAny(record.path, config.scanGlobs));
  const sourcePaths = new Set(sourceFiles.map((record) => record.path));
  const edges = [];
  for (const { path, sourceFile } of sourceFiles) {
    for (const reference of moduleReferences(sourceFile)) {
      const target = resolveReference(root, checker, project, reference);
      if (!target || !sourcePaths.has(target)) continue;
      const { node: _node, ...evidence } = reference;
      edges.push({ from: path, to: target, ...evidence });
    }
  }

  const violations = new Map();
  function add(rule, edge, detail = edge.kind) {
    const fingerprint = edgeFingerprint(rule, edge, detail);
    violations.set(fingerprint, { detail, fingerprint, rule, ...edge });
  }
  for (const edge of edges) {
    if (matchesAny(edge.from, config.uiSources) && matchesAny(edge.to, config.serverTargets)) {
      add("UI_SERVER", edge);
    }
    if (
      matchesAny(edge.from, config.providerAdapterSources) &&
      matchesAny(edge.to, config.storageConcreteTargets)
    ) {
      add("PROVIDER_STORAGE", edge);
    }
    if (
      matchesAny(edge.from, config.mediaSources) &&
      matchesAny(edge.to, config.generationWriteTargets)
    ) {
      add("MEDIA_GENERATION_WRITE", edge);
    }
    for (const boundary of config.internalBoundaries) {
      if (
        matchesAny(edge.to, boundary.internalTargets) &&
        !matchesAny(edge.from, boundary.ownerSources)
      ) {
        add("CROSS_DOMAIN_INTERNAL", edge, `${boundary.name}:${edge.kind}`);
      }
    }
  }

  const owners = tableOwnerMap(config.tableOwners);
  for (const { path, sourceFile } of sourceFiles) {
    const domain = sourceDomain(path, config.sqlDomains);
    const references = sqlReferences(sourceFile, owners);
    if (!domain) {
      if (matchesAny(path, config.sqlExemptSources)) continue;
      for (const reference of references) {
        const [table, mode] = reference.split(":");
        const owner = owners.get(table);
        add(
          "UNCLASSIFIED_SQL",
          { from: path, to: `table:${table}`, kind: mode, line: 0, specifier: table, syntax: "sql" },
          `unclassified->${owner}:${mode}`,
        );
      }
      continue;
    }
    for (const reference of references) {
      const [table, mode] = reference.split(":");
      const owner = owners.get(table);
      if (owner === domain) continue;
      add(
        "CROSS_DOMAIN_SQL",
        { from: path, to: `table:${table}`, kind: mode, line: 0, specifier: table, syntax: "sql" },
        `${domain}->${owner}:${mode}`,
      );
    }
  }

  const runtimeAdjacency = new Map([...sourcePaths].map((path) => [path, new Set()]));
  for (const edge of edges) {
    if (edge.kind === "runtime") runtimeAdjacency.get(edge.from).add(edge.to);
  }
  for (const component of stronglyConnectedComponents(sourcePaths, runtimeAdjacency)) {
    const selfCycle = component.length === 1 && runtimeAdjacency.get(component[0]).has(component[0]);
    if (component.length < 2 && !selfCycle) continue;
    const detail = component.join(" -> ");
    add(
      "RUNTIME_CYCLE",
      { from: component[0], to: component.at(-1), kind: "runtime", line: 0, specifier: "", syntax: "graph" },
      detail,
    );
  }
  return {
    edges: edges.sort((left, right) =>
      `${left.from}|${left.to}|${left.kind}`.localeCompare(`${right.from}|${right.to}|${right.kind}`)),
    sourceFiles: [...sourcePaths].sort(),
    violations: [...violations.values()].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint)),
  };
}

function validateBaseline(config, violations, today) {
  const invalid = [];
  const declared = new Map();
  for (const [index, entry] of config.baseline.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid.push(`baseline[${index}] must be an object`);
      continue;
    }
    for (const key of ["owner", "reason", "expiry"]) {
      if (typeof entry[key] !== "string" || entry[key].trim().length === 0) {
        invalid.push(`baseline[${index}].${key} must be a non-empty string`);
      }
    }
    const fingerprints = typeof entry.fingerprint === "string"
      ? [entry.fingerprint]
      : entry.fingerprints;
    if (
      !Array.isArray(fingerprints) || fingerprints.length === 0 ||
      fingerprints.some((fingerprint) =>
        typeof fingerprint !== "string" || fingerprint.length === 0)
    ) {
      invalid.push(
        `baseline[${index}] requires a non-empty fingerprint or fingerprints array`,
      );
    }
    if (typeof entry.reason === "string" && entry.reason.length < 20) {
      invalid.push(`baseline[${index}].reason is too short`);
    }
    if (typeof entry.expiry === "string" && !datePattern.test(entry.expiry)) {
      invalid.push(`baseline[${index}].expiry must be YYYY-MM-DD`);
    } else if (entry.expiry < today) {
      invalid.push(`baseline[${index}] expired on ${entry.expiry}`);
    }
    for (const fingerprint of Array.isArray(fingerprints) ? fingerprints : []) {
      if (declared.has(fingerprint)) {
        invalid.push(`duplicate baseline fingerprint: ${fingerprint}`);
      }
      declared.set(fingerprint, entry);
    }
  }
  const actual = new Set(violations.map((violation) => violation.fingerprint));
  return {
    invalid,
    newViolations: violations.filter((violation) => !declared.has(violation.fingerprint)),
    staleBaseline: [...declared.keys()].filter((fingerprint) => !actual.has(fingerprint)).sort(),
  };
}

export function analyzeArchitecture({
  configPath = defaultConfigPath,
  root = repositoryRoot,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const canonicalRoot = realpathSync(root);
  const canonicalConfig = isAbsolute(configPath) ? configPath : resolve(canonicalRoot, configPath);
  const config = loadConfiguration(canonicalConfig);
  const compiler = parseProject(canonicalRoot, config);
  try {
    const graph = architectureViolations(
      canonicalRoot,
      config,
      compiler.program,
      compiler.checker,
      compiler.project,
    );
    return { ...graph, ...validateBaseline(config, graph.violations, today) };
  } finally {
    compiler.snapshot.dispose();
    compiler.api.close();
  }
}

function main() {
  const result = analyzeArchitecture();
  if (
    result.invalid.length > 0 || result.newViolations.length > 0 ||
    result.staleBaseline.length > 0
  ) {
    console.error(JSON.stringify({
      invalidBaseline: result.invalid,
      newViolations: result.newViolations.map((violation) => violation.fingerprint),
      staleBaseline: result.staleBaseline,
      status: "fail",
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    baselineExceptions: result.violations.length,
    edges: {
      runtime: result.edges.filter((edge) => edge.kind === "runtime").length,
      type: result.edges.filter((edge) => edge.kind === "type").length,
    },
    sourceFiles: result.sourceFiles.length,
    status: "pass",
  }, null, 2));
}

if (process.argv[1] && realpathSync(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
