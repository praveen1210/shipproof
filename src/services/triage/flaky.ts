import type { HistoryEntry } from '../types';

export const FLAKY_WINDOW = 10;
export const FLAKY_MIN_RATE = 0.2;
export const FLAKY_MAX_RATE = 0.9;
/** Below this many decided (pass/fail) results we can't call anything flaky. */
export const FLAKY_MIN_RESULTS = 3;
/**
 * Minimum pass↔fail flips. A brand-new regression (P P P P P P P P F) has a 89% pass rate
 * but only one flip: it is a real failure, not a flaky test. Refinement over the PRD's
 * pure pass-rate rule, documented in docs/PRD.md §6.3 notes.
 */
export const FLAKY_MIN_FLIPS = 2;

export interface FlakyStats {
  passRate: number;
  decided: number;
  flips: number;
  flaky: boolean;
}

/** Chronological (oldest first) history, at most the last 10 entries are considered. */
export function flakyStats(history: Pick<HistoryEntry, 'status' | 'at'>[]): FlakyStats {
  const window = [...history].sort((a, b) => a.at - b.at).slice(-FLAKY_WINDOW);
  const decided = window.filter((h) => h.status !== 'skipped');
  const passed = decided.filter((h) => h.status === 'passed').length;
  let flips = 0;
  for (let i = 1; i < decided.length; i++) if (decided[i].status !== decided[i - 1].status) flips++;
  const passRate = decided.length ? passed / decided.length : 0;
  const flaky =
    decided.length >= FLAKY_MIN_RESULTS &&
    flips >= FLAKY_MIN_FLIPS &&
    passRate >= FLAKY_MIN_RATE &&
    passRate <= FLAKY_MAX_RATE;
  return { passRate, decided: decided.length, flips, flaky };
}

/** Step 4 (§6.3): flaky = unstable history AND failed in the latest run. */
export function isFlakyFailure(history: Pick<HistoryEntry, 'status' | 'at'>[]): boolean {
  if (history.length === 0) return false;
  const latest = [...history].sort((a, b) => a.at - b.at)[history.length - 1];
  return latest.status === 'failed' && flakyStats(history).flaky;
}
