import type { Cluster } from './types';
import { CATEGORY_LABEL, effectiveCategory } from './types';
import { signatureLabel } from './triage/signature';
import { errorHeadline, GENERIC_EXCEPTIONS, skeletonTokens } from './triage/normalise';

/** Escapes a value for use inside a JQL double-quoted string. */
export function jqlString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Dedupe 1 (exact, §6.4): an open issue already carries the signature label. */
export function exactDedupeJql(projectKey: string, sig: string): string {
  return `project = ${jqlString(projectKey)} AND labels = ${jqlString(signatureLabel(sig))} AND statusCategory != Done ORDER BY created DESC`;
}

// Words that appear in almost every failure and say nothing about which one it is.
const COMMON = new Set(
  'error exception expected but was found failed failure timeout exceeded element unable locate assertion assertionerror java lang org openqa selenium junit message after waiting locator click true false null none value test step status code'.split(
    ' ',
  ),
);

/** The 3 rarest skeleton tokens: here, the longest ones that are not common failure vocabulary. */
export function rarestTokens(skeleton: string, n = 3): string[] {
  return skeletonTokens(skeleton)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter((t) => t.length >= 4 && !COMMON.has(t.toLowerCase()) && !/^\d+$/.test(t))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, n);
}

/** Dedupe 2 (suggest, §6.4): text search on exception type + rarest tokens, Bugs updated in 90 days. */
export function suggestDedupeJql(projectKey: string, cluster: Pick<Cluster, 'exceptionType' | 'skeleton'>): string | undefined {
  const terms = [cluster.exceptionType, ...rarestTokens(cluster.skeleton)]
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter((t) => t.length >= 4 && t !== 'Error');
  if (terms.length === 0) return undefined;
  const text = terms.map((t) => `text ~ ${jqlString(t)}`).join(' AND ');
  return `project = ${jqlString(projectKey)} AND issuetype = Bug AND updated >= -90d AND ${text} ORDER BY updated DESC`;
}

export function bugSummary(cluster: Pick<Cluster, 'failedStep' | 'exceptionType' | 'scenarioIds'> & { sampleError?: string }): string {
  const step = cluster.failedStep || cluster.scenarioIds[0]?.split(':').slice(1).join(':') || 'Test failure';
  // "Error" / "AssertionError" say nothing: use the message itself instead.
  const detail = GENERIC_EXCEPTIONS.has(cluster.exceptionType) ? errorHeadline(cluster.sampleError, 120) || cluster.exceptionType : cluster.exceptionType;
  return `[ShipProof] ${step} – ${detail}`.slice(0, 254);
}

export function maintenanceTaskSummary(cluster: Pick<Cluster, 'failedStep' | 'ruleId' | 'scenarioIds'>): string {
  return `[ShipProof] Test maintenance: ${cluster.ruleId} in ${cluster.failedStep || cluster.scenarioIds[0] || 'tests'}`.slice(0, 254);
}

function fmt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Evidence-prefilled description (§6.4), as Markdown; converted to ADF by adfDoc(). */
export function bugDescriptionMarkdown(cluster: Cluster): string {
  const cat = effectiveCategory(cluster);
  const lines = [
    `## Failure found by ShipProof`,
    `**Category:** ${CATEGORY_LABEL[cat]}${cluster.flaky ? ' (shows flaky behaviour)' : ''} · **Rule:** \`${cluster.ruleId}\` · **Signature:** \`${signatureLabel(cluster.signature)}\``,
    '',
    cluster.explanation,
    '',
    `## Failing step`,
    cluster.failedStep || '(not reported)',
    '',
    `## Error`,
    '```',
    cluster.sampleError.slice(0, 1500) || '(no message)',
    '```',
    '',
    `## Frequency`,
    `| Occurrences | Runs | First seen | Last seen |`,
    `|---|---|---|---|`,
    `| ${cluster.count} | ${Object.keys(cluster.runCounts).length} | ${fmt(cluster.firstSeen)} | ${fmt(cluster.lastSeen)} |`,
    '',
  ];
  if (cluster.environments.length) lines.push(`**Environment:** ${cluster.environments.join(', ')}`, '');
  if (cluster.buildUrls.length) {
    lines.push('## Builds');
    for (const u of cluster.buildUrls.slice(0, 5)) lines.push(`- [${u}](${u})`);
    lines.push('');
  }
  if (cluster.issueKeys.length) lines.push('## Affected stories', ...cluster.issueKeys.map((k) => `- ${k}`), '');
  lines.push('## Affected scenarios', ...cluster.scenarioIds.slice(0, 15).map((s) => `- ${s}`));
  lines.push('', `_Future failures with this signature are linked to this issue automatically._`);
  return lines.join('\n');
}
