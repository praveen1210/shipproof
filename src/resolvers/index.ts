import Resolver from '@forge/resolver';
import api, { webTrigger } from '@forge/api';
import * as app from '../services/app';
import * as jira from '../services/jira';
import * as repo from '../storage/repo';
import { loadDemo, removeDemo, ingestDemoRerun } from '../services/demo';
import { generateToken, hashToken } from '../ingest/token';
import { compileCustomRules } from '../services/triage/rules';
import type { Category, Settings } from '../services/types';
import { DEFAULT_WEIGHTS } from '../services/types';

/**
 * UI resolvers for the issue panel, project page and admin page. Thin adapters over services/app.
 * Issue and project keys come from the module context, never from the payload, so a frontend can
 * only ask about the issue or project it was rendered for.
 */
const resolver = new Resolver();
type Ctx = { cloudId?: string; moduleKey?: string; extension?: { issue?: { key?: string }; project?: { key?: string } } };

const asUser = () => api.asUser();

function wrap<P>(fn: (payload: P, ctx: Ctx) => Promise<unknown>) {
  return async ({ payload, context }: { payload: unknown; context: unknown }) => {
    try {
      return { ok: true, data: await fn((payload ?? {}) as P, (context ?? {}) as Ctx) };
    } catch (e) {
      const status = e instanceof jira.JiraError ? e.status : undefined;
      const message = e instanceof app.UserError || status ? (e as Error).message : 'Something went wrong. Try again.';
      if (!(e instanceof app.UserError)) console.error('ShipProof resolver error', (e as Error).message);
      return { ok: false, error: message, status };
    }
  };
}

const issueKeyOf = (ctx: Ctx) => {
  const k = ctx.extension?.issue?.key;
  if (!k) throw new app.UserError('No issue in context');
  return k;
};
const projectKeyOf = (ctx: Ctx) => {
  const k = ctx.extension?.project?.key;
  if (!k) throw new app.UserError('No project in context');
  return k;
};

async function requireAdmin(ctx: Ctx) {
  if (ctx.moduleKey !== 'sp-settings') throw new app.UserError('Settings can only be changed from the ShipProof admin page');
  if (!(await jira.isJiraAdmin(asUser()))) throw new app.UserError('Only Jira administrators can change ShipProof settings');
}

// ───────────── issue panel ─────────────

resolver.define('getIssueEvidence', wrap(async (_p, ctx) => app.getIssueEvidence(issueKeyOf(ctx))));

// ───────────── project page ─────────────

resolver.define('getTriage', wrap<{ runId?: string }>(async (p, ctx) => app.getLatestTriage(projectKeyOf(ctx), p.runId)));
resolver.define('listRuns', wrap(async (_p, ctx) => app.listRuns(projectKeyOf(ctx))));
resolver.define(
  'listClusters',
  wrap<{ category?: string; sinceDays?: number }>(async (p, ctx) => app.listFailureClusters(projectKeyOf(ctx), p.category, p.sinceDays)),
);
resolver.define(
  'reclassify',
  wrap<{ signature: string; category: Category | null }>(async (p, ctx) => {
    const allowed: (Category | null)[] = ['product', 'maintenance', 'environment', 'unclassified', null];
    if (!allowed.includes(p.category)) throw new app.UserError('Unknown category');
    return app.reclassifyCluster(projectKeyOf(ctx), p.signature, p.category);
  }),
);
resolver.define(
  'createFromCluster',
  wrap<{ signature: string; kind?: 'bug' | 'task' }>(async (p, ctx) =>
    app.createIssueFromCluster(asUser(), projectKeyOf(ctx), p.signature, p.kind === 'task' ? 'task' : 'bug'),
  ),
);
resolver.define(
  'linkCluster',
  wrap<{ signature: string; issueKey: string }>(async (p, ctx) => app.linkClusterToIssue(asUser(), projectKeyOf(ctx), p.signature, p.issueKey)),
);
resolver.define('listVersions', wrap(async (_p, ctx) => app.listVersions(asUser(), projectKeyOf(ctx))));
resolver.define(
  'getReadiness',
  wrap<{ fixVersion: string }>(async (p, ctx) => app.getReleaseReadiness(asUser(), projectKeyOf(ctx), p.fixVersion, ctx.cloudId)),
);
resolver.define(
  'getReport',
  wrap<{ fixVersion: string }>(async (p, ctx) => app.buildReleaseReport(asUser(), projectKeyOf(ctx), p.fixVersion, ctx.cloudId)),
);
resolver.define(
  'postReport',
  wrap<{ fixVersion: string; issueKey?: string }>(async (p, ctx) => {
    const projectKey = projectKeyOf(ctx);
    const target = p.issueKey || (await app.findReleaseIssue(asUser(), projectKey, p.fixVersion));
    if (!target) throw new app.UserError('No release issue found. Label an issue in the version "shipproof-release", or enter an issue key.');
    const { markdown } = await app.buildReleaseReport(asUser(), projectKey, p.fixVersion, ctx.cloudId);
    return app.addIssueComment(asUser(), target, markdown);
  }),
);

// ───────────── admin page ─────────────

export interface SettingsView extends Omit<Settings, 'tokenHash'> {
  hasToken: boolean;
  ingestUrl?: string;
}

async function settingsView(): Promise<SettingsView> {
  const { tokenHash, ...rest } = await repo.getSettings();
  let ingestUrl: string | undefined;
  try {
    ingestUrl = await webTrigger.getUrl('ingest');
  } catch {
    ingestUrl = undefined;
  }
  return { ...rest, hasToken: !!tokenHash, ingestUrl };
}

resolver.define(
  'getSettings',
  wrap(async (_p, ctx) => {
    await requireAdmin(ctx);
    return { settings: await settingsView(), demo: (await repo.getDemo()) ?? null, projects: await jira.listProjects(asUser()) };
  }),
);

resolver.define(
  'saveSettings',
  wrap<Partial<Settings>>(async (p, ctx) => {
    await requireAdmin(ctx);
    const current = await repo.getSettings();
    const num = (v: unknown, min: number, max: number, d: number) =>
      v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d;
    const rules = (p.customRules ?? current.customRules).slice(0, 50).map((r, i) => ({
      id: String(r.id || `CUSTOM-${i + 1}`).toUpperCase().slice(0, 30),
      category: r.category,
      pattern: String(r.pattern).slice(0, 500),
      explanation: r.explanation?.slice(0, 300),
    }));
    if (compileCustomRules(rules).length !== rules.length) throw new app.UserError('One of the custom rules is not a valid regular expression');
    const weights = { ...current.weights };
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]) {
      if (p.weights?.[k] !== undefined) weights[k] = num(p.weights[k], 0, 100, current.weights[k]);
    }
    const next: Settings = {
      ...current,
      weights,
      retentionDays: num(p.retentionDays, 1, 365, current.retentionDays),
      staleHours: num(p.staleHours, 1, 24 * 30, current.staleHours),
      excludedTypes: (p.excludedTypes ?? current.excludedTypes).map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
      maintenanceAssignee: p.maintenanceAssignee === undefined ? current.maintenanceAssignee : p.maintenanceAssignee || undefined,
      customRules: rules,
      twgEnabled: p.twgEnabled === undefined ? current.twgEnabled : !!p.twgEnabled,
    };
    await repo.saveSettings(next);
    return settingsView();
  }),
);

/** Generates or rotates the ingest token. The plain token is returned once and never stored. */
resolver.define(
  'rotateToken',
  wrap(async (_p, ctx) => {
    await requireAdmin(ctx);
    const token = generateToken();
    const current = await repo.getSettings();
    await repo.saveSettings({ ...current, tokenHash: hashToken(token), tokenCreatedAt: Date.now() });
    return { token, ingestUrl: (await settingsView()).ingestUrl };
  }),
);

resolver.define(
  'loadDemo',
  wrap<{ projectKey: string }>(async (p, ctx) => {
    await requireAdmin(ctx);
    if (!p.projectKey) throw new app.UserError('Pick a project for the demo workspace');
    return loadDemo(asUser(), p.projectKey.toUpperCase());
  }),
);
resolver.define(
  'demoRerun',
  wrap(async (_p, ctx) => {
    await requireAdmin(ctx);
    return ingestDemoRerun();
  }),
);
resolver.define(
  'removeDemo',
  wrap(async (_p, ctx) => {
    await requireAdmin(ctx);
    return removeDemo(asUser());
  }),
);
resolver.define(
  'demoStatus',
  wrap(async (_p, ctx) => {
    await requireAdmin(ctx);
    const demo = await repo.getDemo();
    if (!demo) return { demo: null };
    const runs = await Promise.all(demo.runIds.map((id) => repo.getRun(id)));
    return { demo, triaged: runs.filter((r) => r?.status === 'triaged').length, total: demo.runIds.length };
  }),
);

export const handler = resolver.getDefinitions();
