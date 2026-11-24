#!/usr/bin/env node
/**
 * ShipProof CI uploader (F2).
 * Parses Cucumber JSON, JUnit XML or Playwright JSON in CI, maps results to Jira issue keys and
 * POSTs a compact payload to the ShipProof web trigger, chunked into parts of at most 200 KB.
 *
 *   SHIPPROOF_URL=... SHIPPROOF_TOKEN=... node shipproof-upload.mjs \
 *     --file target/cucumber.json --project PROJ --build-id "$BUILD_NUMBER" --source jenkins
 *
 * Node 20+, one dependency: fast-xml-parser (JUnit only).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_PART_BYTES = 190 * 1024; // headroom under the 200 KB server limit
const ISSUE_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/g;

// ─────────────────────────── helpers ───────────────────────────

const ANSI = /\u001b\[[0-9;]*m/g;

/** First 1000 chars of the message + the top 5 stack frames (§6.2). */
export function compactError(message, stack) {
  const msg = String(message ?? '').replace(ANSI, '').trim();
  const frames = String(stack ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s/.test(l))
    .slice(0, 5);
  const head = msg.slice(0, 1000);
  return frames.length && !head.includes(frames[0]) ? `${head}\n${frames.join('\n')}` : head;
}

export function extractIssueKeys(texts, projectKey) {
  const keys = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(ISSUE_KEY)) {
      const key = m[1];
      if (!projectKey || key.startsWith(`${projectKey}-`)) keys.add(key);
    }
  }
  return [...keys];
}

function uniqueId(id, seen) {
  let out = id.slice(0, 480);
  let n = 2;
  while (seen.has(out)) out = `${id.slice(0, 470)}#${n++}`;
  seen.add(out);
  return out;
}

// ─────────────────────────── Cucumber JSON ───────────────────────────

export function parseCucumber(json, projectKey) {
  const features = typeof json === 'string' ? JSON.parse(json) : json;
  const results = [];
  const seen = new Set();
  for (const feature of features ?? []) {
    const suite = basename(feature.uri ?? feature.name ?? 'feature');
    const featureTags = (feature.tags ?? []).map((t) => t.name);
    let background = [];
    for (const el of feature.elements ?? []) {
      if (el.type === 'background' || el.keyword?.trim() === 'Background') {
        background = el.steps ?? [];
        continue;
      }
      const steps = [...background, ...(el.steps ?? [])];
      const tags = [...featureTags, ...(el.tags ?? []).map((t) => t.name)];
      let status = 'passed';
      let failedStep;
      let error;
      let durationNs = 0;
      for (const s of steps) {
        const r = s.result ?? {};
        durationNs += r.duration ?? 0;
        if (status !== 'passed') continue;
        const stepText = `${(s.keyword ?? '').trim()} ${s.name ?? ''}`.trim();
        if (r.status === 'failed') {
          status = 'failed';
          failedStep = stepText;
          error = compactError(r.error_message, r.error_message);
        } else if (r.status === 'undefined' || r.status === 'pending' || r.status === 'ambiguous') {
          status = 'failed';
          failedStep = stepText;
          error =
            r.status === 'ambiguous'
              ? `Ambiguous step definitions: ${stepText}`
              : r.status === 'pending'
                ? `Pending step: ${stepText}`
                : `Undefined step: ${stepText}`;
        } else if (r.status === 'skipped' && steps.every((x) => x.result?.status === 'skipped')) {
          status = 'skipped';
        }
      }
      const name = el.name || el.id || 'scenario';
      results.push({
        id: uniqueId(`${suite}:${name}`, seen),
        name,
        suite,
        status,
        durationMs: Math.round(durationNs / 1e6),
        issueKeys: extractIssueKeys([...tags, name], projectKey),
        ...(failedStep ? { failedStep: failedStep.slice(0, 500) } : {}),
        ...(error ? { error } : {}),
      });
    }
  }
  return results;
}

// ─────────────────────────── JUnit XML ───────────────────────────

export async function parseJUnit(xml, projectKey) {
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    isArray: (name) => ['testsuite', 'testcase', 'property', 'failure', 'error'].includes(name),
  });
  const doc = parser.parse(xml);
  const suites = [];
  const collect = (node) => {
    for (const s of node?.testsuite ?? []) {
      suites.push(s);
      collect(s);
    }
  };
  collect(doc.testsuites ?? doc);

  const results = [];
  const seen = new Set();
  for (const s of suites) {
    const suiteProps = (s.properties?.property ?? []).filter((p) => /^(issue|issues|jira|issueKey)$/i.test(p.name));
    for (const tc of s.testcase ?? []) {
      const props = (tc.properties?.property ?? []).filter((p) => /^(issue|issues|jira|issueKey)$/i.test(p.name));
      const failure = tc.failure?.[0] ?? tc.error?.[0];
      const skipped = tc.skipped !== undefined;
      const name = String(tc.name ?? 'test');
      const suite = String(tc.classname ?? s.name ?? 'suite');
      const text = typeof failure === 'string' ? failure : failure?.['#text'];
      const message = typeof failure === 'object' ? failure.message : undefined;
      const fullMessage = message && text && !text.startsWith(message) ? `${message}\n${text}` : text ?? message;
      results.push({
        id: uniqueId(`${suite}:${name}`, seen),
        name,
        suite,
        status: failure ? 'failed' : skipped ? 'skipped' : 'passed',
        durationMs: Math.round(Number(tc.time ?? 0) * 1000),
        issueKeys: extractIssueKeys(
          [...[...suiteProps, ...props].map((p) => p.value ?? p['#text']), name],
          projectKey,
        ),
        ...(failure ? { error: compactError(fullMessage?.split('\n\tat ')[0] ?? fullMessage, fullMessage) } : {}),
      });
    }
  }
  return results;
}

// ─────────────────────────── Playwright JSON ───────────────────────────

export function parsePlaywright(json, projectKey) {
  const report = typeof json === 'string' ? JSON.parse(json) : json;
  const results = [];
  const seen = new Set();
  const walk = (suite, titles) => {
    const path = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = (test.results ?? []).at(-1);
        if (!last) continue;
        const status =
          last.status === 'passed' ? 'passed' : last.status === 'skipped' ? 'skipped' : 'failed';
        const err = last.error ?? last.errors?.[0];
        const file = spec.file ?? suite.file ?? path[0] ?? 'spec';
        const name = [...path.slice(1), spec.title].join(' › ') || spec.title;
        const annotations = [...(test.annotations ?? []), ...(spec.annotations ?? [])]
          .filter((a) => /issue|jira/i.test(a.type))
          .map((a) => a.description);
        results.push({
          id: uniqueId(`${basename(file)}:${name}`, seen),
          name: name.slice(0, 500),
          suite: basename(file),
          status,
          durationMs: Math.round(last.duration ?? 0),
          issueKeys: extractIssueKeys([...(spec.tags ?? []), ...annotations, name], projectKey),
          ...(status === 'failed'
            ? {
                error: compactError(
                  err?.message ?? (last.status === 'timedOut' ? `Test timeout of ${test.timeout ?? '?'}ms exceeded.` : `Test ${last.status}`),
                  err?.stack,
                ),
              }
            : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const s of report.suites ?? []) walk(s, []);
  return results;
}

// ─────────────────────────── payload + chunking ───────────────────────────

export function detectFormat(file, content) {
  if (/\.xml$/i.test(file) || content.trimStart().startsWith('<')) return 'junit';
  const json = JSON.parse(content);
  if (Array.isArray(json)) return 'cucumber';
  if (json && Array.isArray(json.suites)) return 'playwright';
  throw new Error(`Cannot detect report format of ${file}; pass --format cucumber|junit|playwright`);
}

export function buildParts(meta, results, maxBytes = MAX_PART_BYTES) {
  const base = { schemaVersion: 1, ...meta };
  const baseSize = Buffer.byteLength(JSON.stringify({ ...base, part: { index: 99, total: 99 }, results: [] }));
  const chunks = [];
  let current = [];
  let size = baseSize;
  for (const r of results) {
    const s = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (current.length && size + s > maxBytes) {
      chunks.push(current);
      current = [];
      size = baseSize;
    }
    current.push(r);
    size += s;
  }
  chunks.push(current);
  return chunks.map((c, i) => ({ ...base, part: { index: i + 1, total: chunks.length }, results: c }));
}

async function post(url, token, body, attempt = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ShipProof-Token': token },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return post(url, token, body, attempt + 1);
  }
  const text = await res.text();
  if (res.status !== 202) {
    const hint = res.status === 400 ? ' Run again with --dry-run to inspect the payload; the exact validation errors are in the ShipProof app logs (forge logs).' : '';
    throw new Error(`ShipProof rejected part ${body.part.index}/${body.part.total}: ${res.status} ${text}${hint}`);
  }
}

/**
 * Same formula as the server (src/ingest/core.ts runIdFor). The web trigger's responses are static
 * (Runs on Atlassian), so the run id is computed here instead of being returned.
 */
export function runIdFor(projectKey, source, buildId) {
  return `r${createHash('sha1').update(`${projectKey}|${source}|${buildId}`).digest('hex').slice(0, 15)}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const HELP = `Usage: node shipproof-upload.mjs --file <report> --project <KEY> --build-id <id> [options]
  --format     cucumber | junit | playwright (default: auto-detect)
  --source     jenkins | azure-devops | github-actions | other (default: auto-detect from env)
  --build-url  link to the CI build      --pipeline  pipeline name
  --branch     git branch                --commit    git sha
  --environment target env (e.g. staging) --started-at ISO time (default: now)
  --url        web trigger URL (or SHIPPROOF_URL)   token: SHIPPROOF_TOKEN env var
  --dry-run    print the payload summary instead of uploading`;

function detectSource(env) {
  if (env.JENKINS_URL) return 'jenkins';
  if (env.TF_BUILD) return 'azure-devops';
  if (env.GITHUB_ACTIONS) return 'github-actions';
  return 'other';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const a = parseArgs(argv);
  if (a.help || !a.file || !a.project) {
    console.log(HELP);
    return a.help ? 0 : 2;
  }
  const content = readFileSync(a.file, 'utf8');
  const format = a.format ?? detectFormat(a.file, content);
  const project = String(a.project).toUpperCase();
  const results =
    format === 'junit'
      ? await parseJUnit(content, project)
      : format === 'playwright'
        ? parsePlaywright(content, project)
        : parseCucumber(content, project);

  const meta = {
    source: a.source ?? detectSource(env),
    projectKey: project,
    buildId: String(a['build-id'] ?? env.BUILD_NUMBER ?? env.BUILD_BUILDID ?? env.GITHUB_RUN_ID ?? Date.now()),
    ...(a['build-url'] || env.BUILD_URL ? { buildUrl: a['build-url'] ?? env.BUILD_URL } : {}),
    ...(a.pipeline ? { pipeline: a.pipeline } : {}),
    ...(a.branch ? { branch: a.branch } : {}),
    ...(a.commit ? { commit: String(a.commit).slice(0, 40) } : {}),
    ...(a.environment ? { environment: a.environment } : {}),
    startedAt: a['started-at'] ?? new Date().toISOString(),
  };
  const parts = buildParts(meta, results);
  const mapped = results.filter((r) => r.issueKeys.length).length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`ShipProof: ${results.length} results (${failed} failed, ${results.length - mapped} unmapped) in ${parts.length} part(s) from ${format}`);

  if (a['dry-run']) {
    console.log(JSON.stringify({ ...parts[0], results: parts[0].results.slice(0, 3) }, null, 2));
    return 0;
  }
  const url = a.url ?? env.SHIPPROOF_URL;
  const token = env.SHIPPROOF_TOKEN;
  if (!url || !token) {
    console.error('Set SHIPPROOF_URL (or --url) and SHIPPROOF_TOKEN.');
    return 2;
  }
  for (const p of parts) await post(url, token, p);
  console.log(`ShipProof: accepted as run ${runIdFor(meta.projectKey, meta.source, meta.buildId)}. Triage runs asynchronously (usually < 30 s).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      // Never fail the build because reporting failed.
      process.exit(env_bool(process.env.SHIPPROOF_STRICT) ? 1 : 0);
    },
  );
}

function env_bool(v) {
  return v === '1' || v === 'true';
}
