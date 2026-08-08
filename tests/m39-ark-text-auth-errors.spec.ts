import { expect, test } from "./safe-test";
import type { ProviderProfile } from "../server/providerProfiles";
import { createVolcengineArkTextResponse } from "../server/volcengineArkTextProvider";

const profile: ProviderProfile = {
  apiKey: "fake-key-never-sent",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "volcengine-ark",
  id: "ark-text-error-test",
  label: "Ark Text Error Test",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

const input = {
  model: "doubao-seed-2-0-lite-260428",
  prompt: "只检查错误分类，不访问真实Provider",
} as const;

test("Ark Text distinguishes invalid credentials from missing model permission", async () => {
  let fakeCalls = 0;

  await expect(createVolcengineArkTextResponse(
    profile,
    input,
    async () => {
      fakeCalls += 1;
      return new Response("{}", { status: 401 });
    },
  )).rejects.toMatchObject({
    code: "AUTH",
    message: "火山方舟API Key无效或已失效，请由管理员更新平台连接",
  });

  await expect(createVolcengineArkTextResponse(
    profile,
    input,
    async () => {
      fakeCalls += 1;
      return new Response("{}", { status: 403 });
    },
  )).rejects.toMatchObject({
    code: "PERMISSION",
    message: "当前API Key没有所选文字模型权限，请在方舟控制台开通模型服务并更新平台连接",
  });

  expect(fakeCalls).toBe(2);
});
