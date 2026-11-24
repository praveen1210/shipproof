import { describe, expect, it } from 'vitest';
import {
  computeConfidence,
  computeReadiness,
  evaluateRelease,
  verdictFor,
  type ReleaseInput,
  type ReleaseIssue,
} from '../src/services/readiness';
import type { Cluster, HistoryEntry, IssueResults } from '../src/services/types';

const NOW = 10 * 86_400_000;
const HOUR = 3_600_000;

const story = (key: string, extra: Partial<ReleaseIssue> = {}): ReleaseIssue => ({
  key,
  summary: key,
  type: 'Story',
  status: 'Done',
  statusCategory: 'done',
  ...extra,
});
const bug = (key: string, priority: string, extra: Partial<ReleaseIssue> = {}): ReleaseIssue => ({
  key,
  summary: key,
  type: 'Bug',
  status: 'To Do',
  statusCategory: 'new',
  priority,
  ...extra,
});

const entry = (status: HistoryEntry['status'], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  runId: 'r1',
  status,
  at: NOW - HOUR,
  ...extra,
});

/** n scenarios with the given latest entry */
const scen = (...entries: HistoryEntry[]): IssueResults =>
  Object.fromEntries(entries.map((e, i) => [`s${i}`, { name: `scenario ${i}`, history: [e] }]));

const cluster = (sig: string, extra: Partial<Cluster> = {}): Cluster => ({
  projectKey: 'PROJ',
  signature: sig,
  category: 'product',
  ruleId: 'ASSERT-EQ',
  explanation: '',
  flaky: false,
  skeleton: '',
  exceptionType: 'AssertionError',
  failedStep: 'Then ok',
  sampleError: '',
  runCounts: { r1: 1 },
  count: 1,
  firstSeen: 0,
  lastSeen: NOW,
  lastRunId: 'r1',
  issueKeys: [],
  scenarioIds: [],
  buildUrls: [],
  environments: [],
  ...extra,
});

const input = (issues: ReleaseIssue[], evidence: Record<string, IssueResults>, clusters: Record<string, Cluster> = {}): ReleaseInput => ({
  projectKey: 'PROJ',
  fixVersion: '2.4.0',
  issues,
  evidence,
  clusters,
  now: NOW,
});

describe('computeReadiness (§6.5)', () => {
  it('is 100 with no deductions for a clean, fully evidenced, done release', () => {
    const r = computeReadiness(input([story('P-1')], { 'P-1': scen(entry('passed')) }));
    expect(r).toEqual({ score: 100, factors: [] });
  });

  it('applies each deduction with its cap and lists the issues', () => {
    const issues = [
      ...['B1', 'B2', 'B3', 'B4'].map((k) => bug(k, 'High')), // 4 × 15 = 60 → cap 45
      bug('B5', 'Medium'),
      bug('B6', 'Low'),
      bug('B7', 'Highest', { statusCategory: 'done', status: 'Done' }), // done bugs don't count
      story('S1'),
      story('S2', { statusCategory: 'indeterminate', status: 'In Progress', reopened: true, openPrCount: 2 }),
      story('S3', { type: 'Spike' }), // excluded type, no evidence ok
    ];
    const ev = {
      S1: scen(entry('failed', { category: 'product', signature: 'aaa111' })),
      S2: scen(entry('passed')),
    };
    const r = computeReadiness(input(issues, ev, { aaa111: cluster('aaa111', { issueKeys: ['S1'] }) }));
    const by = Object.fromEntries(r.factors.map((f) => [f.factor, f]));
    expect(by['Open High/Highest bugs']).toMatchObject({ points: 45, count: 4 });
    expect(by['Open Medium bugs']).toMatchObject({ points: 5, issueKeys: ['B5'] });
    expect(by['Stories failing with a product defect']).toMatchObject({ points: 12, issueKeys: ['S1'] });
    expect(by['Untracked product failures']).toMatchObject({ points: 5, issueKeys: ['S1'] });
    expect(by['Open pull requests']).toMatchObject({ points: 4, count: 2 });
    expect(by['Reopened issues']).toMatchObject({ points: 2, issueKeys: ['S2'] });
    // not done: B1..B6 + S2 = 7
    expect(by['Issues not Done']).toMatchObject({ points: 7 });
    expect(by['Stories with no test evidence']).toBeUndefined();
    expect(r.score).toBe(100 - 45 - 5 - 12 - 5 - 4 - 2 - 7);
    expect(r.factors[0].points).toBeGreaterThanOrEqual(r.factors[1].points);
  });

  it('ignores flaky, environment and maintenance failures for product risk', () => {
    const ev = {
      S1: scen(
        entry('failed', { category: 'environment', signature: 'e1' }),
        entry('failed', { category: 'maintenance', signature: 'm1' }),
        entry('failed', { category: 'product', signature: 'p1', flaky: true }),
      ),
    };
    const r = computeReadiness(input([story('S1')], ev));
    expect(r.score).toBe(100);
  });

  it('does not count a product failure as untracked when its cluster has a bug', () => {
    const ev = { S1: scen(entry('failed', { category: 'product', signature: 'p1' })) };
    const r = computeReadiness(input([story('S1')], ev, { p1: cluster('p1', { bugKey: 'PROJ-9' }) }));
    expect(r.factors.map((f) => f.factor)).toEqual(['Stories failing with a product defect']);
  });

  it('uses the cluster override over the stored category', () => {
    const ev = { S1: scen(entry('failed', { category: 'product', signature: 'p1' })) };
    const r = computeReadiness(input([story('S1')], ev, { p1: cluster('p1', { override: 'environment' }) }));
    expect(r.score).toBe(100);
  });

  it('caps every factor and never goes below 0', () => {
    const many = Array.from({ length: 30 }, (_, i) => story(`S${i}`, { statusCategory: 'new', status: 'To Do' }));
    const highs = Array.from({ length: 10 }, (_, i) => bug(`B${i}`, 'Highest'));
    const meds = Array.from({ length: 10 }, (_, i) => bug(`M${i}`, 'Medium'));
    const ev = Object.fromEntries(many.slice(0, 10).map((s, i) => [s.key, scen(entry('failed', { category: 'product', signature: `p${i}` }))]));
    const r = computeReadiness(input([...many, ...highs, ...meds], ev));
    const pts = Object.fromEntries(r.factors.map((f) => [f.factor, f.points]));
    expect(pts).toMatchObject({
      'Open High/Highest bugs': 45,
      'Open Medium bugs': 20,
      'Stories failing with a product defect': 48,
      'Untracked product failures': 15,
      'Stories with no test evidence': 15,
      'Issues not Done': 10,
    });
    expect(r.score).toBe(0);
  });

  it('respects custom weights (e.g. TWG factor switched off)', () => {
    const r = computeReadiness(input([story('S1', { openPrCount: 3 })], { S1: scen(entry('passed')) }), { weights: { openPr: 0 } });
    expect(r.score).toBe(100);
  });
});

describe('computeConfidence (§6.5)', () => {
  it('averages trusted/total over stories with evidence', () => {
    const ev = {
      S1: scen(entry('passed'), entry('passed'), entry('failed', { category: 'product' }), entry('skipped')), // 3/4
      S2: scen(entry('passed'), entry('failed', { category: 'environment' })), // 1/2
    };
    const c = computeConfidence(input([story('S1'), story('S2'), story('S3')], ev));
    expect(c).toMatchObject({ confidence: 63, storiesWithEvidence: 2, trustedScenarios: 4, totalScenarios: 6 });
    expect(c.perIssue[0].issueKey).toBe('S2');
  });

  it('does not trust flaky, maintenance, unclassified or stale results', () => {
    const ev = {
      S1: scen(
        entry('passed', { at: NOW - 80 * HOUR }), // stale at 72 h
        entry('failed', { category: 'product', flaky: true }),
        entry('failed', { category: 'maintenance' }),
        entry('failed', { category: 'unclassified' }),
        entry('passed'),
      ),
    };
    expect(computeConfidence(input([story('S1')], ev)).confidence).toBe(20);
    expect(computeConfidence(input([story('S1')], ev), { staleHours: 100 }).confidence).toBe(40);
  });

  it('is 0 when no story has evidence', () => {
    expect(computeConfidence(input([story('S1')], {})).confidence).toBe(0);
  });
});

describe('verdict', () => {
  it.each([
    [100, 100, 'Ready'],
    [80, 70, 'Ready'],
    [95, 69, 'At risk'],
    [79, 100, 'At risk'],
    [60, 10, 'At risk'],
    [59, 100, 'Not ready'],
  ])('readiness %i, confidence %i → %s', (r, c, v) => {
    expect(verdictFor(r, c).verdict).toBe(v);
  });
  it('explains low evidence confidence', () => {
    expect(verdictFor(92, 40).reason).toMatch(/low evidence confidence/);
  });
});

describe('US-4: green but untrustworthy is not ready', () => {
  it('all stories pass but 60% of scenarios are flaky or stale', () => {
    const stories = ['S1', 'S2', 'S3', 'S4', 'S5'].map((k) => story(k));
    // 10 scenarios per story: 4 fresh passes, 3 stale passes, 3 flaky failures
    const ev = Object.fromEntries(
      stories.map((s) => [
        s.key,
        scen(
          ...Array.from({ length: 4 }, () => entry('passed')),
          ...Array.from({ length: 3 }, () => entry('passed', { at: NOW - 100 * HOUR })),
          ...Array.from({ length: 3 }, () => entry('failed', { category: 'product', flaky: true })),
        ),
      ]),
    );
    const e = evaluateRelease(input(stories, ev));
    expect(e.readiness).toBeGreaterThanOrEqual(90);
    expect(e.confidence).toBeLessThan(70);
    expect(e.verdict).toBe('At risk');
    expect(e.verdictReason).toMatch(/low evidence confidence/);
    expect(e).toMatchObject({ storyCount: 5, issueCount: 5, storiesWithoutEvidence: [] });
  });
});
