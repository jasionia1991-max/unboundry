import { expect, test } from "@playwright/test";

const emptySchema = {
  fields: [],
  referenceInputs: { audio: 0, image: 0, video: 0 },
  referencePolicy: {
    allowedCombinations: [],
    roles: {},
  },
  schemaVersion: 2,
};

function model(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    archived: false,
    archivedAt: undefined as string | undefined,
    canDelete: false,
    capability: "text",
    costCurrency: "USD",
    deleteBlockedReason: "该模型曾经发布过，只能归档，不能永久删除",
    displayName: id,
    enabled: false,
    everPublished: true,
    generationAvailable: false,
    id,
    isDefault: false,
    maxCostMicrounits: 0,
    parameterSchema: emptySchema,
    providerConnected: true,
    providerDriver: "openrouter",
    providerModelId: `vendor/${id}`,
    providerName: "OpenRouter",
    providerProfileId: "provider-openrouter",
    references: { activeTasks: 0, canvasDocuments: 0, tasks: 0 },
    sortOrder: 100,
    status: "disabled",
    ...overrides,
  };
}

test("model center keeps archive reversible and exposes permanent delete only for unused drafts", async ({
  page,
}) => {
  const models = [
    model("published-default", {
      displayName: "Published Default",
      enabled: true,
      isDefault: true,
      status: "published",
    }),
    model("stopped-used-model", {
      displayName: "Stopped Used Model",
      references: { activeTasks: 0, canvasDocuments: 2, tasks: 3 },
    }),
    model("unused-imported-draft", {
      archived: true,
      archivedAt: "2026-08-03T12:00:00.000Z",
      canDelete: true,
      deleteBlockedReason: undefined,
      displayName: "Unused Imported Draft",
      everPublished: false,
      status: "draft",
    }),
  ];
  const lifecycleRequests: string[] = [];
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${path}`);
    }
  });
  await page.route("**/api/admin/models**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "GET" && path === "/api/admin/models") {
      await route.fulfill({
        body: JSON.stringify({
          models,
          providerSecretsStoredInBrowser: false,
          providers: [{
            displayName: "OpenRouter",
            driver: "openrouter",
            id: "provider-openrouter",
            status: "enabled",
          }],
          submissionEnabled: false,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    lifecycleRequests.push(`${request.method()} ${path}`);
    const id = decodeURIComponent(path.split("/")[4] ?? "");
    const target = models.find((item) => item.id === id);
    if (!target) {
      await route.fulfill({ status: 404, body: JSON.stringify({ error: "模型不存在" }) });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/archive")) {
      target.archived = true;
      target.archivedAt = "2026-08-03T13:00:00.000Z";
      await route.fulfill({
        body: JSON.stringify({ model: target, paidProviderRequests: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/restore")) {
      target.archived = false;
      target.archivedAt = undefined;
      await route.fulfill({
        body: JSON.stringify({ model: target, paidProviderRequests: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.method() === "DELETE") {
      models.splice(models.indexOf(target), 1);
      await route.fulfill({
        body: JSON.stringify({ deleted: true, id, paidProviderRequests: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  await page.goto("/admin/models");
  await expect(page.getByText("Unused Imported Draft")).toHaveCount(0);
  const published = page.locator(".model-list article").filter({
    hasText: "Published Default",
  });
  await expect(published.getByRole("button", { name: "归档" })).toBeDisabled();

  const stopped = page.locator(".model-list article").filter({
    hasText: "Stopped Used Model",
  });
  await stopped.getByRole("button", { name: "归档" }).click();
  await expect(stopped).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示归档（2）" })).toBeVisible();

  await page.getByRole("button", { name: "显示归档（2）" }).click();
  const usedArchive = page.locator(".model-list article").filter({
    hasText: "Stopped Used Model",
  });
  await expect(usedArchive).toContainText("保留关系：画布2个 · 历史任务3条");
  await expect(usedArchive.getByRole("button", { name: "永久删除" })).toHaveCount(0);
  await usedArchive.getByRole("button", { name: "恢复" }).click();

  const unusedArchive = page.locator(".model-list article").filter({
    hasText: "Unused Imported Draft",
  });
  page.once("dialog", (dialog) => void dialog.accept());
  await unusedArchive.getByRole("button", { name: "永久删除" }).click();
  await expect(
    page.locator(".model-list article").filter({ hasText: "Unused Imported Draft" }),
  ).toHaveCount(0);
  expect(lifecycleRequests).toContain(
    "POST /api/admin/models/stopped-used-model/archive",
  );
  expect(lifecycleRequests).toContain(
    "POST /api/admin/models/stopped-used-model/restore",
  );
  expect(lifecycleRequests).toContain(
    "DELETE /api/admin/models/unused-imported-draft",
  );
  expect(generationRequests).toEqual([]);
});
