import type { Cluster, IssueResults, ReadinessWeights } from './types';
import { DEFAULT_WEIGHTS, effectiveCategory } from './types';
import { isTrusted, latestState } from './evidence';

export type StatusCategory = 'new' | 'indeterminate' | 'done';

export interface ReleaseIssue {
  id?: string;
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
  priority?: string;
  /** Moved from a Done status back to an earlier one (from the changelog). */
  reopened?: boolean;
  /** Open pull requests linked through Teamwork Graph (F12). Undefined when TWG is off. */
  openPrCount?: number;
}

export interface ReleaseInput {
  projectKey: string;
  fixVersion: string;
  issues: ReleaseIssue[];
  /** `res:<issueKey>` for every non-bug issue in the release. */
  evidence: Record<string, IssueResults | undefined>;
  clusters: Record<string, Cluster>;
  now: number;
}

export interface ReadinessOptions {
  weights?: Partial<ReadinessWeights>;
  excludedTypes?: string[];
  staleHours?: number;
}

export interface Factor {
  factor: string;
  points: number;
  count: number;
  issueKeys: string[];
  explanation: string;
}

export interface ReadinessResult {
  score: number;
  factors: Factor[];
}

export interface ConfidenceResult {
  /** 0–100 */
  confidence: number;
  storiesWithEvidence: number;
  trustedScenarios: number;
  totalScenarios: number;
  perIssue: { issueKey: string; trusted: number; total: number; ratio: number }[];
}

export type Verdict = 'Ready' | 'At risk' | 'Not ready';

export interface VerdictResult {
  verdict: Verdict;
  reason: string;
}

const HIGH = /^(highest|high|blocker|critical|p0|p1)$/i;
const MEDIUM = /^(medium|major|p2)$/i;
const DEFAULT_EXCLUDED = ['Bug', 'Epic', 'Sub-task', 'Subtask', 'Spike'];

export function isBug(i: ReleaseIssue): boolean {
  return /^(bug|defect)$/i.test(i.type);
}

export function storiesOf(issues: ReleaseIssue[], excludedTypes: string[] = DEFAULT_EXCLUDED): ReleaseIssue[] {
  const excluded = new Set(excludedTypes.map((t) => t.toLowerCase()));
  return issues.filter((i) => !isBug(i) && !excluded.has(i.type.toLowerCase()));
}

function hasEvidence(r: IssueResults | undefined): boolean {
  return !!r && Object.values(r).some((s) => s.history.length > 0);
}

/** Signatures of the current (latest, non-flaky) product-defect failures of a story. */
function productFailureSignatures(r: IssueResults | undefined, input: ReleaseInput, staleHours: number): string[] {
  const out: string[] = [];
  for (const s of Object.values(r ?? {})) {
    const l = latestState(s, input.now, staleHours);
    if (!l || l.status !== 'failed' || l.flaky) continue;
    const cluster = l.signature ? input.clusters[l.signature] : undefined;
    const cat = cluster ? effectiveCategory(cluster) : l.category;
    if (cat === 'product') out.push(l.signature ?? '');
  }
  return out;
}

/** Readiness (product risk) per §6.5: start at 100, capped deductions, every one explained. */
export function computeReadiness(input: ReleaseInput, opts: ReadinessOptions = {}): ReadinessResult {
  const w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const staleHours = opts.staleHours ?? 72;
  const open = input.issues.filter((i) => i.statusCategory !== 'done');
  const stories = storiesOf(input.issues, opts.excludedTypes);
  const factors: Factor[] = [];

  const add = (factor: string, keys: string[], each: number, cap: number, explanation: string) => {
    if (keys.length === 0 || each <= 0) return;
    factors.push({ factor, count: keys.length, points: Math.min(keys.length * each, cap), issueKeys: keys, explanation });
  };

  add(
    'Open High/Highest bugs',
    open.filter((i) => isBug(i) && HIGH.test(i.priority ?? '')).map((i) => i.key),
    w.highBug,
    w.highBugCap,
    `−${w.highBug} per open High/Highest bug in the fix version (cap −${w.highBugCap}).`,
  );
  add(
    'Open Medium bugs',
    open.filter((i) => isBug(i) && MEDIUM.test(i.priority ?? '')).map((i) => i.key),
    w.mediumBug,
    w.mediumBugCap,
    `−${w.mediumBug} per open Medium bug (cap −${w.mediumBugCap}).`,
  );

  const failingStories: string[] = [];
  const failingSigs = new Set<string>();
  for (const s of stories) {
    const sigs = productFailureSignatures(input.evidence[s.key], input, staleHours);
    if (sigs.length) {
      failingStories.push(s.key);
      sigs.forEach((g) => failingSigs.add(g));
    }
  }
  add(
    'Stories failing with a product defect',
    failingStories,
    w.productFailure,
    w.productFailureCap,
    `−${w.productFailure} per story whose latest run has a 🐞 product-defect failure (flaky, environment and maintenance failures do not count) (cap −${w.productFailureCap}).`,
  );

  const untracked = [...failingSigs].filter((sig) => sig && !input.clusters[sig]?.bugKey);
  const untrackedKeys = untracked.flatMap((sig) => (input.clusters[sig]?.issueKeys ?? []).filter((k) => failingStories.includes(k)));
  if (untracked.length) {
    factors.push({
      factor: 'Untracked product failures',
      count: untracked.length,
      points: Math.min(untracked.length * w.untrackedFailure, w.untrackedFailureCap),
      issueKeys: Array.from(new Set(untrackedKeys)),
      explanation: `−${w.untrackedFailure} per product-defect cluster with no linked Jira bug (${untracked.map((s) => `sp-sig-${s}`).join(', ')}) (cap −${w.untrackedFailureCap}).`,
    });
  }

  add(
    'Stories with no test evidence',
    stories.filter((s) => !hasEvidence(input.evidence[s.key])).map((s) => s.key),
    w.noEvidence,
    w.noEvidenceCap,
    `−${w.noEvidence} per story with no mapped test results (cap −${w.noEvidenceCap}).`,
  );

  const prIssues = input.issues.filter((i) => (i.openPrCount ?? 0) > 0);
  const prCount = prIssues.reduce((a, i) => a + (i.openPrCount ?? 0), 0);
  if (prCount > 0 && w.openPr > 0) {
    factors.push({
      factor: 'Open pull requests',
      count: prCount,
      points: Math.min(prCount * w.openPr, w.openPrCap),
      issueKeys: prIssues.map((i) => i.key),
      explanation: `−${w.openPr} per open PR linked to a release issue, from Teamwork Graph (cap −${w.openPrCap}).`,
    });
  }

  add(
    'Reopened issues',
    input.issues.filter((i) => i.reopened && i.statusCategory !== 'done').map((i) => i.key),
    w.reopened,
    w.reopenedCap,
    `−${w.reopened} per issue moved back from Done (cap −${w.reopenedCap}).`,
  );
  add(
    'Issues not Done',
    open.map((i) => i.key),
    w.notDone,
    w.notDoneCap,
    `−${w.notDone} per issue not yet Done (cap −${w.notDoneCap}).`,
  );

  const score = Math.max(0, 100 - factors.reduce((a, f) => a + f.points, 0));
  factors.sort((a, b) => b.points - a.points);
  return { score, factors };
}

/** Evidence confidence per §6.5: mean over stories with evidence of trusted / total scenarios. */
export function computeConfidence(input: ReleaseInput, opts: ReadinessOptions = {}): ConfidenceResult {
  const staleHours = opts.staleHours ?? 72;
  const perIssue: ConfidenceResult['perIssue'] = [];
  let trustedScenarios = 0;
  let totalScenarios = 0;
  for (const s of storiesOf(input.issues, opts.excludedTypes)) {
    const r = input.evidence[s.key];
    if (!hasEvidence(r)) continue;
    const states = Object.values(r!).map((sc) => latestState(sc, input.now, staleHours));
    const total = states.filter(Boolean).length;
    const trusted = states.filter((l) => {
      if (!l) return false;
      const cluster = l.signature ? input.clusters[l.signature] : undefined;
      return isTrusted(cluster ? { ...l, category: effectiveCategory(cluster) } : l);
    }).length;
    trustedScenarios += trusted;
    totalScenarios += total;
    perIssue.push({ issueKey: s.key, trusted, total, ratio: total ? trusted / total : 0 });
  }
  const mean = perIssue.length ? perIssue.reduce((a, p) => a + p.ratio, 0) / perIssue.length : 0;
  return {
    confidence: Math.round(mean * 100),
    storiesWithEvidence: perIssue.length,
    trustedScenarios,
    totalScenarios,
    perIssue: perIssue.sort((a, b) => a.ratio - b.ratio),
  };
}

export function verdictFor(readiness: number, confidence: number): VerdictResult {
  if (readiness < 60) return { verdict: 'Not ready', reason: `Readiness ${readiness} is below 60: real product risk remains.` };
  if (readiness >= 80 && confidence >= 70) return { verdict: 'Ready', reason: `Readiness ${readiness} ≥ 80 and evidence confidence ${confidence}% ≥ 70%.` };
  if (readiness >= 80) {
    return {
      verdict: 'At risk',
      reason: `At risk – low evidence confidence: readiness ${readiness} looks fine, but only ${confidence}% of the test evidence can be trusted (flaky, environment, maintenance, skipped or stale results).`,
    };
  }
  return { verdict: 'At risk', reason: `Readiness ${readiness} is between 60 and 79.` };
}

export interface ReleaseEvaluation {
  projectKey: string;
  fixVersion: string;
  readiness: number;
  confidence: number;
  verdict: Verdict;
  verdictReason: string;
  factors: Factor[];
  confidenceDetail: ConfidenceResult;
  issueCount: number;
  storyCount: number;
  storiesWithoutEvidence: string[];
  evaluatedAt: number;
}

export function evaluateRelease(input: ReleaseInput, opts: ReadinessOptions = {}): ReleaseEvaluation {
  const r = computeReadiness(input, opts);
  const c = computeConfidence(input, opts);
  const v = verdictFor(r.score, c.confidence);
  const stories = storiesOf(input.issues, opts.excludedTypes);
  return {
    projectKey: input.projectKey,
    fixVersion: input.fixVersion,
    readiness: r.score,
    confidence: c.confidence,
    verdict: v.verdict,
    verdictReason: v.reason,
    factors: r.factors,
    confidenceDetail: c,
    issueCount: input.issues.length,
    storyCount: stories.length,
    storiesWithoutEvidence: stories.filter((s) => !hasEvidence(input.evidence[s.key])).map((s) => s.key),
    evaluatedAt: input.now,
  };
}
