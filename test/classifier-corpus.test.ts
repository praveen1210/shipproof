import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classify } from '../src/services/triage/classify';
import type { Category } from '../src/services/types';

interface Labelled {
  framework: string;
  category: Category;
  rule?: string;
  error: string;
}

const corpus: Labelled[] = parse(readFileSync(fileURLToPath(new URL('./fixtures/failures.yaml', import.meta.url)), 'utf8'));
export const ACCURACY_GATE = 0.9;

describe('classifier corpus (§9)', () => {
  it('has at least 120 labelled real-world messages', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(120);
  });

  it(`classifies at least ${ACCURACY_GATE * 100}% of the corpus correctly`, () => {
    const misses: string[] = [];
    let correct = 0;
    for (const item of corpus) {
      const got = classify(item.error);
      const ok = got.category === item.category && (!item.rule || got.ruleId === item.rule);
      if (ok) correct++;
      else misses.push(`[${item.framework}] expected ${item.category}/${item.rule ?? '*'} got ${got.category}/${got.ruleId}: ${item.error.split('\n')[0].slice(0, 110)}`);
    }
    const accuracy = correct / corpus.length;
    // Printed so the number can be quoted in the README and video.
    console.log(`Classifier accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${corpus.length})`);
    if (misses.length) console.log(`Misses:\n  ${misses.join('\n  ')}`);
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_GATE);
  });
});

describe('classifier hold-out set (never used to tune rules)', () => {
  const holdout: Labelled[] = parse(
    readFileSync(fileURLToPath(new URL('./fixtures/failures-holdout.yaml', import.meta.url)), 'utf8'),
  );

  it('reports honest accuracy on unseen messages', () => {
    const misses: string[] = [];
    let correct = 0;
    for (const item of holdout) {
      const got = classify(item.error);
      if (got.category === item.category) correct++;
      else misses.push(`[${item.framework}] expected ${item.category} got ${got.category}/${got.ruleId}: ${item.error.split('\n')[0].slice(0, 100)}`);
    }
    const accuracy = correct / holdout.length;
    console.log(`Hold-out accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${holdout.length})`);
    if (misses.length) console.log(`Hold-out misses:\n  ${misses.join('\n  ')}`);
    // Looser gate: wrong categories matter more than unclassified ones, which a human or the agent picks up.
    const wrong = holdout.filter((i) => {
      const c = classify(i.error).category;
      return c !== i.category && c !== 'unclassified';
    }).length;
    expect(wrong / holdout.length).toBeLessThanOrEqual(0.1);
  });
});
