import { z } from 'zod';

export const MAX_BODY_BYTES = 200 * 1024;
export const MAX_ERROR_CHARS = 2000;

const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/, 'must be a Jira issue key like PROJ-12');

export const resultSchema = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  suite: z.string().max(500).optional(),
  status: z.enum(['passed', 'failed', 'skipped']),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  issueKeys: z.array(issueKey).max(20).optional(),
  failedStep: z.string().max(500).optional(),
  // Truncate instead of rejecting: CI output is messy and losing a whole run over one long trace helps nobody.
  error: z
    .string()
    .optional()
    .transform((e) => (e === undefined ? undefined : e.slice(0, MAX_ERROR_CHARS))),
});

export const ingestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(['jenkins', 'azure-devops', 'github-actions', 'other']),
  projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,9}$/, 'must be a Jira project key like PROJ'),
  buildId: z.string().min(1).max(100),
  buildUrl: z.string().url().max(1000).optional(),
  pipeline: z.string().max(200).optional(),
  branch: z.string().max(200).optional(),
  commit: z.string().max(100).optional(),
  environment: z.string().max(100).optional(),
  startedAt: z.string().datetime({ offset: true }),
  part: z
    .object({ index: z.number().int().min(1), total: z.number().int().min(1).max(50) })
    .refine((p) => p.index <= p.total, 'part.index must be <= part.total')
    .default({ index: 1, total: 1 }),
  results: z.array(resultSchema).max(5000),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

export function formatZodErrors(err: z.ZodError): string[] {
  return err.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
