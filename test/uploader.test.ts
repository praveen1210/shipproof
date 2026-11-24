import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import * as up from '../ci/shipproof-upload.mjs';
import { ingestSchema } from '../src/ingest/schema';
import { classify } from '../src/services/triage/classify';

const sample = (f: string) => readFileSync(fileURLToPath(new URL(`../ci/samples/${f}`, import.meta.url)), 'utf8');

describe('CI uploader (F2/F3)', () => {
  it('parses Cucumber JSON with background steps, tags, undefined steps and unmapped scenarios', () => {
    const r = up.parseCucumber(sample('cucumber.json'), 'PROJ');
    expect(r.map((x: any) => [x.name, x.status, x.issueKeys])).toEqual([
      ['Pay with saved card', 'failed', ['PROJ-12']],
      ['Apply coupon at checkout', 'failed', ['PROJ-15']],
      ['Pay with UPI', 'failed', ['PROJ-12']],
      ['Guest checkout', 'passed', []],
    ]);
    expect(r[0]).toMatchObject({ id: 'checkout.feature:Pay with saved card', failedStep: 'Then the order is placed', durationMs: 4112 });
    expect(classify(r[0].error).ruleId).toBe('ASSERT-EQ');
    expect(classify(r[1].error).ruleId).toBe('SEL-LOCATOR');
    expect(classify(r[2].error).ruleId).toBe('CUKE-UNDEFINED');
  });

  it('parses JUnit XML with suite/testcase issue properties and [KEY] names', async () => {
    const r = await up.parseJUnit(sample('junit.xml'), 'PROJ');
    expect(r.map((x: any) => [x.name, x.status])).toEqual([
      ['createOrderReturns201', 'passed'],
      ['getOrderStatus', 'failed'],
      ['[PROJ-20] refundIsIssued', 'failed'],
      ['cancelOrder', 'skipped'],
    ]);
    expect(r[0].issueKeys).toEqual(['PROJ-18']);
    expect(r[2].issueKeys.sort()).toEqual(['PROJ-18', 'PROJ-20']);
    expect(classify(r[1].error).ruleId).toBe('HTTP-5XX-GW');
    expect(r[1].error).toContain('at io.restassured');
  });

  it('parses Playwright JSON with tags, annotations, nested suites and timeouts', () => {
    const r = up.parsePlaywright(sample('playwright.json'), 'PROJ');
    expect(r.map((x: any) => [x.name, x.status, x.issueKeys])).toEqual([
      ['search shows results @PROJ-22', 'passed', ['PROJ-22']],
      ['filter by category', 'failed', ['PROJ-22']],
      ['sorting › sort by price [PROJ-23]', 'failed', ['PROJ-23']],
    ]);
    expect(r[1].error).not.toMatch(/\u001b/);
    expect(classify(r[1].error).ruleId).toBe('PW-LOCATOR');
    expect(classify(r[2].error).ruleId).toBe('TIMEOUT-GLOBAL');
  });

  it('only maps keys of the target project and dedupes ids', () => {
    expect(up.extractIssueKeys(['@PROJ-1 @HTTP-500 [PROJ-2]', 'PROJ-1'], 'PROJ')).toEqual(['PROJ-1', 'PROJ-2']);
    expect(up.extractIssueKeys(['@OTHER-3'], undefined)).toEqual(['OTHER-3']);
  });

  it('chunks large runs into ≤ 190 KB parts that each pass the server schema', () => {
    const results = Array.from({ length: 900 }, (_, i) => ({
      id: `suite:test ${i}`,
      name: `test ${i}`,
      status: 'failed',
      issueKeys: ['PROJ-1'],
      error: 'x'.repeat(800),
    }));
    const parts = up.buildParts({ source: 'jenkins', projectKey: 'PROJ', buildId: '1', startedAt: '2026-12-01T10:15:00Z' }, results);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) {
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(190 * 1024);
      expect(ingestSchema.safeParse(p).success).toBe(true);
      expect(p.part.total).toBe(parts.length);
    }
    expect(parts.reduce((a: number, p: any) => a + p.results.length, 0)).toBe(900);
  });

  it('detects formats', () => {
    expect(up.detectFormat('a.xml', '<x/>')).toBe('junit');
    expect(up.detectFormat('a.json', '[]')).toBe('cucumber');
    expect(up.detectFormat('a.json', '{"suites":[]}')).toBe('playwright');
    expect(() => up.detectFormat('a.json', '{}')).toThrow(/--format/);
  });

  it('keeps the message head plus the top 5 stack frames', () => {
    const stack = Array.from({ length: 9 }, (_, i) => `    at frame${i} (f.js:${i}:1)`).join('\n');
    const out = up.compactError('Boom '.repeat(400), `Error\n${stack}`);
    expect(out.split('\n')).toHaveLength(6);
    expect(out.split('\n')[0].length).toBeLessThanOrEqual(1000);
  });

  it('computes the same run id as the server', async () => {
    const { runIdFor } = await import('../src/ingest/core');
    expect(up.runIdFor('PROJ', 'jenkins', '1287')).toBe(runIdFor('PROJ', 'jenkins', '1287'));
  });

  it('prints help and exits 2 without required args', async () => {
    expect(await up.main([], {})).toBe(2);
  });
});
