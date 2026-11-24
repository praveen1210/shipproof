import type { Category, Cluster, HistoryEntry, IssueResults, ResultStatus, ScenarioRecord } from './types';
import { categoryText, effectiveCategory } from './types';

export type EvidenceStatus =
  | 'failing-product'
  | 'failing-unclassified'
  | 'failing-maintenance'
  | 'failing-environment'
  | 'flaky'
  | 'passing'
  | 'skipped'
  | 'no-evidence';

export const STATUS_TEXT: Record<EvidenceStatus, string> = {
  'failing-product': 'Failing – product defect',
  'failing-unclassified': 'Failing – unclassified',
  'failing-maintenance': 'Failing – test maintenance',
  'failing-environment': 'Failing – environment',
  flaky: 'Flaky',
  passing: 'Passing',
  skipped: 'Skipped',
  'no-evidence': 'No test evidence',
};

export interface LatestState {
  status: ResultStatus;
  category?: Category;
  flaky: boolean;
  stale: boolean;
  signature?: string;
  durationMs?: number;
  buildUrl?: string;
  runId: string;
  at: number;
}

export function sortedHistory(s: ScenarioRecord): HistoryEntry[] {
  return [...s.history].sort((a, b) => a.at - b.at);
}

export function latestState(s: ScenarioRecord, now: number, staleHours: number): LatestState | undefined {
  const h = sortedHistory(s);
  const last = h[h.length - 1];
  if (!last) return undefined;
  return {
    status: last.status,
    category: last.category,
    flaky: !!last.flaky,
    stale: now - last.at > staleHours * 3600_000,
    signature: last.signature,
    durationMs: last.durationMs,
    buildUrl: last.buildUrl,
    runId: last.runId,
    at: last.at,
  };
}

/**
 * Trusted evidence (§6.5): latest result passed or failed as a product defect, and NOT flaky,
 * environment, maintenance, unclassified, skipped or stale.
 */
export function isTrusted(l: LatestState | undefined): boolean {
  if (!l || l.stale || l.flaky) return false;
  if (l.status === 'passed') return true;
  return l.status === 'failed' && l.category === 'product';
}

/** "✅✅❌🎲⏭" – oldest → newest. Emoji + the panel's text labels, never colour alone. */
export function historyStrip(s: ScenarioRecord): string {
  return sortedHistory(s)
    .map((h) => (h.status === 'passed' ? '✅' : h.status === 'skipped' ? '⏭' : h.flaky ? '🎲' : '❌'))
    .join('');
}

export interface ScenarioEvidence {
  id: string;
  name: string;
  suite?: string;
  latest: LatestState;
  categoryLabel: string;
  ruleId?: string;
  historyStrip: string;
  bugKey?: string;
}

export interface IssueEvidence {
  issueKey: string;
  status: EvidenceStatus;
  statusText: string;
  counts: { total: number; passed: number; failed: number; skipped: number; flaky: number };
  scenarios: ScenarioEvidence[];
  linkedBugs: string[];
  lastRunAt?: number;
  hint?: string;
}

export function buildIssueEvidence(
  issueKey: string,
  results: IssueResults | undefined,
  clusters: Record<string, Cluster>,
  now: number,
  staleHours: number,
): IssueEvidence {
  const scenarios: ScenarioEvidence[] = [];
  for (const [id, rec] of Object.entries(results ?? {})) {
    const latest = latestState(rec, now, staleHours);
    if (!latest) continue;
    const cluster = latest.signature ? clusters[latest.signature] : undefined;
    const category = cluster ? effectiveCategory(cluster) : latest.category;
    if (category) latest.category = category;
    scenarios.push({
      id,
      name: rec.name,
      suite: rec.suite,
      latest,
      categoryLabel:
        latest.status === 'passed' ? '✅ Passed' : latest.status === 'skipped' ? '⏭ Skipped' : categoryText(category ?? 'unclassified', latest.flaky),
      ruleId: cluster?.ruleId,
      historyStrip: historyStrip(rec),
      bugKey: cluster?.bugKey,
    });
  }

  // failing first, then by name
  const rank = (s: ScenarioEvidence) => (s.latest.status === 'failed' ? (s.latest.flaky ? 1 : 0) : s.latest.status === 'skipped' ? 2 : 3);
  scenarios.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const counts = {
    total: scenarios.length,
    passed: scenarios.filter((s) => s.latest.status === 'passed').length,
    failed: scenarios.filter((s) => s.latest.status === 'failed' && !s.latest.flaky).length,
    skipped: scenarios.filter((s) => s.latest.status === 'skipped').length,
    flaky: scenarios.filter((s) => s.latest.status === 'failed' && s.latest.flaky).length,
  };
  const status = overallStatus(scenarios);
  return {
    issueKey,
    status,
    statusText: STATUS_TEXT[status],
    counts,
    scenarios,
    linkedBugs: Array.from(new Set(scenarios.map((s) => s.bugKey).filter((k): k is string => !!k))),
    lastRunAt: scenarios.length ? Math.max(...scenarios.map((s) => s.latest.at)) : undefined,
    hint: status === 'no-evidence' ? 'Ask the ShipProof agent to draft scenarios' : undefined,
  };
}

export function overallStatus(scenarios: Pick<ScenarioEvidence, 'latest'>[]): EvidenceStatus {
  if (scenarios.length === 0) return 'no-evidence';
  const failing = scenarios.filter((s) => s.latest.status === 'failed');
  const hard = failing.filter((s) => !s.latest.flaky);
  const has = (c: Category) => hard.some((s) => (s.latest.category ?? 'unclassified') === c);
  if (has('product')) return 'failing-product';
  if (has('unclassified')) return 'failing-unclassified';
  if (has('maintenance')) return 'failing-maintenance';
  if (has('environment')) return 'failing-environment';
  if (failing.length) return 'flaky';
  if (scenarios.some((s) => s.latest.status === 'passed')) return 'passing';
  return 'skipped';
}
