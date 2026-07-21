import { createHmac } from "node:crypto";
import { privacyKey, safeSecretEqual } from "./areaPulsePrivacy";

const MAX_SKEW_SECONDS = 300;

export function verifySignedAdminRequest(options: { request: Request; body: string; secret: string; now?: number }): { ok: true; nonce: string; actorKey: string } | { ok: false; error: string } {
  const timestampText = options.request.headers.get("x-netpulse-timestamp") ?? "";
  const nonce = options.request.headers.get("x-netpulse-nonce") ?? "";
  const supplied = options.request.headers.get("x-netpulse-signature") ?? "";
  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return { ok: false, error: "Signed request timestamp is missing or expired." };
  if (!/^[0-9a-f-]{36}$/.test(nonce)) return { ok: false, error: "Signed request nonce is invalid." };
  if (!/^[0-9a-f]{64}$/.test(supplied)) return { ok: false, error: "Signed request signature is invalid." };
  const expected = createHmac("sha256", options.secret).update(`${timestampText}.${nonce}.${options.body}`).digest("hex");
  if (!safeSecretEqual(expected, supplied)) return { ok: false, error: "Signed request signature is invalid." };
  return { ok: true, nonce, actorKey: privacyKey(options.secret, "admin-signature", supplied) };
}
