

export async function jsonRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & { code?: string; error?: string };
  if (!response.ok) {
    throw Object.assign(new Error(body.error || "操作失败，请重试"), {
      code: body.code,
      status: response.status,
    });
  }
  return body;
}
