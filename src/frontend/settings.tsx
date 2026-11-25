import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Code,
  CodeBlock,
  DynamicTable,
  Heading,
  Inline,
  Label,
  LoadingButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Stack,
  Text,
  Textfield,
  Toggle,
  xcss,
} from '@forge/react';
import type { CustomRuleConfig, ReadinessWeights } from '../services/types';
import { ErrorMessage, Loading, ago, call, categoryLabel, useResolver } from './common';

interface SettingsView {
  hasToken: boolean;
  tokenCreatedAt?: number;
  ingestUrl?: string;
  weights: ReadinessWeights;
  retentionDays: number;
  staleHours: number;
  excludedTypes: string[];
  customRules: CustomRuleConfig[];
  twgEnabled: boolean;
}

interface Demo {
  projectKey: string;
  versionName: string;
  issueKeys: string[];
  runIds: string[];
  createdAt: number;
}

interface Loaded {
  settings: SettingsView;
  demo: Demo | null;
  projects: { key: string; name: string }[];
}

type Flash = { appearance: 'success' | 'error' | 'information'; text: string } | null;

const section = xcss({ padding: 'space.200', borderRadius: 'radius.medium', backgroundColor: 'color.background.neutral.subtle', borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid' });
const narrow = xcss({ width: '320px' });

const CATEGORY_OPTIONS = ['product', 'maintenance', 'environment', 'unclassified'].map((c) => ({ label: categoryLabel(c), value: c }));

function DemoSection({ demo, projects, onChange, flash }: { demo: Demo | null; projects: Loaded['projects']; onChange: () => Promise<void>; flash: (f: Flash) => void }) {
  const [project, setProject] = useState<string | undefined>();
  const [busy, setBusy] = useState<'load' | 'remove' | 'rerun' | null>(null);
  const [confirm, setConfirm] = useState<'load' | 'remove' | null>(null);
  const status = useResolver<{ demo: Demo | null; triaged?: number; total?: number }>('demoStatus', {}, [demo?.runIds.length]);

  useEffect(() => {
    if (!status.data?.demo || status.data.triaged === status.data.total) return;
    const t = setTimeout(() => void status.reload(), 4000);
    return () => clearTimeout(t);
    // re-arm on every response (new object), not only when the count changes
  }, [status.data]);

  const run = async (kind: 'load' | 'remove' | 'rerun') => {
    setBusy(kind);
    setConfirm(null);
    try {
      if (kind === 'load') {
        const target = project ?? demo?.projectKey;
        const r = await call<{ issueKeys: string[]; runIds: string[] }>('loadDemo', { projectKey: target });
        flash({ appearance: 'success', text: `Demo workspace ready in ${target}: ${r.issueKeys.length} issues, fix version 2.4.0, ${r.runIds.length} nightly runs queued for triage. Open the project's ShipProof page in about 30 seconds.` });
      } else if (kind === 'remove') {
        const r = await call<{ deletedIssues: number; deletedRuns: number }>('removeDemo');
        flash({ appearance: 'success', text: `Demo removed: ${r.deletedIssues} issues, the demo version and ${r.deletedRuns} runs deleted.` });
      } else {
        await call('demoRerun');
        flash({ appearance: 'success', text: 'Rerun ingested: the staging environment is fixed in this run. Recalculate 2.4.0 on the Release readiness tab.' });
      }
      await onChange();
      await status.reload();
    } catch (e) {
      flash({ appearance: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box xcss={section}>
      <Stack space="space.150">
        <Heading size="small">Demo workspace</Heading>
        <Text>See ShipProof end to end in under 3 minutes, without a CI pipeline. Loading creates 8 stories, 2 bugs and fix version 2.4.0 in the project you pick, then ingests 5 nightly runs (275 results) through the same pipeline CI uses.</Text>
        {demo ? (
          <Stack space="space.100">
            <Text>
              Loaded in <Code>{demo.projectKey}</Code> {ago(demo.createdAt)}: {demo.issueKeys.join(', ')}.
              {status.data?.total ? ` Runs triaged: ${status.data.triaged}/${status.data.total}.` : ''}
            </Text>
            {demo.runIds.length === 0 ? (
              <SectionMessage appearance="warning" title="Demo issues created, runs not ingested yet">
                <Text>The last load stopped before the nightly runs were sent. Finish loading to ingest them into the existing demo issues.</Text>
              </SectionMessage>
            ) : null}
            <ButtonGroup>
              {demo.runIds.length === 0 ? (
                <LoadingButton appearance="primary" isLoading={busy === 'load'} onClick={() => void run('load')}>Finish loading</LoadingButton>
              ) : (
                <LoadingButton isLoading={busy === 'rerun'} onClick={() => void run('rerun')}>Ingest rerun (environment fixed)</LoadingButton>
              )}
              <Button appearance="danger" isDisabled={!!busy} onClick={() => setConfirm('remove')}>Remove demo workspace</Button>
            </ButtonGroup>
          </Stack>
        ) : (
          <Inline space="space.100" alignBlock="end">
            <Box xcss={narrow}>
              <Label labelFor="demo-project">Project</Label>
              <Select
                inputId="demo-project"
                options={projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))}
                onChange={(o: { value: string } | null) => setProject(o?.value)}
                placeholder="Pick a project"
              />
            </Box>
            <LoadingButton appearance="primary" isDisabled={!project} isLoading={busy === 'load'} onClick={() => setConfirm('load')}>
              Load demo workspace
            </LoadingButton>
          </Inline>
        )}
      </Stack>
      <ModalTransition>
        {confirm ? (
          <Modal onClose={() => setConfirm(null)}>
            <ModalHeader>
              <ModalTitle>{confirm === 'load' ? `Load demo workspace into ${project}?` : 'Remove demo workspace?'}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Text>
                {confirm === 'load'
                  ? 'This creates 10 issues labelled shipproof-demo and fix version 2.4.0 (if it does not exist) as you, and moves 5 of the stories to Done.'
                  : `This permanently deletes the ${demo?.issueKeys.length ?? 0} demo issues, the demo fix version and all demo runs and clusters. It cannot be undone.`}
              </Text>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup>
                <Button appearance="subtle" onClick={() => setConfirm(null)}>Cancel</Button>
                <Button appearance={confirm === 'load' ? 'primary' : 'danger'} onClick={() => void run(confirm)}>
                  {confirm === 'load' ? 'Load demo' : 'Delete demo data'}
                </Button>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Box>
  );
}

function TokenSection({ settings, onChange, flash }: { settings: SettingsView; onChange: () => Promise<void>; flash: (f: Flash) => void }) {
  const [token, setToken] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rotate = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      const r = await call<{ token: string }>('rotateToken');
      setToken(r.token);
      await onChange();
    } catch (e) {
      flash({ appearance: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const url = settings.ingestUrl ?? '<deploy the app to get the ingest URL>';
  return (
    <Box xcss={section}>
      <Stack space="space.150">
        <Heading size="small">CI ingest</Heading>
        <Text>Add one step after your tests. Results are parsed in CI; only a compact summary (names, statuses, truncated errors) is sent to ShipProof, which runs on Atlassian with no external backend.</Text>
        <Label labelFor="url">Ingest URL</Label>
        <CodeBlock language="text" text={url} showLineNumbers={false} />
        <Text>
          Token: {settings.hasToken ? `set ${settings.tokenCreatedAt ? ago(settings.tokenCreatedAt) : ''} (stored only as a SHA-256 hash)` : 'not generated yet'}
        </Text>
        {token ? (
          <SectionMessage appearance="warning" title="Copy this token now: it is shown only once">
            <Stack space="space.100">
              <CodeBlock language="text" text={token} showLineNumbers={false} />
              <Text>Store it as the CI secret SHIPPROOF_TOKEN. Rotating invalidates the previous token immediately.</Text>
            </Stack>
          </SectionMessage>
        ) : null}
        <Inline space="space.100">
          <LoadingButton appearance={settings.hasToken ? 'default' : 'primary'} isLoading={busy} onClick={() => (settings.hasToken ? setConfirm(true) : void rotate())}>
            {settings.hasToken ? 'Rotate token' : 'Generate token'}
          </LoadingButton>
        </Inline>
        <CodeBlock
          language="shell"
          showLineNumbers={false}
          text={`npm i --no-save fast-xml-parser
SHIPPROOF_URL="${url}" SHIPPROOF_TOKEN="$SHIPPROOF_TOKEN" \\
  node ci/shipproof-upload.mjs --file target/cucumber.json --project PROJ \\
  --build-id "$BUILD_NUMBER" --build-url "$BUILD_URL" --environment staging`}
        />
      </Stack>
      <ModalTransition>
        {confirm ? (
          <Modal onClose={() => setConfirm(false)}>
            <ModalHeader>
              <ModalTitle>Rotate the ingest token?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Text>CI jobs using the current token get 401 until you update their SHIPPROOF_TOKEN secret.</Text>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup>
                <Button appearance="subtle" onClick={() => setConfirm(false)}>Cancel</Button>
                <Button appearance="warning" onClick={() => void rotate()}>Rotate token</Button>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Box>
  );
}

function ScoringSection({ settings, onSaved, flash }: { settings: SettingsView; onSaved: () => Promise<void>; flash: (f: Flash) => void }) {
  const [form, setForm] = useState({
    staleHours: String(settings.staleHours),
    retentionDays: String(settings.retentionDays),
    excludedTypes: settings.excludedTypes.join(', '),
    twgEnabled: settings.twgEnabled,
    weights: Object.fromEntries(Object.entries(settings.weights).map(([k, v]) => [k, String(v)])) as Record<string, string>,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await call('saveSettings', {
        staleHours: Number(form.staleHours),
        retentionDays: Number(form.retentionDays),
        excludedTypes: form.excludedTypes.split(',').map((s) => s.trim()).filter(Boolean),
        twgEnabled: form.twgEnabled,
        weights: Object.fromEntries(Object.entries(form.weights).map(([k, v]) => [k, Number(v)])),
      });
      flash({ appearance: 'success', text: 'Settings saved.' });
      await onSaved();
    } catch (e) {
      flash({ appearance: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const field = (key: 'staleHours' | 'retentionDays' | 'excludedTypes', label: string, help?: string) => (
    <Box xcss={narrow}>
      <Label labelFor={key}>{label}</Label>
      <Textfield id={key} name={key} value={form[key]} onChange={(e) => setForm({ ...form, [key]: String(e.target.value ?? '') })} />
      {help ? <Text size="small">{help}</Text> : null}
    </Box>
  );
  const WEIGHT_ROWS: [keyof ReadinessWeights, keyof ReadinessWeights, string][] = [
    ['highBug', 'highBugCap', 'Open High/Highest bug'],
    ['mediumBug', 'mediumBugCap', 'Open Medium bug'],
    ['productFailure', 'productFailureCap', 'Story failing with a product defect'],
    ['untrackedFailure', 'untrackedFailureCap', 'Product-defect cluster with no bug'],
    ['noEvidence', 'noEvidenceCap', 'Story with no test evidence'],
    ['openPr', 'openPrCap', 'Open PR (Teamwork Graph)'],
    ['reopened', 'reopenedCap', 'Reopened issue'],
    ['notDone', 'notDoneCap', 'Issue not Done'],
  ];
  const wField = (k: keyof ReadinessWeights) => (
    <Box xcss={xcss({ width: '90px' })}>
      <Textfield name={k} aria-label={k} value={form.weights[k]} onChange={(e) => setForm({ ...form, weights: { ...form.weights, [k]: String(e.target.value ?? '') } })} />
    </Box>
  );
  return (
    <Box xcss={section}>
      <Stack space="space.150">
        <Heading size="small">Scoring and retention</Heading>
        <Inline space="space.200" shouldWrap>
          {field('staleHours', 'Stale after (hours)', 'Older results are not trusted evidence.')}
          {field('retentionDays', 'Keep runs for (days)', 'Purged daily.')}
          {field('excludedTypes', 'Issue types without tests', 'Not counted as stories, e.g. Spike.')}
        </Inline>
        <Inline space="space.100" alignBlock="center">
          <Toggle id="twg" isChecked={form.twgEnabled} onChange={() => setForm({ ...form, twgEnabled: !form.twgEnabled })} />
          <Label labelFor="twg">Use Teamwork Graph for linked pull requests (Preview; needs Teamwork Graph API access)</Label>
        </Inline>
        <DynamicTable
          head={{ cells: [{ key: 'f', content: 'Readiness deduction' }, { key: 'w', content: 'Points each' }, { key: 'c', content: 'Cap' }] }}
          rows={WEIGHT_ROWS.map(([w, c, label]) => ({ key: w, cells: [{ key: 'f', content: <Text>{label}</Text> }, { key: 'w', content: wField(w) }, { key: 'c', content: wField(c) }] }))}
        />
        <Inline>
          <LoadingButton appearance="primary" isLoading={busy} onClick={() => void save()}>Save settings</LoadingButton>
        </Inline>
      </Stack>
    </Box>
  );
}

function RulesSection({ settings, onSaved, flash }: { settings: SettingsView; onSaved: () => Promise<void>; flash: (f: Flash) => void }) {
  const [draft, setDraft] = useState<{ id: string; category: string; pattern: string; explanation: string }>({ id: '', category: 'environment', pattern: '', explanation: '' });
  const [busy, setBusy] = useState(false);
  const save = async (rules: CustomRuleConfig[]) => {
    setBusy(true);
    try {
      await call('saveSettings', { customRules: rules });
      await onSaved();
      flash({ appearance: 'success', text: 'Custom rules saved. They apply to runs triaged from now on.' });
      setDraft({ id: '', category: 'environment', pattern: '', explanation: '' });
    } catch (e) {
      flash({ appearance: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box xcss={section}>
      <Stack space="space.150">
        <Heading size="small">Custom rules</Heading>
        <Text>Your rules run before the built-in ones (first match wins). Patterns are case-insensitive regular expressions matched against the failure message. To reclassify a single cluster, use the triage board instead.</Text>
        {settings.customRules.length ? (
          <DynamicTable
            head={{ cells: [{ key: 'id', content: 'Rule' }, { key: 'cat', content: 'Category' }, { key: 'p', content: 'Pattern' }, { key: 'x', content: '' }] }}
            rows={settings.customRules.map((r, i) => ({
              key: `${r.id}-${i}`,
              cells: [
                { key: 'id', content: <Text>{r.id}</Text> },
                { key: 'cat', content: <Text>{categoryLabel(r.category)}</Text> },
                { key: 'p', content: <Code>{r.pattern}</Code> },
                { key: 'x', content: <Button spacing="compact" appearance="subtle" onClick={() => void save(settings.customRules.filter((_, j) => j !== i))}>Remove</Button> },
              ],
            }))}
          />
        ) : (
          <Text>No custom rules.</Text>
        )}
        <Inline space="space.100" alignBlock="end" shouldWrap>
          <Box xcss={xcss({ width: '160px' })}>
            <Label labelFor="rule-id">Rule id</Label>
            <Textfield id="rule-id" name="rule-id" placeholder="ACME-STUB" value={draft.id} onChange={(e) => setDraft({ ...draft, id: String(e.target.value ?? '') })} />
          </Box>
          <Box xcss={xcss({ width: '200px' })}>
            <Label labelFor="rule-cat">Category</Label>
            <Select inputId="rule-cat" options={CATEGORY_OPTIONS} value={CATEGORY_OPTIONS.find((o) => o.value === draft.category)} onChange={(o: { value: string } | null) => o && setDraft({ ...draft, category: o.value })} />
          </Box>
          <Box xcss={xcss({ width: '320px' })}>
            <Label labelFor="rule-pattern">Pattern</Label>
            <Textfield id="rule-pattern" name="rule-pattern" placeholder="payment stub returned 5\d\d" value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: String(e.target.value ?? '') })} />
          </Box>
          <Box xcss={xcss({ width: '320px' })}>
            <Label labelFor="rule-exp">Explanation</Label>
            <Textfield id="rule-exp" name="rule-exp" value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: String(e.target.value ?? '') })} />
          </Box>
          <LoadingButton
            isLoading={busy}
            isDisabled={!draft.pattern.trim()}
            onClick={() => void save([...settings.customRules, { id: draft.id || `CUSTOM-${settings.customRules.length + 1}`, category: draft.category as CustomRuleConfig['category'], pattern: draft.pattern, explanation: draft.explanation || undefined }])}
          >
            Add rule
          </LoadingButton>
        </Inline>
      </Stack>
    </Box>
  );
}

function McpSection() {
  return (
    <Box xcss={section}>
      <Stack space="space.100">
        <Heading size="small">Rovo agent and MCP</Heading>
        <Text>The ShipProof Triage Agent is available in Rovo chat. Its read-only actions are also exposed as MCP tools for IDE agents (Claude Code, Cursor). Write actions (create bug, add comment) are never exposed over MCP.</Text>
        <Text>To allow external MCP clients, a site admin enables it in Atlassian Administration → Apps → Sites → your site → Connected apps → ShipProof. The endpoint is https://mcp.atlassian.com/forge/&lt;appId&gt; (OAuth 2.1). Tools run with the connecting user's Jira permissions.</Text>
      </Stack>
    </Box>
  );
}

function Settings() {
  const loaded = useResolver<Loaded>('getSettings');
  const [flash, setFlash] = useState<Flash>(null);
  if (loaded.loading && !loaded.data) return <Loading label="Loading ShipProof settings" />;
  if (loaded.error) return <ErrorMessage error={loaded.error} onRetry={loaded.reload} />;
  const { settings, demo, projects } = loaded.data!;
  return (
    <Stack space="space.300">
      <Heading size="large">ShipProof settings</Heading>
      <Text>Know why your tests failed. Know if you can ship.</Text>
      {flash ? (
        <SectionMessage appearance={flash.appearance}>
          <Text>{flash.text}</Text>
        </SectionMessage>
      ) : null}
      <DemoSection demo={demo} projects={projects} onChange={loaded.reload} flash={setFlash} />
      <TokenSection settings={settings} onChange={loaded.reload} flash={setFlash} />
      <ScoringSection key={JSON.stringify(settings)} settings={settings} onSaved={loaded.reload} flash={setFlash} />
      <RulesSection settings={settings} onSaved={loaded.reload} flash={setFlash} />
      <McpSection />
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>,
);
