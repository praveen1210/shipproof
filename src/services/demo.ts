import * as repo from '../storage/repo';
import * as jira from './jira';
import type { Requester } from './jira';
import { adfDoc } from './adf';
import { UserError } from './app';
import { buildDemoRuns, DEMO_ISSUES, DEMO_LABEL, DEMO_VERSION, type Slot } from './demoData';
import { runIdFor } from '../ingest/core';
import { enqueueTriage } from '../ingest/webtrigger';
import { isUnmappedKey, unmappedKey } from './triage';
import type { IngestPayload } from '../ingest/schema';

/**
 * "Load demo workspace" (US-7). Creates real issues and a real fix version on the judge's site as
 * the user, then pushes the demo runs through the SAME ingest path as CI (raw part → run → queue →
 * consumer). Nothing is hardcoded in the UI: every number on screen is computed from these runs.
 */
export async function loadDemo(req: Requester, projectKey: string): Promise<{ issueKeys: string[]; runIds: string[]; version: string }> {
  const existing = await repo.getDemo();
  if (existing) {
    // Resume a load that created every issue but failed before the runs were ingested.
    const complete = DEMO_ISSUES.every((d) => existing.keyMap[d.slot]);
    if (existing.projectKey === projectKey && complete && existing.runIds.length === 0) {
      const runs = buildDemoRuns(projectKey, existing.keyMap as Partial<Record<Slot, string>>, Date.now());
      const runIds = await ingestPayloads(runs);
      await repo.saveDemo({ ...existing, runIds });
      return { issueKeys: existing.issueKeys, runIds, version: existing.versionName };
    }
    throw new UserError(`A demo workspace already exists in ${existing.projectKey}. Remove it first.`);
  }

  const project = await jira.getProject(req, projectKey);
  const types = project.issueTypes.filter((t) => !t.subtask);
  const storyType = types.find((t) => /^story$/i.test(t.name)) ?? types.find((t) => /^task$/i.test(t.name)) ?? types[0];
  const bugType = types.find((t) => /^bug$/i.test(t.name)) ?? storyType;
  if (!storyType) throw new UserError(`Project ${projectKey} has no issue types this app can create.`);

  const versions = await jira.listVersions(req, projectKey);
  const version =
    versions.find((v) => v.name === DEMO_VERSION) ??
    (await jira.createVersion(req, project.id, DEMO_VERSION, 'ShipProof demo release. Remove it from ShipProof settings.'));
  const createdVersion = !versions.some((v) => v.id === version.id);

  const state: repo.DemoState = {
    projectKey,
    projectId: project.id,
    versionId: createdVersion ? version.id : undefined,
    versionName: DEMO_VERSION,
    issueKeys: [],
    runIds: [],
    keyMap: {},
    createdAt: Date.now(),
  };
  // Save as we go, so a partial failure can still be cleaned up by "Remove demo workspace".
  await repo.saveDemo(state);

  for (const def of DEMO_ISSUES) {
    const fields: Record<string, unknown> = {
      project: { id: project.id },
      issuetype: { id: def.kind === 'bug' ? bugType.id : storyType.id },
      summary: def.summary,
      description: adfDoc(def.description),
      labels: [DEMO_LABEL, ...(def.labels ?? [])],
      ...(def.inVersion ? { fixVersions: [{ id: version.id }] } : {}),
    };
    let created: { key: string };
    try {
      created = await jira.createIssue(req, def.priority ? { ...fields, priority: { name: def.priority } } : fields);
    } catch (e) {
      if (!(e instanceof jira.JiraError) || e.status !== 400) throw e;
      created = await jira.createIssue(req, fields); // priority/fixVersions not on the create screen
    }
    state.issueKeys.push(created.key);
    state.keyMap[def.slot] = created.key;
    await repo.saveDemo(state);
  }

  // Dev work is finished for the noisy stories: only their tests are red.
  await Promise.all(
    DEMO_ISSUES.filter((d) => d.done).map((d) => jira.transitionToDone(req, state.keyMap[d.slot]).catch(() => false)),
  );

  const runs = buildDemoRuns(projectKey, state.keyMap as Partial<Record<Slot, string>>, Date.now());
  state.runIds = await ingestPayloads(runs);
  await repo.saveDemo(state);
  return { issueKeys: state.issueKeys, runIds: state.runIds, version: DEMO_VERSION };
}

/** Night 6: the same suite after the staging environment was fixed. */
export async function ingestDemoRerun(): Promise<{ runId: string }> {
  const demo = await repo.getDemo();
  if (!demo) throw new UserError('Load the demo workspace first.');
  const [run] = buildDemoRuns(demo.projectKey, demo.keyMap as Partial<Record<Slot, string>>, Date.now(), [5]);
  const [runId] = await ingestPayloads([run]);
  if (!demo.runIds.includes(runId)) await repo.saveDemo({ ...demo, runIds: [...demo.runIds, runId] });
  return { runId };
}

async function ingestPayloads(payloads: IngestPayload[]): Promise<string[]> {
  const ids: string[] = [];
  for (const p of payloads) {
    const runId = runIdFor(p.projectKey, p.source, p.buildId);
    await repo.saveRawPart(runId, 1, p);
    await repo.upsertRun({
      runId,
      projectKey: p.projectKey,
      source: p.source,
      buildId: p.buildId,
      buildUrl: p.buildUrl,
      pipeline: p.pipeline,
      branch: p.branch,
      commit: p.commit,
      environment: p.environment,
      startedAt: Date.parse(p.startedAt),
      partsTotal: 1,
      status: 'queued',
      receivedAt: Date.now(),
    });
    await enqueueTriage({ runId, projectKey: p.projectKey, part: 1, total: 1 });
    ids.push(runId);
  }
  return ids;
}

/** "Remove demo workspace": deletes demo issues, the version it created, and every stored run trace. */
export async function removeDemo(req: Requester): Promise<{ deletedIssues: number; deletedRuns: number }> {
  const demo = await repo.getDemo();
  if (!demo) return { deletedIssues: 0, deletedRuns: 0 };

  let deletedIssues = 0;
  for (const key of demo.issueKeys) {
    try {
      await jira.deleteIssue(req, key);
      deletedIssues++;
    } catch (e) {
      if (!(e instanceof jira.JiraError) || e.status !== 404) throw e;
    }
  }
  if (demo.versionId) await jira.deleteVersion(req, demo.versionId).catch(() => undefined);

  const sigs = new Set<string>();
  for (const runId of demo.runIds) {
    const run = await repo.getRun(runId);
    run?.summary?.clusters.forEach((c) => sigs.add(c.signature));
    await repo.deleteRun(runId);
    await repo.deleteRawParts(runId, run?.partsTotal ?? 1);
  }
  await repo.deleteClusters([...sigs].map((signature) => ({ projectKey: demo.projectKey, signature })));
  await repo.deleteIssueResults(demo.issueKeys);

  // Unmapped results may mix demo and real runs: drop only demo entries.
  const uKey = unmappedKey(demo.projectKey);
  const unmapped = (await repo.getManyIssueResults([uKey]))[uKey];
  if (unmapped && isUnmappedKey(uKey)) {
    const runIds = new Set(demo.runIds);
    for (const [id, s] of Object.entries(unmapped)) {
      s.history = s.history.filter((h) => !runIds.has(h.runId));
      if (s.history.length === 0) delete unmapped[id];
    }
    if (Object.keys(unmapped).length) await repo.saveManyIssueResults({ [uKey]: unmapped });
    else await repo.deleteIssueResults([uKey]);
  }
  await repo.deleteDemo();
  return { deletedIssues, deletedRuns: demo.runIds.length };
}
