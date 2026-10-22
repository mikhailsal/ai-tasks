export interface TestClock {
  now(): number;
  set(instantMs: number): void;
  advanceBy(durationMs: number): number;
}

export function createTestClock(initialInstantMs = Date.UTC(2026, 0, 1)): TestClock {
  if (!Number.isSafeInteger(initialInstantMs)) {
    throw new TypeError('Initial test clock instant must be an integer Unix millisecond value');
  }

  let currentInstantMs = initialInstantMs;

  return {
    now: () => currentInstantMs,
    set(instantMs) {
      if (!Number.isSafeInteger(instantMs)) {
        throw new TypeError('Test clock instant must be an integer Unix millisecond value');
      }
      currentInstantMs = instantMs;
    },
    advanceBy(durationMs) {
      if (!Number.isSafeInteger(durationMs)) {
        throw new TypeError('Test clock duration must be an integer number of milliseconds');
      }
      const nextInstantMs = currentInstantMs + durationMs;
      if (!Number.isSafeInteger(nextInstantMs)) {
        throw new RangeError('Test clock moved outside the safe integer range');
      }
      currentInstantMs = nextInstantMs;
      return currentInstantMs;
    },
  };
}
