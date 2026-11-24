import kvs, { Sort, WhereConditions } from '@forge/kvs';
import type { StoredRun } from '../ingest/core';
import type { IngestPayload } from '../ingest/schema';
import type { RunSummary } from '../services/triage';
import type { Cluster, IssueResults, Settings } from '../services/types';
import { withDefaults } from '../services/types';

/**
 * Storage repository (§7.4). Plain KVS for settings, per-issue results and raw parts;
 * Custom Entities for runs and clusters so they can be queried by project and time.
 * Entity values keep their indexed fields as declared attributes and the rest in `data` (type any).
 */

const RUN = 'run';
const CLUSTER = 'cluster';
const BATCH = 20; // KVS batch operations stay well under the 25-op limit

/**
 * Entity `integer` attributes are 32-bit, so epoch milliseconds overflow them. Indexed time
 * attributes (run.startedAt, cluster.lastSeen) are stored in epoch SECONDS (fits until 2038);
 * the millisecond values stay inside `data`. Convert only at this boundary.
 */
export const toEntitySeconds = (ms: number): number => Math.floor(ms / 1000);

interface RunEntity {
  projectKey: string;
  startedAt: number;
  status: string;
  data: StoredRunRecord;
}

export interface StoredRunRecord extends StoredRun {
  summary?: RunSummary;
  triagedAt?: number;
  error?: string;
}

interface ClusterEntity {
  projectKey: string;
  category: string;
  lastSeen: number;
  data: Cluster;
}

// ───────────── settings ─────────────

export async function getSettings(): Promise<Settings> {
  return withDefaults(await kvs.get<Partial<Settings>>('settings'));
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvs.set('settings', s);
}

// ───────────── raw parts ─────────────

const rawKey = (runId: string, part: number) => `raw:${runId}:${part}`;

export async function saveRawPart(runId: string, part: number, payload: IngestPayload): Promise<void> {
  await kvs.set(rawKey(runId, part), payload, { ttl: { value: 2, unit: 'DAYS' } });
}

export async function getRawParts(runId: string, total: number): Promise<(IngestPayload | undefined)[]> {
  return Promise.all(Array.from({ length: total }, (_, i) => kvs.get<IngestPayload>(rawKey(runId, i + 1))));
}

export async function deleteRawParts(runId: string, total: number): Promise<void> {
  await Promise.all(Array.from({ length: total }, (_, i) => kvs.delete(rawKey(runId, i + 1))));
}

// ───────────── runs ─────────────

export async function getRun(runId: string): Promise<StoredRunRecord | undefined> {
  return (await kvs.entity<RunEntity>(RUN).get(runId))?.data;
}

export async function saveRun(run: StoredRunRecord): Promise<void> {
  await kvs.entity<RunEntity>(RUN).set(run.runId, {
    projectKey: run.projectKey,
    startedAt: toEntitySeconds(run.startedAt),
    status: run.status,
    data: run,
  });
}

/** Keeps a previous triage summary when a build is re-uploaded (needed for idempotent clusters). */
export async function upsertRun(run: StoredRun): Promise<void> {
  const existing = await getRun(run.runId);
  await saveRun({ ...existing, ...run });
}

export async function deleteRun(runId: string): Promise<void> {
  await kvs.entity<RunEntity>(RUN).delete(runId);
}

export async function listRuns(projectKey: string, limit = 20, before?: number): Promise<StoredRunRecord[]> {
  let q = kvs
    .entity<RunEntity>(RUN)
    .query()
    .index('by-project-started', { partition: [projectKey] })
    .sort(Sort.DESC)
    .limit(Math.min(limit, 100));
  if (before !== undefined) q = q.where(WhereConditions.lessThan(toEntitySeconds(before)));
  const res = await q.getMany();
  return res.results.map((r) => r.value.data);
}

export async function listRunsOlderThan(projectKey: string, cutoff: number): Promise<StoredRunRecord[]> {
  const out: StoredRunRecord[] = [];
  let cursor: string | undefined;
  do {
    let q = kvs
      .entity<RunEntity>(RUN)
      .query()
      .index('by-project-started', { partition: [projectKey] })
      .where(WhereConditions.lessThan(toEntitySeconds(cutoff)))
      .limit(100);
    if (cursor) q = q.cursor(cursor);
    const res = await q.getMany();
    out.push(...res.results.map((r) => r.value.data));
    cursor = res.nextCursor;
  } while (cursor && out.length < 1000);
  return out;
}

// ───────────── clusters ─────────────

const clusterKey = (projectKey: string, sig: string) => `${projectKey}:${sig}`;

export async function getCluster(projectKey: string, sig: string): Promise<Cluster | undefined> {
  return (await kvs.entity<ClusterEntity>(CLUSTER).get(clusterKey(projectKey, sig)))?.data;
}

export async function getClusters(projectKey: string, sigs: string[]): Promise<Record<string, Cluster>> {
  const out: Record<string, Cluster> = {};
  const unique = Array.from(new Set(sigs.filter(Boolean)));
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const res = await kvs.batchGet<ClusterEntity>(chunk.map((s) => ({ key: clusterKey(projectKey, s), entityName: CLUSTER })));
    for (const r of res.successfulKeys) if (r.value?.data) out[r.value.data.signature] = r.value.data;
  }
  return out;
}

export async function saveClusters(clusters: Cluster[]): Promise<void> {
  for (let i = 0; i < clusters.length; i += BATCH) {
    const chunk = clusters.slice(i, i + BATCH);
    await kvs.batchSet(
      chunk.map((c) => ({
        key: clusterKey(c.projectKey, c.signature),
        entityName: CLUSTER,
        value: { projectKey: c.projectKey, category: c.override ?? c.category, lastSeen: toEntitySeconds(c.lastSeen), data: c } satisfies ClusterEntity,
      })),
    );
  }
}

export async function saveCluster(c: Cluster): Promise<void> {
  await saveClusters([c]);
}

/** Most recently seen clusters for a project (up to `max`), newest first. */
export async function listClusters(projectKey: string, sinceMs = 0, max = 300): Promise<Cluster[]> {
  const out: Cluster[] = [];
  let cursor: string | undefined;
  do {
    let q = kvs
      .entity<ClusterEntity>(CLUSTER)
      .query()
      .index('by-project-lastseen', { partition: [projectKey] })
      .where(WhereConditions.greaterThanEqualTo(toEntitySeconds(sinceMs)))
      .sort(Sort.DESC)
      .limit(100);
    if (cursor) q = q.cursor(cursor);
    const res = await q.getMany();
    out.push(...res.results.map((r) => r.value.data));
    cursor = res.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

export async function deleteClusters(clusters: Pick<Cluster, 'projectKey' | 'signature'>[]): Promise<void> {
  for (let i = 0; i < clusters.length; i += BATCH) {
    await kvs.batchDelete(clusters.slice(i, i + BATCH).map((c) => ({ key: clusterKey(c.projectKey, c.signature), entityName: CLUSTER })));
  }
}

// ───────────── per-issue results ─────────────

const resKey = (issueKey: string) => `res:${issueKey}`;

export async function getIssueResults(issueKey: string): Promise<IssueResults | undefined> {
  return kvs.get<IssueResults>(resKey(issueKey));
}

export async function getManyIssueResults(issueKeys: string[]): Promise<Record<string, IssueResults>> {
  const out: Record<string, IssueResults> = {};
  const unique = Array.from(new Set(issueKeys));
  for (let i = 0; i < unique.length; i += BATCH) {
    const res = await kvs.batchGet<IssueResults>(unique.slice(i, i + BATCH).map((k) => ({ key: resKey(k) })));
    for (const r of res.successfulKeys) out[r.key.slice(4)] = r.value;
  }
  return out;
}

export async function saveManyIssueResults(map: Record<string, IssueResults>): Promise<void> {
  const entries = Object.entries(map);
  for (let i = 0; i < entries.length; i += BATCH) {
    await kvs.batchSet(entries.slice(i, i + BATCH).map(([k, v]) => ({ key: resKey(k), value: v })));
  }
}

export async function deleteIssueResults(issueKeys: string[]): Promise<void> {
  for (let i = 0; i < issueKeys.length; i += BATCH) {
    await kvs.batchDelete(issueKeys.slice(i, i + BATCH).map((k) => ({ key: resKey(k) })));
  }
}

/** All `res:` keys (for retention purge and demo cleanup). */
export async function listIssueResultKeys(): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith('res:')).limit(100);
    if (cursor) q = q.cursor(cursor);
    const res = await q.getMany<IssueResults>();
    out.push(...res.results.map((r) => r.key.slice(4)));
    cursor = res.nextCursor;
  } while (cursor && out.length < 10_000);
  return out;
}

// ───────────── demo bookkeeping ─────────────

export interface DemoState {
  projectKey: string;
  projectId: string;
  versionId?: string;
  versionName: string;
  issueKeys: string[];
  runIds: string[];
  /** story slot → created issue key */
  keyMap: Record<string, string>;
  createdAt: number;
}

export async function getDemo(): Promise<DemoState | undefined> {
  return kvs.get<DemoState>('demo');
}

export async function saveDemo(d: DemoState): Promise<void> {
  await kvs.set('demo', d);
}

export async function deleteDemo(): Promise<void> {
  await kvs.delete('demo');
}

/** Projects that have received runs, so the scheduled purge knows where to look. */
export async function addKnownProject(projectKey: string): Promise<void> {
  const list = (await kvs.get<string[]>('projects')) ?? [];
  if (!list.includes(projectKey)) await kvs.set('projects', [...list, projectKey]);
}

export async function getKnownProjects(): Promise<string[]> {
  return (await kvs.get<string[]>('projects')) ?? [];
}
