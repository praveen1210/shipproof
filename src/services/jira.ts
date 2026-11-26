import { route } from '@forge/api';
import type { ReleaseIssue, StatusCategory } from './readiness';
import { adfDoc } from './adf';

/** `api.asUser()` or `api.asApp()`: user-facing reads go through asUser so users only see what they may see. */
export interface Requester {
  requestJira: (url: ReturnType<typeof route>, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
    text: () => Promise<string>;
  }>;
}

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

async function call<T>(req: Requester, url: ReturnType<typeof route>, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await req.requestJira(url, {
    method: init?.method ?? 'GET',
    headers: JSON_HEADERS,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new JiraError(res.status, `Jira ${init?.method ?? 'GET'} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
  changelog?: { histories: { items: { field: string; fromString?: string; toString?: string }[] }[] };
}

/** Enhanced search (`/search/jql`) with nextPageToken paging. */
export async function searchJql(req: Requester, jql: string, fields: string[], opts: { max?: number; expand?: string } = {}): Promise<JiraIssue[]> {
  const out: JiraIssue[] = [];
  const max = opts.max ?? 500;
  let nextPageToken: string | undefined;
  do {
    const res = await call<{ issues: JiraIssue[]; nextPageToken?: string }>(req, route`/rest/api/3/search/jql`, {
      method: 'POST',
      body: { jql, fields, maxResults: Math.min(100, max - out.length), ...(opts.expand ? { expand: opts.expand } : {}), ...(nextPageToken ? { nextPageToken } : {}) },
    });
    out.push(...(res.issues ?? []));
    nextPageToken = res.nextPageToken;
  } while (nextPageToken && out.length < max);
  return out;
}

export async function getIssue(req: Requester, key: string, fields: string[]): Promise<JiraIssue> {
  return call<JiraIssue>(req, route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`);
}

export async function getProject(req: Requester, key: string): Promise<{ id: string; key: string; name: string; issueTypes: { id: string; name: string; subtask: boolean }[] }> {
  return call(req, route`/rest/api/3/project/${key}`);
}

export interface JiraVersion {
  id: string;
  name: string;
  released: boolean;
  archived: boolean;
  releaseDate?: string;
}

export async function listVersions(req: Requester, projectKey: string): Promise<JiraVersion[]> {
  return call<JiraVersion[]>(req, route`/rest/api/3/project/${projectKey}/versions`);
}

export async function createVersion(req: Requester, projectId: string, name: string, description: string): Promise<JiraVersion> {
  return call<JiraVersion>(req, route`/rest/api/3/version`, { method: 'POST', body: { projectId: Number(projectId), name, description } });
}

export async function deleteVersion(req: Requester, id: string): Promise<void> {
  await call(req, route`/rest/api/3/version/${id}`, { method: 'DELETE' });
}

export async function createIssue(req: Requester, fields: Record<string, unknown>): Promise<{ id: string; key: string }> {
  return call(req, route`/rest/api/3/issue`, { method: 'POST', body: { fields } });
}

export async function deleteIssue(req: Requester, key: string): Promise<void> {
  await call(req, route`/rest/api/3/issue/${key}?deleteSubtasks=true`, { method: 'DELETE' });
}

export async function addLabel(req: Requester, key: string, label: string): Promise<void> {
  await call(req, route`/rest/api/3/issue/${key}`, { method: 'PUT', body: { update: { labels: [{ add: label }] } } });
}

export async function linkIssues(req: Requester, inwardKey: string, outwardKey: string, type = 'Relates'): Promise<void> {
  await call(req, route`/rest/api/3/issueLink`, {
    method: 'POST',
    body: { type: { name: type }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } },
  });
}

export async function addComment(req: Requester, key: string, markdown: string): Promise<{ id: string }> {
  return call(req, route`/rest/api/3/issue/${key}/comment`, { method: 'POST', body: { body: adfDoc(markdown) } });
}

/** Moves an issue to the first transition whose target status is in the Done category, if any. */
export async function transitionToDone(req: Requester, key: string): Promise<boolean> {
  const res = await call<{ transitions: { id: string; to: { statusCategory: { key: string } } }[] }>(req, route`/rest/api/3/issue/${key}/transitions`);
  const t = res.transitions.find((x) => x.to?.statusCategory?.key === 'done');
  if (!t) return false;
  await call(req, route`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
  return true;
}

export async function getSiteUrl(req: Requester): Promise<string | undefined> {
  try {
    const info = await call<{ baseUrl: string }>(req, route`/rest/api/3/serverInfo`);
    return info.baseUrl;
  } catch {
    return undefined;
  }
}

const RELEASE_FIELDS = ['summary', 'issuetype', 'status', 'priority', 'fixVersions', 'labels'];
const DONE_NAME = /^(done|closed|resolved|released|complete[d]?)$/i;

function statusCategory(issue: JiraIssue): StatusCategory {
  const k = issue.fields.status?.statusCategory?.key;
  return k === 'done' ? 'done' : k === 'indeterminate' ? 'indeterminate' : 'new';
}

/** Issues in a fix version, mapped for the readiness engine; `reopened` comes from the changelog. */
export async function getReleaseIssues(req: Requester, projectKey: string, fixVersion: string): Promise<ReleaseIssue[]> {
  const jql = `project = "${projectKey.replace(/"/g, '')}" AND fixVersion = "${fixVersion.replace(/(["\\])/g, '\\$1')}" ORDER BY key ASC`;
  const issues = await searchJql(req, jql, RELEASE_FIELDS, { expand: 'changelog', max: 500 });
  return issues.map((i) => {
    const cat = statusCategory(i);
    const reopened =
      cat !== 'done' &&
      (i.changelog?.histories ?? []).some((h) => h.items.some((it) => it.field === 'status' && DONE_NAME.test(it.fromString ?? '') && !DONE_NAME.test(it.toString ?? '')));
    return {
      id: i.id,
      key: i.key,
      summary: i.fields.summary ?? '',
      type: i.fields.issuetype?.name ?? 'Task',
      status: i.fields.status?.name ?? '',
      statusCategory: cat,
      priority: i.fields.priority?.name,
      reopened,
    };
  });
}

export async function listProjects(req: Requester): Promise<{ id: string; key: string; name: string }[]> {
  const res = await call<{ values: { id: string; key: string; name: string }[] }>(req, route`/rest/api/3/project/search?maxResults=100&orderBy=name`);
  return res.values.map((p) => ({ id: p.id, key: p.key, name: p.name }));
}

/** Global "Administer Jira" check, as the user. */
export async function isJiraAdmin(req: Requester): Promise<boolean> {
  const res = await call<{ permissions: Record<string, { havePermission: boolean }> }>(req, route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  return !!res.permissions?.ADMINISTER?.havePermission;
}

/** Throws unless the user can browse the project (checked before returning stored test data). */
export async function assertCanBrowseProject(req: Requester, projectKey: string): Promise<void> {
  const res = await call<{ permissions: Record<string, { havePermission: boolean }> }>(
    req,
    route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=BROWSE_PROJECTS`,
  );
  if (!res.permissions?.BROWSE_PROJECTS?.havePermission) throw new JiraError(403, `You do not have access to project ${projectKey}`);
}

/** Removes all fix versions from an issue (used when a demo issue can't be deleted). */
export async function clearFixVersions(req: Requester, key: string): Promise<void> {
  await call(req, route`/rest/api/3/issue/${key}`, { method: 'PUT', body: { fields: { fixVersions: [] } } });
}
