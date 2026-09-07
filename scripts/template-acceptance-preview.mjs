// Local manual acceptance only. Started by run-safe-tests.mjs acceptance.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createServer } from "vite";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Use run-safe-tests.mjs acceptance: missing ${name}`);
  return value;
};
if (required("UNBOUNDRY_SAFE_TEST") !== "1" ||
    required("UNBOUNDRY_TEST_TEMPLATE_ACCEPTANCE") !== "1" || process.versions.node !== "22.23.1") {
  throw new Error("Manual acceptance requires the isolated Node 22 safe runner");
}
const testRoot = realpathSync(required("UNBOUNDRY_TEST_ROOT"));
const sourceRoot = realpathSync(required("UNBOUNDRY_TEST_REPOSITORY_ROOT"));
const dataRoot = realpathSync(required("UNBOUNDRY_DATA_DIR"));
const systemRoot = realpathSync(required("UNBOUNDRY_SYSTEM_TEMPORARY_ROOT"));
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};
const sentinel = realpathSync(required("UNBOUNDRY_SAFE_RUN_SENTINEL"));
if (!inside(systemRoot, testRoot) || !inside(systemRoot, sourceRoot) ||
    !inside(testRoot, dataRoot) || !inside(testRoot, sentinel) ||
    readFileSync(sentinel, "utf8").trim() !== required("UNBOUNDRY_SAFE_RUN_NONCE") ||
    process.env.NODE_OPTIONS !== `--import=${join(sourceRoot, "scripts/offline-network-guard.mjs")}`) {
  throw new Error("Manual acceptance isolation contract is invalid");
}
const port = Number(required("UNBOUNDRY_TEST_PORT"));
if (!Number.isInteger(port) || port < 42000 || port > 60000 || port === 4173) {
  throw new Error("Manual acceptance requires a dynamic safe-runner port");
}
const origin = `http://127.0.0.1:${port}`;
const packagedVersion = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version;
const setupToken = randomUUID();
let adminCookie;
let ready = false;
let slow = false;
let graphReads = 0;
let toolsAvailable = false;
let maintenanceUntil = 0;
let demoVersion = "";
const updateStreams = new Set();
let finishSession;
const sessionFinished = new Promise((resolve) => { finishSession = resolve; });
const projects = [];
const mediaIds = [];
const operations = ["crop", "color-mark", "resize-pixels", "quick-split", "annotate", "save-to-library", "multi-angle", "redraw", "outpaint", "erase", "enhance-conservative", "enhance-creative", "remove-background", "seedance-validate", "download", "fullscreen", "lighting"];
const remoteOperations = new Set(["multi-angle", "redraw", "outpaint", "erase", "enhance-creative", "remove-background"]);
const fixtures = [];
const startedAt = new Date();
const expiresAt = new Date(startedAt.getTime() + 2 * 60 * 60_000);
const digest = (graph) => createHash("sha256").update(JSON.stringify(graph)).digest("hex");
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};
async function api(path, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "x-acceptance-setup": setupToken,
      ...(adminCookie ? { Cookie: adminCookie.split(";")[0] } : {}),
      ...(body ? { "Content-Type": Buffer.isBuffer(body) ? "image/png" : "application/json" } : {}),
    },
    ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Acceptance setup API ${path}: HTTP ${response.status}`);
  return response;
}

const guide = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剩余修复 · 本地验收</title>
<style>body{margin:0;background:#f5f5f5;color:#242424;font:16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:30px;margin:8px 0}h2{font-size:19px}p{color:#565656}section{background:white;border:1px solid #ddd;border-radius:14px;padding:22px;margin:18px 0}button,a.primary{font:inherit;display:inline-block;border:1px solid #aaa;border-radius:8px;padding:9px 16px;background:white;color:#222;cursor:pointer;text-decoration:none}a.primary{background:#222;color:#fff;border-color:#222}.badge{font-size:13px;letter-spacing:1px}li{margin:10px 0}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:10px;border-bottom:1px solid #eee;overflow-wrap:anywhere}.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}#result{overflow:auto}small{color:#777}button:focus-visible,a:focus-visible{outline:3px solid #555;outline-offset:3px}</style>
<main><span class="badge">本地验收 · 独立测试数据</span><h1>只需复验图片菜单遮挡</h1><p>你已确认其他项目通过。这次只检查图片顶部「浏览全部」菜单是否完整显示、能够点击。这里使用独立测试数据，修复尚未上线。</p>
<section><h2>本次检查这一个问题</h2><ol><li>打开测试画布，点击分组内的「图片裁剪与连线」，让顶部工具栏和下方输入框都出现。</li><li>点击顶部三点按钮「浏览全部」。检查菜单底部的「角色可信素材」「角色风险预检」「快速切分」：应显示在输入框上方，不能被盖住。</li><li>点击最下面可用的「快速切分」，应打开切分窗口；按 Esc 或窗口里的取消退出。再打开「浏览全部」，点击「调整像素」检查能打开并取消。</li><li>缩放、平移画布后再打开菜单。菜单项仍能看见和点击，取消后原图、节点位置和输入框保持正常。</li></ol><a id="canvas-link" class="primary" target="_blank" rel="noopener">打开测试画布</a><p><small>灰色项目表示功能当前不可用，仍应完整可见；本次不用提交生成、切分结果或修改图片。检查通过后，在对话里回复「菜单遮挡通过」。</small></p></section>
<details><summary>已通过项目和演示开关（无需重做）</summary><section><p>第1～5组，包括中文名称、模板筛选/保存、拖线菜单与稳定性、裁剪/工具、更新后文字保留、历史图片与速度，均已按你的确认记录通过。每日自动备份及视频、音频空按钮仍暂缓。</p><a class="primary" href="/canvas/projects" target="_blank" rel="noopener">打开工作空间</a> <a class="primary" href="/admin/templates" target="_blank" rel="noopener">打开模板管理</a><div class="tools"><button id="tools">切换图片工具状态</button><span id="tools-mode" role="status"></span></div><div class="tools"><button id="slow" aria-pressed="false">开启慢速演示</button><span id="mode" role="status">正常速度</span></div><button id="maintenance">模拟维护恢复</button><span id="maintenance-mode" role="status"></span></section><section><h2>模板保存核对（已通过，留作参考）</h2><button id="check">核对已保存内容</button><div id="result" role="status">点击按钮查看。</div></section></details><p id="expiry"></p><p><button id="finish">结束本次验收并清理测试数据</button></p></main>
<script>const slowButton=document.getElementById('slow'), mode=document.getElementById('mode');async function status(){const r=await fetch('/__acceptance/status');if(!r.ok)throw Error('验收服务已停止');const d=await r.json();slowButton.textContent=d.slow?'关闭慢速演示':'开启慢速演示';slowButton.setAttribute('aria-pressed',String(d.slow));mode.textContent=d.slow?'慢速演示已开启':'正常速度';document.getElementById('expiry').textContent='本次临时页面开放至 '+new Date(d.expiresAt).toLocaleTimeString('zh-CN')+'。到时自动关闭。';}slowButton.onclick=async()=>{slowButton.disabled=true;try{const r=await fetch('/__acceptance/toggle-slow',{method:'POST'});if(!r.ok)throw Error('切换失败');await status();}catch(e){mode.textContent=e.message;}finally{slowButton.disabled=false;}};document.getElementById('check').onclick=async()=>{const box=document.getElementById('result');box.textContent='正在读取…';try{const r=await fetch('/__acceptance/results');if(!r.ok)throw Error('读取失败');const d=await r.json();const table=document.createElement('table'),head=table.insertRow();['原模板','当前名称','当前说明','图内容'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);});d.items.forEach(item=>{const row=table.insertRow();[item.label,item.title??'模板未找到',item.description??'',item.graphUnchanged?'与初始相同，已保留':'与初始不同，请核对'].forEach(t=>row.insertCell().textContent=t);});box.replaceChildren(table);}catch(e){box.textContent=e.message;}};status().catch(e=>mode.textContent=e.message);</script><script>async function refreshScenarios(){const d=await(await fetch('/__acceptance/status')).json();document.getElementById('canvas-link').href=d.projects[1].url;document.getElementById('tools-mode').textContent=d.toolsAvailable?'可用入口演示（生成未开放）':'不可用演示';}async function toggleScenario(path,box,onSuccess){try{const r=await fetch(path,{method:'POST'});if(!r.ok)throw Error('切换失败，验收服务可能已停止');await onSuccess();}catch(e){document.getElementById(box).textContent=e.message;}}document.getElementById('tools').onclick=()=>toggleScenario('/__acceptance/toggle-tools','tools-mode',refreshScenarios);document.getElementById('maintenance').onclick=()=>toggleScenario('/__acceptance/toggle-maintenance','maintenance-mode',async()=>{document.getElementById('maintenance-mode').textContent='模拟维护中。请回到画布等待，开始后约35～65秒出现更新提示。';});refreshScenarios().catch(e=>document.getElementById('tools-mode').textContent=e.message);document.getElementById('finish').onclick=async()=>{const r=await fetch('/__acceptance/stop',{method:'POST'});if(r.ok)document.body.textContent='本次验收已结束。你可以关闭这些验收标签页；再次双击启动文件会准备一份新的测试数据。';};</script></html>`;

// A second restrictive policy also fences the user's unsandboxed browser.
const browserPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const plugin = {
  name: "isolated-template-manual-acceptance",
  enforce: "pre",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => originalSetHeader(name,
        name.toLowerCase() === "content-security-policy" ? [...(Array.isArray(value) ? value : [value]), browserPolicy] : value);
      originalSetHeader("Content-Security-Policy", browserPolicy);
      originalSetHeader("Cache-Control", "no-store");
      const url = new URL(req.url ?? "/", origin);
      if (req.headers.host !== `127.0.0.1:${port}` || url.origin !== origin ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers["sec-fetch-site"] === "cross-site") {
        json(res, 403, { error: "本地验收只接受本页请求" }); return;
      }
      const setup = req.headers["x-acceptance-setup"] === setupToken;
      const method = req.method ?? "GET";
      const templatePath = /^\/api\/admin\/templates(?:\/[a-f0-9-]+)?$/.test(url.pathname);
      const localEdit = templatePath ||
        (url.pathname === "/api/projects" && method === "POST") ||
        (/^\/api\/projects\/[a-z0-9._-]+(?:\/clone)?$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/(?:project-title|canvas)\/[a-z0-9._-]+$/i.test(url.pathname) && ["PUT", "DELETE"].includes(method)) ||
        (/^\/api\/canvases\/[a-z0-9._-]+\/commands$/i.test(url.pathname) && method === "POST") ||
        (/^\/api\/assets\/[a-z0-9._-]+$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/history\/[a-z0-9._-]+$/i.test(url.pathname) && method === "POST") ||
        (url.pathname === "/__acceptance/stop" && method === "POST") ||
        (/^\/__acceptance\/toggle-(?:slow|tools|maintenance)$/.test(url.pathname) && method === "POST");
      if (!setup && !["GET", "HEAD"].includes(method) && !localEdit) {
        json(res, 403, { error: "本地验收只开放测试数据编辑，生成与外部操作未开放" }); return;
      }
      if (!setup && url.pathname === "/api/updates" && method === "GET") {
        if (Date.now() < maintenanceUntil) {
          res.setHeader("Retry-After", "5"); json(res, 503, { error: "模拟维护中" }); return;
        }
        if (updateStreams.size >= 16) { json(res, 429, { error: "请关闭多余验收标签页" }); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`retry: 1000\ndata: ${JSON.stringify({ version: demoVersion || packagedVersion })}\n\n`);
        updateStreams.add(res);
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": acceptance heartbeat\n\n"); }, 15000);
        res.once("close", () => { clearInterval(heartbeat); updateStreams.delete(res); });
        return;
      }
      if (!setup && url.pathname === "/api/image-tools/capabilities" && method === "GET") {
        json(res, 200, { generatedAt: new Date().toISOString(), revision: toolsAvailable ? "aaaaaaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbbbbbb", operations: operations.map((operation) => ({
          operation, status: operation === "lighting" ? "paused" : !remoteOperations.has(operation) || toolsAvailable ? "available" : "unavailable",
          reason: operation === "lighting" ? "打光仍暂停" : !remoteOperations.has(operation) ? "本地工具可用" : toolsAvailable ? "验收演示：入口可打开，生成未开放" : "验收演示：图片工具暂不可用",
          reasonCode: operation === "lighting" ? "PAUSED_BY_SCOPE" : !remoteOperations.has(operation) || toolsAvailable ? "AVAILABLE" : "PROVIDER_UNAVAILABLE",
          expiresAt: new Date(Date.now() + 300000).toISOString(), maximumInputBytes: 20 * 1024 * 1024,
          maximumInputPixels: 4096 * 4096, outputContentTypes: ["image/png"], supportsAlpha: true, supportsMask: true, supportsReferenceImage: true,
        })) }); return;
      }
      if (url.pathname.startsWith("/__acceptance")) {
        void (async () => {
          if (!ready) { json(res, 503, { error: "正在准备测试模板" }); return; }
          if (url.pathname === "/__acceptance" && method === "GET") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": adminCookie, "Cache-Control": "no-store" });
            res.end(guide); return;
          }
          if (url.pathname === "/__acceptance/status" && method === "GET") {
            json(res, 200, { slow, toolsAvailable, maintenanceUntil, projects, expiresAt: expiresAt.toISOString() }); return;
          }
          if (url.pathname === "/__acceptance/stop" && method === "POST") {
            json(res, 200, { stopped: true }); finishSession(); return;
          }
          if (url.pathname === "/__acceptance/toggle-slow" && method === "POST") {
            slow = !slow; graphReads = 0;
            json(res, 200, { slow }); return;
          }
          if (url.pathname === "/__acceptance/toggle-tools" && method === "POST") {
            toolsAvailable = !toolsAvailable; json(res, 200, { toolsAvailable }); return;
          }
          if (url.pathname === "/__acceptance/toggle-maintenance" && method === "POST") {
            maintenanceUntil = Date.now() + 35000;
            demoVersion = `${packagedVersion}-local-acceptance`;
            for (const stream of [...updateStreams]) stream.end();
            json(res, 200, { maintenanceUntil }); return;
          }
          if (url.pathname === "/__acceptance/results" && method === "GET") {
            const items = await Promise.all(fixtures.map(async (fixture) => {
              const item = (await (await api(`/api/admin/templates/${fixture.id}`)).json()).template;
              return { label: fixture.label, title: item?.title, description: item?.description,
                graphUnchanged: Boolean(item?.graph && digest(item.graph) === fixture.graphHash) };
            }));
            json(res, 200, { items }); return;
          }
          json(res, 404, { error: "验收入口不存在" });
        })().catch((error) => {
          console.error(error);
          if (!res.headersSent) json(res, 500, { error: "验收辅助读取失败" });
          else res.end();
        });
        return;
      }
      if (!setup && slow && (templatePath || url.pathname.startsWith("/api/image-edit-sources/"))) {
        const delay = method === "GET" && (/^\/api\/admin\/templates\/[a-f0-9-]+$/.test(url.pathname) || url.pathname.startsWith("/api/image-edit-sources/"))
          ? (++graphReads % 2 === 1 ? 6000 : 1000)
          : ["POST", "PATCH", "DELETE"].includes(method) ? 3000 : 0;
        if (delay) { setTimeout(() => { if (!res.destroyed) next(); }, delay); return; }
      }
      next();
    });
  },
};

const server = await createServer({
  configFile: join(sourceRoot, "vite.config.ts"),
  plugins: [plugin],
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, open: false },
});
let stopping;
async function stop() {
  if (!stopping) {
    for (const stream of [...updateStreams]) stream.end();
    stopping = server.close();
  }
  await stopping;
}
process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
try {
  await server.listen();
  const bootstrap = await api("/api/auth/bootstrap", "POST", {
    displayName: "本地验收管理员", loginName: "acceptance", password: `local-${randomUUID()}`,
  });
  adminCookie = bootstrap.headers.get("set-cookie");
  if (!adminCookie) throw new Error("Temporary admin session was not created");
  const simpleGraph = (marker) => ({ version: 1, nodes: [{ id: `text-${marker}`, type: "text", position: { x: 350, y: 160 }, data: { title: marker, label: "Text", textPrompt: `这是${marker}的独立图内容` }, style: { width: 250, height: 250 } }], edges: [] });
  for (let index = 1; index <= 201; index += 1) {
    await api("/api/admin/templates", "POST", { title: `分页验收${String(index).padStart(3, "0")}`, graph: simpleGraph(`page-${index}`), status: "draft" });
  }
  for (const title of ["验收项目 · 可改中文名", "验收画布 · 文本图片与分组"]) {
    const item = await (await api("/api/projects", "POST", { title })).json();
    projects.push({ id: item.id, title, url: `/canvas/${item.id}` });
  }
  const png = readFileSync(join(sourceRoot, "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png"));
  for (let index = 1; index <= 27; index += 1) {
    const id = `acceptance-image-${index}.png`;
    await api(`/api/assets/${id}`, "POST", png);
    mediaIds.push(id);
    await api("/api/history/local-user", "POST", { id, kind: "image", label: `验收图片 ${index}`, preview: `/api/assets/${id}` });
  }
  const canvasId = projects[1].id;
  const baseline = await (await api(`/api/canvas/${canvasId}`)).json();
  const imageId = mediaIds[0];
  await api(`/api/canvas/${canvasId}`, "PUT", {
    revision: baseline.revision, observedRevision: baseline.revision, observedLoadToken: baseline.loadToken,
    saveAttemptId: randomUUID(), saveSequence: 1, saveSessionId: randomUUID(), viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "acceptance-group", type: "group", position: { x: 200, y: 180 }, data: { label: "Group", title: "分组连线验收" }, style: { width: 520, height: 360 } },
      { id: "acceptance-group-image", type: "image", parentId: "acceptance-group", extent: "parent", position: { x: 90, y: 75 },
        data: { label: "Image", title: "图片裁剪与连线", assetId: imageId, imageSrc: `/api/assets/${imageId}`, sourceKind: "image", imagePromptReady: true, mediaSizingMode: "manual" },
        style: { width: 300, height: 169 } },
    ], edges: [],
  });
  for (const [letter, fruit] of [["A", "苹果"], ["B", "香蕉"]]) {
    const graph = { version: 1, nodes: [{
      id: `acceptance-${letter}`, type: "text", position: { x: 0, y: 0 },
      data: { title: `${letter} 的${fruit}`, textPrompt: `这是模板 ${letter} 的${fruit}内容。保存其他模板时，这段内容应该保留。`, label: "Text" },
      style: { width: 320, height: 220 },
    }], edges: [] };
    const response = await api("/api/admin/templates", "POST", {
      title: `验收 ${letter} · ${fruit}`, description: `这是 ${letter} 的${fruit}模板，请只用于本地验收。`, category: ["工具"], graph,
    });
    const { template } = await response.json();
    fixtures.push({ id: template.id, label: `${letter} · ${fruit}`, graphHash: digest(template.graph) });
  }
  ready = true;
  const receipt = { status: "USER_RECHECK", url: `${origin}/__acceptance`, appUrl: `${origin}/admin/templates`,
    expiresAt: expiresAt.toISOString(), pid: process.pid, dataRoot, fixtures, projects, mediaIds,
    appSha256: createHash("sha256").update(readFileSync(join(sourceRoot, "client/src/App.tsx"))).digest("hex") };
  writeFileSync(join(testRoot, "manual-acceptance.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`[manual-acceptance-ready] ${JSON.stringify(receipt)}`);
  let expiryTimer;
  await Promise.race([
    sessionFinished,
    new Promise((resolve) => { expiryTimer = setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now())); }),
  ]);
  clearTimeout(expiryTimer);
} finally {
  await stop();
}
// Vite's denied wildcard capability probe leaves the offline guard exit code
// set. The owning runner independently audits every network attempt before
// accepting this successful, fully closed session (as for the signal path).
process.exit(0);
