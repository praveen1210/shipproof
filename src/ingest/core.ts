import { createHash } from 'node:crypto';
import type { RunMeta } from '../services/types';
import { formatZodErrors, ingestSchema, MAX_BODY_BYTES, type IngestPayload } from './schema';
import { verifyToken } from './token';

export interface IngestRequest {
  method?: string;
  body: string | undefined;
  headers: Record<string, string[] | string | undefined>;
}

/**
 * Static web trigger outputs (manifest `response.type: static`). A fixed set of responses keeps
 * the app eligible for Runs on Atlassian: nothing computed from stored data leaves through the
 * HTTP reply. Keys and status codes must match manifest.yml (enforced by test/manifest.test.ts).
 */
export const OUTPUTS = {
  accepted: 202,
  'invalid-json': 400,
  'invalid-schema': 400,
  unauthorized: 401,
  'method-not-allowed': 405,
  'too-large': 413,
  'server-error': 500,
} as const;

export type OutputKey = keyof typeof OUTPUTS;

export interface IngestResponse {
  outputKey: OutputKey;
  statusCode: number;
  /** Diagnostic detail for logs and tests; never sent to the client. */
  detail: Record<string, unknown>;
}

const respond = (outputKey: OutputKey, detail: Record<string, unknown> = {}): IngestResponse => ({
  outputKey,
  statusCode: OUTPUTS[outputKey],
  detail,
});

export interface StoredRun extends RunMeta {
  partsTotal: number;
  status: 'queued' | 'triaged' | 'failed';
  receivedAt: number;
}

export interface TriageJob {
  runId: string;
  projectKey: string;
  part: number;
  total: number;
}

export interface IngestDeps {
  getTokenHash(): Promise<string | undefined>;
  saveRawPart(runId: string, part: number, payload: IngestPayload): Promise<void>;
  upsertRun(run: StoredRun): Promise<void>;
  enqueue(job: TriageJob): Promise<void>;
  now(): number;
}

export const TOKEN_HEADER = 'x-shipproof-token';

/** Idempotency key (§8): one run per (projectKey, source, buildId). Re-uploads replace it. */
export function runIdFor(projectKey: string, source: string, buildId: string): string {
  return `r${createHash('sha1').update(`${projectKey}|${source}|${buildId}`).digest('hex').slice(0, 15)}`;
}

export function header(headers: IngestRequest['headers'], name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Web trigger core (§6.2). Only validates, stores the raw part and enqueues: all heavy work runs
 * in the async consumer, because web triggers have a hard 55 s limit. Rejected requests store nothing.
 */
export async function handleIngest(req: IngestRequest, deps: IngestDeps): Promise<IngestResponse> {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    return respond('method-not-allowed');
  }
  const body = req.body ?? '';
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return respond('too-large', { bytes: Buffer.byteLength(body, 'utf8'), limit: MAX_BODY_BYTES });
  }
  if (!verifyToken(header(req.headers, TOKEN_HEADER), await deps.getTokenHash())) {
    return respond('unauthorized');
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return respond('invalid-json', { errors: ['Body is not valid JSON'] });
  }
  const parsed = ingestSchema.safeParse(json);
  if (!parsed.success) return respond('invalid-schema', { errors: formatZodErrors(parsed.error) });

  const p = parsed.data;
  const runId = runIdFor(p.projectKey, p.source, p.buildId);
  await deps.saveRawPart(runId, p.part.index, p);
  await deps.upsertRun({
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
    partsTotal: p.part.total,
    status: 'queued',
    receivedAt: deps.now(),
  });
  await deps.enqueue({ runId, projectKey: p.projectKey, part: p.part.index, total: p.part.total });
  return respond('accepted', { runId, part: p.part, accepted: p.results.length });
}
