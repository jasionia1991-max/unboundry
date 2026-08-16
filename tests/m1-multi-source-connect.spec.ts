import { expect, test } from "./safe-test";

test("one shared plus connects every selected node to the dropped-on node", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.multi-source-connect-to-node");
  const world = page.getByTestId("canvas-world");
  const a = page.locator('.react-flow__node[data-id="probe-a"]');
  const b = page.locator('.react-flow__node[data-id="probe-b"]');
  const c = page.locator('.react-flow__node[data-id="probe-c"]');

  await a.click();
  await b.click({ modifiers: ["Shift"] });

  await expect(world).toHaveAttribute("data-selected-node-count", "2");
  await expect(page.getByTestId("batch-connect-handle")).toHaveCount(1);
  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "0");
  await expect(b.locator(".node-handle-plus").last()).toHaveCSS("opacity", "0");

  const handle = await page.getByTestId("batch-connect-handle").boundingBox();
  const target = await c.boundingBox();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 6 },
  );

  await expect(
    page.getByTestId("batch-connection-preview").locator("path"),
  ).toHaveCount(2);
  await page.mouse.up();

  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(
    page.locator(
      '.react-flow__edge[data-id^="edge-probe-a-probe-c-"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.react-flow__edge[data-id^="edge-probe-b-probe-c-"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("batch-connection-preview")).toHaveCount(0);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(page.locator(".cut-edge-button")).toHaveCount(0);
});

test("marquee-selecting connected nodes does not show edge scissors", async ({
  page,
}) => {
  await page.goto(
    "/__fixture/interaction.edge-delete-reconnect-download-sandbox-current",
  );
  const a = page.locator('.react-flow__node[data-id="probe-a"]');
  const b = page.locator('.react-flow__node[data-id="probe-b"]');
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-node-count",
    "3",
  );
  const [aBox, bBox] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  expect(aBox).not.toBeNull();
  expect(bBox).not.toBeNull();
  const left = Math.min(aBox!.x, bBox!.x) - 20;
  const top = Math.min(aBox!.y, bBox!.y) - 20;
  const right = Math.max(aBox!.x + aBox!.width, bBox!.x + bBox!.width) + 20;
  const bottom = Math.max(aBox!.y + aBox!.height, bBox!.y + bBox!.height) + 20;

  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(page.locator(".cut-edge-button")).toHaveCount(0);
});
