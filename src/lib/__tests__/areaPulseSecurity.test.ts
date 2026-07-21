import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { limitedJsonBody, RequestBodyError } from "../../../server/areaPulseHttp";
import { coarseRegionFromRequest, privacyKey, transientRequestIp } from "../../../server/areaPulsePrivacy";
import { validateAbuseReport, validateAreaReport, validateProviderMessage } from "../../../server/areaPulseValidation";
import { verifySignedAdminRequest } from "../../../server/signedRequest";
import { verifyTurnstile } from "../../../server/turnstile";

describe("Area Pulse API security controls", () => {
  it("uses only the platform-specific address header for privacy rate keys", () => {
    const spoofed = new Request("https://netpulse.example/api", { headers: { "x-forwarded-for": "203.0.113.8", "x-real-ip": "203.0.113.9" } });
    expect(transientRequestIp(spoofed)).toBeNull();
    const platform = new Request("https://netpulse.example/api", { headers: { "x-vercel-forwarded-for": "2001:db8::1" } });
    expect(transientRequestIp(platform)).toBe("2001:db8::1");
    expect(privacyKey("s".repeat(32), "reporter", "2001:db8::1")).not.toContain("2001:db8::1");
  });

  it("derives only coarse sanitized region fields and no coordinates", () => {
    const request = new Request("https://netpulse.example/api", { headers: { "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "NY", "x-vercel-ip-city": "New%20York" } });
    expect(coarseRegionFromRequest(request)).toEqual({ key: "us|ny|new york", label: "New York, NY", level: "city", countryCode: "US", approximate: true });
    expect(JSON.stringify(coarseRegionFromRequest(request))).not.toMatch(/latitude|longitude|coordinate|203\./i);
  });

  it("rejects report markup, links, contact details, oversized tokens, and mass-assigned fields", () => {
    const base = { kind: "complete_outage", isp: "Example ISP", asn: "AS64500", service: null, note: null, turnstileToken: "token", identityConsent: true, measurement: null };
    expect(validateAreaReport({ ...base, note: "<script>alert(1)</script>" }).ok).toBe(false);
    expect(validateAreaReport({ ...base, note: "visit https://evil.example" }).ok).toBe(false);
    expect(validateAreaReport({ ...base, note: "me@example.com" }).ok).toBe(false);
    expect(validateAreaReport({ ...base, turnstileToken: "x".repeat(2049) }).ok).toBe(false);
    const accepted = validateAreaReport({ ...base, admin: true, official: true });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value).not.toHaveProperty("admin");
  });

  it("rejects private, credentialed, non-HTTPS, and malformed provider source URLs", () => {
    const base = { id: "notice-1", isp: "Example ISP", asn: "AS64500", regionKey: null, regionLabel: null, regionLevel: null, countryCode: null, title: "Incident", message: "Investigating", status: "active", publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceLabel: "Status" };
    for (const sourceUrl of ["http://status.example.com", "https://127.0.0.1/x", "https://10.0.0.1/x", "https://user:pass@example.com/x", "javascript:alert(1)"]) {
      expect(validateProviderMessage({ ...base, sourceUrl }).ok).toBe(false);
    }
    expect(validateProviderMessage({ ...base, sourceUrl: "https://status.example.com/incidents/1" }).ok).toBe(true);
  });

  it("strictly validates private abuse reports", () => {
    const valid = { incidentId: "as64500-complete_outage-general-1", reason: "inaccurate", details: "Pattern appears incorrect", turnstileToken: "token" };
    expect(validateAbuseReport(valid).ok).toBe(true);
    expect(validateAbuseReport({ ...valid, reason: "delete_everything" }).ok).toBe(false);
    expect(validateAbuseReport({ ...valid, details: "contact me@example.com" }).ok).toBe(false);
    expect(validateAbuseReport({ ...valid, details: "<img src=x>" }).ok).toBe(false);
  });

  it("enforces content type and encoded byte limits", async () => {
    await expect(limitedJsonBody(new Request("https://netpulse.example", { method: "POST", body: "{}" }))).rejects.toBeInstanceOf(RequestBodyError);
    const oversized = new Request("https://netpulse.example", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "é".repeat(20) }) });
    await expect(limitedJsonBody(oversized, 20)).rejects.toThrow(/too large/i);
  });

  it("verifies signed request body, timestamp, signature, and nonce shape", () => {
    const secret = "k".repeat(32);
    const timestamp = "1784462400";
    const nonce = "123e4567-e89b-12d3-a456-426614174000";
    const body = JSON.stringify({ id: "notice-1" });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
    const request = new Request("https://netpulse.example/api", { headers: { "x-netpulse-timestamp": timestamp, "x-netpulse-nonce": nonce, "x-netpulse-signature": signature } });
    expect(verifySignedAdminRequest({ request, body, secret, now: Number(timestamp) * 1000 }).ok).toBe(true);
    expect(verifySignedAdminRequest({ request, body: `${body} `, secret, now: Number(timestamp) * 1000 }).ok).toBe(false);
    expect(verifySignedAdminRequest({ request, body, secret, now: Number(timestamp) * 1000 + 301_000 }).ok).toBe(false);
  });

  it("requires Turnstile success plus exact action and hostname", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, action: "area-pulse-report", hostname: "netpulse.example" })));
    await expect(verifyTurnstile({ token: "token", remoteIp: "203.0.113.1", secret: "secret", expectedHostname: "netpulse.example" })).resolves.toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, action: "other", hostname: "netpulse.example" })));
    await expect(verifyTurnstile({ token: "token", remoteIp: "203.0.113.1", secret: "secret", expectedHostname: "netpulse.example" })).resolves.toMatchObject({ ok: false });
    vi.unstubAllGlobals();
  });

  it("keeps the deployment CSP strict and the schema free of raw address or coordinates", () => {
    const vercel = readFileSync("vercel.json", "utf8");
    const migration = readFileSync("migrations/001_area_pulse.sql", "utf8");
    expect(vercel).toContain("frame-ancestors 'none'");
    expect(vercel).not.toContain("'unsafe-eval'");
    expect(vercel).toContain("https://challenges.cloudflare.com");
    expect(migration).toContain("REVOKE ALL");
    expect(migration).not.toMatch(/raw_ip|ip_address|latitude|longitude/i);
  });
});
