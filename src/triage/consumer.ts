import api from '@forge/api';
import { InvocationError, InvocationErrorCode, type AsyncEvent } from '@forge/events';
import type { TriageJob } from '../ingest/core';
import type { IngestResult } from '../services/types';
import { triageRun, normalise, signature, unmappedKey, latestSignatures } from '../services/triage';
import { dedupeClusters } from '../services/app';
import { JiraError } from '../services/jira';
import * as repo from '../storage/repo';

/**
 * Async consumer (F4): runs after all parts of a run have arrived. Up to 900 s, so heavy work
 * (classification, clustering, dedupe JQL, storage writes) lives here, never in the web trigger.
 */
export async function triage(event: AsyncEvent) {
  const job = event.body as unknown as TriageJob;
  try {
    return await processRun(job.runId);
  } catch (e) {
    if (e instanceof JiraError && e.status === 429) {
      return new InvocationError({ retryAfter: 30 * ((event.retryContext?.retryCount ?? 0) + 1), retryReason: InvocationErrorCode.FUNCTION_UPSTREAM_RATE_LIMITED });
    }
    console.error(`ShipProof triage failed for ${job.runId}:`, (e as Error).message);
    const run = await repo.getRun(job.runId);
    if (run) await repo.saveRun({ ...run, status: 'failed', error: (e as Error).message.slice(0, 300) });
    return undefined;
  }
}

export async function processRun(runId: string): Promise<{ status: string; runId: string }> {
  const run = await repo.getRun(runId);
  if (!run) return { status: 'missing-run', runId };
  const parts = await repo.getRawParts(runId, run.partsTotal);
  if (parts.some((p) => !p)) return { status: 'waiting-for-parts', runId }; // the last part's job does the work
  if (run.status === 'triaged') return { status: 'already-triaged', runId };

  const results: IngestResult[] = parts.flatMap((p) => p!.results);
  const settings = await repo.getSettings();
  const issueKeys = Array.from(new Set([...results.flatMap((r) => r.issueKeys ?? []), unmappedKey(run.projectKey)]));
  const previousSignatures = run.summary?.clusters.map((c) => c.signature) ?? [];
  const newSigs = results.filter((r) => r.status === 'failed').map((r) => signature(normalise(r.error) || normalise(r.failedStep) || 'unknown failure', r.failedStep));

  const issueResults = await repo.getManyIssueResults(issueKeys);
  // Also load the clusters of these scenarios' latest results: if this run is older than what is
  // already stored (the queue does not keep order), their flaky flags are recomputed too.
  const scenarioIds = new Set(results.map((r) => r.id));
  const clusters = await repo.getClusters(run.projectKey, [...newSigs, ...previousSignatures, ...latestSignatures(issueResults, scenarioIds)]);

  const out = triageRun({ run, results, issueResults, clusters, previousSignatures, customRules: settings.customRules });

  // Dedupe against Jira as the app (the run has no user). Exact label match links automatically.
  const deduped = await dedupeClusters(api.asApp(), Object.values(out.clusters));
  for (const c of deduped) out.clusters[c.signature] = c;

  await repo.saveManyIssueResults(out.issueResults);
  await repo.saveClusters(Object.values(out.clusters));
  await repo.saveRun({ ...run, status: 'triaged', summary: out.summary, triagedAt: Date.now(), error: undefined });
  await repo.deleteRawParts(runId, run.partsTotal);
  await repo.addKnownProject(run.projectKey);
  return { status: 'triaged', runId };
}
