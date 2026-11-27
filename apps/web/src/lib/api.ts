export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<T> {
  const headers = new Headers();
  headers.set("X-Mandoc-Request", "1");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const request: RequestInit = { method: init.method ?? (body ? "POST" : "GET"), headers, credentials: "include" };
  if (body !== undefined) request.body = body;
  const response = await fetch(path, request);
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(response.status, parsed.error ?? "invalid");
  return parsed as T;
}

export async function apiBytes(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(path, { credentials: "include", headers: { "X-Mandoc-Request": "1" } });
  if (!response.ok) {
    const text = await response.text();
    let code = "invalid";
    try {
      code = (JSON.parse(text) as { error?: string }).error ?? code;
    } catch {
      code = "invalid";
    }
    throw new ApiError(response.status, code);
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
}
