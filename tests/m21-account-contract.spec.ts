import { expect, test } from "@playwright/test";

test("the private account contract returns only the current personal scope", async ({
  request,
}) => {
  const response = await request.get("/api/account-context");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");

  const context = await response.json() as {
    permissions: Record<string, boolean>;
    user: {
      displayName: string;
      id: string;
      loginName: string;
      role: "admin" | "user";
      status: "active" | "disabled";
    };
    workspace: {
      id: string;
      teamEnabled: boolean;
      type: string;
    };
  };

  expect(context.user).toMatchObject({
    displayName: "Test User",
    id: "__test__",
    role: "admin",
    status: "active",
  });
  expect(context.workspace).toEqual({
    id: "personal:__test__",
    teamEnabled: false,
    type: "personal",
  });
  expect(context.permissions).toMatchObject({
    manageAccounts: true,
    manageModels: true,
    manageProviders: true,
    manageStorage: true,
    readOwnData: true,
    submitOwnTasks: true,
    writeOwnData: true,
  });
  expect(JSON.stringify(context)).not.toMatch(
    /password|secret|apiKey|wallet|balance|credit|quota/i,
  );

  const specification = await (await request.get("/api/openapi.json")).json() as {
    paths: Record<string, unknown>;
  };
  expect(Object.keys(specification.paths)).toContain("/api/account-context");
  expect(Object.keys(specification.paths).join(" ")).not.toMatch(
    /wallet|balance|credit|quota/i,
  );
});
