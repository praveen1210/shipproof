import * as repo from '../storage/repo';
import { HISTORY_LIMIT } from '../services/triage';

/** Scheduled daily purge (F16): drops runs, history entries and clusters older than retention. */
export async function purge(): Promise<{ runs: number; clusters: number }> {
  const settings = await repo.getSettings();
  const cutoff = Date.now() - settings.retentionDays * 86_400_000;
  let runs = 0;
  let clusters = 0;
  for (const projectKey of await repo.getKnownProjects()) {
    const old = await repo.listRunsOlderThan(projectKey, cutoff);
    for (const r of old) {
      await repo.deleteRun(r.runId);
      runs++;
    }
    const stale = (await repo.listClusters(projectKey, 0, 2000)).filter((c) => c.lastSeen < cutoff && !c.override);
    await repo.deleteClusters(stale);
    clusters += stale.length;
  }
  const keys = await repo.listIssueResultKeys();
  const all = await repo.getManyIssueResults(keys);
  const changed: typeof all = {};
  const empty: string[] = [];
  for (const [k, rec] of Object.entries(all)) {
    let dirty = false;
    for (const [id, s] of Object.entries(rec)) {
      const kept = s.history.filter((h) => h.at >= cutoff).slice(-HISTORY_LIMIT);
      if (kept.length !== s.history.length) dirty = true;
      if (kept.length === 0) delete rec[id];
      else s.history = kept;
    }
    if (Object.keys(rec).length === 0) empty.push(k);
    else if (dirty) changed[k] = rec;
  }
  await repo.saveManyIssueResults(changed);
  await repo.deleteIssueResults(empty);
  return { runs, clusters };
}
