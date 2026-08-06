import { expect, test } from "@playwright/test";
import { composeTextControl } from "./helpers/ime";

test("Group keeps children stable through create, move, resize, delete and ungroup", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.selection-and-keyboard-move");

  const nodeA = page.getByTestId("probe-node-probe-a");
  const nodeB = page.getByTestId("probe-node-probe-b");
  const beforeA = (await nodeA.boundingBox())!;
  const beforeB = (await nodeB.boundingBox())!;
  await nodeA.click();
  await nodeB.click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "打组" }).click();

  let group = page.locator(".react-flow__node-group");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".group-node-body")).toHaveAttribute(
    "data-child-count",
    "2",
  );
  expect((await nodeA.boundingBox())!.x).toBeCloseTo(beforeA.x, 0);
  expect((await nodeB.boundingBox())!.x).toBeCloseTo(beforeB.x, 0);
  await expect(page.getByTestId("group-node-toolbar")).toHaveCount(1);
  expect(await page.getByTestId("group-node-toolbar").boundingBox()).toMatchObject(
    { height: 48, width: 390 },
  );
  await expect(page.locator(".react-flow__nodesselection")).toHaveCount(0);

  const groupBox = (await group.boundingBox())!;
  await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(
    groupBox.x + groupBox.width / 2,
    groupBox.y + 80,
    { steps: 5 },
  );
  await page.mouse.up();
  expect((await nodeA.boundingBox())!.y).toBeGreaterThan(beforeA.y + 40);

  const childSize = (await nodeA.boundingBox())!;
  const resize = group.locator(".react-flow__resize-control.bottom.right");
  const resizeBox = (await resize.boundingBox())!;
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 80, resizeBox.y + 50);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.up();
  expect((await nodeA.boundingBox())!.width).toBeCloseTo(childSize.width, 0);
  expect((await nodeA.boundingBox())!.height).toBeCloseTo(childSize.height, 0);

  await page.keyboard.press("Backspace");
  await expect(group).toHaveCount(0);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  group = page.locator(".react-flow__node-group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(3);

  await page.getByRole("button", { name: "解组" }).click();
  await expect(group).toHaveCount(0);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(3);
});

test("Selected Group matches the frozen shell and title behavior", async ({
  page,
}) => {
  await page.goto("/__fixture/node.group.selected");
  const group = page.locator(".react-flow__node-group");
  const toolbar = page.getByTestId("group-node-toolbar");

  expect(await group.boundingBox()).toMatchObject({ height: 290, width: 1034 });
  expect(await toolbar.boundingBox()).toMatchObject({ height: 48, width: 390 });
  await expect(group.locator(".react-flow__resize-control")).toHaveCount(8);
  const title = page.getByLabel("组合框标题");
  await expect(title).toHaveValue("新建组");
  await composeTextControl(title, ["xin zu", "新组"]);
  await expect(title).toHaveValue("新组");
  await title.press("Meta+z");
  await expect(title).toHaveValue("新建组");
  await title.press("Meta+Shift+z");
  await expect(title).toHaveValue("新组");

  await page.getByRole("button", { name: "组合框颜色" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "设置颜色" }).first().click();
  await expect(page.getByTestId("group-node-group-primary")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("Group layout reflows children into grid and horizontal positions", async ({
  page,
}) => {
  await page.goto("/__fixture/node.group.selected");
  const image = page.getByTestId("image-node-group-image");
  const video = page.getByTestId("video-node-group-video");
  const group = page.locator(".react-flow__node-group");
  const beforeImage = (await image.boundingBox())!;
  const beforeVideo = (await video.boundingBox())!;
  const beforeGroup = (await group.boundingBox())!;

  await page.getByRole("button", { name: "组合框布局" }).click();
  await expect(page.getByRole("button", { name: "宫格" })).toBeVisible();
  await page.getByRole("button", { name: "宫格" }).click();
  await expect
    .poll(async () => (await video.boundingBox())?.x ?? -1)
    .not.toBe(beforeVideo.x);
  await expect
    .poll(async () => (await group.boundingBox())?.width ?? -1)
    .not.toBe(beforeGroup.width);

  await page.getByRole("button", { name: "组合框布局" }).click();
  await expect(page.getByRole("button", { name: "水平" })).toBeVisible();
  await page.getByRole("button", { name: "水平" }).click();
  await expect
    .poll(async () => (await video.boundingBox())?.x ?? -1)
    .not.toBe(beforeVideo.x);
  await expect
    .poll(async () => (await group.boundingBox())?.width ?? -1)
    .not.toBe(beforeGroup.width);
});

test("Dense template Group keeps the frozen geometry and chrome", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node.group-dense-selected");

  const group = page.locator(".react-flow__node-group");
  const toolbar = page.getByTestId("group-node-toolbar");
  const viewport = Number(
    await page.locator(".react-flow__viewport").getAttribute("style")
      .then((style) => style?.match(/scale\(([^)]+)\)/)?.[1]),
  );

  const groupBox = (await group.boundingBox())!;
  expect(groupBox.height).toBeCloseTo(2111 * viewport, 1);
  expect(groupBox.width).toBeCloseTo(3443 * viewport, 1);
  expect(await toolbar.boundingBox()).toMatchObject({ height: 48, width: 390 });
  await expect(group.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "更新模板" })).toBeDisabled();

  const handle = group.locator(".react-flow__resize-control.top.left");
  expect(await handle.boundingBox()).toMatchObject({ height: 24, width: 24 });
});

test("Dense template Group downloads every available child asset", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node.group-dense-selected");

  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "下载全部" }).click();

  await expect.poll(() => downloads.length).toBe(6);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual([
    "1-素材 1.svg",
    "2-素材 2.svg",
    "3-素材 3.svg",
    "4-素材 4.svg",
    "5-素材 5.svg",
    "6-素材 6.svg",
  ]);
  for (const download of downloads) {
    expect(await download.failure()).toBeNull();
  }
});
