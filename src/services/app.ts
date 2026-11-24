/**
 * Shared service layer: the ONE place the issue panel, project page, settings, Rovo actions and
 * MCP tools get their answers from. Resolvers and actions are thin adapters over these functions.
 */
import * as repo from '../storage/repo';
import type { Category, Cluster } from './types';
import { CATEGORY_EMOJI, CATEGORY_LABEL, categoryText, effectiveCategory } from './types';
import { buildIssueEvidence, latestState, type IssueEvidence } from './evidence';
import { evaluateRelease, type ReleaseEvaluation } from './readiness';
import { extractAcceptanceCriteria, matchCoverage } from './acParser';
import { renderReleaseReport } from './report';
import { bugDescriptionMarkdown, bugSummary, exactDedupeJql, maintenanceTaskSummary, suggestDedupeJql } from './dedupe';
import { signatureLabel } from './triage/signature';
import * as jira from './jira';
import type { Requester } from './jira';
import { adfDoc } from './adf';
import { getOpenPrCounts } from './twg';

export class UserError extends Error {}

export const projectOf = (issueKey: string) => issueKey.split('-')[0].toUpperCase();

function assertProjectKey(k: unknown): string {
  if (typeof k !== 'string' || !/^[A-Z][A-Z0-9_]{1,9}$/.test(k.trim().toUpperCase())) throw new UserError('projectKey must be a Jira project key like PROJ');
  return k.trim().toUpperCase();
}

function assertIssueKey(k: unknown): string {
  if (typeof k !== 'string' || !/^[A-Z][A-Z0-9_]+-\d+$/.test(k.trim().toUpperCase())) throw new UserError('issueKey must look like PROJ-12');
  return k.trim().toUpperCase();
}

// ───────────── cluster views ─────────────

export interface ClusterView {
  signature: string;
  label: string;
  category: Category;
  flaky: boolean;
  categoryText: string;
  ruleId: string;
  explanation: string;
  failedStep: string;
  exceptionType: string;
  sampleError: string;
  countInRun?: number;
  totalCount: number;
  runs: number;
  firstSeen: number;
  lastSeen: number;
  issueKeys: string[];
  scenarioCount: number;
  bugKey?: string;
  possibleDuplicates: string[];
  overridden: boolean;
}

export function toView(c: Cluster, countInRun?: number): ClusterView {
  const cat = effectiveCategory(c);
  return {
    signature: c.signature,
    label: signatureLabel(c.signature),
    category: cat,
    flaky: c.flaky,
    categoryText: categoryText(cat, c.flaky),
    ruleId: c.ruleId,
    explanation: c.explanation,
    failedStep: c.failedStep,
    exceptionType: c.exceptionType,
    sampleError: c.sampleError.slice(0, 600),
    countInRun,
    totalCount: c.count,
    runs: Object.keys(c.runCounts).length,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
    issueKeys: c.issueKeys,
    scenarioCount: c.scenarioIds.length,
    bugKey: c.bugKey,
    possibleDuplicates: c.possibleDuplicates ?? [],
    overridden: !!c.override,
  };
}

type Group = Category | 'flaky';
const GROUP_ORDER: Group[] = ['product', 'unclassified', 'maintenance', 'environment', 'flaky'];

function groupClusters(views: ClusterView[]) {
  return GROUP_ORDER.map((g) => {
    const cs = views.filter((v) => (v.flaky ? 'flaky' : v.category) === g);
    return {
      category: g,
      label: `${CATEGORY_EMOJI[g]} ${CATEGORY_LABEL[g]}`,
      clusterCount: cs.length,
      failureCount: cs.reduce((a, c) => a + (c.countInRun ?? c.totalCount), 0),
      clusters: cs,
    };
  });
}

// ───────────── triage ─────────────

export async function listRuns(projectKey: string, limit = 15) {
  const runs = await repo.listRuns(assertProjectKey(projectKey), limit);
  return runs.map((r) => ({
    runId: r.runId,
    buildId: r.buildId,
    buildUrl: r.buildUrl,
    pipeline: r.pipeline,
    branch: r.branch,
    environment: r.environment,
    source: r.source,
    startedAt: r.startedAt,
    status: r.status,
    totals: r.summary
      ? { total: r.summary.total, passed: r.summary.passed, failed: r.summary.failed, skipped: r.summary.skipped, unmapped: r.summary.unmapped }
      : undefined,
  }));
}

/** get-latest-triage: clusters of one run (latest by default) grouped by category. */
export async function getLatestTriage(projectKeyIn: string, runId?: string) {
  const projectKey = assertProjectKey(projectKeyIn);
  const run = runId ? await repo.getRun(runId) : (await repo.listRuns(projectKey, 5)).find((r) => r.status === 'triaged') ?? (await repo.listRuns(projectKey, 1))[0];
  if (!run) {
    return { projectKey, run: null, message: `No runs have been ingested for ${projectKey} yet. Load the demo workspace in ShipProof settings, or post results from CI.` };
  }
  if (run.projectKey !== projectKey) throw new UserError(`Run ${runId} belongs to ${run.projectKey}`);
  const summary = run.summary;
  const clusters = await repo.getClusters(projectKey, summary?.clusters.map((c) => c.signature) ?? []);
  const views = (summary?.clusters ?? []).filter((c) => clusters[c.signature]).map((c) => toView(clusters[c.signature], c.count));
  return {
    projectKey,
    run: {
      runId: run.runId,
      buildId: run.buildId,
      buildUrl: run.buildUrl,
      pipeline: run.pipeline,
      branch: run.branch,
      environment: run.environment,
      startedAt: new Date(run.startedAt).toISOString(),
      status: run.status,
    },
    totals: summary
      ? { total: summary.total, passed: summary.passed, failed: summary.failed, skipped: summary.skipped, unmapped: summary.unmapped, byCategory: summary.byCategory }
      : null,
    clusterCount: views.length,
    groups: groupClusters(views),
    untrackedProductDefects: views.filter((v) => v.category === 'product' && !v.flaky && !v.bugKey).map((v) => v.label),
  };
}

/** list-failure-clusters: clusters seen in the last N days, optionally one category (or "flaky"). */
export async function listFailureClusters(projectKeyIn: string, category?: string, sinceDays = 7) {
  const projectKey = assertProjectKey(projectKeyIn);
  const days = Math.max(1, Math.min(Number(sinceDays) || 7, 90));
  const since = Date.now() - days * 86_400_000;
  const wanted = normaliseCategory(category);
  const all = (await repo.listClusters(projectKey, since)).map((c) => toView(c));
  const filtered = wanted ? all.filter((v) => (wanted === 'flaky' ? v.flaky : v.category === wanted && !v.flaky)) : all;
  return { projectKey, sinceDays: days, category: wanted ?? 'all', count: filtered.length, clusters: filtered.sort((a, b) => b.lastSeen - a.lastSeen || b.totalCount - a.totalCount).slice(0, 100) };
}

export function normaliseCategory(c: string | undefined): Group | undefined {
  if (!c) return undefined;
  const s = c.toLowerCase();
  if (/prod|defect|bug|🐞/.test(s)) return 'product';
  if (/maint|locator|test code|🔧/.test(s)) return 'maintenance';
  if (/env|infra|🌩/.test(s)) return 'environment';
  if (/flak|🎲/.test(s)) return 'flaky';
  if (/unclass|unknown|❓/.test(s)) return 'unclassified';
  return undefined;
}

export async function reclassifyCluster(projectKeyIn: string, signature: string, category: Category | null) {
  const projectKey = assertProjectKey(projectKeyIn);
  const c = await repo.getCluster(projectKey, signature);
  if (!c) throw new UserError(`No cluster ${signature} in ${projectKey}`);
  const updated: Cluster = { ...c, override: category ?? undefined };
  await repo.saveCluster(updated);
  return toView(updated);
}

// ───────────── issue evidence + context ─────────────

export async function getIssueEvidence(issueKeyIn: string): Promise<IssueEvidence & { bugsByScenario?: never }> {
  const issueKey = assertIssueKey(issueKeyIn);
  const settings = await repo.getSettings();
  const results = await repo.getIssueResults(issueKey);
  const now = Date.now();
  const sigs = Object.values(results ?? {})
    .map((s) => latestState(s, now, settings.staleHours)?.signature)
    .filter((s): s is string => !!s);
  const clusters = await repo.getClusters(projectOf(issueKey), sigs);
  return buildIssueEvidence(issueKey, results, clusters, now, settings.staleHours);
}

/** get-issue-context: summary, extracted ACs, mapped scenarios and a lexical coverage first pass. */
export async function getIssueContext(req: Requester, issueKeyIn: string) {
  const issueKey = assertIssueKey(issueKeyIn);
  const issue = await jira.getIssue(req, issueKey, ['summary', 'description', 'issuetype', 'status', 'fixVersions']);
  const ac = extractAcceptanceCriteria(issue.fields.description);
  const evidence = await getIssueEvidence(issueKey);
  const scenarios = evidence.scenarios.map((s) => ({ name: s.name, suite: s.suite, status: s.latest.status, category: s.categoryLabel }));
  const coverage = matchCoverage(ac.acs, scenarios.map((s) => s.name));
  return {
    issueKey,
    summary: issue.fields.summary,
    type: issue.fields.issuetype?.name,
    status: issue.fields.status?.name,
    fixVersions: (issue.fields.fixVersions ?? []).map((v: { name: string }) => v.name),
    acceptanceCriteria: ac.acs,
    acSource: ac.source,
    acWarning: ac.warning,
    mappedScenarios: scenarios,
    coverage,
    uncoveredAcs: coverage.filter((c) => !c.covered).map((c) => c.ac),
    coverageNote: 'Coverage is a lexical first pass (shared words between AC and scenario name). Review it before relying on it.',
  };
}

// ───────────── readiness + report ─────────────

export async function listVersions(req: Requester, projectKey: string) {
  const versions = await jira.listVersions(req, assertProjectKey(projectKey));
  return versions.filter((v) => !v.archived).map((v) => ({ id: v.id, name: v.name, released: v.released, releaseDate: v.releaseDate })).reverse();
}

export async function getReleaseReadiness(req: Requester, projectKeyIn: string, fixVersion: string, cloudId?: string): Promise<ReleaseEvaluation & { twg: 'on' | 'off' | 'unavailable'; summaries: Record<string, string> }> {
  const projectKey = assertProjectKey(projectKeyIn);
  if (!fixVersion || typeof fixVersion !== 'string') throw new UserError('fixVersion is required, e.g. 2.4.0');
  const settings = await repo.getSettings();
  const issues = await jira.getReleaseIssues(req, projectKey, fixVersion.trim());
  if (issues.length === 0) {
    const versions = await jira.listVersions(req, projectKey).catch(() => []);
    if (!versions.some((v) => v.name === fixVersion.trim())) {
      throw new UserError(`Fix version "${fixVersion}" not found in ${projectKey}. Versions: ${versions.map((v) => v.name).join(', ') || 'none'}`);
    }
  }

  let twg: 'on' | 'off' | 'unavailable' = 'off';
  if (settings.twgEnabled && cloudId) {
    const prs = await getOpenPrCounts(cloudId, issues.filter((i) => i.id).map((i) => ({ id: i.id!, key: i.key })));
    if (prs) {
      twg = 'on';
      for (const i of issues) i.openPrCount = prs.openPrs[i.key] ?? 0;
    } else twg = 'unavailable';
  }

  const evidence = await repo.getManyIssueResults(issues.map((i) => i.key));
  const now = Date.now();
  const sigs = Object.values(evidence).flatMap((r) => Object.values(r).map((s) => latestState(s, now, settings.staleHours)?.signature ?? ''));
  const clusters = await repo.getClusters(projectKey, sigs);
  const evaluation = evaluateRelease(
    { projectKey, fixVersion: fixVersion.trim(), issues, evidence, clusters, now },
    { weights: settings.weights, excludedTypes: settings.excludedTypes, staleHours: settings.staleHours },
  );
  return { ...evaluation, twg, summaries: Object.fromEntries(issues.map((i) => [i.key, i.summary])) };
}

export async function buildReleaseReport(req: Requester, projectKey: string, fixVersion: string, cloudId?: string) {
  const evaluation = await getReleaseReadiness(req, projectKey, fixVersion, cloudId);
  const keys = new Set(Object.keys(evaluation.summaries));
  const clusters = (await repo.listClusters(evaluation.projectKey, Date.now() - 14 * 86_400_000)).filter(
    (c) => c.issueKeys.some((k) => keys.has(k)) && Object.keys(c.runCounts).length > 0 && c.count > 0,
  );
  const markdown = renderReleaseReport({ evaluation, clusters, summaries: evaluation.summaries, generatedAt: Date.now() });
  return { markdown, evaluation, fileName: `shipproof-${evaluation.projectKey}-${evaluation.fixVersion}.md` };
}

/** Finds the "release issue" to post a report on: an issue labelled shipproof-release in the version. */
export async function findReleaseIssue(req: Requester, projectKey: string, fixVersion: string): Promise<string | undefined> {
  const found = await jira.searchJql(
    req,
    `project = "${projectKey}" AND fixVersion = "${fixVersion.replace(/"/g, '\\"')}" AND (labels = shipproof-release OR issuetype = Epic) ORDER BY created ASC`,
    ['summary'],
    { max: 1 },
  );
  return found[0]?.key;
}

// ───────────── writes (user-confirmed) ─────────────

async function pickIssueType(req: Requester, projectKey: string, want: RegExp, fallback: RegExp) {
  const p = await jira.getProject(req, projectKey);
  const types = p.issueTypes.filter((t) => !t.subtask);
  const t = types.find((x) => want.test(x.name)) ?? types.find((x) => fallback.test(x.name)) ?? types[0];
  if (!t) throw new UserError(`Project ${projectKey} has no usable issue type`);
  return { project: p, type: t };
}

export interface CreatedIssue {
  key: string;
  url?: string;
  existing: boolean;
  linked: string[];
}

/** create-bug-from-cluster (§6.4). Dedupe first: an open issue with the signature label wins. */
export async function createIssueFromCluster(req: Requester, projectKeyIn: string, signature: string, kind: 'bug' | 'task' = 'bug'): Promise<CreatedIssue> {
  const projectKey = assertProjectKey(projectKeyIn);
  const cluster = await repo.getCluster(projectKey, String(signature).replace(/^sp-sig-/, ''));
  if (!cluster) throw new UserError(`No failure cluster ${signature} in ${projectKey}`);
  const base = await jira.getSiteUrl(req);
  const url = (k: string) => (base ? `${base}/browse/${k}` : undefined);

  const existing = await jira.searchJql(req, exactDedupeJql(projectKey, cluster.signature), ['summary'], { max: 1 });
  if (existing[0]) {
    await repo.saveCluster({ ...cluster, bugKey: existing[0].key });
    return { key: existing[0].key, url: url(existing[0].key), existing: true, linked: [] };
  }
  if (cluster.bugKey) return { key: cluster.bugKey, url: url(cluster.bugKey), existing: true, linked: [] };

  const settings = await repo.getSettings();
  const isTask = kind === 'task';
  const { project, type } = await pickIssueType(req, projectKey, isTask ? /^task$/i : /^bug$/i, isTask ? /task|story/i : /task/i);
  const created = await jira.createIssue(req, {
    project: { id: project.id },
    issuetype: { id: type.id },
    summary: isTask ? maintenanceTaskSummary(cluster) : bugSummary(cluster),
    description: adfDoc(bugDescriptionMarkdown(cluster)),
    labels: [signatureLabel(cluster.signature), isTask ? 'shipproof-maintenance' : 'shipproof'],
    ...(isTask && settings.maintenanceAssignee ? { assignee: { id: settings.maintenanceAssignee } } : {}),
  });
  const linked: string[] = [];
  for (const story of cluster.issueKeys.slice(0, 20)) {
    try {
      await jira.linkIssues(req, created.key, story, 'Relates');
      linked.push(story);
    } catch {
      // the user may not see that story, or links may be disabled: the bug still stands
    }
  }
  await repo.saveCluster({ ...cluster, bugKey: created.key });
  return { key: created.key, url: url(created.key), existing: false, linked };
}

/** Links a cluster to an existing issue the user picked (e.g. a suggested possible duplicate). */
export async function linkClusterToIssue(req: Requester, projectKeyIn: string, signature: string, issueKey: string) {
  const projectKey = assertProjectKey(projectKeyIn);
  const cluster = await repo.getCluster(projectKey, signature);
  if (!cluster) throw new UserError(`No failure cluster ${signature}`);
  const key = assertIssueKey(issueKey);
  await jira.addLabel(req, key, signatureLabel(cluster.signature));
  await repo.saveCluster({ ...cluster, bugKey: key });
  return toView({ ...cluster, bugKey: key });
}

export async function addIssueComment(req: Requester, issueKeyIn: string, body: string) {
  const issueKey = assertIssueKey(issueKeyIn);
  if (!body || !String(body).trim()) throw new UserError('Comment body is empty');
  const res = await jira.addComment(req, issueKey, String(body).slice(0, 30_000));
  const base = await jira.getSiteUrl(req);
  return { issueKey, commentId: res.id, url: base ? `${base}/browse/${issueKey}?focusedCommentId=${res.id}` : undefined };
}

// ───────────── triage-time dedupe (as app) ─────────────

/** Runs exact dedupe for clusters without a bug, and "possible duplicate" search for product ones. */
export async function dedupeClusters(req: Requester, clusters: Cluster[], budget = 15): Promise<Cluster[]> {
  const changed: Cluster[] = [];
  for (const c of clusters.filter((x) => !x.bugKey).slice(0, budget)) {
    try {
      const exact = await jira.searchJql(req, exactDedupeJql(c.projectKey, c.signature), ['summary'], { max: 1 });
      if (exact[0]) {
        changed.push({ ...c, bugKey: exact[0].key, possibleDuplicates: [] });
        continue;
      }
      if (effectiveCategory(c) === 'product' && !c.possibleDuplicates) {
        const jql = suggestDedupeJql(c.projectKey, c);
        const dupes = jql ? await jira.searchJql(req, jql, ['summary'], { max: 3 }) : [];
        changed.push({ ...c, possibleDuplicates: dupes.map((d) => d.key) });
      }
    } catch (e) {
      if (e instanceof jira.JiraError && e.status === 429) throw e;
      // a JQL failure must never block triage
    }
  }
  return changed;
}
