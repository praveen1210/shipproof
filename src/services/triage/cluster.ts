import type { Category, Cluster } from '../types';

export interface FailureOccurrence {
  signature: string;
  category: Category;
  ruleId: string;
  explanation: string;
  flaky: boolean;
  skeleton: string;
  exceptionType: string;
  failedStep: string;
  error: string;
  scenarioId: string;
  issueKeys: string[];
}

export interface RunContext {
  projectKey: string;
  runId: string;
  at: number;
  buildUrl?: string;
  environment?: string;
}

const MAX_LIST = 50;
const MAX_RUNS = 60;

/**
 * Step 5 (§6.3): cluster by (projectKey, signature). Occurrences are stored per run, so
 * re-ingesting the same build replaces that run's contribution instead of double counting.
 */
export function mergeCluster(existing: Cluster | undefined, occ: FailureOccurrence[], run: RunContext): Cluster {
  if (occ.length === 0) throw new Error('mergeCluster needs at least one occurrence');
  const first = occ[0];
  const flakyCount = occ.filter((o) => o.flaky).length;

  const runCounts: Record<string, number> = { ...(existing?.runCounts ?? {}) };
  runCounts[run.runId] = occ.length;
  pruneRuns(runCounts);

  const count = Object.values(runCounts).reduce((a, b) => a + b, 0);
  const isNewer = !existing || run.at >= existing.lastSeen;

  return {
    projectKey: run.projectKey,
    signature: first.signature,
    category: first.category === 'unclassified' && existing ? existing.category : first.category,
    ruleId: first.ruleId === 'NONE' && existing ? existing.ruleId : first.ruleId,
    explanation: first.explanation,
    override: existing?.override,
    flaky: isNewer ? flakyCount * 2 >= occ.length : existing!.flaky,
    skeleton: first.skeleton,
    exceptionType: first.exceptionType,
    failedStep: first.failedStep,
    sampleError: isNewer ? first.error.slice(0, 1000) : existing!.sampleError,
    runCounts,
    count,
    firstSeen: Math.min(existing?.firstSeen ?? run.at, run.at),
    lastSeen: Math.max(existing?.lastSeen ?? run.at, run.at),
    lastRunId: isNewer ? run.runId : existing!.lastRunId,
    issueKeys: union(existing?.issueKeys, occ.flatMap((o) => o.issueKeys)),
    scenarioIds: union(existing?.scenarioIds, occ.map((o) => o.scenarioId)),
    buildUrls: run.buildUrl ? union([run.buildUrl], existing?.buildUrls, 10) : existing?.buildUrls ?? [],
    environments: run.environment ? union(existing?.environments, [run.environment], 10) : existing?.environments ?? [],
    bugKey: existing?.bugKey,
    possibleDuplicates: existing?.possibleDuplicates,
  };
}

/** Removes a run's contribution (used when a re-uploaded build no longer has that failure). */
export function removeRun(existing: Cluster, runId: string): Cluster {
  if (!(runId in existing.runCounts)) return existing;
  const runCounts = { ...existing.runCounts };
  delete runCounts[runId];
  return { ...existing, runCounts, count: Object.values(runCounts).reduce((a, b) => a + b, 0) };
}

export function groupBySignature(occ: FailureOccurrence[]): Map<string, FailureOccurrence[]> {
  const m = new Map<string, FailureOccurrence[]>();
  for (const o of occ) {
    const list = m.get(o.signature);
    if (list) list.push(o);
    else m.set(o.signature, [o]);
  }
  return m;
}

function pruneRuns(runCounts: Record<string, number>): void {
  const keys = Object.keys(runCounts);
  for (let i = 0; i < keys.length - MAX_RUNS; i++) delete runCounts[keys[i]];
}

function union(a: string[] | undefined, b: string[] | undefined, max = MAX_LIST): string[] {
  const out: string[] = [];
  for (const v of [...(a ?? []), ...(b ?? [])]) if (v && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}
