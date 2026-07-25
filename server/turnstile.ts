const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export async function verifyTurnstile(options: { token: string; remoteIp: string; secret: string; expectedHostname?: string; expectedAction?: "area-pulse-report" | "area-pulse-abuse" }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: options.secret, response: options.token, remoteip: options.remoteIp, idempotency_key: crypto.randomUUID() }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "Anti-abuse verification service was unavailable." };
    const parsed: unknown = await response.json();
    if (!isTurnstileResponse(parsed) || parsed.success !== true) return { ok: false, reason: "Anti-abuse verification failed or expired." };
    if (parsed.action !== (options.expectedAction ?? "area-pulse-report")) return { ok: false, reason: "Anti-abuse verification action did not match." };
    if (!options.expectedHostname || parsed.hostname !== options.expectedHostname) return { ok: false, reason: "Anti-abuse verification hostname did not match." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "Anti-abuse verification service was unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}

function isTurnstileResponse(value: unknown): value is TurnstileResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
