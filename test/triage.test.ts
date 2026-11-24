import { describe, expect, it } from 'vitest';
import { classify } from '../src/services/triage/classify';
import { normalise, exceptionType, skeletonTokens } from '../src/services/triage/normalise';
import { signature, signatureLabel } from '../src/services/triage/signature';
import { flakyStats, isFlakyFailure } from '../src/services/triage/flaky';
import { mergeCluster, removeRun } from '../src/services/triage/cluster';
import { triageRun, unmappedKey } from '../src/services/triage';
import { compileCustomRules } from '../src/services/triage/rules';
import type { HistoryEntry, IngestResult, RunMeta } from '../src/services/types';

describe('US-2 deterministic classification (PRD examples)', () => {
  it.each([
    ['NoSuchElementException: Unable to locate element: #loginBtn', 'maintenance', 'SEL-LOCATOR'],
    ['locator.click: Timeout 30000ms exceeded waiting for getByRole', 'maintenance', 'PW-LOCATOR'],
    ['ECONNREFUSED 10.0.0.5:8443', 'environment', 'NET-REFUSED'],
    ['Expected status code <200> but was <503>', 'environment', 'HTTP-5XX-GW'],
    ['expected: <Order Placed> but was: <Payment Failed>', 'product', 'ASSERT-EQ'],
  ])('%s → %s / %s', (error, category, rule) => {
    const c = classify(error);
    expect(c.category).toBe(category);
    expect(c.ruleId).toBe(rule);
    expect(c.explanation.length).toBeGreaterThan(10);
  });

  it('returns Unclassified for empty and unknown messages', () => {
    expect(classify(undefined).category).toBe('unclassified');
    expect(classify('   ').ruleId).toBe('NONE');
    expect(classify('Something odd happened').category).toBe('unclassified');
  });

  it('runs custom rules before built-ins and ignores invalid regexes', () => {
    const custom = [
      { id: 'BAD', category: 'product' as const, pattern: '([' },
      { id: 'ACME-STUB', category: 'environment' as const, pattern: 'payment stub returned', explanation: 'stub down' },
    ];
    expect(compileCustomRules(custom)).toHaveLength(1);
    const c = classify('AssertionError: payment stub returned HTML', custom);
    expect(c).toMatchObject({ category: 'environment', ruleId: 'ACME-STUB', explanation: 'stub down' });
    expect(classify('x', compileCustomRules(custom)).category).toBe('unclassified');
  });
});

describe('normalise + signature', () => {
  const a = `org.openqa.selenium.TimeoutException: waited 30 seconds at 2026-12-01T10:15:00Z for session 9f8e7d6c5b4a3f2e1d0c
    at org.openqa.selenium.support.ui.WebDriverWait.timeoutException(WebDriverWait.java:84)`;
  const b = `org.openqa.selenium.TimeoutException: waited 30 seconds at 2026-12-02T03:01:44Z for session 1a2b3c4d5e6f7a8b9c0d
    at org.openqa.selenium.support.ui.WebDriverWait.timeoutException(WebDriverWait.java:90)`;

  it('strips timestamps, hex ids, stack frames, uuids, ports, paths and big numbers', () => {
    expect(normalise(a)).toBe(normalise(b));
    expect(normalise(a)).not.toMatch(/2026|9f8e7d|WebDriverWait\.java/);
    expect(normalise('ECONNREFUSED 10.0.0.5:8443')).toBe('ECONNREFUSED <ip>');
    expect(normalise('order 123e4567-e89b-12d3-a456-426614174000 total 125000')).toBe('order <uuid> total <n>');
    expect(normalise('open /tmp/run-77/screens/a.png failed')).toContain('<path>');
    expect(normalise('localhost:8443 down')).toBe('localhost:<port> down');
    expect(normalise('Timeout 30000ms exceeded')).toBe('Timeout <dur> exceeded');
    expect(normalise(undefined)).toBe('');
  });

  it('keeps locators but masks quoted data', () => {
    expect(normalise(`waiting for locator('#email')`)).toContain(`'#email'`);
    expect(normalise(`Expected "Welcome back, asha@example.com"`)).toContain('"<str>"');
    expect(normalise(`Expected "12.50"`)).toContain('"<n>"');
  });

  it('extracts the exception type', () => {
    expect(exceptionType('org.openqa.selenium.NoSuchElementException: x')).toBe('NoSuchElementException');
    expect(exceptionType('Error: connect ECONNREFUSED 1.2.3.4:5')).toBe('ECONNREFUSED');
    expect(exceptionType('expected: <a> but was: <b>')).toBe('Error');
    expect(skeletonTokens('NoSuchElementException <n> #loginBtn')).toContain('#loginBtn');
  });

  it('is a stable 6-hex signature that depends on the failing step', () => {
    const s1 = signature(normalise(a), 'When I confirm the payment');
    expect(s1).toMatch(/^[0-9a-f]{6}$/);
    expect(signature(normalise(b), '  when I confirm   the payment ')).toBe(s1);
    expect(signature(normalise(a), 'Then the order is placed')).not.toBe(s1);
    expect(signatureLabel('7f3a9c')).toBe('sp-sig-7f3a9c');
  });
});

const h = (statuses: string): HistoryEntry[] =>
  [...statuses].map((c, i) => ({
    runId: `r${i}`,
    status: c === 'P' ? 'passed' : c === 'F' ? 'failed' : 'skipped',
    at: i * 1000,
  }));

describe('flaky overlay', () => {
  it('flags alternating results that failed last', () => {
    expect(isFlakyFailure(h('PFPPFPPF'))).toBe(true);
    expect(flakyStats(h('PFPPFPPF'))).toMatchObject({ flips: 5, decided: 8 });
  });
  it('does not flag a fresh regression, a permanent failure or a pass', () => {
    expect(isFlakyFailure(h('PPPPPPPPPF'))).toBe(false); // 90% but one flip: real regression
    expect(isFlakyFailure(h('FFFFF'))).toBe(false);
    expect(isFlakyFailure(h('PFPFP'))).toBe(false); // passed last
    expect(isFlakyFailure([])).toBe(false);
  });
  it('needs at least 3 decided results and ignores skips', () => {
    expect(isFlakyFailure(h('PF'))).toBe(false);
    expect(flakyStats(h('PSSFSPF')).decided).toBe(4);
  });
  it('only looks at the last 10 results', () => {
    expect(isFlakyFailure(h('PFPFPFPF' + 'FFFFFFFFFF'))).toBe(false);
  });
});

const run = (n: number, extra: Partial<RunMeta> = {}): RunMeta => ({
  runId: `run${n}`,
  projectKey: 'PROJ',
  source: 'jenkins',
  buildId: String(n),
  buildUrl: `https://ci/${n}`,
  environment: 'staging',
  startedAt: n * 86_400_000,
  ...extra,
});

const fail = (id: string, keys: string[], error: string, step = 'When I pay'): IngestResult => ({
  id,
  name: id,
  status: 'failed',
  issueKeys: keys,
  failedStep: step,
  error,
});

describe('triageRun pipeline', () => {
  it('clusters 14 failures across 3 runs into 1 cluster with first/last seen', () => {
    let issueResults = {};
    let clusters = {};
    const counts = [5, 5, 4];
    counts.forEach((c, i) => {
      const results = Array.from({ length: c }, (_, j) =>
        fail(`s${j}`, ['PROJ-12'], `expected: <Order Placed> but was: <Payment Failed> at 2026-12-0${i + 1}T10:00:00Z id ${i}abcdef12`),
      );
      const out = triageRun({ run: run(i + 1), results, issueResults, clusters });
      issueResults = { ...issueResults, ...out.issueResults };
      clusters = { ...clusters, ...out.clusters };
    });
    const list = Object.values(clusters) as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 14, firstSeen: 86_400_000, lastSeen: 3 * 86_400_000, category: 'product', ruleId: 'ASSERT-EQ' });
  });

  it('is idempotent when the same run is ingested twice', () => {
    const results = [fail('a', ['PROJ-1'], 'ECONNREFUSED 1.1.1.1:80'), { id: 'b', name: 'b', status: 'passed' as const, issueKeys: ['PROJ-1'] }];
    const first = triageRun({ run: run(1), results, issueResults: {}, clusters: {} });
    const again = triageRun({ run: run(1), results, issueResults: first.issueResults, clusters: first.clusters, previousSignatures: first.summary.clusters.map((c) => c.signature) });
    const c = Object.values(again.clusters)[0];
    expect(c.count).toBe(1);
    expect(again.issueResults['PROJ-1'].a.history).toHaveLength(1);
  });

  it('removes a run contribution when a re-upload no longer contains the failure', () => {
    const r1 = triageRun({ run: run(1), results: [fail('a', ['PROJ-1'], 'ECONNREFUSED 1.1.1.1:80')], issueResults: {}, clusters: {} });
    const sig = r1.summary.clusters[0].signature;
    const r2 = triageRun({
      run: run(1),
      results: [{ id: 'a', name: 'a', status: 'passed', issueKeys: ['PROJ-1'] }],
      issueResults: r1.issueResults,
      clusters: r1.clusters,
      previousSignatures: [sig],
    });
    expect(r2.clusters[sig].count).toBe(0);
    expect(removeRun(r2.clusters[sig], 'nope')).toBe(r2.clusters[sig]);
  });

  it('marks flaky failures and counts them under flaky in the run summary', () => {
    let issueResults = {};
    let clusters = {};
    let last: ReturnType<typeof triageRun> | undefined;
    'PFPPF'.split('').forEach((c, i) => {
      const results: IngestResult[] = [
        c === 'P'
          ? { id: 'search', name: 'search', status: 'passed', issueKeys: ['PROJ-6'] }
          : fail('search', ['PROJ-6'], "locator.click: Timeout 30000ms exceeded.\n - waiting for getByRole('button')"),
      ];
      last = triageRun({ run: run(i + 1), results, issueResults, clusters });
      issueResults = { ...issueResults, ...last.issueResults };
      clusters = { ...clusters, ...last.clusters };
    });
    expect(last!.summary.byCategory.flaky).toBe(1);
    const entry = last!.issueResults['PROJ-6'].search.history.at(-1)!;
    expect(entry).toMatchObject({ status: 'failed', flaky: true, category: 'maintenance' });
    expect(Object.values(clusters)[0]).toMatchObject({ flaky: true });
  });

  it('stores results without issue keys as Unmapped and counts them', () => {
    const out = triageRun({
      run: run(1),
      results: [{ id: 'x', name: 'x', status: 'passed' }, fail('y', [], 'Expected status code <200> but was <503>')],
      issueResults: {},
      clusters: {},
    });
    expect(out.summary).toMatchObject({ unmapped: 2, total: 2, passed: 1, failed: 1, issueKeys: [] });
    expect(Object.keys(out.issueResults[unmappedKey('PROJ')])).toEqual(['x', 'y']);
    expect(Object.values(out.clusters)[0].issueKeys).toEqual([]);
  });

  it('applies a cluster override to future failures with that signature', () => {
    const r1 = triageRun({ run: run(1), results: [fail('a', ['PROJ-1'], 'Weird thing')], issueResults: {}, clusters: {} });
    const sig = r1.summary.clusters[0].signature;
    expect(r1.summary.byCategory.unclassified).toBe(1);
    const overridden = { [sig]: { ...r1.clusters[sig], override: 'environment' as const } };
    const r2 = triageRun({ run: run(2), results: [fail('a', ['PROJ-1'], 'Weird thing')], issueResults: r1.issueResults, clusters: overridden });
    expect(r2.summary.byCategory.environment).toBe(1);
    expect(r2.clusters[sig].override).toBe('environment');
    expect(r2.issueResults['PROJ-1'].a.history.at(-1)!.category).toBe('environment');
  });

  it('keeps at most 10 history entries per scenario', () => {
    let issueResults = {};
    for (let i = 1; i <= 13; i++) {
      const out = triageRun({ run: run(i), results: [{ id: 'a', name: 'a', status: 'passed', issueKeys: ['PROJ-1'] }], issueResults, clusters: {} });
      issueResults = { ...issueResults, ...out.issueResults };
    }
    expect((issueResults as any)['PROJ-1'].a.history).toHaveLength(10);
  });

  it('maps one result to several issues', () => {
    const out = triageRun({ run: run(1), results: [fail('a', ['PROJ-1', 'proj-2', 'PROJ-1'], 'Expected status code <200> but was <400>')], issueResults: {}, clusters: {} });
    expect(Object.keys(out.issueResults).sort()).toEqual(['PROJ-1', 'PROJ-2']);
    expect(Object.values(out.clusters)[0]).toMatchObject({ issueKeys: ['PROJ-1', 'PROJ-2'], category: 'product', ruleId: 'RA-STATUS-4XX' });
  });
});

describe('mergeCluster', () => {
  const occ = {
    signature: 'abc123',
    category: 'product' as const,
    ruleId: 'ASSERT-EQ',
    explanation: 'x',
    flaky: false,
    skeleton: 's',
    exceptionType: 'AssertionError',
    failedStep: 'Then ok',
    error: 'expected <a> but was <b>',
    scenarioId: 's1',
    issueKeys: ['PROJ-1'],
  };
  it('throws without occurrences', () => {
    expect(() => mergeCluster(undefined, [], { projectKey: 'P', runId: 'r', at: 1 })).toThrow();
  });
  it('keeps the newer sample and bug link and does not move lastSeen back for older runs', () => {
    const c1 = mergeCluster(undefined, [occ], { projectKey: 'PROJ', runId: 'r2', at: 200, buildUrl: 'u2' });
    const linked = { ...c1, bugKey: 'PROJ-99' };
    const c2 = mergeCluster(linked, [{ ...occ, error: 'older', scenarioId: 's2' }], { projectKey: 'PROJ', runId: 'r1', at: 100 });
    expect(c2).toMatchObject({ lastSeen: 200, firstSeen: 100, sampleError: c1.sampleError, bugKey: 'PROJ-99', count: 2, lastRunId: 'r2' });
    expect(c2.scenarioIds).toEqual(['s1', 's2']);
  });
  it('prunes per-run counts beyond 60 runs', () => {
    let c = mergeCluster(undefined, [occ], { projectKey: 'PROJ', runId: 'r0', at: 0 });
    for (let i = 1; i < 70; i++) c = mergeCluster(c, [occ], { projectKey: 'PROJ', runId: `r${i}`, at: i });
    expect(Object.keys(c.runCounts)).toHaveLength(60);
    expect(c.count).toBe(60);
  });
});
