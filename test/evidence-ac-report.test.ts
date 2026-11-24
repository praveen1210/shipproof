import { describe, expect, it } from 'vitest';
import { buildIssueEvidence, historyStrip, isTrusted, overallStatus } from '../src/services/evidence';
import { adfToText, extractAcceptanceCriteria, matchCoverage, splitAcs } from '../src/services/acParser';
import { adfDoc, inline, markdownToAdf } from '../src/services/adf';
import { renderReleaseReport } from '../src/services/report';
import { evaluateRelease } from '../src/services/readiness';
import {
  bugDescriptionMarkdown,
  bugSummary,
  exactDedupeJql,
  jqlString,
  maintenanceTaskSummary,
  rarestTokens,
  suggestDedupeJql,
} from '../src/services/dedupe';
import type { Cluster, HistoryEntry, IssueResults } from '../src/services/types';
import { categoryText, withDefaults } from '../src/services/types';

const NOW = 100 * 3_600_000;
const e = (status: HistoryEntry['status'], at: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ runId: `r${at}`, status, at, ...extra });

const cluster = (sig: string, extra: Partial<Cluster> = {}): Cluster => ({
  projectKey: 'PROJ',
  signature: sig,
  category: 'product',
  ruleId: 'ASSERT-EQ',
  explanation: 'An assertion failed.',
  flaky: false,
  skeleton: 'AssertionFailedError: expected: <Order Placed> but was: <Payment Failed> CheckoutSteps',
  exceptionType: 'AssertionFailedError',
  failedStep: 'Then the order is placed',
  sampleError: 'expected: <Order Placed> but was: <Payment Failed>',
  runCounts: { r1: 3, r2: 4 },
  count: 7,
  firstSeen: 0,
  lastSeen: NOW,
  lastRunId: 'r2',
  issueKeys: ['PROJ-12'],
  scenarioIds: ['checkout.feature:Pay with saved card'],
  buildUrls: ['https://ci/1287'],
  environments: ['staging'],
  ...extra,
});

describe('US-3 issue panel evidence', () => {
  const results: IssueResults = {
    a: { name: 'Pay with saved card', history: [e('passed', 1), e('failed', NOW, { category: 'product', signature: 'p1' })] },
    b: { name: 'Pay with UPI', history: [e('passed', NOW)] },
    c: { name: 'Pay with wallet', history: [e('passed', NOW)] },
    d: { name: 'Search suggestions', history: [e('failed', 1), e('passed', 2), e('failed', NOW, { category: 'maintenance', flaky: true, signature: 'f1' })] },
  };

  it('shows "Failing – product defect" with badges, history strips and the linked bug', () => {
    const ev = buildIssueEvidence('PROJ-12', results, { p1: cluster('p1', { bugKey: 'PROJ-40' }), f1: cluster('f1', { category: 'maintenance', ruleId: 'PW-LOCATOR', flaky: true }) }, NOW, 72);
    expect(ev.statusText).toBe('Failing – product defect');
    expect(ev.counts).toEqual({ total: 4, passed: 2, failed: 1, skipped: 0, flaky: 1 });
    expect(ev.scenarios[0]).toMatchObject({ name: 'Pay with saved card', categoryLabel: '🐞 Product defect', ruleId: 'ASSERT-EQ', bugKey: 'PROJ-40', historyStrip: '✅❌' });
    expect(ev.scenarios[1]).toMatchObject({ categoryLabel: '🎲 Flaky', historyStrip: '❌✅🎲' });
    expect(ev.linkedBugs).toEqual(['PROJ-40']);
    expect(ev.lastRunAt).toBe(NOW);
  });

  it('shows "No test evidence" with the agent hint', () => {
    const ev = buildIssueEvidence('PROJ-20', undefined, {}, NOW, 72);
    expect(ev).toMatchObject({ status: 'no-evidence', statusText: 'No test evidence', hint: 'Ask the ShipProof agent to draft scenarios' });
  });

  it('ranks overall status product > unclassified > maintenance > environment > flaky > passing > skipped', () => {
    const l = (status: HistoryEntry['status'], category?: any, flaky = false) => ({ latest: { status, category, flaky, stale: false, runId: 'r', at: 0 } });
    expect(overallStatus([l('failed', 'environment'), l('failed', 'unclassified')])).toBe('failing-unclassified');
    expect(overallStatus([l('failed', 'environment'), l('failed', 'maintenance')])).toBe('failing-maintenance');
    expect(overallStatus([l('failed', 'environment')])).toBe('failing-environment');
    expect(overallStatus([l('failed', 'product', true), l('passed')])).toBe('flaky');
    expect(overallStatus([l('passed'), l('skipped')])).toBe('passing');
    expect(overallStatus([l('skipped')])).toBe('skipped');
    expect(overallStatus([l('failed')])).toBe('failing-unclassified');
  });

  it('uses a reclassification override from the cluster', () => {
    const ev = buildIssueEvidence('PROJ-12', { a: results.a }, { p1: cluster('p1', { override: 'environment' }) }, NOW, 72);
    expect(ev.status).toBe('failing-environment');
  });

  it('helpers', () => {
    expect(historyStrip({ name: 'x', history: [e('skipped', 2), e('passed', 1)] })).toBe('✅⏭');
    expect(isTrusted(undefined)).toBe(false);
    expect(categoryText('environment')).toBe('🌩 Environment');
    expect(withDefaults({ staleHours: 24, weights: { highBug: 20 } as any })).toMatchObject({ staleHours: 24, retentionDays: 30, weights: { highBug: 20, mediumBug: 5 } });
    expect(withDefaults(undefined).twgEnabled).toBe(false);
  });
});

describe('AC extraction (§6.6)', () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'As a shopper I want to pay with a saved card.' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved cards are listed at checkout' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paying with a saved card places the order' }] }] },
        ],
      },
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Expired cards are hidden' }] }] }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Given a declined card' }, { type: 'hardBreak' }, { type: 'text', text: 'When I pay' }, { type: 'hardBreak' }, { type: 'text', text: 'Then I see "Card declined"' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Notes' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Design link in Figma' }] },
      { type: 'rule' },
      { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
    ],
  };

  it('converts ADF to text with headings and list markers', () => {
    const t = adfToText(adf);
    expect(t).toContain('# Acceptance criteria');
    expect(t).toContain('- Saved cards are listed at checkout');
    expect(t).toContain('1. Expired cards are hidden');
    expect(adfToText(null)).toBe('');
    expect(adfToText('plain')).toBe('plain');
  });

  it('extracts bullets, numbered items and Given/When/Then blocks from the AC section only', () => {
    const r = extractAcceptanceCriteria(adf);
    expect(r.source).toBe('section');
    expect(r.acs).toEqual([
      'Saved cards are listed at checkout',
      'Paying with a saved card places the order',
      'Expired cards are hidden',
      'Given a declined card When I pay Then I see "Card declined"',
    ]);
  });

  it('accepts "ACs:" headings with inline text and plain-text descriptions', () => {
    const r = extractAcceptanceCriteria('Intro\nACs: user can reset the password by email\n- link expires after 24 hours\n## Out of scope\n- SMS');
    expect(r.acs).toEqual(['user can reset the password by email', 'link expires after 24 hours']);
  });

  it('falls back to the description and flags it', () => {
    const r = extractAcceptanceCriteria('- Users can export orders as CSV\n- Export includes GST column');
    expect(r).toMatchObject({ source: 'description', acs: ['Users can export orders as CSV', 'Export includes GST column'] });
    expect(r.warning).toMatch(/No "Acceptance criteria" section/);
    expect(extractAcceptanceCriteria(undefined)).toMatchObject({ source: 'none', acs: [] });
  });

  it('splits gherkin continued by plain lines', () => {
    expect(splitAcs(['Scenario: refund', 'Given a paid order', 'And it was shipped', 'more context here', '', '[x] done item'])).toEqual([
      'Scenario: refund',
      'Given a paid order And it was shipped more context here',
      'done item',
    ]);
  });

  it('matches ACs to scenarios lexically', () => {
    const cov = matchCoverage(
      ['Saved cards are listed at checkout', 'Expired cards are hidden', 'Paying with a saved card places the order'],
      ['Pay with saved card @PROJ-12', 'List saved cards on checkout page'],
    );
    expect(cov.map((c) => c.covered)).toEqual([true, false, true]);
    expect(cov[0].coveredBy).toContain('List saved cards on checkout page');
  });
});

describe('Markdown → ADF', () => {
  it('converts headings, lists, tables, code and inline marks', () => {
    const doc = markdownToAdf('# Title\n\nSome **bold** and `code` and [link](https://x.y)\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n```\n```');
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'table', 'codeBlock', 'codeBlock']);
    const para = doc.content![1].content!;
    expect(para.some((n: any) => n.marks?.[0]?.type === 'strong')).toBe(true);
    expect(para.some((n: any) => n.marks?.[0]?.type === 'link')).toBe(true);
    expect(para.some((n) => n.type === 'hardBreak')).toBe(true);
    expect(doc.content![4].content).toHaveLength(2); // header row + 1 row (separator dropped)
    expect(adfDoc('hi')).toMatchObject({ version: 1, type: 'doc' });
    expect(inline('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});

describe('bug dedupe and creation (§6.4)', () => {
  it('builds exact and suggest JQL', () => {
    expect(exactDedupeJql('PROJ', '7f3a9c')).toBe('project = "PROJ" AND labels = "sp-sig-7f3a9c" AND statusCategory != Done ORDER BY created DESC');
    const s = suggestDedupeJql('PROJ', cluster('p1'))!;
    expect(s).toContain('issuetype = Bug AND updated >= -90d');
    expect(s).toContain('text ~ "AssertionFailedError"');
    expect(suggestDedupeJql('PROJ', { exceptionType: 'Error', skeleton: 'x' })).toBeUndefined();
    expect(jqlString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(rarestTokens('Expected <n> but was PaymentFailed CheckoutSteps total')).toEqual(['CheckoutSteps', 'PaymentFailed', 'total']);
  });

  it('writes an evidence-filled summary and description', () => {
    const c = cluster('7f3a9c');
    expect(bugSummary(c)).toBe('[ShipProof] Then the order is placed – AssertionFailedError');
    expect(bugSummary({ ...c, failedStep: '' })).toBe('[ShipProof] Pay with saved card – AssertionFailedError');
    expect(maintenanceTaskSummary({ ...c, ruleId: 'SEL-LOCATOR' })).toContain('Test maintenance: SEL-LOCATOR');
    const md = bugDescriptionMarkdown(c);
    for (const s of ['sp-sig-7f3a9c', 'Then the order is placed', 'Payment Failed', '| 7 | 2 |', 'staging', 'https://ci/1287', 'PROJ-12']) expect(md).toContain(s);
  });
});

describe('release report (§6.8)', () => {
  it('renders header, factors, triage summary, untracked defects and stories without evidence', () => {
    const evaluation = evaluateRelease({
      projectKey: 'PROJ',
      fixVersion: '2.4.0',
      issues: [
        { key: 'PROJ-12', summary: 'Pay', type: 'Story', status: 'In Progress', statusCategory: 'indeterminate' },
        { key: 'PROJ-20', summary: 'Refunds', type: 'Story', status: 'To Do', statusCategory: 'new' },
      ],
      evidence: { 'PROJ-12': { a: { name: 'Pay', history: [e('failed', NOW, { category: 'product', signature: 'p1' })] } } },
      clusters: { p1: cluster('p1') },
      now: NOW,
    });
    const md = renderReleaseReport({
      evaluation,
      clusters: [cluster('p1'), cluster('m1', { category: 'maintenance', bugKey: 'PROJ-50' }), cluster('t1', { bugKey: 'PROJ-41' })],
      summaries: { 'PROJ-20': 'Refunds' },
      generatedAt: Date.UTC(2026, 11, 1, 10, 0),
    });
    expect(md).toContain('# ShipProof release report: PROJ 2.4.0');
    expect(md).toContain(`**${evaluation.readiness}/100**`);
    expect(md).toContain('Stories failing with a product defect (1) | −12 | PROJ-12');
    expect(md).toContain('| 🐞 Product defect | 2 | 14 |');
    expect(md).toContain('`sp-sig-p1` Then the order is placed (7×) → PROJ-12');
    expect(md).toContain('PROJ-41: Then the order is placed');
    expect(md).toContain('- PROJ-20 Refunds');
    expect(md).not.toContain('Low-confidence evidence'); // the only evidenced story is a trusted product failure
  });

  it('says so when there is nothing to report', () => {
    const evaluation = evaluateRelease({ projectKey: 'P', fixVersion: '1', issues: [], evidence: {}, clusters: {}, now: NOW });
    const md = renderReleaseReport({ evaluation, clusters: [], generatedAt: 0 });
    expect(md).toContain('No deductions.');
    expect(md).toContain('None: every product-defect cluster');
  });
});
