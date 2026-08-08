import { expect, test } from "./safe-test";
import { defaultParameterSchema } from "../types/modelParameters";

test("Agent models, paused skills and suggestions come from the safe local configuration", async ({
  page,
  request,
}) => {
  const createdResponse = await request.post("/api/admin/models", {
    data: {
      capability: "text",
      displayName: "Doubao Seed",
      isDefault: true,
      parameterSchema: defaultParameterSchema("text"),
      providerModelId: "test/doubao-seed-lite",
      sortOrder: 1,
      status: "published",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { model: { id: string } };
  const response = await request.get("/api/agent-config");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");
  const configuration = await response.json() as {
    defaultModelId: string;
    executionEnabled: boolean;
    models: Array<{ id: string; label: string; status: string }>;
    skills: Array<{ enabled: boolean; label: string }>;
    suggestions: Array<{ title: string }>;
  };
  expect(configuration.executionEnabled).toBe(false);
  expect(configuration.defaultModelId).toBe(created.model.id);
  expect(configuration.models).toEqual([
    { id: created.model.id, label: "Doubao Seed", status: "ready" },
  ]);
  expect(configuration.skills).toHaveLength(3);
  expect(configuration.skills.every((skill) => !skill.enabled)).toBe(true);
  expect(configuration.suggestions.map((suggestion) => suggestion.title)).toEqual([
    "体验 Brainstorm 模式设计人物关系",
    "体验 Brainstorm 模式扩展世界观",
  ]);
  expect(JSON.stringify(configuration)).not.toMatch(/apiKey|secret|password|endpoint/i);

  const paidRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /provider|generate|agent.*run/i.test(request.url())) {
      paidRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/menu.agent.add-and-model");
  await expect(page.getByTestId("agent-suggestion-a")).toContainText(
    "体验 Brainstorm 模式设计人物关系",
  );
  await expect(page.getByTestId("agent-model")).toContainText("Doubao Seed");
  await page.getByTestId("agent-model").click();
  const modelMenu = page.getByTestId("agent-model-menu");
  await expect(modelMenu.getByRole("menuitemradio")).toHaveCount(1);
  await expect(modelMenu).not.toContainText("Auto switch");
  await expect(modelMenu).not.toContainText("即将上线");
  await page.getByTestId("agent-model").click();
  await page.getByTestId("agent-add").click();
  await page.getByTestId("agent-add-menu").getByRole("menuitem", {
    name: "技能",
    exact: true,
  }).click();
  const skills = page.getByTestId("agent-skills-menu");
  await expect(skills.getByRole("menuitem")).toHaveCount(3);
  await expect(skills.getByRole("menuitem", { name: /头脑风暴/ })).toBeDisabled();
  await expect(skills.getByRole("menuitem", { name: /画布内容整理/ })).toBeDisabled();
  await expect(skills.getByRole("menuitem", { name: /提示词优化/ })).toBeDisabled();
  await expect(page.getByTestId("agent-send")).toBeDisabled();
  expect(paidRequests).toEqual([]);
  await request.patch(`/api/admin/models/${created.model.id}`, {
    data: { status: "disabled" },
  });
});
