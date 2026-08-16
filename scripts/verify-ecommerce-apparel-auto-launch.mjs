import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../spec/ecommerce-apparel-auto-launch-prompt-pack.json');
const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
const supportedTypes = new Set(['image', 'text', 'video']);
const inputMatrix = {
  text: new Set(['text', 'image', 'video']),
  image: new Set(['text', 'image']),
  video: new Set(['text', 'image', 'video'])
};
const forbidden = /(?:api[_-]?key|secret|password|https?:\/\/|oss\.|accessKey)/i;
const knownPlaceholderRoots = new Set([
  'source_image',
  'product_facts',
  'normalized_garment_image',
  'creative_direction',
  'aspect_ratio',
  'shared_fidelity',
  'negative_rules',
  'shelf_hero',
  'try_on',
  'detail_page',
  'ootd_scene',
  'pose_set',
  'douyin_video',
  'douyin_caption'
]);

const fail = (message) => errors.push(message);
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

if (pack.version !== 1) fail('version must be 1');
if (pack.kind !== 'APPAREL_AUTO_LAUNCH_PROMPT_PACK') fail('unexpected kind');
if (pack.status !== 'local-candidate') fail('candidate must not be marked published');
if (!isObject(pack.factExtraction) || typeof pack.factExtraction.prompt !== 'string' || !pack.factExtraction.prompt.trim()) {
  fail('factExtraction prompt is required');
}
if (!Array.isArray(pack.factExtraction?.outputSchema?.required) || pack.factExtraction.outputSchema.required.length < 10) {
  fail('factExtraction output schema is incomplete');
}
if (pack.promptBindings?.shared_fidelity !== 'sharedRules.fidelity' || pack.promptBindings?.negative_rules !== 'sharedRules.negative') {
  fail('shared prompt bindings are incomplete');
}
if (!Array.isArray(pack.workflows) || pack.workflows.length !== 2) fail('exactly two P0/P1 workflows are required');

const workflowById = new Map();
for (const workflow of pack.workflows ?? []) {
  if (workflowById.has(workflow.id)) fail(`duplicate workflow id: ${workflow.id}`);
  workflowById.set(workflow.id, workflow);
  if (!['P0', 'P1'].includes(workflow.priority)) fail(`${workflow.id}: invalid priority`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 6) fail(`${workflow.id}: too few nodes`);
  const nodeById = new Map();
  for (const node of workflow.nodes ?? []) {
    if (nodeById.has(node.id)) fail(`${workflow.id}: duplicate node id ${node.id}`);
    nodeById.set(node.id, node);
    if (!supportedTypes.has(node.type)) fail(`${workflow.id}/${node.id}: unsupported type`);
    if (node.role !== 'input' && !node.promptRef && !(typeof node.prompt === 'string' && node.prompt.trim())) {
      fail(`${workflow.id}/${node.id}: generation node has no prompt`);
    }
    if (typeof node.prompt === 'string') {
      if (forbidden.test(node.prompt)) fail(`${workflow.id}/${node.id}: forbidden secret or URL-like text`);
      for (const placeholder of node.prompt.matchAll(/\{\{([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+)?\}\}/g)) {
        if (!knownPlaceholderRoots.has(placeholder[1])) fail(`${workflow.id}/${node.id}: unknown placeholder ${placeholder[1]}`);
      }
    }
  }
  const indegree = new Map([...nodeById.keys()].map((id) => [id, 0]));
  const outgoing = new Map([...nodeById.keys()].map((id) => [id, []]));
  const incomingTypes = new Map([...nodeById.keys()].map((id) => [id, []]));
  for (const edge of workflow.edges ?? []) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      fail(`${workflow.id}: malformed edge`);
      continue;
    }
    const [from, to] = edge;
    if (!nodeById.has(from) || !nodeById.has(to)) {
      fail(`${workflow.id}: edge points to missing node ${from}->${to}`);
      continue;
    }
    outgoing.get(from).push(to);
    incomingTypes.get(to).push(nodeById.get(from).type);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift();
    visited += 1;
    for (const next of outgoing.get(current)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== nodeById.size) fail(`${workflow.id}: graph contains a cycle`);
  for (const node of workflow.nodes ?? []) {
    if (node.role !== 'input' && (incomingTypes.get(node.id)?.length ?? 0) === 0) {
      fail(`${workflow.id}/${node.id}: non-input node has no upstream dependency`);
    }
    for (const sourceType of incomingTypes.get(node.id) ?? []) {
      if (!inputMatrix[node.type]?.has(sourceType)) {
        fail(`${workflow.id}/${node.id}: ${node.type} cannot accept ${sourceType} input`);
      }
    }
  }
  const input = nodeById.get('upload_reference');
  if (!input || input.role !== 'input' || input.type !== 'image') fail(`${workflow.id}: upload_reference must be image input`);
  if (!workflow.edges.some(([from, to]) => from === 'upload_reference' && to === 'extract_product_facts')) {
    fail(`${workflow.id}: upload must feed fact extraction`);
  }
  const outputs = (workflow.nodes ?? []).filter((node) => node.role === 'output');
  if (!outputs.some((node) => node.type === 'image')) fail(`${workflow.id}: image output missing`);
  if (workflow.priority === 'P1' && !outputs.some((node) => node.type === 'video')) fail('P1: video output missing');
}

if (pack.orchestrator?.uploadOnce !== true) fail('orchestrator must upload once');
if (pack.orchestrator?.fanOutAfter !== 'extract_product_facts') fail('orchestrator fan-out point is invalid');
for (const ref of pack.orchestrator?.pipelineRefs ?? []) {
  if (!workflowById.has(ref)) fail(`orchestrator references missing workflow ${ref}`);
}
if (pack.orchestrator?.costPolicy?.neverAutoRetryPaidGeneration !== true) fail('paid auto-retry safety rule missing');

if (errors.length) {
  console.error(`FAIL ${path.relative(process.cwd(), file)}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS ${path.relative(process.cwd(), file)}`);
console.log(`P0/P1 workflows: ${pack.workflows.length}; orchestrator: ${pack.orchestrator.id}; paid auto-retry: disabled`);
