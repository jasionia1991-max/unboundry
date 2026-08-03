import { expect, test } from "@playwright/test";
import {
  discoverArkCatalog,
  discoverVolcengineArkControlPlane,
  isVolcengineArkControlPlaneReadAction,
  listVolcengineArkEndpoints,
  listVolcengineArkFoundationModels,
  listVolcengineArkFoundationModelVersions,
  type ArkControlPlaneCredentialsInput,
  VolcengineArkControlPlaneError,
  VOLCENGINE_ARK_CONTROL_PLANE_MAX_RESPONSE_BYTES,
} from "../server/volcengineArkControlPlane";

const credentials: ArkControlPlaneCredentialsInput = {
  accessKeyId: "AKIDEXAMPLECONTROL",
  projectName: "default",
  secretAccessKey: "secret-example-control-key",
};

const fixedNow = () => new Date("2026-08-03T01:02:03.000Z");

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function result(items: unknown[], total = items.length) {
  return json({ Result: { Items: items, TotalCount: total } });
}

function actionOf(input: RequestInfo | URL) {
  return new URL(String(input)).searchParams.get("Action");
}

function unicodeEscapeJsonString(value: string) {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return "";
    if (codePoint <= 0xffff) {
      return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
    const offset = codePoint - 0x10000;
    const high = 0xd800 + (offset >> 10);
    const low = 0xdc00 + (offset & 0x3ff);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  }).join("");
}

test("Ark control-plane signs the official paginated model-list request with the fixed V4 headers", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return result([{
      DisplayName: "Doubao Seed",
      FoundationModelTag: { TaskTypes: ["TextGeneration"] },
      LifecycleStatus: "Active",
      Name: "doubao-seed",
      PrimaryVersion: "260101",
    }]);
  };

  const catalog = await listVolcengineArkFoundationModels(credentials, {
    fetcher,
    now: fixedNow,
    pageSize: 2,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(
    "https://open.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01",
  );
  expect(calls[0].init?.method).toBe("POST");
  expect(calls[0].init?.redirect).toBe("error");
  expect(calls[0].init?.body).toBe('{"PageNumber":1,"PageSize":2}');
  const headers = new Headers(calls[0].init?.headers);
  expect(headers.get("host")).toBe("open.volcengineapi.com");
  expect(headers.get("x-date")).toBe("20260803T010203Z");
  expect(headers.get("x-content-sha256")).toBe(
    "19d7ea0681915fb10e24d7ca93a7a3138c8b1798bcc9f8c8295c3a8de3bd1932",
  );
  expect(headers.get("authorization")).toBe(
    "HMAC-SHA256 Credential=AKIDEXAMPLECONTROL/20260803/cn-beijing/ark/request, " +
      "SignedHeaders=host;x-content-sha256;x-date, " +
      "Signature=e04a15beb5d4893558a8abcc28c832f426e111fdd6493c9c200b6fe6d7e08a85",
  );
  expect(catalog).toEqual({
    items: [{
      createdAt: null,
      displayName: "Doubao Seed",
      lifecycleStatus: "Active",
      name: "doubao-seed",
      primaryVersion: "260101",
      taskTypes: ["TextGeneration"],
      updatedAt: null,
    }],
    requestCount: 1,
  });
});

test("Ark catalog discovery reads every version and bounded endpoint page without a real request", async () => {
  const calls: Array<{ action: string | null; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const action = actionOf(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ action, body });
    if (action === "ListFoundationModels") {
      const page = Number(body.PageNumber);
      const seedream = {
        DisplayName: "Seedream",
        FoundationModelTag: { FilterTaskTypes: ["TextToImage"] },
        Name: "doubao-seedream",
        PrimaryVersion: "260202",
      };
      return page === 1
        ? result([
            {
              DisplayName: "Seedance",
              FoundationModelTag: { TaskTypes: ["TextToVideo"] },
              LifecycleStatus: "Active",
              Name: "doubao-seedance",
              PrimaryVersion: "260101",
            },
            seedream,
          ], 4)
        : result([
            seedream,
            { DisplayName: "Unknown model", Name: "other-model" },
          ], 4);
    }
    if (action === "ListFoundationModelVersions") {
      if (body.FoundationModelName === "doubao-seedance") {
        return Number(body.PageNumber) === 1
          ? result([
              { LifecycleStatus: "Active", Version: "260101" },
              { LifecycleStatus: "Active", Version: "260102" },
            ], 4)
          : result([
              { LifecycleStatus: "Active", Version: "260102" },
              { LifecycleStatus: "Active", Version: "260103" },
            ], 4);
      }
      if (body.FoundationModelName === "doubao-seedream") {
        return result([{ DisplayName: "Seedream 2026", Version: "260202" }]);
      }
      return result([]);
    }
    if (action === "ListEndpoints") {
      const page = Number(body.PageNumber);
      if (page === 1) {
        return result([
          {
            Id: "ep-video",
            ModelReference: {
              FoundationModel: {
                ModelVersion: "260102",
                Name: "doubao-seedance",
              },
            },
            Name: "Video endpoint",
            Status: "Running",
          },
          {
            Id: "ep-image",
            ModelReference: {
              FoundationModel: {
                ModelVersion: "260202",
                Name: "doubao-seedream",
              },
            },
            Name: "Image endpoint",
            Status: "Stopped",
          },
        ], 3);
      }
      return result([{
        Id: "ep-unknown",
        Name: "Unmapped endpoint",
        Status: "Running",
      }], 3);
    }
    throw new Error("unexpected action");
  };

  const catalog = await discoverArkCatalog(credentials, {
    fetcher,
    maxRecords: 20,
    now: fixedNow,
    pageSize: 2,
  });

  expect(catalog.requestCount).toBe(8);
  expect(calls.map((call) => call.action)).toEqual([
    "ListFoundationModels",
    "ListFoundationModels",
    "ListFoundationModelVersions",
    "ListFoundationModelVersions",
    "ListFoundationModelVersions",
    "ListFoundationModelVersions",
    "ListEndpoints",
    "ListEndpoints",
  ]);
  expect(calls.filter((call) => call.action === "ListFoundationModels").map(
    (call) => call.body,
  )).toEqual([
    { PageNumber: 1, PageSize: 2 },
    { PageNumber: 2, PageSize: 2 },
  ]);
  expect(calls.filter(
    (call) => call.action === "ListFoundationModelVersions",
  ).every((call) =>
    typeof call.body.FoundationModelName === "string" &&
    call.body.ProjectName === undefined &&
    Number.isInteger(call.body.PageNumber) &&
    call.body.PageSize === 2
  )).toBe(true);
  expect(calls.filter((call) => call.action === "ListEndpoints").every(
    (call) => call.body.ProjectName === "default",
  )).toBe(true);
  expect(catalog.models).toEqual([
    expect.objectContaining({
      capability: "video",
      providerModelId: "doubao-seedance-260101",
      status: "Active",
    }),
    expect.objectContaining({
      capability: "video",
      providerModelId: "doubao-seedance-260102",
    }),
    expect.objectContaining({
      capability: "video",
      providerModelId: "doubao-seedance-260103",
    }),
    expect.objectContaining({
      capability: "image",
      displayName: "Seedream 2026",
      providerModelId: "doubao-seedream-260202",
    }),
    expect.objectContaining({
      capability: "unknown",
      providerModelId: "other-model",
    }),
  ]);
  expect(catalog.endpoints).toEqual([
    expect.objectContaining({
      id: "ep-video",
      providerModelId: "doubao-seedance-260102",
    }),
    expect.objectContaining({
      id: "ep-image",
      providerModelId: "doubao-seedream-260202",
    }),
    expect.objectContaining({ id: "ep-unknown" }),
  ]);
  expect(catalog.endpoints[2]).not.toHaveProperty("providerModelId");
});

test("full Ark discovery exposes normalized model, version and endpoint records with one request count", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const action = actionOf(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (action === "ListFoundationModels") {
      return result([{
        CreateTime: "2026-01-01T00:00:00Z",
        Name: "model-a",
        PrimaryVersion: "v1",
      }]);
    }
    if (action === "ListFoundationModelVersions") {
      expect(body).toEqual({
        FoundationModelName: "model-a",
        PageNumber: 1,
        PageSize: 100,
      });
      return result([{ Id: "version-id", Name: "v1", Status: "Active" }]);
    }
    if (action === "ListEndpoints") {
      return result([{
        EndpointId: "ep-a",
        FoundationModelName: "model-a",
        FoundationModelVersion: "v1",
      }]);
    }
    throw new Error("unexpected action");
  };

  const discovered = await discoverVolcengineArkControlPlane(credentials, {
    fetcher,
    now: fixedNow,
  });
  expect(discovered.requestCount).toBe(3);
  expect(discovered.models[0].name).toBe("model-a");
  expect(discovered.versions[0]).toMatchObject({
    id: "version-id",
    modelName: "model-a",
    version: "v1",
  });
  expect(discovered.endpoints[0]).toMatchObject({
    id: "ep-a",
    modelName: "model-a",
    modelVersion: "v1",
  });
});

test("Ark read-only action allowlist contains only the three approved actions", () => {
  expect(isVolcengineArkControlPlaneReadAction("ListFoundationModels")).toBe(true);
  expect(isVolcengineArkControlPlaneReadAction("ListFoundationModelVersions")).toBe(true);
  expect(isVolcengineArkControlPlaneReadAction("ListEndpoints")).toBe(true);
  expect(isVolcengineArkControlPlaneReadAction("CreateEndpoint")).toBe(false);
  expect(isVolcengineArkControlPlaneReadAction("DeleteEndpoint")).toBe(false);
  expect(isVolcengineArkControlPlaneReadAction("ListEndpoints&Action=DeleteEndpoint")).toBe(false);
});

for (const scenario of [
  { code: "AUTH", providerCode: "SignatureDoesNotMatch", status: 403 },
  { code: "PERMISSION", providerCode: "AccessDenied", status: 403 },
  { code: "RATE_LIMIT", providerCode: "RequestLimitExceeded", status: 429 },
  { code: "REMOTE", providerCode: "InternalError", status: 500 },
] as const) {
  test(`Ark control-plane classifies ${scenario.code} without exposing remote details`, async () => {
    const fetcher: typeof fetch = async () => json({
      ResponseMetadata: {
        Error: {
          Code: scenario.providerCode,
          Message: "provider detail must stay private",
        },
      },
    }, scenario.status);

    await expect(listVolcengineArkFoundationModels(credentials, {
      fetcher,
      now: fixedNow,
    })).rejects.toMatchObject({
      code: scenario.code,
    } satisfies Partial<VolcengineArkControlPlaneError>);
  });
}

test("Ark control-plane still classifies empty HTTP auth responses", async () => {
  for (const scenario of [
    { code: "AUTH", status: 401 },
    { code: "PERMISSION", status: 403 },
    { code: "RATE_LIMIT", status: 429 },
  ] as const) {
    await expect(listVolcengineArkFoundationModels(credentials, {
      fetcher: async () => new Response(null, { status: scenario.status }),
      now: fixedNow,
    })).rejects.toMatchObject({ code: scenario.code });
  }
});

test("Ark control-plane replaces thrown network details and never returns or errors with AK/SK", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error(
      `${credentials.accessKeyId}:${credentials.secretAccessKey}:socket detail`,
    );
  };

  let caught: unknown;
  try {
    await listVolcengineArkFoundationModels(credentials, {
      fetcher,
      now: fixedNow,
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VolcengineArkControlPlaneError);
  expect(caught).toMatchObject({ code: "NETWORK" });
  const visibleError = `${String(caught)}\n${JSON.stringify(caught)}\n${
    caught instanceof Error ? caught.stack : ""
  }`;
  expect(visibleError).not.toContain(credentials.accessKeyId);
  expect(visibleError).not.toContain(credentials.secretAccessKey);

  const success = await listVolcengineArkFoundationModels(credentials, {
    fetcher: async () => result([{ Name: "safe-model" }]),
    now: fixedNow,
  });
  expect(JSON.stringify(success)).not.toContain(credentials.accessKeyId);
  expect(JSON.stringify(success)).not.toContain(credentials.secretAccessKey);
});

test("Ark control-plane rejects credential echoes, invalid JSON and oversized bodies as FORMAT", async () => {
  const fetchers: Array<typeof fetch> = [
    async () => result([{ DisplayName: credentials.secretAccessKey, Name: "x" }]),
    async () => new Response("not-json", { status: 200 }),
    async () => new Response("{}", {
      headers: {
        "Content-Length": String(
          VOLCENGINE_ARK_CONTROL_PLANE_MAX_RESPONSE_BYTES + 1,
        ),
      },
      status: 200,
    }),
  ];
  for (const fetcher of fetchers) {
    await expect(listVolcengineArkFoundationModels(credentials, {
      fetcher,
      now: fixedNow,
    })).rejects.toMatchObject({
      code: "FORMAT",
    } satisfies Partial<VolcengineArkControlPlaneError>);
  }
});

test("Ark control-plane rejects case-varied Unicode-escaped credentials anywhere in parsed JSON", async () => {
  const encodedSecret = unicodeEscapeJsonString(
    credentials.secretAccessKey.toUpperCase(),
  );
  const encodedAccessKey = unicodeEscapeJsonString(
    credentials.accessKeyId.toLowerCase(),
  );
  const bodies = [
    `{"Result":{"Items":[{"Name":"safe-model","DisplayName":"${encodedSecret}"}],"TotalCount":1}}`,
    `{"Result":{"Items":[{"Name":"safe-model","Metadata":{"nested":[{"${encodedAccessKey}":"safe"}]}}],"TotalCount":1}}`,
  ];
  expect(bodies.every((body) =>
    !body.toLowerCase().includes(credentials.accessKeyId.toLowerCase()) &&
    !body.toLowerCase().includes(credentials.secretAccessKey.toLowerCase())
  )).toBe(true);

  const completedResults: unknown[] = [];
  for (const body of bodies) {
    let caught: unknown;
    try {
      completedResults.push(await listVolcengineArkFoundationModels(credentials, {
        fetcher: async () => new Response(body, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
        now: fixedNow,
      }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VolcengineArkControlPlaneError);
    expect(caught).toMatchObject({ code: "FORMAT" });
    const visibleError = `${String(caught)}\n${JSON.stringify(caught)}\n${
      caught instanceof Error ? caught.stack : ""
    }`.toLowerCase();
    expect(visibleError).not.toContain(credentials.accessKeyId.toLowerCase());
    expect(visibleError).not.toContain(credentials.secretAccessKey.toLowerCase());
  }
  expect(completedResults).toEqual([]);
});

test("Ark model and version pagination enforce page size, page count and record limits", async () => {
  let invalidPageSizeCalls = 0;
  await expect(listVolcengineArkFoundationModels(credentials, {
    fetcher: async () => {
      invalidPageSizeCalls += 1;
      return result([]);
    },
    now: fixedNow,
    pageSize: 101,
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(invalidPageSizeCalls).toBe(0);

  let modelCalls = 0;
  await expect(listVolcengineArkFoundationModels(credentials, {
    fetcher: async (_input, init) => {
      modelCalls += 1;
      expect(JSON.parse(String(init?.body))).toEqual({
        PageNumber: 1,
        PageSize: 2,
      });
      return result([{ Name: "model-a" }, { Name: "model-b" }], 3);
    },
    maxPages: 1,
    maxRecords: 10,
    now: fixedNow,
    pageSize: 2,
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(modelCalls).toBe(1);

  let versionCalls = 0;
  await expect(listVolcengineArkFoundationModelVersions(
    credentials,
    "model-a",
    {
      fetcher: async (_input, init) => {
        versionCalls += 1;
        expect(JSON.parse(String(init?.body))).toEqual({
          FoundationModelName: "model-a",
          PageNumber: 1,
          PageSize: 2,
        });
        return result([{ Version: "v1" }, { Version: "v2" }], 2);
      },
      maxRecords: 1,
      now: fixedNow,
      pageSize: 2,
    },
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(versionCalls).toBe(1);
});

test("Ark endpoint pagination enforces total page and record limits before another request", async () => {
  let pageCalls = 0;
  const fullPageFetcher: typeof fetch = async () => {
    pageCalls += 1;
    return result([
      { Id: `ep-${pageCalls}-a` },
      { Id: `ep-${pageCalls}-b` },
    ], 10);
  };
  await expect(listVolcengineArkEndpoints(credentials, {
    fetcher: fullPageFetcher,
    maxPages: 1,
    maxRecords: 20,
    now: fixedNow,
    pageSize: 2,
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(pageCalls).toBe(1);

  let recordCalls = 0;
  await expect(listVolcengineArkEndpoints(credentials, {
    fetcher: async () => {
      recordCalls += 1;
      return result([{ Id: "ep-a" }, { Id: "ep-b" }], 2);
    },
    maxRecords: 1,
    now: fixedNow,
    pageSize: 2,
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(recordCalls).toBe(1);
});

test("Ark control-plane aborts a stalled injected fetch at the bounded timeout", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };
  await expect(listVolcengineArkFoundationModelVersions(
    credentials,
    "doubao-seed",
    { fetcher, now: fixedNow, timeoutMs: 5 },
  )).rejects.toMatchObject({ code: "NETWORK" });
  expect(calls).toBe(1);
});
