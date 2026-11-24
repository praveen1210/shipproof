// Writes demo/runs/night-*.json: the same 5 nightly runs (+ rerun) the "Load demo workspace" button
// ingests, mapped to PROJ-1..PROJ-10, for testing the web trigger with curl or the uploader.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildDemoRuns, DEMO_ISSUES, type Slot } from '../src/services/demoData';

const project = (process.argv[2] ?? 'PROJ').toUpperCase();
const keyMap = Object.fromEntries(DEMO_ISSUES.map((d, i) => [d.slot, `${project}-${i + 1}`])) as Record<Slot, string>;
mkdirSync(new URL('./runs/', import.meta.url), { recursive: true });
buildDemoRuns(project, keyMap, Date.now(), [0, 1, 2, 3, 4, 5]).forEach((run, i) => {
  const name = i === 5 ? 'night-6-rerun.json' : `night-${i + 1}.json`;
  writeFileSync(new URL(`./runs/${name}`, import.meta.url), JSON.stringify(run, null, 2));
  console.log(`${name}: ${run.results.length} results, ${run.results.filter((r) => r.status === 'failed').length} failed`);
});
console.log('Issue mapping:', DEMO_ISSUES.map((d) => `${keyMap[d.slot]}=${d.summary}`).join('; '));
