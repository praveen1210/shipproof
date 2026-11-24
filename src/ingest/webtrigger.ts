import { Queue } from '@forge/events';
import type { WebTriggerRequest } from '@forge/api';
import { handleIngest, type OutputKey, type TriageJob } from './core';
import * as repo from '../storage/repo';

export const TRIAGE_QUEUE = 'triage-queue';

export async function enqueueTriage(job: TriageJob): Promise<void> {
  const queue = new Queue({ key: TRIAGE_QUEUE });
  // One consumer at a time per project: parts of a run and cluster updates never race.
  await queue.push([{ body: { ...job }, concurrency: { key: `p-${job.projectKey}`, limit: 1 } }]);
}

/**
 * Web trigger handler (F1). The trigger is static: it only picks one of the fixed responses declared
 * in manifest.yml, which keeps ShipProof eligible for Runs on Atlassian. Validation details go to
 * `forge logs` instead (never the token or the payload).
 */
export async function ingest(request: WebTriggerRequest): Promise<{ outputKey: OutputKey }> {
  try {
    const res = await handleIngest(request, {
      getTokenHash: async () => (await repo.getSettings()).tokenHash,
      saveRawPart: repo.saveRawPart,
      upsertRun: repo.upsertRun,
      enqueue: enqueueTriage,
      now: Date.now,
    });
    if (res.outputKey === 'accepted') console.log('ShipProof ingest accepted', JSON.stringify(res.detail));
    else if (res.outputKey !== 'unauthorized') console.warn(`ShipProof ingest rejected (${res.outputKey})`, JSON.stringify(res.detail));
    return { outputKey: res.outputKey };
  } catch (e) {
    console.error('ShipProof ingest failed', (e as Error).message);
    return { outputKey: 'server-error' };
  }
}
