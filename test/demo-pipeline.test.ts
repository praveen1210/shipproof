import { describe, expect, it } from 'vitest';
import { buildDemoRuns, CHECKOUT_SIGNATURE, DEMO_ISSUES, type Slot } from '../src/services/demoData';
import { triageRun } from '../src/services/triage';
import { runIdFor } from '../src/ingest/core';
import { ingestSchema } from '../src/ingest/schema';
import { evaluateRelease, type ReleaseIssue } from '../src/services/readiness';
import { buildIssueEvidence } from '../src/services/evidence';
import type { Cluster, IssueResults } from '../src/services/types';

const NOW = Date.UTC(2026, 11, 10, 8, 0);
const keyMap = Object.fromEntries(DEMO_ISSUES.map((d, i) => [d.slot, `DEMO-${i + 1}`])) as Record<Slot, string>;

/** Simulates ingest → consumer for a list of payloads, exactly like processRun does. */
function ingestAll(nights: number[], state = { issueResults: {} as Record<string, IssueResults>, clusters: {} as Record<string, Cluster> }) {
  const summaries = [];
  for (const p of buildDemoRuns('DEMO', keyMap, NOW, nights)) {
    expect(ingestSchema.safeParse(p).success).toBe(true);
    const run = { runId: runIdFor(p.projectKey, p.source, p.buildId), projectKey: p.projectKey, source: p.source, buildId: p.buildId, buildUrl: p.buildUrl, environment: p.environment, startedAt: Date.parse(p.startedAt) };
    const out = triageRun({ run, results: p.results, issueResults: state.issueResults, clusters: state.clusters });
    Object.assign(state.issueResults, out.issueResults);
    Object.assign(state.clusters, out.clusters);
    summaries.push(out.summary);
  }
  return { state, summaries };
}

function release(state: { issueResults: Record<string, IssueResults>; clusters: Record<string, Cluster> }) {
  const issues: ReleaseIssue[] = DEMO_ISSUES.filter((d) => d.inVersion).map((d) => ({
    key: keyMap[d.slot],
    summary: d.summary,
    type: d.kind === 'bug' ? 'Bug' : 'Story',
    status: d.done ? 'Done' : 'To Do',
    statusCategory: d.done ? 'done' : 'new',
    priority: d.priority,
  }));
  // simulate triage-time dedupe: demo bug 1 carries the checkout signature label
  const clusters = { ...state.clusters };
  if (clusters[CHECKOUT_SIGNATURE]) clusters[CHECKOUT_SIGNATURE] = { ...clusters[CHECKOUT_SIGNATURE], bugKey: keyMap.B1 };
  return evaluateRelease({ projectKey: 'DEMO', fixVersion: '2.4.0', issues, evidence: state.issueResults, clusters, now: NOW });
}

describe('US-7 demo workspace through the real pipeline', () => {
  const { state, summaries } = ingestAll([0, 1, 2, 3, 4]);
  const last = summaries.at(-1)!;

  it('ingests 5 nightly runs of ~300 results with unmapped results', () => {
    const total = summaries.reduce((a, s) => a + s.total, 0);
    console.log(`Demo: ${total} results, last night ${last.failed} failures in ${last.clusters.length} clusters`, last.byCategory);
    expect(total).toBeGreaterThanOrEqual(250);
    expect(last.unmapped).toBeGreaterThan(0);
  });

  it('turns last night\'s failures into 6 clusters: 2 🐞, 2 🔧, 1 🌩, 1 🎲', () => {
    const kinds = last.clusters.map((c) => (c.flaky ? 'flaky' : c.category)).sort();
    expect(kinds).toEqual(['environment', 'flaky', 'maintenance', 'maintenance', 'product', 'product']);
    expect(last.clusters.find((c) => c.signature === CHECKOUT_SIGNATURE)?.count).toBe(3);
  });

  it('keeps one cluster per signature across nights (no duplicates)', () => {
    const checkout = state.clusters[CHECKOUT_SIGNATURE];
    expect(checkout.count).toBe(9); // 3 scenarios × nights 3–5
    expect(Object.keys(checkout.runCounts)).toHaveLength(3);
  });

  it('shows the checkout story as failing with a product defect', () => {
    const ev = buildIssueEvidence(keyMap.S1, state.issueResults[keyMap.S1], state.clusters, NOW, 72);
    expect(ev.statusText).toBe('Failing – product defect');
    expect(buildIssueEvidence(keyMap.S8, state.issueResults[keyMap.S8], state.clusters, NOW, 72).statusText).toBe('No test evidence');
  });

  it('release 2.4.0 is "At risk – low evidence confidence" (readiness ≥ 80, confidence < 70)', () => {
    const e = release(state);
    console.log(`Demo release before rerun: readiness ${e.readiness}, confidence ${e.confidence}%, ${e.verdict}`, e.factors.map((f) => `${f.factor} −${f.points}`));
    expect(e.readiness).toBeGreaterThanOrEqual(80);
    expect(e.confidence).toBeLessThan(70);
    expect(e.verdict).toBe('At risk');
  });

  it('after the environment is fixed and the suite rerun, the release is Ready', () => {
    ingestAll([5], state);
    const e = release(state);
    console.log(`Demo release after rerun: readiness ${e.readiness}, confidence ${e.confidence}%, ${e.verdict}`);
    expect(e.confidence).toBeGreaterThanOrEqual(70);
    expect(e.verdict).toBe('Ready');
  });
});

describe('runs triaged out of order (live finding: the queue does not keep run order)', () => {
  const inOrder = ingestAll([0, 1, 2, 3, 4]);
  const orders = [
    [4, 3, 2, 1, 0],
    [4, 0, 1, 2, 3],
    [2, 4, 0, 3, 1],
  ];
  const view = (s: ReturnType<typeof ingestAll>['state']) =>
    Object.values(s.clusters)
      .filter((c) => c.lastRunId === Object.values(inOrder.state.clusters).find((x) => x.signature === c.signature)?.lastRunId)
      .map((c) => `${c.signature}:${c.flaky ? 'flaky' : c.category}:${c.count}`)
      .sort();

  it.each(orders)('order %j gives the same clusters, flaky flags and verdict as in-order triage', (...order) => {
    const shuffled = ingestAll(order);
    expect(view(shuffled.state)).toEqual(view(inOrder.state));
    const flakyIn = Object.values(inOrder.state.clusters).filter((c) => c.flaky).map((c) => c.signature).sort();
    const flakyOut = Object.values(shuffled.state.clusters).filter((c) => c.flaky).map((c) => c.signature).sort();
    expect(flakyOut).toEqual(flakyIn);
    const a = release(inOrder.state);
    const b = release(shuffled.state);
    expect([b.readiness, b.confidence, b.verdict]).toEqual([a.readiness, a.confidence, a.verdict]);
  });
});
