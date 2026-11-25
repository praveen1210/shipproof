import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  CodeBlock,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Link,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  SectionMessage,
  Select,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textfield,
  Tooltip,
  xcss,
} from '@forge/react';
import type { ClusterView } from '../services/app';
import type { ReleaseEvaluation } from '../services/readiness';
import { CategoryLozenge, ErrorMessage, Loading, ago, call, categoryLabel, useResolver } from './common';

// ───────────────────────────── types ─────────────────────────────

interface Group {
  category: string;
  label: string;
  clusterCount: number;
  failureCount: number;
  clusters: ClusterView[];
}

interface Triage {
  projectKey: string;
  run: null | { runId: string; buildId: string; buildUrl?: string; pipeline?: string; branch?: string; environment?: string; startedAt: string; status: string };
  message?: string;
  totals: null | { total: number; passed: number; failed: number; skipped: number; unmapped: number };
  clusterCount: number;
  groups: Group[];
}

interface RunItem {
  runId: string;
  buildId: string;
  pipeline?: string;
  startedAt: number;
  status: string;
  totals?: { total: number; failed: number };
}

type Readiness = ReleaseEvaluation & { twg: 'on' | 'off' | 'unavailable'; summaries: Record<string, string> };

const card = xcss({ padding: 'space.200', borderRadius: 'radius.medium', backgroundColor: 'color.background.neutral' });

// ───────────────────────────── triage board ─────────────────────────────

const RECLASSIFY_OPTIONS = [
  { label: 'Keep rule result', value: '' },
  { label: '🐞 Product defect', value: 'product' },
  { label: '🔧 Test maintenance', value: 'maintenance' },
  { label: '🌩 Environment', value: 'environment' },
  { label: '❓ Unclassified', value: 'unclassified' },
];

function TriageBoard() {
  const runs = useResolver<RunItem[]>('listRuns');
  const [runId, setRunId] = useState<string | undefined>();
  const triage = useResolver<Triage>('getTriage', runId ? { runId } : {}, [runId]);
  const [confirm, setConfirm] = useState<{ cluster: ClusterView; kind: 'bug' | 'task' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ appearance: 'success' | 'error'; text: string } | null>(null);

  // Poll while the selected run is still being triaged.
  useEffect(() => {
    if (triage.data?.run?.status !== 'queued') return;
    const t = setTimeout(() => void triage.reload(), 4000);
    return () => clearTimeout(t);
    // re-arm on every response (new object), not only when the status value changes
  }, [triage.data]);

  const create = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await call<{ key: string; existing: boolean; linked: string[] }>('createFromCluster', { signature: confirm.cluster.signature, kind: confirm.kind });
      setFlash({
        appearance: 'success',
        text: res.existing
          ? `Linked to existing issue ${res.key} (it already carries ${confirm.cluster.label}).`
          : `Created ${res.key}${res.linked.length ? ` and linked it to ${res.linked.join(', ')}` : ''}.`,
      });
      setConfirm(null);
      await triage.reload();
    } catch (e) {
      setFlash({ appearance: 'error', text: (e as Error).message });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const reclassify = async (c: ClusterView, value: string) => {
    try {
      await call('reclassify', { signature: c.signature, category: value || null });
      setFlash({ appearance: 'success', text: `${c.label} is now ${value ? categoryLabel(value) : 'back to its rule result'}. Future failures with this signature inherit it.` });
      await triage.reload();
    } catch (e) {
      setFlash({ appearance: 'error', text: (e as Error).message });
    }
  };

  if (triage.loading && !triage.data) return <Loading label="Loading triage" />;
  if (triage.error) return <ErrorMessage error={triage.error} onRetry={triage.reload} />;
  const data = triage.data;
  if (!data?.run) {
    return (
      <EmptyState
        header="No test runs yet"
        description={data?.message ?? 'Post results from CI with ci/shipproof-upload.mjs, or ask a Jira admin to load the demo workspace in ShipProof settings.'}
      />
    );
  }

  const runOptions = (runs.data ?? []).map((r) => ({
    label: `#${r.buildId} ${r.pipeline ?? ''} · ${ago(r.startedAt)} · ${r.totals ? `${r.totals.failed}/${r.totals.total} failed` : r.status}`,
    value: r.runId,
  }));

  return (
    <Stack space="space.300">
      <Inline space="space.200" alignBlock="center" shouldWrap>
        <Box xcss={xcss({ width: '420px' })}>
          <Select
            inputId="run"
            options={runOptions}
            value={runOptions.find((o) => o.value === data.run!.runId)}
            onChange={(o: { value: string } | null) => o && setRunId(o.value)}
            placeholder="Latest run"
          />
        </Box>
        {data.run.buildUrl ? <Link href={data.run.buildUrl} openNewTab>Open build #{data.run.buildId}</Link> : null}
        <Text>
          {data.run.branch ?? ''} {data.run.environment ? `· ${data.run.environment}` : ''} · {ago(data.run.startedAt)}
        </Text>
        <Button appearance="subtle" onClick={() => void triage.reload()}>Refresh</Button>
      </Inline>

      {data.run.status === 'queued' ? (
        <SectionMessage appearance="information" title="Triage in progress">
          <Text>This run was received and is being classified. The board refreshes automatically.</Text>
        </SectionMessage>
      ) : null}
      {flash ? (
        <SectionMessage appearance={flash.appearance}>
          <Text>{flash.text}</Text>
        </SectionMessage>
      ) : null}

      {data.totals ? (
        <Inline space="space.200" shouldWrap>
          <Box xcss={card}>
            <Text weight="bold">{data.totals.failed} failures → {data.clusterCount} clusters</Text>
            <Text size="small">{data.totals.total} results · {data.totals.passed} passed · {data.totals.skipped} skipped · {data.totals.unmapped} unmapped</Text>
          </Box>
          {data.groups.filter((g) => g.clusterCount).map((g) => (
            <Box key={g.category} xcss={card}>
              <Text weight="bold">{g.label}</Text>
              <Text size="small">{g.clusterCount} clusters · {g.failureCount} failures</Text>
            </Box>
          ))}
        </Inline>
      ) : null}

      {data.clusterCount === 0 && data.run.status === 'triaged' ? (
        <SectionMessage appearance="success" title="Green run">
          <Text>No failures in this run.</Text>
        </SectionMessage>
      ) : null}

      {data.groups.filter((g) => g.clusterCount).map((g) => (
        <Stack key={g.category} space="space.100">
          <Heading size="small">{g.label} ({g.clusterCount})</Heading>
          <DynamicTable
            head={{
              cells: [
                { key: 'what', content: 'Failure' },
                { key: 'count', content: 'Hits' },
                { key: 'issues', content: 'Stories' },
                { key: 'bug', content: 'Jira' },
                { key: 'class', content: 'Classification' },
              ],
            }}
            rows={g.clusters.map((c) => ({
              key: c.signature,
              cells: [
                {
                  key: 'what',
                  content: (
                    <Stack space="space.050">
                      <Inline space="space.100" alignBlock="center" shouldWrap>
                        <CategoryLozenge category={c.category} flaky={c.flaky} />
                        <Tooltip content={c.explanation}>
                          <Text size="small">{c.ruleId}</Text>
                        </Tooltip>
                        <Text size="small">{c.label}</Text>
                        {c.overridden ? <Lozenge>reclassified</Lozenge> : null}
                      </Inline>
                      <Text weight="medium">{c.title}</Text>
                      <Text size="small">{c.sampleError.split('\n')[0].slice(0, 180)}</Text>
                    </Stack>
                  ),
                },
                {
                  key: 'count',
                  content: (
                    <Stack space="space.0">
                      <Text>{c.countInRun ?? c.totalCount} in run</Text>
                      <Text size="small">{c.totalCount} total · {c.runs} runs</Text>
                      <Text size="small">since {ago(c.firstSeen)}</Text>
                    </Stack>
                  ),
                },
                { key: 'issues', content: <Text>{c.issueKeys.length ? c.issueKeys.join(', ') : 'Unmapped'}</Text> },
                {
                  key: 'bug',
                  content: c.bugKey ? (
                    <Link href={`/browse/${c.bugKey}`}>{c.bugKey}</Link>
                  ) : (
                    <Stack space="space.050">
                      {c.category === 'product' || c.category === 'unclassified' ? (
                        <Button appearance="primary" spacing="compact" onClick={() => setConfirm({ cluster: c, kind: 'bug' })}>Create bug</Button>
                      ) : (
                        <Button spacing="compact" onClick={() => setConfirm({ cluster: c, kind: 'task' })}>Create task</Button>
                      )}
                      {c.possibleDuplicates.length ? <Text size="small">Possible duplicate: {c.possibleDuplicates.join(', ')}</Text> : null}
                    </Stack>
                  ),
                },
                {
                  key: 'class',
                  content: (
                    <Box xcss={xcss({ width: '200px' })}>
                      <Select
                        inputId={`rc-${c.signature}`}
                        options={RECLASSIFY_OPTIONS}
                        value={c.overridden ? RECLASSIFY_OPTIONS.find((o) => o.value === c.category) : RECLASSIFY_OPTIONS[0]}
                        onChange={(o: { value: string } | null) => o && void reclassify(c, o.value)}
                        spacing="compact"
                      />
                    </Box>
                  ),
                },
              ],
            }))}
          />
        </Stack>
      ))}

      <ModalTransition>
        {confirm ? (
          <Modal onClose={() => setConfirm(null)}>
            <ModalHeader>
              <ModalTitle>{confirm.kind === 'bug' ? 'Create bug from cluster' : 'Create test-maintenance task'}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>
                  ShipProof will create a {confirm.kind === 'bug' ? 'Bug' : 'Task'} with the failing step, error, frequency, first/last seen, build links and affected stories, labelled {confirm.cluster.label}, and link it to {confirm.cluster.issueKeys.join(', ') || 'no stories (unmapped)'} with "relates to".
                </Text>
                <Text>If an open issue already has that label, it is linked instead and nothing is created.</Text>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup>
                <Button appearance="subtle" onClick={() => setConfirm(null)}>Cancel</Button>
                <LoadingButton appearance="primary" isLoading={busy} onClick={() => void create()}>
                  {confirm.kind === 'bug' ? 'Create bug' : 'Create task'}
                </LoadingButton>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Stack>
  );
}

// ───────────────────────────── readiness ─────────────────────────────

const VERDICT_APPEARANCE = { Ready: 'success', 'At risk': 'moved', 'Not ready': 'removed' } as const;

/** `refresh` changes every time the tab is opened, so the score never shows stale triage results. */
function ReadinessTab({ refresh }: { refresh: number }) {
  const versions = useResolver<{ id: string; name: string; released: boolean }[]>('listVersions');
  const [version, setVersion] = useState<string | undefined>();
  const [result, setResult] = useState<Readiness | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | undefined>();
  const [postOpen, setPostOpen] = useState(false);
  const [postKey, setPostKey] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | undefined>();
  const [flash, setFlash] = useState<{ appearance: 'success' | 'error'; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!version && versions.data?.length) setVersion((versions.data.find((v) => !v.released) ?? versions.data[0]).name);
  }, [versions.data]);

  useEffect(() => {
    if (!version) return;
    setLoading(true);
    setError(undefined);
    setReport(undefined);
    call<Readiness>('getReadiness', { fixVersion: version })
      .then(setResult)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [version, nonce, refresh]);

  const showReport = async () => {
    try {
      setReport((await call<{ markdown: string }>('getReport', { fixVersion: version })).markdown);
    } catch (e) {
      setFlash({ appearance: 'error', text: (e as Error).message });
    }
  };

  const post = async () => {
    setPosting(true);
    setPostError(undefined);
    try {
      const res = await call<{ issueKey: string }>('postReport', { fixVersion: version, issueKey: postKey.trim().toUpperCase() || undefined });
      setFlash({ appearance: 'success', text: `Report posted as a comment on ${res.issueKey}.` });
      setPostOpen(false);
    } catch (e) {
      // shown inside the modal, which would otherwise hide it
      setPostError((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  if (versions.loading) return <Loading label="Loading versions" />;
  if (versions.error) return <ErrorMessage error={versions.error} />;
  if (!versions.data?.length) {
    return <EmptyState header="No fix versions" description="Create a fix version (Releases) in this project, assign issues to it, and ShipProof scores it here." />;
  }
  const options = versions.data.map((v) => ({ label: `${v.name}${v.released ? ' (released)' : ''}`, value: v.name }));

  return (
    <Stack space="space.300">
      <Inline space="space.200" alignBlock="center">
        <Box xcss={xcss({ width: '260px' })}>
          <Select inputId="version" options={options} value={options.find((o) => o.value === version)} onChange={(o: { value: string } | null) => o && setVersion(o.value)} />
        </Box>
        <Button onClick={() => setNonce((n) => n + 1)} isDisabled={loading}>Recalculate</Button>
      </Inline>

      {flash ? (
        <SectionMessage appearance={flash.appearance}>
          <Text>{flash.text}</Text>
        </SectionMessage>
      ) : null}
      {loading ? <Loading label={`Scoring ${version}`} /> : null}
      {error ? <ErrorMessage error={error} /> : null}

      {result && !loading ? (
        <Stack space="space.300">
          <Inline space="space.300" shouldWrap>
            <Box xcss={card}>
              <Stack space="space.100">
                <Text size="small">Release readiness (product risk)</Text>
                <Heading size="large">{`${result.readiness} / 100`}</Heading>
                <ProgressBar value={result.readiness / 100} ariaLabel="Readiness" />
              </Stack>
            </Box>
            <Box xcss={card}>
              <Stack space="space.100">
                <Text size="small">Evidence confidence (trust in tests)</Text>
                <Heading size="large">{`${result.confidence}%`}</Heading>
                <ProgressBar value={result.confidence / 100} ariaLabel="Evidence confidence" />
              </Stack>
            </Box>
            <Box xcss={card}>
              <Stack space="space.100">
                <Text size="small">Verdict</Text>
                <Lozenge appearance={VERDICT_APPEARANCE[result.verdict]} isBold>{result.verdict}</Lozenge>
                <Text size="small">{result.issueCount} issues · {result.storyCount} stories</Text>
              </Stack>
            </Box>
          </Inline>
          <SectionMessage appearance={result.verdict === 'Ready' ? 'success' : result.verdict === 'At risk' ? 'warning' : 'error'}>
            <Text>{result.verdictReason}</Text>
          </SectionMessage>

          <Heading size="small">Deductions</Heading>
          {result.factors.length ? (
            <DynamicTable
              head={{ cells: [{ key: 'f', content: 'Factor' }, { key: 'p', content: 'Points' }, { key: 'i', content: 'Issues' }] }}
              rows={result.factors.map((f) => ({
                key: f.factor,
                cells: [
                  { key: 'f', content: <Stack space="space.0"><Text weight="medium">{f.factor} ({f.count})</Text><Text size="small">{f.explanation}</Text></Stack> },
                  { key: 'p', content: <Text weight="bold">−{f.points}</Text> },
                  {
                    key: 'i',
                    content: (
                      <Inline space="space.075" shouldWrap>
                        {f.issueKeys.slice(0, 12).map((k) => (
                          <Tooltip key={k} content={result.summaries[k] ?? k}>
                            <Link href={`/browse/${k}`}>{k}</Link>
                          </Tooltip>
                        ))}
                      </Inline>
                    ),
                  },
                ],
              }))}
            />
          ) : (
            <Text>No deductions: nothing in this version carries product risk.</Text>
          )}

          <Heading size="small">Evidence confidence by story</Heading>
          {result.confidenceDetail.perIssue.length ? (
            <DynamicTable
              head={{ cells: [{ key: 'k', content: 'Story' }, { key: 't', content: 'Trusted scenarios' }] }}
              rows={result.confidenceDetail.perIssue.map((p) => ({
                key: p.issueKey,
                cells: [
                  { key: 'k', content: <Text>{p.issueKey} {result.summaries[p.issueKey] ?? ''}</Text> },
                  { key: 't', content: <Text>{p.trusted}/{p.total} ({Math.round(p.ratio * 100)}%)</Text> },
                ],
              }))}
            />
          ) : (
            <Text>No story in this version has test evidence yet.</Text>
          )}
          <Text size="small">
            Trusted = latest result passed or failed as a product defect, and not flaky, environment, maintenance, skipped or stale. Teamwork Graph: {result.twg}.
          </Text>

          <Heading size="small">Report</Heading>
          <ButtonGroup>
            <Button onClick={() => void showReport()}>Show Markdown report</Button>
            <Button appearance="primary" onClick={() => {
              setPostError(undefined);
              setPostOpen(true);
            }}>Post to release issue</Button>
          </ButtonGroup>
          {report ? <CodeBlock language="markdown" text={report} showLineNumbers={false} /> : null}
        </Stack>
      ) : null}

      <ModalTransition>
        {postOpen ? (
          <Modal onClose={() => setPostOpen(false)}>
            <ModalHeader>
              <ModalTitle>Post report as a comment</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>The readiness report for {version} is added as a comment. Leave the key empty to use the issue in this version labelled "shipproof-release" (or its epic).</Text>
                {postError ? (
                  <SectionMessage appearance="error">
                    <Text>{postError}</Text>
                  </SectionMessage>
                ) : null}
                <Textfield name="issue" placeholder="Issue key, e.g. PROJ-1" value={postKey} onChange={(e) => setPostKey(String(e.target.value ?? ''))} />
              </Stack>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup>
                <Button appearance="subtle" onClick={() => setPostOpen(false)}>Cancel</Button>
                <LoadingButton appearance="primary" isLoading={posting} onClick={() => void post()}>Post comment</LoadingButton>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Stack>
  );
}

function App() {
  const [readinessVisits, setReadinessVisits] = useState(0);
  return (
    <Tabs id="shipproof-tabs" onChange={(index: number) => index === 1 && setReadinessVisits((n) => n + 1)}>
      <TabList>
        <Tab>Triage board</Tab>
        <Tab>Release readiness</Tab>
      </TabList>
      <TabPanel>
        <Box xcss={xcss({ paddingBlock: 'space.200' })}>
          <TriageBoard />
        </Box>
      </TabPanel>
      <TabPanel>
        <Box xcss={xcss({ paddingBlock: 'space.200' })}>
          <ReadinessTab refresh={readinessVisits} />
        </Box>
      </TabPanel>
    </Tabs>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
