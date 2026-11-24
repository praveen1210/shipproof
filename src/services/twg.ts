import api from '@forge/api';

/**
 * Teamwork Graph enrichment (F12, §6.7). Consumes the Teamwork Graph API as the user
 * (`asUser().requestTeamworkGraph`, the only mode it supports) to count open pull requests linked
 * to release issues. Apps can't send raw Cypher, so this uses a persisted query by operation name.
 *
 * Status: gated behind `settings.twgEnabled`, off by default until the Phase 0 spike confirms
 * EAP access and the persisted query name on the dev site. Any failure returns `undefined`, and
 * readiness then simply has no "open PR" factor. Nothing else depends on this module.
 */

/** Persisted query operation name: set it to the one registered for the app during the spike. */
export const TWG_OPERATION = 'ShipProofLinkedPullRequests';

const QUERY = `query ${TWG_OPERATION}($issueAris: [ID!]!) {
  issues: nodes(ids: $issueAris) {
    id
    linkedPullRequests: relationships(type: "jira-work-item-to-pull-request") {
      nodes { ... on PullRequest { id status } }
    }
  }
}`;

export interface TwgPrCounts {
  /** issue key → number of OPEN linked pull requests */
  openPrs: Record<string, number>;
}

export async function getOpenPrCounts(cloudId: string, issues: { id: string; key: string }[]): Promise<TwgPrCounts | undefined> {
  if (!issues.length) return { openPrs: {} };
  try {
    const aris = issues.map((i) => `ari:cloud:jira:${cloudId}:issue/${i.id}`);
    const res = await api.asUser().requestTeamworkGraph(QUERY, { issueAris: aris }, TWG_OPERATION);
    if (!res.ok) return undefined;
    const json = (await res.json()) as any;
    const byAri = new Map(aris.map((a, i) => [a, issues[i].key]));
    const openPrs: Record<string, number> = {};
    for (const node of json?.data?.issues ?? []) {
      const key = byAri.get(node?.id);
      if (!key) continue;
      openPrs[key] = (node.linkedPullRequests?.nodes ?? []).filter((p: any) => /open/i.test(p?.status ?? '')).length;
    }
    return { openPrs };
  } catch {
    return undefined;
  }
}
