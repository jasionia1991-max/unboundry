import { expect, test } from "./safe-test";

test("Agent records locally, stops, clears and cancels without Provider requests", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  await page.addInitScript(() => {
    const fakeTrack = { stop() {} };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [fakeTrack],
        }),
      },
    });

    class FakeMediaRecorder extends EventTarget {
      mimeType = "audio/webm";
      state: RecordingState = "inactive";

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.dispatchEvent(
          new BlobEvent("dataavailable", {
            data: new Blob(["local voice"], { type: this.mimeType }),
          }),
        );
        this.dispatchEvent(new Event("stop"));
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
  });

  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" && /\/api\/generation-tasks(?:[/?]|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) {
      providerRequests.push(request.url());
    }
  });

  await page.goto("/__fixture/panel.agent.voice");
  await page.getByRole("button", { name: "语音输入" }).click();
  await expect(page.getByTestId("agent-voice-panel")).toHaveAttribute(
    "data-state",
    "recording",
  );
  await expect(page.getByText(/正在录音/)).toBeVisible();

  await page
    .getByTestId("agent-voice-panel")
    .getByRole("button", { name: "停止", exact: true })
    .click();
  await expect(page.getByText("录音已完成")).toBeVisible();
  await expect(page.getByText(/转写暂未接入/)).toBeVisible();
  await expect(page.getByTestId("agent-voice-preview")).toBeVisible();
  await page.getByRole("button", { name: "清除" }).click();
  await expect(page.getByTestId("agent-voice-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "语音输入" }).click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("agent-voice-panel")).toHaveCount(0);
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(providerRequests).toEqual([]);
});

test("Agent shows a clear microphone permission denial state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: class {},
    });
  });

  await page.goto("/__fixture/panel.agent.voice");
  await page.getByRole("button", { name: "语音输入" }).click();
  await expect(page.getByTestId("agent-voice-panel")).toHaveAttribute(
    "data-state",
    "denied",
  );
  await expect(page.getByText("未获得麦克风权限")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});
