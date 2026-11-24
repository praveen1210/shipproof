# ShipProof MCP tools: skill for IDE agents

ShipProof exposes **read-only** tools over the Atlassian Forge MCP endpoint `https://mcp.atlassian.com/forge/<appId>` (OAuth 2.1). Every call runs with the connecting user's Jira permissions. Write actions (create bug, add comment) exist only in the Rovo agent, behind explicit confirmation, and are not exposed here.

**Setup:** a site admin enables external MCP exposure in *Atlassian Administration → Apps → Sites → <site> → Connected apps → ShipProof*. Then, in Claude Code:

```bash
claude mcp add --transport http shipproof https://mcp.atlassian.com/forge/<appId>
```

## Vocabulary
- **Category**: 🐞 `product` (real product defect), 🔧 `maintenance` (broken test: locator, step definition), 🌩 `environment` (network, gateway, browser, DB), 🎲 `flaky` (unstable history, shown over the base category), ❓ `unclassified` (no rule matched).
- **Rule id**: the deterministic rule that classified a failure, e.g. `SEL-LOCATOR`, `HTTP-5XX-GW`, `ASSERT-EQ`.
- **Signature / cluster**: 6-hex hash of the normalised error + failing step. Same failure in any run = same cluster. Jira bugs carry the label `sp-sig-<signature>`.
- **Readiness** (0–100): product risk only. **Evidence confidence** (0–100%): share of trustworthy test evidence. **Verdict**: Ready (≥ 80 and ≥ 70%), At risk, Not ready (< 60).

## Tools

| Tool | Inputs | Use it for |
|---|---|---|
| `get-latest-triage` | `projectKey`, `runId?` | "Why is the nightly red?" Clusters of the latest run grouped by category. |
| `get-issue-evidence` | `issueKey` | "What's failing for PROJ-12?" Scenarios, latest result, category, history, linked bugs. |
| `get-release-readiness` | `projectKey`, `fixVersion` | "Can we ship 2.4.0?" Scores, verdict, deductions with issue keys. |
| `list-failure-clusters` | `projectKey`, `category?`, `sinceDays?` (7) | "Which locators broke this week?" `category=maintenance`. |
| `get-issue-context` | `issueKey` | ACs from the description, mapped scenarios, lexical coverage, to draft missing tests. |

Every tool returns `{ ok: true, result }` or `{ ok: false, error }`. On `ok: false`, show the error; never guess.

## Recipes
- **Fixing a red test in the IDE:** `get-issue-evidence` for the story → open the failing scenario → if the category is 🔧 with `SEL-LOCATOR`/`PW-LOCATOR`, fix the selector; if 🐞, the product is wrong: don't "fix" the test.
- **Writing missing tests:** `get-issue-context` → for each item in `uncoveredAcs`, write a scenario tagged `@<issueKey>` so ShipProof maps it on the next run.
- **Pre-merge check:** `get-release-readiness` for the version on your branch; mention deductions that involve your issue keys.
