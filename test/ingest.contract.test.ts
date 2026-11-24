import { describe, expect, it } from 'vitest';
import { handleIngest, header, runIdFor, type IngestDeps, type StoredRun, type TriageJob } from '../src/ingest/core';
import { generateToken, hashToken, verifyToken } from '../src/ingest/token';
import { MAX_BODY_BYTES } from '../src/ingest/schema';

const TOKEN = generateToken();

function fakeDeps(tokenHash: string | null = hashToken(TOKEN)) {
  const raw = new Map<string, unknown>();
  const runs = new Map<string, StoredRun>();
  const jobs: TriageJob[] = [];
  const deps: IngestDeps = {
    getTokenHash: async () => tokenHash ?? undefined,
    saveRawPart: async (runId, part, payload) => void raw.set(`${runId}:${part}`, payload),
    upsertRun: async (r) => void runs.set(r.runId, r),
    enqueue: async (j) => void jobs.push(j),
    now: () => 1_700_000_000_000,
  };
  return { deps, raw, runs, jobs };
}

const payload = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  source: 'jenkins',
  projectKey: 'PROJ',
  buildId: '1287',
  buildUrl: 'https://ci.example.com/job/app/1287',
  pipeline: 'nightly-regression',
  branch: 'release/2.4.0',
  commit: 'a1b2c3d',
  environment: 'staging',
  startedAt: '2026-12-01T10:15:00Z',
  part: { index: 1, total: 1 },
  results: [
    { id: 'checkout.feature:Pay with saved card', name: 'Pay with saved card', suite: 'checkout.feature', status: 'failed', durationMs: 4120, issueKeys: ['PROJ-12'], failedStep: 'When I confirm the payment', error: 'expected: <Order Placed> but was: <Payment Failed>' },
    { id: 'checkout.feature:Apply coupon', name: 'Apply coupon', status: 'passed', issueKeys: ['PROJ-15'] },
  ],
  ...over,
});

const req = (body: unknown, token: string | null = TOKEN, extraHeaders: Record<string, string[]> = {}) => ({
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'Content-Type': ['application/json'], ...(token ? { 'X-ShipProof-Token': [token] } : {}), ...extraHeaders },
});

describe('US-1 ingest contract (§6.2)', () => {
  it('accepts a valid upload with 202 + runId, stores the raw part and enqueues triage', async () => {
    const { deps, raw, runs, jobs } = fakeDeps();
    const t0 = Date.now();
    const res = await handleIngest(req(payload()), deps);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res).toMatchObject({ statusCode: 202, outputKey: 'accepted' });
    expect(res.detail).toMatchObject({ runId: runIdFor('PROJ', 'jenkins', '1287'), accepted: 2 });
    expect(raw.size).toBe(1);
    expect(runs.get(res.detail.runId as string)).toMatchObject({ status: 'queued', partsTotal: 1, startedAt: Date.parse('2026-12-01T10:15:00Z'), environment: 'staging' });
    expect(jobs).toEqual([{ runId: res.detail.runId, projectKey: 'PROJ', part: 1, total: 1 }]);
  });

  it('re-uploading the same build is idempotent (same runId, part replaced)', async () => {
    const { deps, raw, runs } = fakeDeps();
    const a = await handleIngest(req(payload()), deps);
    const b = await handleIngest(req(payload()), deps);
    expect(a.detail.runId).toBe(b.detail.runId);
    expect(raw.size).toBe(1);
    expect(runs.size).toBe(1);
    const other = await handleIngest(req(payload({ buildId: '1288' })), deps);
    expect(other.detail.runId).not.toBe(a.detail.runId);
  });

  it.each([
    ['missing token', null, 401],
    ['wrong token', 'sp_wrong', 401],
  ])('%s → %s and stores nothing', async (_n, token, code) => {
    const { deps, raw, jobs } = fakeDeps();
    expect((await handleIngest(req(payload(), token), deps)).statusCode).toBe(code);
    expect(raw.size + jobs.length).toBe(0);
  });

  it('401 when no token has been generated yet', async () => {
    const { deps } = fakeDeps(null);
    expect((await handleIngest(req(payload()), deps)).statusCode).toBe(401);
  });

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['bad project key', payload({ projectKey: 'proj' }), /projectKey/],
    ['bad status', payload({ results: [{ id: 'a', name: 'a', status: 'broken' }] }), /results\.0\.status/],
    ['bad issue key', payload({ results: [{ id: 'a', name: 'a', status: 'passed', issueKeys: ['12'] }] }), /issueKeys/],
    ['part index > total', payload({ part: { index: 3, total: 2 } }), /part/],
    ['wrong schema version', payload({ schemaVersion: 2 }), /schemaVersion/],
    ['bad date', payload({ startedAt: 'yesterday' }), /startedAt/],
  ])('invalid schema (%s) → 400 with errors and stores nothing', async (_n, body, msg) => {
    const { deps, raw } = fakeDeps();
    const res = await handleIngest(req(body), deps);
    expect(res.statusCode).toBe(400);
    expect((res.detail.errors as string[]).join(' ')).toMatch(msg);
    expect(raw.size).toBe(0);
  });

  it('payload over 200 KB → 413 before anything else', async () => {
    const { deps, raw } = fakeDeps();
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    expect((await handleIngest(req(big, null), deps)).statusCode).toBe(413);
    expect(raw.size).toBe(0);
  });

  it('rejects non-POST methods', async () => {
    const { deps } = fakeDeps();
    expect((await handleIngest({ ...req(payload()), method: 'GET' }, deps)).statusCode).toBe(405);
  });

  it('accepts chunked parts under one runId', async () => {
    const { deps, raw, jobs } = fakeDeps();
    const r1 = await handleIngest(req(payload({ part: { index: 1, total: 2 } })), deps);
    const r2 = await handleIngest(req(payload({ part: { index: 2, total: 2 } })), deps);
    expect(r1.detail.runId).toBe(r2.detail.runId);
    expect(raw.size).toBe(2);
    expect(jobs.map((j) => j.part)).toEqual([1, 2]);
  });

  it('truncates very long error messages instead of rejecting the run', async () => {
    const { deps, raw } = fakeDeps();
    const p = payload({ results: [{ id: 'a', name: 'a', status: 'failed', error: 'e'.repeat(5000) }] });
    expect((await handleIngest(req(p), deps)).statusCode).toBe(202);
    const stored = [...raw.values()][0] as any;
    expect(stored.results[0].error).toHaveLength(2000);
  });

  it('defaults part to 1/1', async () => {
    const { deps, jobs } = fakeDeps();
    const p = payload();
    delete (p as any).part;
    expect((await handleIngest(req(p), deps)).statusCode).toBe(202);
    expect(jobs[0]).toMatchObject({ part: 1, total: 1 });
  });
});

describe('token handling', () => {
  it('hashes, verifies in constant time and rejects mismatches', () => {
    const t = generateToken();
    expect(t).toMatch(/^sp_[A-Za-z0-9_-]{32}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyToken(t, hashToken(t))).toBe(true);
    expect(verifyToken(t, hashToken('other'))).toBe(false);
    expect(verifyToken(undefined, hashToken(t))).toBe(false);
    expect(verifyToken(t, 'abcd')).toBe(false);
  });
  it('reads headers case-insensitively', () => {
    expect(header({ 'x-shipproof-token': ['a'] }, 'X-ShipProof-Token')).toBe('a');
    expect(header({ 'X-SHIPPROOF-TOKEN': 'b' }, 'x-shipproof-token')).toBe('b');
    expect(header({}, 'x')).toBeUndefined();
  });
});
