import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { composeTextControl } from "./helpers/ime";

type Bounds = [number, number, number, number];

async function expectRectanglesNotToIntersect(first: Locator, second: Locator) {
  const [firstBounds, secondBounds] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
  ]);
  expect(firstBounds).not.toBeNull();
  expect(secondBounds).not.toBeNull();
  const overlapWidth = Math.max(
    0,
    Math.min(
      firstBounds!.x + firstBounds!.width,
      secondBounds!.x + secondBounds!.width,
    ) - Math.max(firstBounds!.x, secondBounds!.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(
      firstBounds!.y + firstBounds!.height,
      secondBounds!.y + secondBounds!.height,
    ) - Math.max(firstBounds!.y, secondBounds!.y),
  );
  expect(overlapWidth * overlapHeight).toBe(0);
}

type ShellFixture = {
  id: string;
  state: {
    pageOverflow: string;
    canvasRole: string;
    canvasCursor: string;
    placeholderVisible: boolean;
  };
  elements: Record<string, Bounds>;
};

type ResponsiveBaseline = {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  screenshot: string;
  elements: Record<string, Bounds>;
};

type NodeSearchFixture = {
  id: string;
  elements: {
    modal: Bounds;
  };
  placeholder: string;
  description: string;
  categories: string[];
  emptyText: string;
  heightRule: {
    noMatchText: string;
    oneTextResult: Bounds;
  };
};

type AssetsFixture = {
  id: string;
  elements: {
    panel: Bounds;
    search: Bounds;
  };
  tabs: string[];
  folders: string[];
  emptyText: string;
};

type AiCharactersFixture = {
  id: string;
  layout: {
    columns: number;
    loadedCards: number;
  };
  categories: string[];
  filters: Record<string, string[]>;
  footer: string;
};

type TemplatesFixture = {
  id: string;
  elements: {
    panel: Bounds;
    firstUseNotice: Bounds;
    browseAll: Bounds;
  };
  tabs: string[];
  cardColumns: number;
};

type HistoryFixture = {
  id: string;
  elements: {
    panel: Bounds;
    browseAll: Bounds;
  };
  counts: Record<"image" | "video" | "audio" | "world3d", number>;
};

type ProjectMenuFixture = {
  id: string;
  elements: {
    menu: Bounds;
  };
  style: {
    background: string;
    borderRadius: number;
    padding: number;
  };
  items: string[];
};

type ShareFixture = {
  id: string;
  elements: {
    popover: Bounds;
  };
  actions: Array<{
    name: string;
    button: string;
  }>;
};

type KeyboardShortcutsFixture = {
  id: string;
  elements: {
    modal: Bounds;
  };
  columns: number;
  shortcuts: Record<string, string>;
};

type BlankContextMenuFixture = {
  id: string;
  elements: {
    menu: Bounds;
    list: Bounds;
  };
  items: string[];
  disabled: string[];
};

type NodeContextMenuFixture = {
  id: string;
  elements: {
    menu: Bounds;
    list: Bounds;
  };
  items: string[];
  disabledInPrivateFixture: string[];
};

const testIds: Record<string, string> = {
  projectArea: "project-area",
  logoButton: "logo-button",
  titleInput: "title-input",
  topRight: "top-right",
  share: "share",
  leftToolbar: "left-toolbar",
  addNode: "add-node",
  nodeSearch: "node-search",
  assets: "assets",
  templates: "templates",
  history: "history",
  userAvatar: "user-avatar",
  emptyQuickActions: "empty-quick-actions",
  quickActionBadge: "quick-action-badge",
  textToVideo: "quick-text-video",
  replaceBackground: "quick-replace-background",
  firstLastFrameVideo: "quick-first-last-video",
  audioToVideo: "quick-audio-video",
  quickTemplate: "quick-template",
  bottomControls: "bottom-controls",
  minimapToggle: "minimap-toggle",
  snapToggle: "snap-toggle",
  fitView: "fit-view",
  zoomTrack: "zoom-track",
  help: "help",
  agentBubble: "agent-bubble",
};

async function loadShellFixture(): Promise<ShellFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: ShellFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "shell.empty.primary",
  );

  if (!fixture) {
    throw new Error("shell.empty.primary fixture is missing");
  }

  return fixture;
}

async function loadResponsiveBaselines(): Promise<ResponsiveBaseline[]> {
  const source = JSON.parse(
    await readFile("spec/m0-shell-responsive-baseline.json", "utf8"),
  ) as { viewports: ResponsiveBaseline[] };

  return source.viewports;
}

async function loadNodeSearchFixture(): Promise<NodeSearchFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: NodeSearchFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "modal.node-search.empty",
  );

  if (!fixture) {
    throw new Error("modal.node-search.empty fixture is missing");
  }

  return fixture;
}

async function loadAssetsFixture(): Promise<AssetsFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: AssetsFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "panel.assets.personal-empty",
  );

  if (!fixture) {
    throw new Error("panel.assets.personal-empty fixture is missing");
  }

  return fixture;
}

async function loadAiCharactersFixture(): Promise<AiCharactersFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: AiCharactersFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "overlay.ai-characters.loaded",
  );

  if (!fixture) {
    throw new Error("overlay.ai-characters.loaded fixture is missing");
  }

  return fixture;
}

async function loadTemplatesFixture(): Promise<TemplatesFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: TemplatesFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "panel.templates.public",
  );

  if (!fixture) {
    throw new Error("panel.templates.public fixture is missing");
  }

  return fixture;
}

async function loadHistoryFixture(): Promise<HistoryFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: HistoryFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "panel.history.final",
  );

  if (!fixture) {
    throw new Error("panel.history.final fixture is missing");
  }

  return fixture;
}

async function loadProjectMenuFixture(): Promise<ProjectMenuFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: ProjectMenuFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "menu.project",
  );

  if (!fixture) {
    throw new Error("menu.project fixture is missing");
  }

  return fixture;
}

async function loadShareFixture(): Promise<ShareFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: ShareFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "popover.share",
  );

  if (!fixture) {
    throw new Error("popover.share fixture is missing");
  }

  return fixture;
}

async function loadKeyboardShortcutsFixture(): Promise<KeyboardShortcutsFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: KeyboardShortcutsFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "modal.keyboard-shortcuts",
  );

  if (!fixture) {
    throw new Error("modal.keyboard-shortcuts fixture is missing");
  }

  return fixture;
}

async function loadBlankContextMenuFixture(): Promise<BlankContextMenuFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: BlankContextMenuFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "menu.canvas-context.blank",
  );

  if (!fixture) {
    throw new Error("menu.canvas-context.blank fixture is missing");
  }

  return fixture;
}

async function loadNodeContextMenuFixture(): Promise<NodeContextMenuFixture> {
  const source = JSON.parse(
    await readFile("spec/unboundry-state-fixtures.json", "utf8"),
  ) as { fixtures: NodeContextMenuFixture[] };
  const fixture = source.fixtures.find(
    (candidate) => candidate.id === "menu.canvas-context.node",
  );

  if (!fixture) {
    throw new Error("menu.canvas-context.node fixture is missing");
  }

  return fixture;
}

test("shell.empty.primary stays within the 1px coordinate contract", async ({
  page,
}) => {
  const fixture = await loadShellFixture();

  await page.goto(`/__fixture/${fixture.id}`);
  await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
    "data-fixture-ready",
    "true",
  );

  for (const [elementName, expectedBounds] of Object.entries(fixture.elements)) {
    const testId = testIds[elementName];
    if (!testId) {
      continue;
    }

    const actual = await page.getByTestId(testId).boundingBox();
    expect(actual, `${elementName} should be visible`).not.toBeNull();

    const [x, y, width, height] = expectedBounds;
    expect(Math.abs(actual!.x - x), `${elementName}.x`).toBeLessThanOrEqual(1);
    expect(Math.abs(actual!.y - y), `${elementName}.y`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(actual!.width - width),
      `${elementName}.width`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(actual!.height - height),
      `${elementName}.height`,
    ).toBeLessThanOrEqual(1);
  }

  await expect(page.locator("html")).toHaveCSS("overflow", fixture.state.pageOverflow);
  await expect(page.locator("body")).toHaveCSS("overflow", fixture.state.pageOverflow);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "role",
    fixture.state.canvasRole,
  );
  await expect(page.getByTestId("canvas-world")).toHaveCSS(
    "cursor",
    fixture.state.canvasCursor,
  );
  await expect(
    page.getByTestId("quick-action-badge").locator("svg"),
  ).toHaveAttribute("viewBox", "0 0 20 20");
  await expect(
    page.getByTestId("quick-action-badge").locator('path[fill="#1fa2dc"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("bottom-controls")).toHaveCSS(
    "border-radius",
    "16px",
  );
  await expect(page.getByTestId("minimap-toggle")).toHaveCSS(
    "border-radius",
    "12px",
  );
  const zoomTrack = page.getByTestId("zoom-track");
  const zoomFill = zoomTrack.locator(".zoom-track-fill");
  const zoomThumb = page.getByTestId("zoom-thumb");
  expect((await zoomFill.boundingBox())!.width).toBeCloseTo(35.38, 1);
  expect((await zoomThumb.boundingBox())!.x).toBeCloseTo(159.03, 1);
  await expect(zoomThumb).toHaveCSS("width", "16px");
  await expect(zoomThumb).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("help").locator("svg")).toHaveCSS(
    "width",
    "24px",
  );
  await expect(page.getByTestId("credits")).toHaveCount(0);
  await expect(page.getByTestId("share").locator("path")).toHaveAttribute(
    "d",
    /M6 12m-3 0/,
  );
  await expect(page.getByTestId("agent-bubble").locator(".agent-orb")).toHaveCSS(
    "width",
    "32px",
  );
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible({
    visible: fixture.state.placeholderVisible,
  });
});

test("grid and shell tokens match the frozen state", async ({ page }) => {
  await page.goto("/__fixture/shell.empty.primary");
  await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
    "data-fixture-ready",
    "true",
  );

  await expect(page.getByTestId("canvas-world")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  const grid = page.locator(".canvas-grid");
  await expect(grid.locator("pattern")).toHaveAttribute("width", "20");
  await expect(grid.locator("pattern")).toHaveAttribute("height", "20");
  await expect(grid.locator("circle")).toHaveAttribute("r", "0.5");
});

test("add-node button and blank double click open the same safe menu", async ({
  page,
}) => {
  await page.goto("/__fixture/menu.add-node.double-click");

  await page.getByTestId("add-node").click();
  const menu = page.getByTestId("add-node-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").allTextContents()).resolves.toEqual([
    "文本",
    "图片",
    "视频",
    "音频",
    "3D 世界",
    "播放列表",
    "上传",
  ]);
  await expect(
    menu.getByRole("menuitem", { name: "3D 世界", exact: true }),
  ).toBeDisabled();
  await expect(menu.getByRole("menuitem").first()).toHaveCSS(
    "height",
    "52px",
  );

  await page.getByTestId("add-node").click();
  await expect(menu).toHaveCount(0);
  await page
    .getByTestId("canvas-world")
    .dblclick({ position: { x: 499, y: 300 } });
  await expect(page.getByTestId("add-node-menu")).toBeVisible();
  expect(await page.getByTestId("add-node-menu").boundingBox()).toMatchObject({
    x: 499,
    y: 300,
  });
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
});

test("node search empty modal matches the frozen dimensions and content", async ({
  page,
}) => {
  const fixture = await loadNodeSearchFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const dialog = page.getByRole("dialog", { name: "节点搜索" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(fixture.description);
  const actual = await dialog.boundingBox();
  expect(actual).not.toBeNull();
  const [x, y, width, height] = fixture.elements.modal;
  expect(actual!.x).toBeCloseTo(x, 1);
  expect(actual!.y).toBeCloseTo(y, 1);
  expect(actual!.width).toBeCloseTo(width, 1);
  expect(actual!.height).toBeCloseTo(height, 1);

  const input = page.getByRole("searchbox", { name: fixture.placeholder });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", fixture.placeholder);
  await expect(
    dialog.locator(".node-search-categories button").allTextContents(),
  ).resolves.toEqual(fixture.categories);
  await expect(
    dialog.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-search-empty")).toHaveText(
    fixture.emptyText,
  );

  await input.fill("不存在的节点");
  await expect(page.getByTestId("node-search-empty")).toHaveText(
    fixture.heightRule.noMatchText,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("node-search").click();
  await expect(dialog).toBeVisible();
});

test("node search matches title, Prompt and body then locates the result", async ({
  page,
}) => {
  const fixture = await loadNodeSearchFixture();

  await page.goto("/__fixture/interaction.node-search.populated");
  const world = page.getByTestId("canvas-world");
  const initialZoom = await world.getAttribute("data-viewport-zoom");
  await page.mouse.move(900, 700);
  await page.mouse.wheel(600, 400);
  await expect
    .poll(async () => {
      const x = Number(await world.getAttribute("data-viewport-x"));
      const y = Number(await world.getAttribute("data-viewport-y"));
      return x < 0 && y < 0;
    })
    .toBe(true);
  await expect(world).toHaveAttribute("data-viewport-zoom", initialZoom!);
  await page.getByTestId("node-search").click();
  const dialog = page.getByRole("dialog", { name: "节点搜索" });
  const input = page.getByRole("searchbox", { name: fixture.placeholder });
  await input.fill("红色方块海报");
  const imageResult = page
    .getByTestId("node-search-results")
    .getByRole("button", { name: /红色方块海报 A solid red square/ });
  await expect(imageResult).toBeVisible();
  expect(await dialog.boundingBox()).toMatchObject({
    height: fixture.heightRule.oneTextResult[3],
    width: fixture.heightRule.oneTextResult[2],
  });
  await input.fill("solid red square");
  await expect(imageResult).toBeVisible();
  await dialog.getByRole("button", { name: "视频", exact: true }).click();
  await expect(page.getByTestId("node-search-empty")).toHaveText(
    fixture.heightRule.noMatchText,
  );
  await dialog.getByRole("button", { name: "图片", exact: true }).click();
  await expect(imageResult).toBeVisible();
  await dialog.getByRole("button", { name: "全部", exact: true }).click();
  await input.fill("晨光城市");
  const bodyResult = page
    .getByTestId("node-search-results")
    .getByRole("button", { name: /品牌故事文案.*晨光城市/ });
  await expect(bodyResult).toBeVisible();
  await bodyResult.click();
  await expect(world).toHaveAttribute(
    "data-primary-node",
    "search-text",
  );
  const locatedNode = await page
    .locator('.react-flow__node[data-id="search-text"]')
    .boundingBox();
  const worldBounds = await world.boundingBox();
  expect(locatedNode).not.toBeNull();
  expect(worldBounds).not.toBeNull();
  expect(locatedNode!.x + locatedNode!.width / 2).toBeCloseTo(
    worldBounds!.x + worldBounds!.width / 2,
    0,
  );
  expect(locatedNode!.y + locatedNode!.height / 2).toBeCloseTo(
    worldBounds!.y + worldBounds!.height / 2,
    0,
  );
});

test("asset library keeps its frozen size and internal layout beside the persistent Dock", async ({
  page,
}) => {
  const fixture = await loadAssetsFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const panel = page.getByTestId("assets-panel");
  await expect(panel).toBeVisible();
  const panelBounds = await panel.boundingBox();
  const [panelX, panelY, panelWidth, panelHeight] = fixture.elements.panel;
  const dockBounds = await page.getByTestId("left-toolbar").boundingBox();
  expect(panelBounds).toMatchObject({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
  });
  expect(dockBounds!.x - (panelBounds!.x + panelBounds!.width)).toBe(6);

  const search = page.getByTestId("assets-search");
  const searchBounds = await search.boundingBox();
  const [searchX, searchY, searchWidth, searchHeight] =
    fixture.elements.search;
  expect(Math.abs(searchBounds!.x - searchX)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBounds!.y - searchY)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBounds!.width - searchWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBounds!.height - searchHeight)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("searchbox", { name: "搜索" })).toHaveAttribute(
    "placeholder",
    "搜索",
  );
  await expect(
    page.getByTestId("assets-tabs").getByRole("tab").allTextContents(),
  ).resolves.toEqual(fixture.tabs);
  await expect(panel.getByText(fixture.emptyText, { exact: true })).toBeVisible();
  for (const folder of fixture.folders) {
    await expect(
      panel.getByRole("button", { name: folder, exact: true }),
    ).toBeVisible();
  }
  await expect(
    panel.getByRole("button", { name: "主体库", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "AI 角色" })).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "新建文件夹" }),
  ).toBeDisabled();

  await panel.getByRole("tab", { name: "团队" }).click();
  await expect(panel.getByRole("tab", { name: "团队" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("searchbox", { name: "搜索" }).fill("场景");
  await expect(
    panel.getByRole("button", { name: "场景", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "角色", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "关闭素材库" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("assets").click();
  await expect(panel).toBeVisible();
});

test("AI character library matches categories, filters, grid and loading", async ({
  page,
}) => {
  const fixture = await loadAiCharactersFixture();
  let providerRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      /provider|generate|generation/i.test(request.url())
    ) {
      providerRequests += 1;
    }
  });
  await page.goto(`/__fixture/${fixture.id}`);

  const overlay = page.getByTestId("ai-characters-overlay");
  await expect(overlay).toBeVisible();
  expect(await overlay.boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: 1135,
    height: 917,
  });
  await expect(
    overlay
      .getByRole("navigation", { name: "角色分类" })
      .getByRole("button")
      .locator("span")
      .allTextContents(),
  ).resolves.toEqual(fixture.categories);
  await expect(
    overlay.getByLabel("角色筛选").locator(":scope > div > button")
      .allTextContents(),
  ).resolves.toEqual(Object.keys(fixture.filters).map((filter) => `＋${filter}`));

  const grid = page.getByTestId("ai-character-grid");
  await expect(page.getByTestId("ai-character-card")).toHaveCount(
    fixture.layout.loadedCards,
  );
  expect(
    (await grid.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" "),
    )).length,
  ).toBe(fixture.layout.columns);

  await overlay.getByRole("button", { name: "性别", exact: true }).click();
  const genderMenu = overlay.getByLabel("性别筛选");
  await expect(
    genderMenu.getByRole("checkbox").allTextContents(),
  ).resolves.toEqual(["", "", ""]);
  await expect(
    genderMenu.locator("label span").allTextContents(),
  ).resolves.toEqual(fixture.filters["性别"]);
  await genderMenu.getByRole("checkbox", { name: "男" }).check();
  const filteredCount = await page.getByTestId("ai-character-card").count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThan(fixture.layout.loadedCards);

  await page.reload();
  await expect(overlay).toBeVisible();
  const loadMore = overlay.getByRole("button", {
    name: fixture.footer,
    exact: true,
  });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect(page.getByTestId("ai-character-card")).toHaveCount(80);
  expect(providerRequests).toBe(0);

  await overlay.getByRole("button", { name: "关闭 AI角色库" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByTestId("assets-panel")).toBeVisible();
  await page.getByTestId("assets-panel").getByRole("button", {
    name: "AI 角色",
  }).click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

test("workflow templates match panel, notice, tabs and browse-all states", async ({
  page,
}) => {
  const fixture = await loadTemplatesFixture();
  let providerRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      /provider|generate|generation|workflow\/apply/i.test(request.url())
    ) {
      providerRequests += 1;
    }
  });
  await page.goto(`/__fixture/${fixture.id}`);

  const panel = page.getByTestId("templates-panel");
  const notice = page.getByTestId("template-first-notice");
  await expect(panel).toBeVisible();
  await expect(notice).toBeVisible();

  for (const [element, expected] of [
    [panel, fixture.elements.panel],
    [notice, fixture.elements.firstUseNotice],
  ] as const) {
    const actual = await element.boundingBox();
    expect(actual).not.toBeNull();
    for (let index = 0; index < 4; index += 1) {
      expect(Math.abs(
        [actual!.x, actual!.y, actual!.width, actual!.height][index] -
          expected[index],
      )).toBeLessThanOrEqual(1);
    }
  }

  await expect(
    page.getByTestId("templates-tabs").getByRole("tab").allTextContents(),
  ).resolves.toEqual(fixture.tabs);
  const grid = page.getByTestId("templates-grid");
  expect(
    (await grid.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" "),
    )).length,
  ).toBe(fixture.cardColumns);
  await expect(
    panel.getByRole("searchbox", { name: "搜索资产包..." }),
  ).toHaveAttribute("placeholder", "搜索资产包...");

  await notice.getByRole("button", { name: "知道了" }).click();
  await expect(notice).toHaveCount(0);
  await panel.getByRole("tab", { name: "我的模板" }).click();
  await expect(panel.getByText("暂无我的模板", { exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "公共模板" }).click();
  await panel.getByRole("searchbox", { name: "搜索资产包..." }).fill("电商");
  await expect(panel.getByText("电商详情页工作流", { exact: true })).toBeVisible();
  await expect(panel.getByText("213.电商图片生成专家", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "浏览全部" }).click();
  const browser = page.getByTestId("template-browser");
  await expect(browser).toBeVisible();
  const browserBounds = await browser.boundingBox();
  const [x, y, width, height] = fixture.elements.browseAll;
  expect(Math.abs(browserBounds!.x - x)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.y - y)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.width - width)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.height - height)).toBeLessThanOrEqual(1);
  await expect(
    browser.getByRole("navigation", { name: "模板分类" }),
  ).toContainText("最近使用");
  await expect(
    browser.getByRole("button", { name: "创建" }),
  ).toBeDisabled();
  await browser
    .getByRole("button", { name: "关闭全部模板" })
    .click();
  await expect(browser).toHaveCount(0);
  expect(providerRequests).toBe(0);

  await page.getByTestId("templates").click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("quick-template").click();
  await expect(panel).toBeVisible();
});

test("history media tabs, counts, browse-all zoom and sorting match", async ({
  page,
}) => {
  const fixture = await loadHistoryFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const panel = page.getByTestId("history-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("history-count-image")).toHaveText(
    String(fixture.counts.image),
  );
  await expect(page.getByTestId("history-count-video")).toHaveText(
    String(fixture.counts.video),
  );
  await expect(page.getByTestId("history-count-audio")).toHaveText(
    String(fixture.counts.audio),
  );
  await expect(page.getByTestId("history-count-world3d")).toHaveText(
    String(fixture.counts.world3d),
  );
  const panelBounds = await panel.boundingBox();
  const [panelX, panelY, panelWidth, panelHeight] = fixture.elements.panel;
  expect(panelBounds).toMatchObject({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
  });
  await expect(panel.getByText("2026-07-27", { exact: true })).toBeVisible();
  await expect(panel.getByText("2026-07-23", { exact: true })).toBeVisible();

  await panel.getByRole("tab", { name: /视频历史/ }).click();
  await expect(panel.getByRole("button", { name: "视频 1" })).toBeVisible();
  await panel.getByRole("tab", { name: /音频/ }).click();
  await expect(panel.locator(".history-card")).toHaveCount(
    fixture.counts.audio,
  );
  await panel.getByRole("tab", { name: /图片历史/ }).click();

  await panel.getByRole("button", { name: "浏览全部历史" }).click();
  const browser = page.getByTestId("history-browser");
  await expect(browser).toBeVisible();
  const browserBounds = await browser.boundingBox();
  const [x, y, width, height] = fixture.elements.browseAll;
  expect(Math.abs(browserBounds!.x - x)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.y - y)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.width - width)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserBounds!.height - height)).toBeLessThanOrEqual(1);
  await expect(
    browser.getByRole("navigation", { name: "历史素材类型" }),
  ).toContainText("图片历史");

  const firstCard = browser.locator(".history-card").first();
  expect((await firstCard.boundingBox())!.width).toBe(120);
  await browser.getByRole("button", { name: "放大历史缩略图" }).click();
  expect((await firstCard.boundingBox())!.width).toBe(130);
  await expect(
    browser.locator(".history-browser-date-group h3").first(),
  ).toHaveText("2026-07-27");
  await browser
    .getByRole("button", { name: "当前最新在前，点击改为最早在前" })
    .click();
  await expect(
    browser.locator(".history-browser-date-group h3").first(),
  ).toHaveText("2026-07-23");
  await browser.getByRole("button", { name: "关闭全部历史" }).click();
  await expect(browser).toHaveCount(0);

  await panel.getByRole("button", { name: "浏览全部历史" }).click();
  await expect(browser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browser).toHaveCount(0);
});

test("project menu keeps only the current private-project actions", async ({
  page,
  request,
}) => {
  const fixture = await loadProjectMenuFixture();
  const previousTitleResponse = await request.get(
    `/api/project-title/${fixture.id}`,
  );
  const previousTitle = previousTitleResponse.ok()
    ? ((await previousTitleResponse.json()) as {
        title: string;
        updatedAt: number;
      })
    : undefined;
  await request.delete(`/api/project-title/${fixture.id}`);
  await page.goto(`/__fixture/${fixture.id}`);
  await page.evaluate((id) => {
    localStorage.removeItem(`unboundry-project-title:${id}`);
  }, fixture.id);
  await page.reload();

  const menu = page.getByTestId("project-menu");
  await expect(menu).toHaveCount(0);
  await page.getByTestId("logo-button").click();
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  const [x, y, width, height] = fixture.elements.menu;
  expect(menuBounds).toMatchObject({ x, y, width, height });
  await expect(menu).toHaveCSS("background-color", "rgb(38, 38, 38)");
  await expect(menu).toHaveCSS(
    "border-radius",
    `${fixture.style.borderRadius}px`,
  );
  await expect(menu).toHaveCSS("padding", `${fixture.style.padding}px`);
  await expect(menu.getByRole("button").allTextContents()).resolves.toEqual(
    fixture.items,
  );
  await expect(menu.getByRole("button", { name: "重命名" })).toBeEnabled();
  await expect(menu.getByRole("button", { name: "新建项目", exact: true }))
    .toBeEnabled();
  await expect(menu.getByRole("button", { name: "删除", exact: true }))
    .toBeDisabled();

  await menu.getByRole("button", { name: "重命名" }).click();
  const title = page.getByTestId("title-input");
  await expect(menu).toHaveCount(0);
  await expect(title).toBeFocused();
  expect(await title.evaluate(
    (input) => [
      (input as HTMLInputElement).selectionStart,
      (input as HTMLInputElement).selectionEnd,
    ],
  )).toEqual([0, "Codex Unboundry G0.2 Sandbox 0727".length]);

  await page.getByTestId("logo-button").click();
  await expect(menu).toBeVisible();
  await page.getByTestId("canvas-world").click({ position: { x: 600, y: 400 } });
  await expect(menu).toHaveCount(0);
  await page.getByTestId("logo-button").click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("logo-button")).toBeFocused();

  await page.getByTestId("logo-button").click();
  await menu.getByRole("button", { name: "重命名" }).click();
  await title.fill("中文画布名称直接刷新");
  await page.reload();
  await expect(menu).toHaveCount(0);
  await expect(title).toHaveValue("中文画布名称直接刷新");
  await expect.poll(async () => {
    const response = await request.get(`/api/project-title/${fixture.id}`);
    if (!response.ok()) return "";
    return ((await response.json()) as { title: string }).title;
  }).toBe("中文画布名称直接刷新");
  if (previousTitle) {
    await request.put(`/api/project-title/${fixture.id}`, {
      data: {
        title: previousTitle.title,
        updatedAt: Date.now(),
      },
    });
  } else {
    await request.delete(`/api/project-title/${fixture.id}`);
  }
});

test("account popover closes from the avatar, Escape and the canvas", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByTestId("user-avatar");
  const popover = page.getByTestId("account-popover");

  await expect(popover).toHaveCount(0);
  await trigger.click();
  await expect(popover).toBeVisible();
  const triggerBounds = await trigger.boundingBox();
  const popoverBounds = await popover.boundingBox();
  expect(popoverBounds?.x).toBeGreaterThan(
    (triggerBounds?.x ?? 0) + (triggerBounds?.width ?? 0),
  );
  await trigger.click();
  await expect(popover).toHaveCount(0);

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByTestId("canvas-world").click({ position: { x: 600, y: 400 } });
  await expect(popover).toHaveCount(0);
});

test("share popover keeps only the deferred team-project action", async ({
  page,
}) => {
  const fixture = await loadShareFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const trigger = page.getByTestId("share");
  const popover = page.getByTestId("share-popover");
  await expect(popover).toHaveCount(0);
  await trigger.click();
  await expect(popover).toBeVisible();

  const [x, y, width] = fixture.elements.popover;
  expect(await popover.boundingBox()).toMatchObject({
    x,
    y,
    width,
    height: 94,
  });
  await expect(popover).toHaveCSS("border-radius", "24px");
  await expect(popover).toHaveCSS("padding", "12px");

  await expect(
    popover.getByText("移动到团队项目", { exact: true }),
  ).toBeVisible();
  await expect(popover.getByRole("button")).toHaveCount(1);
  await expect(popover.getByRole("button", { name: "移动" })).toBeDisabled();
  await expect(popover).not.toContainText("TapTV");
  await expect(popover).not.toContainText("通过链接分享");

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByTestId("canvas-world").click({ position: { x: 200, y: 700 } });
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.reload();
  await expect(popover).toHaveCount(0);
});

test("keyboard shortcuts panel matches the live two-column reference", async ({
  page,
}) => {
  const fixture = await loadKeyboardShortcutsFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const help = page.getByTestId("help");
  const helpMenu = page.getByTestId("help-menu");
  const panel = page.getByTestId("keyboard-shortcuts-panel");
  await expect(panel).toHaveCount(0);
  await help.click();
  await expect(helpMenu).toBeVisible();
  await expect(
    helpMenu.getByRole("button", { name: "使用教程" }),
  ).toBeDisabled();
  await expect(
    helpMenu.getByRole("button", { name: "反馈问题" }),
  ).toBeDisabled();
  await helpMenu.getByRole("button", { name: "快捷键" }).click();

  await expect(panel).toBeVisible();
  const [x, y, width, height] = fixture.elements.modal;
  expect(await panel.boundingBox()).toMatchObject({ x, y, width, height });
  await expect(panel.locator(".keyboard-shortcuts-column")).toHaveCount(
    fixture.columns,
  );
  await expect(panel.getByRole("heading").allTextContents()).resolves.toEqual([
    "基础",
    "缩放",
    "移动画布",
    "时间轴",
    "其他",
  ]);

  for (const [label, keys] of Object.entries(fixture.shortcuts)) {
    const row = panel.locator(`[data-shortcut-label="${label}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator("kbd").allTextContents()).resolves.toEqual(
      keys.split(" "),
    );
  }
  await expect(panel.getByLabel("触控板缩放手势")).toBeVisible();
  await expect(panel.getByLabel("触控板双指手势")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(help).toBeFocused();

  await help.click();
  await page.getByTestId("canvas-world").click({ position: { x: 200, y: 700 } });
  await expect(helpMenu).toHaveCount(0);

  await help.click();
  await helpMenu.getByRole("button", { name: "快捷键" }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
});

test("blank canvas context menu matches the live grouped actions", async ({
  page,
}) => {
  const fixture = await loadBlankContextMenuFixture();
  await page.goto(`/__fixture/${fixture.id}`);

  const canvas = page.getByTestId("canvas-world");
  const menu = page.getByTestId("blank-context-menu");
  const list = menu.getByRole("listbox", { name: "画布空白右键菜单" });
  await canvas.click({
    button: "right",
    position: { x: fixture.elements.menu[0], y: fixture.elements.menu[1] },
  });
  await expect(menu).toBeVisible();

  const [menuX, menuY, menuWidth, menuHeight] = fixture.elements.menu;
  expect(await menu.boundingBox()).toMatchObject({
    x: menuX,
    y: menuY,
    width: menuWidth,
    height: menuHeight,
  });
  const [listX, listY, listWidth, listHeight] = fixture.elements.list;
  expect(await list.boundingBox()).toMatchObject({
    x: listX,
    y: listY,
    width: listWidth,
    height: listHeight,
  });
  await expect(menu).toHaveCSS("border-radius", "16px");
  await expect(menu).toHaveCSS("padding", "4px");
  await expect(list.getByRole("separator")).toHaveCount(3);

  for (const item of fixture.items) {
    await expect(list.getByRole("option", { name: item })).toBeVisible();
  }
  for (const item of fixture.disabled) {
    await expect(
      list.getByRole("option", { name: new RegExp(`^${item}`) }),
    ).toBeDisabled();
  }
  await expect(list.getByRole("option", { name: "上传" })).toBeEnabled();
  await expect(list.getByRole("option", { name: "添加资产" })).toBeEnabled();
  await expect(list.getByRole("option", { name: "添加节点" })).toBeEnabled();
  await expect(
    list.getByRole("option", { name: "添加辅助工具" }),
  ).toBeEnabled();
  const upload = list.getByRole("option", { name: "上传" });
  const utility = list.getByRole("option", { name: "添加辅助工具" });
  await expect(upload).toHaveCSS("background-color", "rgb(63, 63, 70)");
  await utility.hover();
  await expect(utility).toHaveCSS("background-color", "rgb(63, 63, 70)");
  await expect(upload).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await list.getByRole("option", { name: "添加资产" }).click();
  await expect(menu).toHaveCount(0);
  const assetsPanel = page.getByTestId("assets-panel");
  await expect(assetsPanel).toBeVisible();
  await assetsPanel.getByRole("button", { name: "关闭素材库" }).click();

  await canvas.click({
    button: "right",
    position: { x: menuX, y: menuY },
  });
  await list.getByRole("option", { name: "添加节点" }).click();
  await expect(page.getByTestId("add-node-menu")).toBeVisible();
  await canvas.click({ position: { x: 200, y: 700 } });

  await canvas.click({
    button: "right",
    position: { x: menuX, y: menuY },
  });
  await list.getByRole("option", { name: "添加辅助工具" }).click();
  await expect(page.getByTestId("add-node-menu")).toBeVisible();
  await canvas.click({ position: { x: 200, y: 700 } });

  await canvas.click({
    button: "right",
    position: { x: menuX, y: menuY },
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await canvas.click({
    button: "right",
    position: { x: menuX, y: menuY },
  });
  await page.reload();
  await expect(menu).toHaveCount(0);
});

test("node context menu keeps copy and paste inside the canvas", async ({
  context,
  page,
}) => {
  const fixture = await loadNodeContextMenuFixture();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/__fixture/${fixture.id}`);
  await page.evaluate(() => navigator.clipboard.writeText("keep-system-copy"));

  const canvas = page.getByTestId("canvas-world");
  const source = page.locator('.react-flow__node[data-id="context-image"]');
  const menu = page.getByTestId("node-context-menu");
  const list = menu.getByRole("listbox", { name: "节点右键菜单" });
  await source.click({
    button: "right",
    position: { x: 69, y: 118 },
  });
  await expect(menu).toBeVisible();

  const [menuX, menuY, menuWidth, menuHeight] = fixture.elements.menu;
  expect(await menu.boundingBox()).toMatchObject({
    x: menuX,
    y: menuY,
    width: menuWidth,
    height: menuHeight,
  });
  const [listX, listY, listWidth, listHeight] = fixture.elements.list;
  expect(await list.boundingBox()).toMatchObject({
    x: listX,
    y: listY,
    width: listWidth,
    height: listHeight,
  });
  await expect(menu).toHaveCSS("border-radius", "16px");
  await expect(menu).toHaveCSS("padding", "4px");
  await expect(list.getByRole("separator")).toHaveCount(5);
  for (const item of fixture.items) {
    await expect(list.getByRole("option", { name: item })).toBeVisible();
  }
  for (const item of fixture.disabledInPrivateFixture) {
    await expect(
      list.getByRole("option", { name: new RegExp(`^${item}`) }),
    ).toBeDisabled();
  }
  await expect(list.getByRole("option", { name: "下载" })).toBeEnabled();
  await expect(list.getByRole("option", { name: /^复制.*⌘C$/ })).toBeEnabled();
  await expect(list.getByRole("option", { name: "副本" })).toBeEnabled();
  await expect(list.getByRole("option", { name: /^删除/ })).toBeEnabled();

  await list.getByRole("option", { name: /^复制.*⌘C$/ }).click();
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("keep-system-copy");

  await canvas.click({
    button: "right",
    position: { x: 900, y: 700 },
  });
  const blankMenu = page.getByTestId("blank-context-menu");
  const paste = blankMenu.getByRole("option", { name: /^粘贴/ });
  await expect(paste).toBeEnabled();
  await paste.click();
  await expect(canvas).toHaveAttribute("data-node-count", "2");

  const pasted = page.locator(
    '.react-flow__node[data-id^="context-image-copy-"]',
  );
  await expect(pasted).toHaveCount(1);
  const sourceBox = await source.boundingBox();
  const pastedBox = await pasted.boundingBox();
  expect(pastedBox?.x).toBe((sourceBox?.x ?? 0) + 40);
  expect(pastedBox?.y).toBe((sourceBox?.y ?? 0) + 40);
  await expect(source).not.toHaveClass(/selected/);
  await expect(pasted).toHaveClass(/selected/);

  await pasted.click({ button: "right" });
  await page
    .getByTestId("node-context-menu")
    .getByRole("option", { name: "副本" })
    .click();
  await expect(canvas).toHaveAttribute("data-node-count", "3");

  const copies = page.locator('.react-flow__node[data-id*="-copy-"]');
  await copies.last().click({ button: "right" });
  await page
    .getByTestId("node-context-menu")
    .getByRole("option", { name: /^删除/ })
    .click();
  await expect(canvas).toHaveAttribute("data-node-count", "2");

  await source.click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Meta+C");
  await page.keyboard.press("Meta+V");
  await expect(canvas).toHaveAttribute("data-node-count", "3");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("keep-system-copy");

  await source.click({ button: "right", position: { x: 20, y: 20 } });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await source.click({ button: "right", position: { x: 20, y: 20 } });
  await page.reload();
  await expect(menu).toHaveCount(0);
});

test("transient dialogs and panels close cleanly and return focus", async ({
  page,
}) => {
  await page.goto("/__fixture/shell.empty.primary");
  const canvas = page.getByTestId("canvas-world");

  const searchButton = page.getByTestId("node-search");
  await searchButton.click();
  const searchBackdrop = page.getByTestId("node-search-backdrop");
  const searchDialog = page.getByTestId("node-search-dialog");
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchDialog).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  await searchButton.click();
  await searchBackdrop.click({ position: { x: 1100, y: 800 } });
  await expect(searchDialog).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  const assetsButton = page.getByTestId("assets");
  await assetsButton.click();
  const assetsPanel = page.getByTestId("assets-panel");
  await expect(assetsPanel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assetsPanel).toHaveCount(0);
  await expect(assetsButton).toBeFocused();

  await assetsButton.click();
  await assetsPanel.getByRole("button", { name: "AI 角色" }).click();
  const characters = page.getByTestId("ai-characters-overlay");
  await expect(characters).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(characters).toHaveCount(0);
  await expect(
    assetsPanel.getByRole("button", { name: "AI 角色" }),
  ).toBeFocused();
  await canvas.click({ position: { x: 800, y: 700 } });
  await expect(assetsPanel).toHaveCount(0);
  await expect(assetsButton).toBeFocused();

  const templatesButton = page.getByTestId("templates");
  await templatesButton.click();
  const templatesPanel = page.getByTestId("templates-panel");
  const browseTemplates = templatesPanel.getByRole("button", {
    name: "浏览全部",
  });
  await browseTemplates.click();
  const templateBrowser = page.getByTestId("template-browser");
  await expect(templateBrowser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(templateBrowser).toHaveCount(0);
  await expect(browseTemplates).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(templatesPanel).toHaveCount(0);
  await expect(templatesButton).toBeFocused();

  const historyButton = page.getByTestId("history");
  await historyButton.click();
  const historyPanel = page.getByTestId("history-panel");
  const browseHistory = historyPanel.getByRole("button", {
    name: "浏览全部历史",
  });
  await browseHistory.click();
  const historyBrowser = page.getByTestId("history-browser");
  await expect(historyBrowser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(historyBrowser).toHaveCount(0);
  await expect(browseHistory).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(historyPanel).toHaveCount(0);
  await expect(historyButton).toBeFocused();
});

test("fixture and normal canvases share the real account popover contract", async ({
  page,
}) => {
  for (const url of ["/", "/__fixture/shell.empty.primary"]) {
    await page.goto(url);
    const account = page.getByTestId("account-popover");
    const user = page.getByTestId("user-avatar");
    await user.click();
    await expect(account).toBeVisible();
    await expect(account).toContainText("Test User");
    await user.click();
    await expect(account).toHaveCount(0);
  }
});

test("project title and shell searches share IME-safe undo and redo", async ({
  page,
}) => {
  const paidRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /generation-tasks|provider|openrouter|volces|mureka/i.test(request.url())
    ) {
      paidRequests.push(request.url());
    }
  });

  const cases = [
    ["/__fixture/shell.empty.primary", "项目名称", ["hua", "hua bu", "画布名称"]],
    ["/__fixture/modal.node-search.empty", "搜索节点...", ["tu", "tu pian", "图片"]],
    ["/__fixture/panel.assets.personal-empty", "搜索", ["fu", "fu zhuang", "服装"]],
    ["/__fixture/panel.templates.public", "搜索资产包...", ["dian", "dian shang", "电商"]],
  ] as const;

  for (const [url, label, values] of cases) {
    await page.goto(url);
    const input = page.getByLabel(label, { exact: true });
    const initial = await input.inputValue();
    await composeTextControl(input, [...values]);
    await expect(input).toHaveValue(values.at(-1)!);
    await input.press("Meta+z");
    await expect(input).toHaveValue(initial);
    await expect(input).not.toHaveValue(/hua bu|tu pian|fu zhuang|dian shang/i);
    await input.press("Meta+Shift+z");
    await expect(input).toHaveValue(values.at(-1)!);
  }
  expect(paidRequests).toEqual([]);
});

test("P1 creators and the selected Text creator never block the user Dock", async ({
  page,
  request,
}) => {
  const canvasId = "node.image.text-image-input";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  const user = page.getByTestId("user-avatar");

  await expect(page.getByTestId("image-creator")).toBeVisible();
  await user.click();
  await expect(page.getByTestId("account-popover")).toBeVisible();
  await expect(page.getByTestId("image-creator")).toBeVisible();
  await user.click();

  await page.locator('.react-flow__node[data-id="input-master-text"]').click();
  await expect(page.getByTestId("text-creator")).toBeVisible();
  await user.click();
  await expect(page.getByTestId("account-popover")).toBeVisible();
  await expect(page.getByTestId("text-creator")).toBeVisible();
});

test("primary shell surfaces switch in place without overlap or a blocked Dock", async ({
  page,
}) => {
  await page.goto("/__fixture/shell.empty.primary");
  const dock = page.getByTestId("left-toolbar");
  const expectNoDockIntersection = (surface: Locator) =>
    expectRectanglesNotToIntersect(dock, surface);

  await page.getByTestId("add-node").click();
  const addMenu = page.getByTestId("add-node-menu");
  await expect(addMenu).toBeVisible();
  await expectNoDockIntersection(addMenu);

  await page.getByTestId("assets").click();
  await expect(page.getByTestId("add-node-menu")).toHaveCount(0);
  const assetsPanel = page.getByTestId("assets-panel");
  await expect(assetsPanel).toBeVisible();
  await expectNoDockIntersection(assetsPanel);
  await page.getByTestId("user-avatar").click();
  await expect(assetsPanel).toHaveCount(0);
  await expect(page.getByTestId("account-popover")).toBeVisible();
  await page.getByTestId("user-avatar").click();
  await page.getByTestId("assets").click();
  await expect(assetsPanel).toBeVisible();

  await page.getByTestId("node-search").click();
  await expect(page.getByTestId("assets-panel")).toHaveCount(0);
  const nodeSearchDialog = page.getByTestId("node-search-dialog");
  await expect(nodeSearchDialog).toBeVisible();
  await expectNoDockIntersection(nodeSearchDialog);

  await page.getByTestId("templates").click();
  await expect(page.getByTestId("node-search-dialog")).toHaveCount(0);
  const templatesPanel = page.getByTestId("templates-panel");
  await expect(templatesPanel).toBeVisible();
  await expectNoDockIntersection(templatesPanel);

  await page.getByTestId("history").click();
  await expect(page.getByTestId("templates-panel")).toHaveCount(0);
  const historyPanel = page.getByTestId("history-panel");
  await expect(historyPanel).toBeVisible();
  await expectNoDockIntersection(historyPanel);

  await page.getByTestId("user-avatar").click();
  await expect(page.getByTestId("history-panel")).toHaveCount(0);
  const accountPopover = page.getByTestId("account-popover");
  await expect(accountPopover).toBeVisible();
  await expectNoDockIntersection(accountPopover);

  await page.getByTestId("logo-button").click();
  await expect(page.getByTestId("account-popover")).toHaveCount(0);
  await expect(page.getByTestId("project-menu")).toBeVisible();

  await page.getByTestId("share").click();
  await expect(page.getByTestId("project-menu")).toHaveCount(0);
  await expect(page.getByTestId("share-popover")).toBeVisible();

  await page.getByTestId("help").click();
  await expect(page.getByTestId("share-popover")).toHaveCount(0);
  await expect(page.getByTestId("help-menu")).toBeVisible();

  await page.getByTestId("agent-bubble").click();
  await expect(page.getByTestId("help-menu")).toHaveCount(0);
  await expect(page.getByTestId("agent-panel")).toBeVisible();
});

test("compact left surfaces keep a Dock lane and secondary fullscreen layers stay modal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto("/__fixture/shell.empty.primary");
  const dock = page.getByTestId("left-toolbar");

  await page.getByTestId("assets").click();
  const assetsPanel = page.getByTestId("assets-panel");
  await expect(assetsPanel).toBeVisible();
  await expectRectanglesNotToIntersect(dock, assetsPanel);

  await assetsPanel.getByRole("button", { name: "AI 角色" }).click();
  const secondaryOverlay = page.getByTestId("ai-characters-overlay");
  await expect(secondaryOverlay).toBeVisible();
  expect(await secondaryOverlay.boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: 720,
    height: 720,
  });
  await secondaryOverlay.getByRole("button", { name: "关闭 AI角色库" }).click();

  await page.getByTestId("node-search").click();
  const searchDialog = page.getByTestId("node-search-dialog");
  await expect(searchDialog).toBeVisible();
  await expectRectanglesNotToIntersect(dock, searchDialog);

  await page.getByTestId("templates").click();
  const templatesPanel = page.getByTestId("templates-panel");
  await expect(templatesPanel).toBeVisible();
  await expectRectanglesNotToIntersect(dock, templatesPanel);

  await page.getByTestId("history").click();
  const historyPanel = page.getByTestId("history-panel");
  await expect(historyPanel).toBeVisible();
  await expectRectanglesNotToIntersect(dock, historyPanel);
});

test("responsive anchors stay within the frozen 1px contract", async ({
  baseURL,
  browser,
}) => {
  for (const baseline of await loadResponsiveBaselines()) {
    const context = await browser.newContext({
      baseURL,
      colorScheme: "dark",
      deviceScaleFactor: baseline.deviceScaleFactor,
      viewport: { width: baseline.width, height: baseline.height },
    });
    const page = await context.newPage();

    await page.goto("/__fixture/shell.empty.primary");
    await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
      "data-fixture-ready",
      "true",
    );

    for (const [elementName, expectedBounds] of Object.entries(
      baseline.elements,
    )) {
      const testId = testIds[elementName];
      if (!testId) {
        continue;
      }
      const actual = await page.getByTestId(testId).boundingBox();
      expect(actual, `${baseline.name}:${elementName}`).not.toBeNull();

      for (const [index, label] of ["x", "y", "width", "height"].entries()) {
        expect(
          Math.abs(
            [actual!.x, actual!.y, actual!.width, actual!.height][index] -
              expectedBounds[index],
          ),
          `${baseline.name}:${elementName}.${label}`,
        ).toBeLessThanOrEqual(1);
      }
    }

    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
      baseline.deviceScaleFactor,
    );
    await expect(page.getByTestId("comments")).toHaveCount(0);
    await context.close();
  }
});

test("visible responsive previews keep an exact target CSS viewport", async ({
  page,
}) => {
  for (const target of [
    { route: "1280x720", width: 1280, height: 720 },
    { route: "1440x900", width: 1440, height: 900 },
    { route: "1512x982", width: 1512, height: 982 },
    { route: "1920x1080", width: 1920, height: 1080 },
  ]) {
    await page.goto(`/__responsive-preview/${target.route}`);

    const preview = page.getByTestId("responsive-preview");
    await expect(preview).toHaveAttribute(
      "data-preview-width",
      String(target.width),
    );
    await expect(preview).toHaveAttribute(
      "data-preview-height",
      String(target.height),
    );
    await expect(
      preview.getByText(`${target.width} × ${target.height} 真实布局预览`),
    ).toBeVisible();
    await expect(
      preview.getByText(/仅用于适应内置浏览器窗口/),
    ).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-dpr", "2");
    await expect(
      preview.getByText(/最小支持宽度 1280px/),
    ).toBeVisible();

    const frame = page.frameLocator(
      `iframe[title="${target.width}×${target.height}画布"]`,
    );
    await expect(frame.getByTestId("canvas-shell")).toHaveAttribute(
      "data-fixture-ready",
      "true",
    );
    await expect(frame.getByTestId("project-area")).toBeVisible();
    await expect(frame.getByTestId("left-toolbar")).toBeVisible();
    await expect(frame.getByTestId("bottom-controls")).toBeVisible();
    await expect(frame.getByTestId("agent-bubble")).toBeVisible();

    const viewport = await frame.locator("html").evaluate(() => ({
      height: document.documentElement.clientHeight,
      width: document.documentElement.clientWidth,
    }));
    expect(viewport).toEqual({
      height: target.height,
      width: target.width,
    });
  }
});
