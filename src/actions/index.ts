import api from '@forge/api';
import * as app from '../services/app';
import * as jira from '../services/jira';

/**
 * Rovo actions (F9) and MCP tools (F10). One handler per action key; all go through services/app,
 * the same layer the UI uses. Reads run as the invoking user and check project/issue access first,
 * so the agent and IDE clients only see what the user could see in Jira.
 */

interface ActionPayload {
  [input: string]: unknown;
  context?: { cloudId?: string; jira?: { issueKey?: string; projectKey?: string } };
}

type Result = Record<string, unknown>;

function run(fn: (p: ActionPayload) => Promise<unknown>) {
  return async (payload: ActionPayload): Promise<Result> => {
    try {
      return { ok: true, result: await fn(payload ?? {}) };
    } catch (e) {
      const known = e instanceof app.UserError || e instanceof jira.JiraError;
      if (!(e instanceof app.UserError)) console.error('ShipProof action error', (e as Error).message);
      // Returned, not thrown, so the agent tells the user what went wrong instead of guessing.
      return { ok: false, error: known ? (e as Error).message : 'ShipProof could not complete this request.' };
    }
  };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function issueKey(p: ActionPayload): string {
  const k = str(p.issueKey) ?? p.context?.jira?.issueKey;
  if (!k) throw new app.UserError('Which issue? Provide an issue key like PROJ-12.');
  return k.toUpperCase();
}

function projectKey(p: ActionPayload): string {
  const k =
    str(p.projectKey) ??
    p.context?.jira?.projectKey ??
    (p.context?.jira?.issueKey ? app.projectOf(p.context.jira.issueKey) : undefined);
  if (!k) throw new app.UserError('Which project? Provide a Jira project key like PROJ.');
  return k.toUpperCase();
}

async function assertCanSeeIssue(key: string) {
  await jira.getIssue(api.asUser(), key, ['summary']); // 404/403 if the user can't see it
}

export const getLatestTriage = run(async (p) => {
  const key = projectKey(p);
  await jira.assertCanBrowseProject(api.asUser(), key);
  return app.getLatestTriage(key, str(p.runId));
});

export const getIssueEvidence = run(async (p) => {
  const key = issueKey(p);
  await assertCanSeeIssue(key);
  return app.getIssueEvidence(key);
});

export const getReleaseReadiness = run(async (p) => {
  const fixVersion = str(p.fixVersion);
  if (!fixVersion) throw new app.UserError('Which fix version? e.g. 2.4.0');
  const r = await app.getReleaseReadiness(api.asUser(), projectKey(p), fixVersion, p.context?.cloudId);
  // keep the agent's context small: the lowest-confidence stories only
  return { ...r, confidenceDetail: { ...r.confidenceDetail, perIssue: r.confidenceDetail.perIssue.slice(0, 10) } };
});

export const listFailureClusters = run(async (p) => {
  const key = projectKey(p);
  await jira.assertCanBrowseProject(api.asUser(), key);
  return app.listFailureClusters(key, str(p.category), Number(p.sinceDays ?? 7));
});

export const getIssueContext = run(async (p) => app.getIssueContext(api.asUser(), issueKey(p)));

/** Write action: agent-only (not an MCP tool); the prompt requires explicit user confirmation. */
export const createBugFromCluster = run(async (p) => {
  const sig = str(p.signature);
  if (!sig) throw new app.UserError('Which cluster? Provide its signature, e.g. 7f3a9c or sp-sig-7f3a9c.');
  return app.createIssueFromCluster(api.asUser(), projectKey(p), sig, 'bug');
});

/** Write action: agent-only (not an MCP tool); the prompt requires explicit user confirmation. */
export const addIssueComment = run(async (p) => {
  const body = str(p.body);
  if (!body) throw new app.UserError('The comment body is empty.');
  return app.addIssueComment(api.asUser(), issueKey(p), body);
});
