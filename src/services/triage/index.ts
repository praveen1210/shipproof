import type {
  Category,
  Cluster,
  CustomRuleConfig,
  HistoryEntry,
  IngestResult,
  IssueResults,
  RunMeta,
} from '../types';
import { effectiveCategory } from '../types';
import { classify } from './classify';
import { compileCustomRules } from './rules';
import { exceptionType, normalise } from './normalise';
import { signature } from './signature';
import { isFlakyFailure } from './flaky';
import { groupBySignature, mergeCluster, removeRun, type FailureOccurrence } from './cluster';

export { classify } from './classify';
export { normalise, exceptionType, skeletonTokens } from './normalise';
export { signature, signatureLabel, SIG_LABEL_PREFIX } from './signature';
export { flakyStats, isFlakyFailure } from './flaky';
export { mergeCluster, removeRun } from './cluster';

export const HISTORY_LIMIT = 10;

/** Results with no issue key are kept under a per-project pseudo key and counted as "Unmapped". */
export function isUnmappedKey(key: string): boolean {
  return key.startsWith('UNMAPPED:');
}

export function unmappedKey(projectKey: string): string {
  return `UNMAPPED:${projectKey}`;
}

export interface RunClusterRef {
  signature: string;
  count: number;
  category: Category;
  flaky: boolean;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  unmapped: number;
  byCategory: Record<Category | 'flaky', number>;
  clusters: RunClusterRef[];
  issueKeys: string[];
}

export interface TriageInput {
  run: RunMeta;
  results: IngestResult[];
  /** Existing `res:<issueKey>` records for every issue key in the run (missing = empty). */
  issueResults: Record<string, IssueResults>;
  /** Existing clusters by signature: those hit by this run plus those this run hit last time. */
  clusters: Record<string, Cluster>;
  /** Signatures this run produced the previous time it was ingested (idempotent re-upload). */
  previousSignatures?: string[];
  customRules?: CustomRuleConfig[];
}

export interface TriageOutput {
  issueResults: Record<string, IssueResults>;
  clusters: Record<string, Cluster>;
  summary: RunSummary;
}

/** The whole triage pipeline for one run, as a pure function (§6.3). */
export function triageRun(input: TriageInput): TriageOutput {
  const { run } = input;
  const rules = compileCustomRules(input.customRules);
  const issueResults: Record<string, IssueResults> = {};
  const occurrences: FailureOccurrence[] = [];
  const summary: RunSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    unmapped: 0,
    byCategory: { product: 0, maintenance: 0, environment: 0, unclassified: 0, flaky: 0 },
    clusters: [],
    issueKeys: [],
  };

  const recordFor = (key: string): IssueResults => {
    if (!issueResults[key]) issueResults[key] = structuredClone(input.issueResults[key] ?? {});
    return issueResults[key];
  };

  for (const res of input.results) {
    summary.total++;
    summary[res.status]++;
    const keys = res.issueKeys && res.issueKeys.length ? unique(res.issueKeys) : [unmappedKey(run.projectKey)];
    if (!res.issueKeys || res.issueKeys.length === 0) summary.unmapped++;

    let failure: Omit<FailureOccurrence, 'flaky' | 'issueKeys' | 'scenarioId'> | undefined;
    if (res.status === 'failed') {
      const skeleton = normalise(res.error) || normalise(res.failedStep) || 'unknown failure';
      const sig = signature(skeleton, res.failedStep);
      const cls = classify(res.error, rules);
      const override = input.clusters[sig]?.override;
      failure = {
        signature: sig,
        category: override ?? cls.category,
        ruleId: cls.ruleId,
        explanation: cls.explanation,
        skeleton,
        exceptionType: exceptionType(res.error ?? ''),
        failedStep: res.failedStep ?? '',
        error: res.error ?? '',
      };
    }

    let flaky = false;
    for (const key of keys) {
      const rec = recordFor(key);
      const scen = rec[res.id] ?? { name: res.name, suite: res.suite, history: [] };
      scen.name = res.name;
      scen.suite = res.suite;
      const entry: HistoryEntry = {
        runId: run.runId,
        status: res.status,
        durationMs: res.durationMs,
        buildUrl: run.buildUrl,
        at: run.startedAt,
      };
      const history = scen.history.filter((h) => h.runId !== run.runId);
      history.push(entry);
      history.sort((a, b) => a.at - b.at);
      scen.history = history.slice(-HISTORY_LIMIT);
      if (failure) {
        entry.category = failure.category;
        entry.signature = failure.signature;
      }
      // Runs can be triaged out of order (the async queue does not keep order), so every failed
      // entry's flaky flag is recomputed from the history before it, not only the new entry's.
      recomputeFlaky(scen.history);
      if (failure) flaky = flaky || !!entry.flaky;
      rec[res.id] = scen;
    }

    if (failure) {
      // second pass so the flaky flag is consistent across every issue the result maps to
      for (const key of keys) {
        const e = issueResults[key][res.id].history.find((h) => h.runId === run.runId);
        if (e) e.flaky = flaky;
      }
      occurrences.push({
        ...failure,
        flaky,
        scenarioId: res.id,
        issueKeys: keys.filter((k) => !isUnmappedKey(k)),
      });
      summary.byCategory[flaky ? 'flaky' : failure.category]++;
    }
  }

  const clusters: Record<string, Cluster> = {};
  const ctx = {
    projectKey: run.projectKey,
    runId: run.runId,
    at: run.startedAt,
    buildUrl: run.buildUrl,
    environment: run.environment,
  };
  for (const [sig, occ] of groupBySignature(occurrences)) {
    const merged = mergeCluster(input.clusters[sig], occ, ctx);
    clusters[sig] = merged;
    summary.clusters.push({ signature: sig, count: occ.length, category: effectiveCategory(merged), flaky: merged.flaky });
  }
  for (const sig of input.previousSignatures ?? []) {
    if (!clusters[sig] && input.clusters[sig]) clusters[sig] = removeRun(input.clusters[sig], run.runId);
  }

  // A cluster is flaky when most scenarios whose LATEST result carries its signature are flaky.
  // Recomputed here so an older run arriving late corrects the newest run's clusters too.
  for (const [sig, flags] of latestFlakyFlags(issueResults)) {
    const c = clusters[sig] ?? input.clusters[sig];
    if (!c) continue;
    const flakyNow = flags.filter(Boolean).length * 2 >= flags.length;
    if (c.flaky !== flakyNow || clusters[sig]) clusters[sig] = { ...c, flaky: flakyNow };
  }
  for (const ref of summary.clusters) ref.flaky = clusters[ref.signature]?.flaky ?? ref.flaky;

  summary.clusters.sort((a, b) => b.count - a.count);
  summary.issueKeys = Object.keys(issueResults).filter((k) => !isUnmappedKey(k));
  return { issueResults, clusters, summary };
}

/** Sets `flaky` on every failed entry from the history up to and including it (sorted oldest first). */
export function recomputeFlaky(history: HistoryEntry[]): void {
  history.forEach((h, i) => {
    if (h.status === 'failed') h.flaky = isFlakyFailure(history.slice(0, i + 1));
    else delete h.flaky;
  });
}

/** signature → flaky flags of the scenarios whose latest result failed with that signature. */
export function latestFlakyFlags(issueResults: Record<string, IssueResults>): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  for (const rec of Object.values(issueResults)) {
    for (const scen of Object.values(rec)) {
      const last = scen.history[scen.history.length - 1];
      if (!last || last.status !== 'failed' || !last.signature) continue;
      const list = out.get(last.signature) ?? [];
      list.push(!!last.flaky);
      out.set(last.signature, list);
    }
  }
  return out;
}

/** Signatures of the latest results of the given scenarios: the consumer loads these clusters too. */
export function latestSignatures(issueResults: Record<string, IssueResults>, scenarioIds: Set<string>): string[] {
  const out = new Set<string>();
  for (const rec of Object.values(issueResults)) {
    for (const [id, scen] of Object.entries(rec)) {
      if (!scenarioIds.has(id)) continue;
      const sig = scen.history[scen.history.length - 1]?.signature;
      if (sig) out.add(sig);
    }
  }
  return [...out];
}

function unique(a: string[]): string[] {
  return Array.from(new Set(a.map((k) => k.trim().toUpperCase()).filter(Boolean)));
}
