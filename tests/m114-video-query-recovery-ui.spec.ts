import { expect, test } from "./safe-test";
import { generationNoticeTone } from "../client/src/generation/generationErrors";
import { activeServerWorkflowNodeIds, stoppedServerWorkflowNodeIds, mergeServerWorkflowRuns, type ServerWorkflowRun } from "../client/src/generation/workflowRuns";
import { friendlyGenerationMessage } from "../client/src/generation/friendlyGenerationMessage";

test("M114 video query recovery uses the recovering UI and never asks for a duplicate submit", async () => {
  expect(generationNoticeTone({ code: "AUTOMATIC_RESULT_RECOVERY" })).toBe("recovering");
  expect(generationNoticeTone({ code: "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED" })).toBe("recovering");
  expect(generationNoticeTone({ code: "PROVIDER_REQUEST_FAILED" })).toBe("recovering");
  expect(generationNoticeTone({ code: "INPUT_INVALID" })).toBe("blocking");
  expect(friendlyGenerationMessage("", "video", "AUTOMATIC_RESULT_RECOVERY")).toContain("不会重复付费提交");
  expect(friendlyGenerationMessage("", "video", "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED")).toContain("原请求记录已保留");
});


test("M114 a durable expired query stops the generation indicator without terminalizing its workflow", () => {
  const running: ServerWorkflowRun = {
    canvasId: "m114-canvas", groupId: "m114-group",
    id: "11111111-1111-4111-8111-111111111111",
    clientSemanticFingerprint: "wf1-client", semanticFingerprint: "wf1-server",
    createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:01.000Z",
    state: "running", lockedNodeIds: ["video", "other"],
    nodes: [
      { id: "video", kind: "video", state: "admitted", projectionState: "pending", taskId: "original-task" },
      { id: "other", kind: "video", state: "admitted", projectionState: "pending", taskId: "other-task" },
      { id: "tail", kind: "text", state: "pending", projectionState: "pending" },
    ],
  };
  expect([...activeServerWorkflowNodeIds(running)]).toEqual(["video", "other"]);
  const expired: ServerWorkflowRun = {
    ...running, updatedAt: "2026-09-13T00:00:02.000Z",
    nodes: running.nodes.map(node => node.id === "video" ? {
      ...node, errorCode: "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED",
      errorMessage: "原请求记录已保留，等待后续处理",
    } : node),
  };
  const resumedRead = mergeServerWorkflowRuns([running], [expired])[0]!;
  expect([...activeServerWorkflowNodeIds(resumedRead)]).toEqual(["other"]);
  expect([...stoppedServerWorkflowNodeIds(resumedRead)]).toEqual(["video"]);
  expect(resumedRead.state).toBe("running");
  expect(resumedRead.nodes.find(node => node.id === "video")).toMatchObject({ state: "admitted", taskId: "original-task" });
  expect(resumedRead.lockedNodeIds).toEqual(running.lockedNodeIds);
  const freshRead = mergeServerWorkflowRuns([], [expired])[0]!;
  expect([...activeServerWorkflowNodeIds(freshRead)]).toEqual(["other"]);
  const missingEvidence = { ...expired, nodes: expired.nodes.map(node => node.id === "video" ? { ...node, errorCode: "AUTOMATIC_RECOVERY_PENDING" } : node) };
  expect([...activeServerWorkflowNodeIds(missingEvidence)]).toEqual(["other"]);
  expect([...stoppedServerWorkflowNodeIds(missingEvidence)]).toEqual(["video"]);
});
