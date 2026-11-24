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
        flaky = flaky || isFlakyFailure(scen.history);
        entry.category = failure.category;
        entry.signature = failure.signature;
      }
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

  summary.clusters.sort((a, b) => b.count - a.count);
  summary.issueKeys = Object.keys(issueResults).filter((k) => !isUnmappedKey(k));
  return { issueResults, clusters, summary };
}

function unique(a: string[]): string[] {
  return Array.from(new Set(a.map((k) => k.trim().toUpperCase()).filter(Boolean)));
}
