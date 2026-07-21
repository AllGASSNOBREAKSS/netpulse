export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": crypto.randomUUID(),
      ...extraHeaders,
    },
  });
}

export async function limitedJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RequestBodyError("Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyError("Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestBodyError("Request body is too large.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError("Request body must be valid JSON.");
  }
}

export async function limitedJsonText(request: Request, maxBytes = 16_384): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RequestBodyError("Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyError("Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestBodyError("Request body is too large.");
  return text;
}

export class RequestBodyError extends Error {}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return /^Bearer [^\s]{16,512}$/.test(authorization) ? authorization.slice(7) : "";
}
