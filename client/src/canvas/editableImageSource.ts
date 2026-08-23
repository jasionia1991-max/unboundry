export type EditableImageSource = Readonly<{
  crossOrigin?: "anonymous";
  release: () => void;
  sourceAssetId: string;
  url: string;
}>;

export type EditableImageSourceResolver = (
  assetId: string,
  signal?: AbortSignal,
) => Promise<EditableImageSource>;

const maximumImageBytes = 20 * 1024 * 1024;
const assetIdPattern = /^[a-z0-9._-]{1,160}$/i;

type EditSourceErrorBody = {
  code?: string;
  error?: string;
};

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("图片准备已取消", "AbortError");
}

async function errorBody(response: Response) {
  try {
    return await response.json() as EditSourceErrorBody;
  } catch {
    return {};
  }
}

function fallbackMessage(status: number) {
  if (status === 401) return "登录已失效，请重新登录";
  if (status === 404) return "这张图片已不存在或尚未保存";
  if (status === 409) return "图片文件不完整，暂时无法裁剪";
  if (status === 429) return "正在处理其他图片，请稍后重试";
  return "图片暂时无法读取，请稍后重试";
}

export const sameOriginEditableImageSourceResolver:
  EditableImageSourceResolver = async (assetId, signal) => {
    if (!assetIdPattern.test(assetId)) {
      throw new Error("这张图片尚未完成安全保存");
    }
    if (signal?.aborted) throw abortReason(signal);

    const response = await fetch(
      `/api/image-edit-sources/${encodeURIComponent(assetId)}`,
      {
        cache: "no-store",
        headers: { Accept: "image/png" },
        redirect: "error",
        signal,
      },
    );
    if (!response.ok) {
      const body = await errorBody(response);
      throw new Error(body.error?.trim() || fallbackMessage(response.status));
    }
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "image/png") {
      throw new Error("图片文件不完整，暂时无法裁剪");
    }
    const declared = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(declared) || declared < 1 ||
      declared > maximumImageBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("图片文件不完整，暂时无法裁剪");
    }
    const blob = await response.blob();
    if (signal?.aborted) throw abortReason(signal);
    if (
      blob.type !== "image/png" || blob.size !== declared ||
      blob.size > maximumImageBytes
    ) {
      throw new Error("图片文件不完整，暂时无法裁剪");
    }

    const url = URL.createObjectURL(blob);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        URL.revokeObjectURL(url);
      },
      sourceAssetId: assetId,
      url,
    };
  };

// Image editors depend on this stable resolver boundary. A future
// media.mymy.ltd CORS resolver can replace this binding while retaining the
// same editor and same-origin resolver as a private/legacy fallback.
export const resolveEditableImageSource = sameOriginEditableImageSourceResolver;
