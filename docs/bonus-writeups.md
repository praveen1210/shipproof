# ShipProof: bonus prize write-ups

Drafts. Fill in the bracketed items (links, numbers from the final run) before submitting.

## Best Agents (rovo:agent + actions)

The **ShipProof Triage Agent** is a Rovo agent with seven actions on one shared service layer:

| Action | Verb | What it grounds |
|---|---|---|
| get-latest-triage | GET | clusters of the latest CI run by category, with rule ids and linked bugs |
| get-issue-evidence | GET | scenarios, latest result, category, 10-run history, linked bugs for one issue |
| get-release-readiness | GET | readiness, evidence confidence, verdict, every deduction with issue keys |
| list-failure-clusters | GET | clusters over the last N days, filterable by category |
| get-issue-context | GET | ACs extracted from the description, mapped scenarios, coverage first pass |
| create-bug-from-cluster | CREATE | evidence-filled bug, deduped by signature label, linked to stories |
| add-issue-comment | CREATE | drafted Gherkin or a release summary as a Jira comment |

Why it's not a shallow wrapper: **code decides, the agent explains.** Classification is a deterministic rule engine (33 rules, 153-message labelled corpus, 75 % on an untuned hold-out set with zero wrong-category answers); scores are pure functions with exhaustive tests. The prompt forces an action call before every answer ("never invent results, counts or keys"), asks for emoji + rule id on every category, a fixed go/no-go format (readiness, confidence, verdict, top 3 deductions, one-line recommendation), "suggestion" labels for unclassified clusters, and explicit chat confirmation before either write action. Actions return `{ ok: false, error }` instead of throwing, so the agent reports real errors ("version 9.9.9 not found; versions are …") instead of guessing. 15-prompt grounding eval: [docs/agent-eval.md](agent-eval.md) → [X/15].

## Best app with Atlassian MCP (rovo:mcp)

The five read-only actions are exposed through one `rovo:mcp` module (`ShipProof`), so an engineer in Claude Code can ask "what's failing for PROJ-12?" and get scenario-level evidence with categories and linked bugs without leaving the IDE. [Video timestamp].

- **Same code path as Rovo and the UI**: MCP tools are the action keys, which call `src/services/app.ts`, the layer the issue panel and project page use. No separate API to drift.
- **Read-only by design**: `create-bug-from-cluster` and `add-issue-comment` are deliberately absent from `tools`. A unit test (`test/manifest.test.ts`) fails the build if a non-GET action is ever added to the MCP module.
- **User permissions**: tools run as the invoking user; each one checks project/issue access via Jira before returning stored test data, because KVS itself has no per-user ACL.
- **Agent-ready docs**: [docs/skill.md](skill.md) explains vocabulary (categories, signatures, the two scores) and recipes ("fix a red test", "write missing tests tagged with the issue key") for third-party agents.

## Teamwork Graph

[Only submit if the Phase 0 spike passes.] ShipProof consumes the Teamwork Graph API as the user (`asUser().requestTeamworkGraph`, persisted query `ShipProofLinkedPullRequests`) to count open pull requests linked to each issue in a fix version. Open PRs become an explained readiness deduction (−2 each, cap −10), so "can we ship?" reflects code still in review, not just Jira status and tests. The integration is isolated in `src/services/twg.ts`, switched on in settings, and fails soft: if Teamwork Graph is unavailable, readiness shows `Teamwork Graph: unavailable` and drops only that factor.

## Marketplace

ShipProof is a free, Jira-only Forge app (no multi-app compatibility, so it can be listed free). Submitted for listing on [date], review ticket [link]. Privacy: stores only test names, statuses, durations and truncated error messages in Forge storage, 30-day retention, no egress.
