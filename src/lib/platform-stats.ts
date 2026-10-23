// Helper to generate a stable pseudo-random number based on a string seed.
// A final avalanche step is applied after the rolling hash: without it, seeds
// that differ by a single character (e.g. "profit-2026-10-23" vs
// "profit-2026-10-24") hash only 1 apart, which after scaling rounds back to
// the exact same dollars — the stats would never visibly change.
export function getSeededRandom(seedStr: string): number {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (Math.imul(31, hash) + seedStr.charCodeAt(i)) | 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295; // Returns a number between 0 and 1
}

export type PlatformWindow = {
  profit: number;
  loss: number;
};

export type PlatformStats = {
  today: PlatformWindow;
  week: PlatformWindow;
  month: PlatformWindow;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Platform-wide mock statistics. Seeded by the current date so the numbers are
 * stable across page refreshes and only change once per day. Losses are always
 * 8–10x smaller than the matching profit window, mirroring the design brief.
 */
export function createPlatformStats(now: Date = new Date()): PlatformStats {
  const todayStr = now.toISOString().slice(0, 10);
  const weekSeed = `${todayStr.slice(0, 7)}-${Math.ceil(now.getDate() / 7)}`;
  const monthSeed = todayStr.slice(0, 7);

  const todayProfit = 10_000 + getSeededRandom(`profit-${todayStr}`) * 40_000;
  const todayLoss = todayProfit / (8 + getSeededRandom(`loss-${todayStr}`) * 2);

  const weekProfit = todayProfit * 5 + getSeededRandom(`wprofit-${weekSeed}`) * 30_000;
  const weekLoss = weekProfit / (8 + getSeededRandom(`wloss-${weekSeed}`) * 2);

  const monthProfit = weekProfit * 4 + getSeededRandom(`mprofit-${monthSeed}`) * 150_000;
  const monthLoss = monthProfit / (8 + getSeededRandom(`mloss-${monthSeed}`) * 2);

  return {
    today: { profit: round2(todayProfit), loss: round2(todayLoss) },
    week: { profit: round2(weekProfit), loss: round2(weekLoss) },
    month: { profit: round2(monthProfit), loss: round2(monthLoss) },
  };
}
