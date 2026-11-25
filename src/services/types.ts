/** Shared domain types for ShipProof. Pure data only: no Forge imports here. */

export type Category = 'product' | 'maintenance' | 'environment' | 'unclassified';
export type ResultStatus = 'passed' | 'failed' | 'skipped';
export type Source = 'jenkins' | 'azure-devops' | 'github-actions' | 'other';

export const CATEGORY_LABEL: Record<Category | 'flaky', string> = {
  product: 'Product defect',
  maintenance: 'Test maintenance',
  environment: 'Environment',
  unclassified: 'Unclassified',
  flaky: 'Flaky',
};

export const CATEGORY_EMOJI: Record<Category | 'flaky', string> = {
  product: '🐞',
  maintenance: '🔧',
  environment: '🌩',
  unclassified: '❓',
  flaky: '🎲',
};

/** "🐞 Product defect": emoji + text, so category is never conveyed by colour alone. */
export function categoryText(category: Category, flaky = false): string {
  const key = flaky ? 'flaky' : category;
  return `${CATEGORY_EMOJI[key]} ${CATEGORY_LABEL[key]}`;
}

/** One test result as it arrives in the ingest payload (§6.2). */
export interface IngestResult {
  id: string;
  name: string;
  suite?: string;
  status: ResultStatus;
  durationMs?: number;
  issueKeys?: string[];
  failedStep?: string;
  error?: string;
}

export interface RunMeta {
  runId: string;
  projectKey: string;
  source: Source;
  buildId: string;
  buildUrl?: string;
  pipeline?: string;
  branch?: string;
  commit?: string;
  environment?: string;
  /** epoch ms */
  startedAt: number;
}

export interface HistoryEntry {
  runId: string;
  status: ResultStatus;
  /** Effective category for failures (after user override). */
  category?: Category;
  /** Base category when the failure is shown as flaky. */
  flaky?: boolean;
  signature?: string;
  durationMs?: number;
  buildUrl?: string;
  /** epoch ms of the run */
  at: number;
}

export interface ScenarioRecord {
  name: string;
  suite?: string;
  history: HistoryEntry[];
}

/** KVS `res:<issueKey>`: scenarioId → record. */
export type IssueResults = Record<string, ScenarioRecord>;

export interface Cluster {
  projectKey: string;
  signature: string;
  category: Category;
  ruleId: string;
  explanation: string;
  /** User reclassification: wins over the rule category for this and future failures. */
  override?: Category;
  flaky: boolean;
  skeleton: string;
  exceptionType: string;
  failedStep: string;
  sampleError: string;
  /** Occurrences per run, so re-ingesting a run replaces its count instead of adding to it. */
  runCounts: Record<string, number>;
  count: number;
  firstSeen: number;
  lastSeen: number;
  lastRunId: string;
  issueKeys: string[];
  scenarioIds: string[];
  buildUrls: string[];
  environments: string[];
  bugKey?: string;
  possibleDuplicates?: string[];
}

export function effectiveCategory(c: Pick<Cluster, 'category' | 'override'>): Category {
  return c.override ?? c.category;
}

export interface Rule {
  id: string;
  category: Category;
  pattern: RegExp;
  explanation: string;
}

export interface CustomRuleConfig {
  id: string;
  category: Category;
  /** Regex source, case-insensitive. */
  pattern: string;
  explanation?: string;
}

export interface ReadinessWeights {
  highBug: number;
  highBugCap: number;
  mediumBug: number;
  mediumBugCap: number;
  productFailure: number;
  productFailureCap: number;
  untrackedFailure: number;
  untrackedFailureCap: number;
  noEvidence: number;
  noEvidenceCap: number;
  openPr: number;
  openPrCap: number;
  reopened: number;
  reopenedCap: number;
  notDone: number;
  notDoneCap: number;
}

export const DEFAULT_WEIGHTS: ReadinessWeights = {
  highBug: 15,
  highBugCap: 45,
  mediumBug: 5,
  mediumBugCap: 20,
  productFailure: 12,
  productFailureCap: 48,
  untrackedFailure: 5,
  untrackedFailureCap: 15,
  noEvidence: 3,
  noEvidenceCap: 15,
  openPr: 2,
  openPrCap: 10,
  reopened: 2,
  reopenedCap: 10,
  notDone: 1,
  notDoneCap: 10,
};

export interface Settings {
  tokenHash?: string;
  tokenCreatedAt?: number;
  weights: ReadinessWeights;
  retentionDays: number;
  staleHours: number;
  excludedTypes: string[];
  customRules: CustomRuleConfig[];
  /** Teamwork Graph enrichment (F12). Off until the Phase 0 spike confirms API access. */
  twgEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: DEFAULT_WEIGHTS,
  retentionDays: 30,
  staleHours: 72,
  excludedTypes: ['Bug', 'Epic', 'Sub-task', 'Subtask', 'Spike'],
  customRules: [],
  twgEnabled: false,
};

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...withoutPersonalData(s ?? {}),
    weights: { ...DEFAULT_WEIGHTS, ...(s?.weights ?? {}) },
  };
}

/**
 * ShipProof declares that it stores no personal data, so no Atlassian account IDs are kept in
 * settings. Drops the removed `maintenanceAssignee` field if an older version stored one; the next
 * settings save then removes it from storage too.
 */
function withoutPersonalData(s: Partial<Settings>): Partial<Settings> {
  const { maintenanceAssignee: _removed, ...rest } = s as Partial<Settings> & { maintenanceAssignee?: string };
  return rest;
}
