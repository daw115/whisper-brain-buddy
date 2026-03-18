import { describe, it, expect } from "vitest";

// We test the pure functions extracted from frame-extractor logic.
// buildTimestamps is not exported, so we replicate it here for testing.

function buildTimestamps(duration: number, intervalSeconds: number, maxFrames: number): number[] {
  const safeDuration = Math.max(duration, 0.1);
  const lastAllowed = Math.max(0, safeDuration - 0.1);
  const timestamps: number[] = [];

  const pushUnique = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), lastAllowed);
    if (timestamps.some((existing) => Math.abs(existing - clamped) < 0.25)) return;
    timestamps.push(clamped);
  };

  if (safeDuration <= 10) {
    pushUnique(safeDuration / 2);
    return timestamps;
  }

  for (let t = 5; t < safeDuration && timestamps.length < maxFrames; t += intervalSeconds) {
    pushUnique(t);
  }

  if (timestamps.length === 0) {
    pushUnique(Math.min(5, safeDuration / 2));
  }

  if (timestamps.length < maxFrames && safeDuration > 10) {
    pushUnique(safeDuration - 5);
  }

  return timestamps.sort((a, b) => a - b).slice(0, maxFrames);
}

function applyOffset(timestamps: number[], offset: number): number[] {
  return timestamps.map(t => t + offset);
}

describe("buildTimestamps", () => {
  it("returns single midpoint for short videos (<=10s)", () => {
    const ts = buildTimestamps(8, 30, 50);
    expect(ts).toEqual([4]);
  });

  it("generates timestamps at intervals for normal video", () => {
    const ts = buildTimestamps(120, 30, 50);
    expect(ts[0]).toBe(5);
    expect(ts[1]).toBe(35);
    expect(ts[2]).toBe(65);
    expect(ts[3]).toBe(95);
    // Last frame should be near the end
    expect(ts[ts.length - 1]).toBe(115);
  });

  it("respects maxFrames limit", () => {
    const ts = buildTimestamps(3600, 10, 5);
    expect(ts.length).toBeLessThanOrEqual(5);
  });

  it("does not exceed video duration", () => {
    const ts = buildTimestamps(60, 30, 50);
    for (const t of ts) {
      expect(t).toBeLessThanOrEqual(60);
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns sorted timestamps", () => {
    const ts = buildTimestamps(300, 30, 50);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
  });
});

describe("cumulative offset for multi-segment frames", () => {
  it("first segment has no offset", () => {
    const ts = buildTimestamps(120, 30, 50);
    const withOffset = applyOffset(ts, 0);
    expect(withOffset).toEqual(ts);
  });

  it("second segment timestamps start after first segment duration", () => {
    const seg1Duration = 120;
    const seg2Timestamps = buildTimestamps(90, 30, 50);
    const withOffset = applyOffset(seg2Timestamps, seg1Duration);

    // All timestamps should be >= seg1Duration
    for (const t of withOffset) {
      expect(t).toBeGreaterThanOrEqual(seg1Duration);
    }
    // First should be seg1Duration + 5
    expect(withOffset[0]).toBe(seg1Duration + 5);
  });

  it("three segments produce continuous timeline", () => {
    const durations = [120, 90, 150];
    let cumulativeOffset = 0;
    const allTimestamps: number[] = [];

    for (const dur of durations) {
      const ts = buildTimestamps(dur, 30, 50);
      const withOffset = applyOffset(ts, cumulativeOffset);
      allTimestamps.push(...withOffset);
      cumulativeOffset += dur;
    }

    // Should be strictly increasing
    for (let i = 1; i < allTimestamps.length; i++) {
      expect(allTimestamps[i]).toBeGreaterThan(allTimestamps[i - 1]);
    }

    // Last timestamp should be close to total duration
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    expect(allTimestamps[allTimestamps.length - 1]).toBeLessThanOrEqual(totalDuration);
    expect(allTimestamps[allTimestamps.length - 1]).toBeGreaterThan(totalDuration - 10);
  });

  it("frame filenames reflect cumulative timestamps", () => {
    const seg1Duration = 1800; // 30 min
    const seg2Timestamps = buildTimestamps(1800, 30, 50);
    const withOffset = applyOffset(seg2Timestamps, seg1Duration);

    // Simulate filename generation
    const filenames = withOffset.map(t => `frame_${Math.round(t)}s.jpg`);
    
    // First frame of seg2 should be around 1805s
    expect(filenames[0]).toBe("frame_1805s.jpg");
    
    // All should have seconds > seg1Duration
    for (const fn of filenames) {
      const m = fn.match(/frame_(\d+)s/);
      expect(Number(m![1])).toBeGreaterThanOrEqual(seg1Duration);
    }
  });
});

describe("quickHash dedup simulation", () => {
  it("identical data produces same hash, different data produces different hash", () => {
    function quickHash(data: Uint8Array): string {
      let hash = 0;
      for (let i = 0; i < data.length; i += 40) {
        hash = ((hash << 5) - hash + data[i]) | 0;
      }
      return hash.toString(36);
    }

    const a = new Uint8Array(200).fill(42);
    const b = new Uint8Array(200).fill(42);
    const c = new Uint8Array(200).fill(99);

    expect(quickHash(a)).toBe(quickHash(b));
    expect(quickHash(a)).not.toBe(quickHash(c));
  });
});
