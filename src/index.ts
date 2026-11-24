// Forge function handlers. Every `handler: index.X` in manifest.yml must be exported here
// (enforced by test/manifest.test.ts).
export { ingest } from './ingest/webtrigger';
export { triage } from './triage/consumer';
export { purge } from './triage/purge';
export { handler as resolver } from './resolvers';
export {
  getLatestTriage,
  getIssueEvidence,
  getReleaseReadiness,
  listFailureClusters,
  getIssueContext,
  createBugFromCluster,
  addIssueComment,
} from './actions';
