import { describe, expect, it } from "vitest";
import {
  ENDPOINT_DIRECTORY_SCHEMA_VERSION,
  FALLBACK_DIRECTORY,
  isHealthFresh,
  parseEndpointDirectory,
  parseEndpointHealth,
} from "../globalNetwork";

describe("global endpoint directory", () => {
  it("accepts the checked-in fail-closed directory model", () => {
    const parsed = parseEndpointDirectory(FALLBACK_DIRECTORY);
    expect(parsed?.schemaVersion).toBe(ENDPOINT_DIRECTORY_SCHEMA_VERSION);
    expect(parsed?.endpoints).toHaveLength(1);
    expect(parsed?.coverage.every((region) => region.status === "planned")).toBe(true);
    expect(parsed?.endpoints[0].capabilities.echo).toBe(false);
  });

  it("rejects insecure measurement URLs", () => {
    const unsafe = structuredClone(FALLBACK_DIRECTORY);
    unsafe.endpoints[0].uploadUrl = "http://example.com/up";
    expect(parseEndpointDirectory(unsafe)).toBeNull();
  });

  it("rejects duplicate endpoint IDs and incompatible schemas", () => {
    const duplicate = structuredClone(FALLBACK_DIRECTORY);
    duplicate.endpoints.push(structuredClone(duplicate.endpoints[0]));
    expect(parseEndpointDirectory(duplicate)).toBeNull();
    expect(parseEndpointDirectory({ ...FALLBACK_DIRECTORY, schemaVersion: 99 })).toBeNull();
  });
});

describe("endpoint health", () => {
  const health = {
    status: "healthy",
    checkedAt: "2026-07-21T10:00:00.000Z",
    expiresAt: "2026-07-21T10:01:00.000Z",
    loadPct: 24,
    capacityMbps: 25_000,
    availableCapacityMbps: 19_000,
    activeTests: 12,
    maxConcurrentTests: 100,
    serverVersion: "1.2.0",
    protocolVersion: 1,
    reason: "Within operating limits",
  };

  it("accepts bounded, versioned health telemetry", () => {
    expect(parseEndpointHealth(health)).toMatchObject({ status: "healthy", loadPct: 24, protocolVersion: 1 });
  });

  it("rejects impossible load and stale health", () => {
    expect(parseEndpointHealth({ ...health, loadPct: 101 })).toBeNull();
    const parsed = parseEndpointHealth(health);
    expect(parsed && isHealthFresh(parsed, Date.parse("2026-07-21T10:00:30.000Z"))).toBe(true);
    expect(parsed && isHealthFresh(parsed, Date.parse("2026-07-21T10:02:00.000Z"))).toBe(false);
  });
});
