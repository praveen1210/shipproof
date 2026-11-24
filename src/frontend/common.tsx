import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import { Lozenge, SectionMessage, Spinner, Stack, Text, Inline } from '@forge/react';

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Calls a resolver and unwraps `{ ok, data, error }`; throws the user-facing message. */
export async function call<T>(name: string, payload?: Record<string, unknown>): Promise<T> {
  const res = (await invoke(name, payload ?? {})) as Envelope<T>;
  if (!res?.ok) throw new Error(res?.error ?? 'Request failed');
  return res.data as T;
}

export function useResolver<T>(name: string, payload?: Record<string, unknown>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await call<T>(name, payload));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, JSON.stringify(payload ?? {}), ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export type CategoryKey = 'product' | 'maintenance' | 'environment' | 'unclassified' | 'flaky';

const APPEARANCE: Record<CategoryKey, 'removed' | 'moved' | 'inprogress' | 'new' | 'default'> = {
  product: 'removed',
  maintenance: 'moved',
  environment: 'inprogress',
  flaky: 'new',
  unclassified: 'default',
};

const LABEL: Record<CategoryKey, string> = {
  product: '🐞 Product defect',
  maintenance: '🔧 Test maintenance',
  environment: '🌩 Environment',
  flaky: '🎲 Flaky',
  unclassified: '❓ Unclassified',
};

/** Category is always emoji + text + lozenge: never colour alone (§8 accessibility). */
export function CategoryLozenge({ category, flaky }: { category: string; flaky?: boolean }) {
  const key = (flaky ? 'flaky' : category) as CategoryKey;
  return <Lozenge appearance={APPEARANCE[key] ?? 'default'}>{LABEL[key] ?? category}</Lozenge>;
}

export function categoryLabel(category: string, flaky?: boolean): string {
  return LABEL[(flaky ? 'flaky' : category) as CategoryKey] ?? category;
}

export function Loading({ label }: { label: string }) {
  return (
    <Inline space="space.100" alignBlock="center">
      <Spinner size="small" label={label} />
      <Text>{label}</Text>
    </Inline>
  );
}

export function ErrorMessage({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <SectionMessage appearance="error" title="ShipProof couldn't load this">
      <Stack space="space.100">
        <Text>{error}</Text>
        {onRetry ? <Text>Reload the page or try again in a moment.</Text> : null}
      </Stack>
    </SectionMessage>
  );
}

export function ago(ts: number | string | undefined): string {
  if (ts === undefined) return '—';
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function duration(ms: number | undefined): string {
  if (!ms) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
