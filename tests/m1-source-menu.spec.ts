import { expect, test } from "./safe-test";

const cases = [
  {
    height: 326,
    id: "probe-image",
    items: ["文本生成", "图片生成", "视频生成", "图片编辑器", "3D 世界 Beta"],
    kind: "image",
  },
  {
    height: 270,
    id: "probe-video",
    items: ["文本生成", "音频生成", "视频编辑", "3D 世界 Beta"],
    kind: "video",
  },
  {
    height: 158,
    id: "probe-audio",
    items: ["视频生成", "数字人视频"],
    kind: "audio",
  },
] as const;

for (const source of cases) {
  test(`${source.kind} blank drop shows its exact source menu and cancels cleanly`, async ({
    page,
  }) => {
    await page.goto(
      "/__fixture/interaction.source-aware-connect-menus-current",
    );
    const world = page.getByTestId("canvas-world");
    const node = page.locator(
      `.react-flow__node[data-id="${source.id}"]`,
    );
    const handle = node.locator(
      ".react-flow__handle.source .node-handle-hit",
    );

    await node.click();
    const from = await handle.boundingBox();
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(950, 460, { steps: 6 });
    await page.mouse.up();

    const menu = page.getByTestId("source-connect-menu");
    await expect(menu).toHaveAttribute("data-source-kind", source.kind);
    await expect(menu).toContainText("引用该节点生成");
    await expect(menu.getByRole("menuitem")).toHaveCount(source.items.length);
    await expect(menu.locator(".source-connect-menu-label")).toHaveText(
      source.items.map((item) => item.replace(" Beta", "Beta")),
    );
    expect(await menu.boundingBox()).toMatchObject({
      width: 288,
      height: source.height,
    });
    await expect(menu.locator(".source-connect-menu-items")).toHaveCSS(
      "gap",
      "4px",
    );
    await expect(menu.getByRole("menuitem").first()).toHaveCSS(
      "height",
      "52px",
    );
    await expect(page.getByTestId("source-connect-preview")).toBeVisible();
    await expect(world).toHaveAttribute("data-node-count", "3");
    await expect(world).toHaveAttribute("data-edge-count", "0");

    await page.mouse.click(1100, 800);
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
    await expect(world).toHaveAttribute("data-node-count", "3");
    await expect(world).toHaveAttribute("data-edge-count", "0");
  });
}

test("open menu preview remains attached while its source node moves", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.source-aware-connect-menus-current");
  const node = page.locator('.react-flow__node[data-id="probe-image"]');
  const handle = node.locator(".react-flow__handle.source .node-handle-hit");

  await node.click();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(950, 460, { steps: 6 });
  await page.mouse.up();

  const before = await node.boundingBox();
  await page.mouse.move(before!.x + 120, before!.y + 120);
  await page.mouse.down();
  await page.mouse.move(before!.x + 200, before!.y + 160, { steps: 6 });
  await page.mouse.up();

  const after = await node.boundingBox();
  const path = await page
    .getByTestId("source-connect-preview")
    .locator("path")
    .getAttribute("d");
  expect(path).toMatch(
    new RegExp(`^M${Math.round(after!.x + after!.width)},${Math.round(after!.y + after!.height / 2)}`),
  );
  await expect(page.getByTestId("source-connect-menu")).toBeVisible();
});

test("selecting another node closes the open menu and preview", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.source-aware-connect-menus-current");
  const image = page.locator('.react-flow__node[data-id="probe-image"]');
  const handle = image.locator(".react-flow__handle.source .node-handle-hit");

  await image.click();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 460, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("source-connect-menu")).toBeVisible();

  await page.locator('.react-flow__node[data-id="probe-video"]').click();
  await expect(page.getByTestId("source-connect-menu")).toHaveCount(0);
  await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
});
