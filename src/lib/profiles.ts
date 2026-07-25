/** Shared, user-visible measurement budgets. Keep estimates and engine caps together. */
export const PROFILES = {
  full: {
    idleProbes: 14,
    serverProbes: 6,
    single: { streams: 1, chunkBytes: 25_000_000, minMs: 3000, maxMs: 6000, maxBytes: 80_000_000 },
    multi: { streams: 4, chunkBytes: 25_000_000, minMs: 4000, maxMs: 9000, maxBytes: 220_000_000 },
    upload: { streams: 3, chunkBytes: 2_000_000, minMs: 4000, maxMs: 8000, maxBytes: 70_000_000 },
    capacityDownload: { ramp: [1, 2, 4, 6, 8], maxMs: 15_000, maxBytes: 750_000_000, maxRequestBytes: 64_000_000, warmupBytes: 2_000_000, stageMinMs: 1_200, stageMaxMs: 2_200, finalStageMinMs: 4_000 },
    capacityUpload: { ramp: [1, 2, 4], maxMs: 11_000, maxBytes: 150_000_000, maxRequestBytes: 8_000_000, warmupBytes: 512_000, stageMinMs: 1_200, stageMaxMs: 2_200, finalStageMinMs: 3_500 },
    estimatedDurationSec: 35,
    estimatedDataMB: 500,
  },
  lowData: {
    idleProbes: 10,
    serverProbes: 4,
    single: { streams: 1, chunkBytes: 8_000_000, minMs: 2000, maxMs: 4000, maxBytes: 12_000_000 },
    multi: { streams: 2, chunkBytes: 8_000_000, minMs: 2000, maxMs: 5000, maxBytes: 22_000_000 },
    upload: { streams: 1, chunkBytes: 1_000_000, minMs: 2000, maxMs: 4000, maxBytes: 8_000_000 },
    capacityDownload: { ramp: [1, 2], maxMs: 5_000, maxBytes: 25_000_000, maxRequestBytes: 8_000_000, warmupBytes: 1_000_000, stageMinMs: 900, stageMaxMs: 1_600, finalStageMinMs: 2_000 },
    capacityUpload: { ramp: [1], maxMs: 3_500, maxBytes: 10_000_000, maxRequestBytes: 1_500_000, warmupBytes: 256_000, stageMinMs: 900, stageMaxMs: 1_500, finalStageMinMs: 2_000 },
    estimatedDurationSec: 20,
    estimatedDataMB: 40,
  },
  quick: {
    idleProbes: 6,
    serverProbes: 3,
    single: { streams: 1, chunkBytes: 4_000_000, minMs: 1200, maxMs: 2500, maxBytes: 6_000_000 },
    multi: { streams: 2, chunkBytes: 4_000_000, minMs: 1500, maxMs: 3000, maxBytes: 10_000_000 },
    upload: { streams: 1, chunkBytes: 512_000, minMs: 1500, maxMs: 2500, maxBytes: 4_000_000 },
    capacityDownload: { ramp: [1, 2], maxMs: 3_500, maxBytes: 14_000_000, maxRequestBytes: 4_000_000, warmupBytes: 750_000, stageMinMs: 700, stageMaxMs: 1_200, finalStageMinMs: 1_500 },
    capacityUpload: { ramp: [1], maxMs: 2_500, maxBytes: 5_000_000, maxRequestBytes: 750_000, warmupBytes: 192_000, stageMinMs: 700, stageMaxMs: 1_000, finalStageMinMs: 1_500 },
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
  const measuredCaps = profile.capacityDownload.maxBytes + profile.capacityUpload.maxBytes;
  const warmups = profile.capacityDownload.warmupBytes + profile.capacityUpload.warmupBytes;
  return Math.ceil((measuredCaps + warmups) / 1_000_000);
}

export { DOWNLOAD_WARMUP_BYTES, UPLOAD_WARMUP_BYTES };
