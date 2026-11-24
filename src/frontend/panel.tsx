import React from 'react';
import ForgeReconciler, { Box, DynamicTable, Inline, Link, Lozenge, SectionMessage, Stack, Text, Tooltip, xcss } from '@forge/react';
import type { IssueEvidence } from '../services/evidence';
import { CategoryLozenge, ErrorMessage, Loading, ago, duration, useResolver } from './common';

const STATUS_APPEARANCE: Record<IssueEvidence['status'], 'removed' | 'moved' | 'inprogress' | 'new' | 'success' | 'default'> = {
  'failing-product': 'removed',
  'failing-unclassified': 'default',
  'failing-maintenance': 'moved',
  'failing-environment': 'inprogress',
  flaky: 'new',
  passing: 'success',
  skipped: 'default',
  'no-evidence': 'default',
};

const STATUS_HELP: Partial<Record<IssueEvidence['status'], string>> = {
  'failing-product': 'At least one scenario fails the way a real product bug would. This counts against release readiness.',
  'failing-maintenance': 'Failures look like broken tests (locators, step definitions), not product bugs. They lower evidence confidence, not readiness.',
  'failing-environment': 'Failures look like environment problems (network, gateway, browser). Rerun once the environment is healthy.',
  flaky: 'The only failures are from flaky scenarios: unstable history, not a reliable signal.',
  'failing-unclassified': 'No rule matched one failure. Ask the ShipProof agent for a suggestion or reclassify it on the triage board.',
};

const historyBox = xcss({ whiteSpace: 'nowrap' } as never);

function Panel() {
  const { data, error, loading, reload } = useResolver<IssueEvidence>('getIssueEvidence');

  if (loading) return <Loading label="Loading test evidence" />;
  if (error) return <ErrorMessage error={error} onRetry={reload} />;
  if (!data) return null;

  if (data.status === 'no-evidence') {
    return (
      <SectionMessage appearance="information" title="No test evidence">
        <Stack space="space.100">
          <Text>No CI test results are mapped to {data.issueKey} yet. Tag scenarios with @{data.issueKey} (Cucumber/Playwright), put [{data.issueKey}] in a test name, or add a JUnit property issue={data.issueKey}.</Text>
          <Text>Ask the ShipProof agent to draft scenarios: "Which acceptance criteria of {data.issueKey} have no tests?"</Text>
        </Stack>
      </SectionMessage>
    );
  }

  const rows = data.scenarios.map((s) => ({
    key: s.id,
    cells: [
      {
        key: 'name',
        content: (
          <Stack space="space.0">
            <Text>{s.name}</Text>
            {s.suite ? <Text size="small" color="color.text.subtlest">{s.suite}</Text> : null}
          </Stack>
        ),
      },
      {
        key: 'cat',
        content:
          s.latest.status === 'failed' ? (
            <Stack space="space.050">
              <CategoryLozenge category={s.latest.category ?? 'unclassified'} flaky={s.latest.flaky} />
              {s.ruleId && s.ruleId !== 'NONE' ? <Text size="small">{s.ruleId}</Text> : null}
            </Stack>
          ) : (
            <Lozenge appearance={s.latest.status === 'passed' ? 'success' : 'default'}>{s.categoryLabel}</Lozenge>
          ),
      },
      {
        key: 'hist',
        content: (
          <Tooltip content="Last 10 runs, oldest → newest. ✅ passed · ❌ failed · 🎲 flaky failure · ⏭ skipped">
            <Box xcss={historyBox}>
              <Text>{s.historyStrip}</Text>
            </Box>
          </Tooltip>
        ),
      },
      { key: 'dur', content: <Text>{duration(s.latest.durationMs)}</Text> },
      {
        key: 'build',
        content: (
          <Stack space="space.0">
            {s.latest.buildUrl ? <Link href={s.latest.buildUrl} openNewTab>Build</Link> : <Text>—</Text>}
            <Text size="small">{ago(s.latest.at)}{s.latest.stale ? ' (stale)' : ''}</Text>
          </Stack>
        ),
      },
      { key: 'bug', content: s.bugKey ? <Link href={`/browse/${s.bugKey}`}>{s.bugKey}</Link> : <Text>—</Text> },
    ],
  }));

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge appearance={STATUS_APPEARANCE[data.status]} isBold>{data.statusText}</Lozenge>
        <Text>
          {data.counts.total} scenarios · {data.counts.passed} passed · {data.counts.failed} failing · {data.counts.flaky} flaky · {data.counts.skipped} skipped
        </Text>
      </Inline>
      {STATUS_HELP[data.status] ? <Text size="small">{STATUS_HELP[data.status]}</Text> : null}
      {data.linkedBugs.length ? (
        <Inline space="space.100">
          <Text weight="medium">Linked bugs:</Text>
          {data.linkedBugs.map((k) => (
            <Link key={k} href={`/browse/${k}`}>{k}</Link>
          ))}
        </Inline>
      ) : null}
      <DynamicTable
        head={{
          cells: [
            { key: 'name', content: 'Scenario' },
            { key: 'cat', content: 'Result' },
            { key: 'hist', content: 'History' },
            { key: 'dur', content: 'Duration' },
            { key: 'build', content: 'Last run' },
            { key: 'bug', content: 'Bug' },
          ],
        }}
        rows={rows}
        rowsPerPage={10}
      />
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
