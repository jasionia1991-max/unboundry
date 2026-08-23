import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  imageToolOperations,
  parseImageToolCapabilitySnapshot,
  type ImageToolCapability,
  type ImageToolCapabilitySnapshot,
  type ImageToolOperation,
} from "../../../types/imageTools";

const ImageToolCapabilityContext =
  createContext<ImageToolCapabilitySnapshot | undefined>(undefined);

const staleCapabilities = new Map<ImageToolOperation, ImageToolCapability>(
  imageToolOperations.map((operation) => [operation, {
    expiresAt: "1970-01-01T00:00:00.000Z",
    maximumInputBytes: 1,
    maximumInputPixels: 1,
    operation,
    outputContentTypes: [],
    reason: "图片工具能力状态正在加载",
    reasonCode: "CAPABILITY_STALE",
    status: "stale",
    supportsAlpha: false,
    supportsMask: false,
    supportsReferenceImage: false,
  }]),
);

export function ImageToolCapabilityProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ImageToolCapabilitySnapshot>();
  useEffect(() => {
    let active = true;
    let expiryTimer: number | undefined;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/image-tools/capabilities", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`capabilities ${response.status}`);
        const parsed = parseImageToolCapabilitySnapshot(await response.json());
        if (active) {
          window.clearTimeout(expiryTimer);
          setSnapshot(parsed);
          const expiresAt = Math.min(
            ...parsed.operations.map((item) => Date.parse(item.expiresAt)),
          );
          expiryTimer = window.setTimeout(
            () => setSnapshot(undefined),
            Math.max(0, expiresAt - Date.now()) + 1,
          );
        }
      } catch {
        if (active && !controller.signal.aborted) {
          window.clearTimeout(expiryTimer);
          setSnapshot(undefined);
        }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 120_000);
    window.addEventListener("online", load);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.clearTimeout(expiryTimer);
      window.removeEventListener("online", load);
    };
  }, []);
  return (
    <ImageToolCapabilityContext.Provider value={snapshot}>
      {children}
    </ImageToolCapabilityContext.Provider>
  );
}

export function useImageToolCapability(operation: ImageToolOperation) {
  const snapshot = useContext(ImageToolCapabilityContext);
  return useMemo(
    () => snapshot?.operations.find((item) => item.operation === operation) ??
      staleCapabilities.get(operation)!,
    [operation, snapshot],
  );
}
