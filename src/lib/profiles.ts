/** Shared, user-visible measurement budgets. Keep estimates and engine caps together. */
export const PROFILES = {
  full: {
    idleProbes: 14,
    serverProbes: 6,
    single: { streams: 1, chunkBytes: 25_000_000, minMs: 3000, maxMs: 6000, maxBytes: 80_000_000 },
    multi: { streams: 4, chunkBytes: 25_000_000, minMs: 4000, maxMs: 9000, maxBytes: 220_000_000 },
    upload: { streams: 3, chunkBytes: 2_000_000, minMs: 4000, maxMs: 8000, maxBytes: 70_000_000 },
    estimatedDurationSec: 34,
    estimatedDataMB: 250,
  },
  lowData: {
    idleProbes: 10,
    serverProbes: 4,
    single: { streams: 1, chunkBytes: 8_000_000, minMs: 2000, maxMs: 4000, maxBytes: 12_000_000 },
    multi: { streams: 2, chunkBytes: 8_000_000, minMs: 2000, maxMs: 5000, maxBytes: 22_000_000 },
    upload: { streams: 1, chunkBytes: 1_000_000, minMs: 2000, maxMs: 4000, maxBytes: 8_000_000 },
    estimatedDurationSec: 20,
    estimatedDataMB: 40,
  },
  quick: {
    idleProbes: 6,
    serverProbes: 3,
    single: { streams: 1, chunkBytes: 4_000_000, minMs: 1200, maxMs: 2500, maxBytes: 6_000_000 },
    multi: { streams: 2, chunkBytes: 4_000_000, minMs: 1500, maxMs: 3000, maxBytes: 10_000_000 },
    upload: { streams: 1, chunkBytes: 512_000, minMs: 1500, maxMs: 2500, maxBytes: 4_000_000 },
    estimatedDurationSec: 14,
    estimatedDataMB: 24,
  },
} as const;

export type ProfileId = keyof typeof PROFILES;

export function resolveProfile(profile: ProfileId | undefined, lowData: boolean) {
  return PROFILES[profile ?? (lowData ? "lowData" : "full")];
}

const DOWNLOAD_WARMUP_BYTES = 1_000_000;
const UPLOAD_WARMUP_BYTES = 256_000;

export function profileDataCeilingMB(lowData: boolean, profileId?: ProfileId): number {
  const profile = resolveProfile(profileId, lowData);
  const measuredCaps = profile.single.maxBytes + profile.multi.maxBytes + profile.upload.maxBytes;
  const warmups = DOWNLOAD_WARMUP_BYTES * 2 + UPLOAD_WARMUP_BYTES;
  return Math.ceil((measuredCaps + warmups) / 1_000_000);
}

export { DOWNLOAD_WARMUP_BYTES, UPLOAD_WARMUP_BYTES };
