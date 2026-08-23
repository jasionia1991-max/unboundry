import type { ImageToolUseCase } from "./imageToolDispatcher";

export function createDownloadImageToolUseCase(): ImageToolUseCase<Readonly<{
  fileName: string;
  sourceUrl: string;
}>> {
  return {
    operation: "download",
    execute(input) {
      const link = document.createElement("a");
      link.href = input.sourceUrl;
      link.download = input.fileName;
      link.click();
      return { kind: "viewer", operation: "download", status: "downloaded" };
    },
  };
}

export function createFullscreenImageToolUseCase(): ImageToolUseCase<Readonly<{
  open(): void;
}>> {
  return {
    operation: "fullscreen",
    execute(input) {
      input.open();
      return { kind: "viewer", operation: "fullscreen", status: "opened" };
    },
  };
}
