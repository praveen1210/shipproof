import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { OUTPUTS } from '../src/ingest/core';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const manifest = parse(readFileSync(root('manifest.yml'), 'utf8'));
const m = manifest.modules;
const indexSrc = readFileSync(root('src/index.ts'), 'utf8');

describe('manifest consistency (§9)', () => {
  const actionKeys: string[] = m.action.map((a: { key: string }) => a.key);
  const functionKeys: string[] = m.function.map((f: { key: string }) => f.key);

  it('every agent action and MCP tool exists as an action module', () => {
    for (const k of m['rovo:agent'][0].actions) expect(actionKeys).toContain(k);
    for (const k of m['rovo:mcp'][0].tools) expect(actionKeys).toContain(k);
  });

  it('MCP exposes only read-only (GET) actions', () => {
    const verbs = Object.fromEntries(m.action.map((a: { key: string; actionVerb: string }) => [a.key, a.actionVerb]));
    for (const k of m['rovo:mcp'][0].tools) expect(verbs[k]).toBe('GET');
    expect(m['rovo:mcp']).toHaveLength(1);
    expect(m['rovo:mcp'][0].name.length).toBeLessThanOrEqual(30);
    expect(m['rovo:agent'][0].name.length).toBeLessThanOrEqual(30);
  });

  it('every function handler is exported from src/index.ts and keys are <= 23 chars', () => {
    for (const f of m.function) {
      expect(f.key.length).toBeLessThanOrEqual(23);
      const [file, name] = f.handler.split('.');
      expect(file).toBe('index');
      expect(indexSrc).toMatch(new RegExp(String.raw`\b${name}\b`));
    }
  });

  it('every module references an existing function and resource', () => {
    const resources = Object.fromEntries(manifest.resources.map((r: { key: string; path: string }) => [r.key, r.path]));
    for (const p of Object.values(resources)) expect(existsSync(root(p as string))).toBe(true);
    const fnRefs = [
      ...m.webtrigger.map((x: any) => x.function),
      ...m.consumer.map((x: any) => x.function),
      ...m.scheduledTrigger.map((x: any) => x.function),
      ...m.action.map((x: any) => x.function),
      ...['jira:issuePanel', 'jira:projectPage', 'jira:adminPage'].flatMap((k) => m[k].map((x: any) => x.resolver.function)),
    ];
    for (const f of fnRefs) expect(functionKeys).toContain(f);
    for (const k of ['jira:issuePanel', 'jira:projectPage', 'jira:adminPage']) for (const x of m[k]) expect(resources[x.resource]).toBeDefined();
    const [res, file] = m['rovo:agent'][0].prompt.replace('resource:', '').split(';');
    expect(existsSync(root(`${resources[res]}/${file}`))).toBe(true);
  });

  it('the consumer listens on the queue the web trigger pushes to', () => {
    const src = readFileSync(root('src/ingest/webtrigger.ts'), 'utf8');
    expect(src).toContain(`'${m.consumer[0].queue}'`);
  });

  it('the ingest web trigger is static (Runs on Atlassian) and its outputs match the code', () => {
    const wt = m.webtrigger[0];
    expect(wt.response.type).toBe('static');
    const declared = Object.fromEntries(wt.response.outputs.map((o: { key: string; statusCode: number }) => [o.key, o.statusCode]));
    expect(declared).toEqual({ ...OUTPUTS });
    for (const o of wt.response.outputs) expect(() => JSON.parse(o.body)).not.toThrow();
    for (const t of m.webtrigger) expect(t.response?.type).toBe('static');
  });

  it('resolver checks the admin module key used in the manifest', () => {
    expect(readFileSync(root('src/resolvers/index.ts'), 'utf8')).toContain(`'${m['jira:adminPage'][0].key}'`);
  });

  it('every action input has title, type, required and description', () => {
    for (const a of m.action) {
      for (const [, input] of Object.entries<any>(a.inputs ?? {})) {
        expect(['string', 'integer', 'number', 'boolean']).toContain(input.type);
        expect(typeof input.required).toBe('boolean');
        expect(input.title && input.description).toBeTruthy();
      }
    }
  });

  it('the agent prompt requires confirmation before writes', () => {
    const prompt = readFileSync(root('prompts/agent.md'), 'utf8');
    expect(prompt).toMatch(/Never call them until the user has explicitly confirmed/);
  });
});
