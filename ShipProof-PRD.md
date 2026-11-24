# ShipProof — Product Requirements Document (FINAL v2.0)

**Know *why* your tests failed. Know *if* you can ship.**
CI failure triage + noise-free release evidence for Jira, built on Forge, Rovo, MCP and Teamwork Graph.

| Field | Value |
|---|---|
| Hackathon | Codegeist 2026 (Atlassian, on Devpost): https://codegeist2026.devpost.com |
| Category | **Apps for Software Teams** |
| Bonus prizes targeted | **Best Agents** (`rovo:agent` + actions) · **Best app with Atlassian MCP** (`rovo:mcp`) · **Teamwork Graph integration** (consume API) · **Marketplace published app** (submit for listing) |
| Platform | Atlassian Forge, **Jira Cloud only** (one installation; see §7.1 for why) |
| Builder | Praveenkumar (solo), built with Claude Code |
| Hard deadline | Dec 22, 2026 12:00 PM PT = **Wed Dec 23, 2026 01:30 AM IST** |
| Internal submit target | **Sun Dec 20, 2026** |
| Cost | **₹0.** Forge free tier + Forge demo site. No Forge LLM, no Rovo Dev, no paid trials. |
| Status | Final (v2.1). Supersedes v1.0. Every platform fact verified against sources on Nov 24, 2026 (Appendix A). |

---

## 0. What changed from v1.0, and why

| # | v1.0 | v2.0 | Reason |
|---|---|---|---|
| 1 | Core = "test evidence on issues + readiness score + Gherkin generator" | Core = **CI failure triage** (classify every failure as Product defect / Test maintenance / Environment / Flaky) + **noise-free readiness** with a separate **evidence confidence** score | The v1 core already exists. **Testream** (Marketplace) publishes CI results to Jira with flaky tests, a Rovo BDD coverage agent and release visibility. **Release Readiness for Jira**, **Xray**, **AssertThat** and **Cucumber for Jira** cover the rest. Other Codegeist 2026 entries are doing the same things: **ShipReady** (fix-version readiness Rovo agent), **Precedent** (ship-confidence score), **Groundwork** (readiness checks), **TracePilot AI** (AI test recommendations). "Innovation: how the concept differs from existing ideas" is 20% of the score. |
| 2 | Gherkin generation = P0 headline | P1, a supporting feature | It's a crowded area (AssertThat, Testream, TracePilot). |
| 3 | Confluence report publishing (P0) | Removed from the core. Report = Markdown export + Jira comment. Confluence = P3 optional. | Jira + Confluence in one app needs multiple-app compatibility (Preview). Marketplace lists multi-app Forge apps only as **paid** apps, which blocks a free listing. A community thread also reports `rovo:mcp` tool calls running in the Confluence installation with empty Jira-side storage. |
| 4 | No Teamwork Graph | **Consume the Teamwork Graph API** (builds / PRs / deployments linked to release issues) as P1 | Teamwork Graph is the headline of this year's theme, and it's a 4th bonus. |
| 5 | Ingest did all work in the web trigger | Ingest stores, then **async queue** processes | Web trigger and action functions have a hard **55 s** runtime. Async consumers get up to **900 s**. |
| 6 | Judges need a CI pipeline to see anything | **"Load demo workspace"** button creates demo issues + runs on the judge's own site | Judges install from a link on their site. Rules penalise a "hardcoded demo path". |
| 7 | Forge LLM not specified | **No Forge LLM.** All AI goes through Rovo. | Forge LLM is off by default, billed per use, and **no credits are given** for Codegeist. Rovo is free on the dev site. |

---

## 1. Summary

Every automation team starts the day the same way: the nightly run is red, and someone spends 1–2 hours working out which failures are **real product bugs** and which are **broken locators, a dead environment or flaky tests**. Then a release manager asks "can we ship?" and gets a gut answer, because the red dashboard mixes signal and noise.

**ShipProof** closes that loop inside Jira:

1. **Ingest:** one CI step posts Cucumber / JUnit / Playwright results (Jenkins, Azure DevOps, GitHub Actions).
2. **Triage:** deterministic, explainable rules cluster failures by error signature and classify each cluster: 🐞 Product defect · 🔧 Test maintenance · 🌩 Environment · 🎲 Flaky. Each cluster is matched to an existing Jira bug, or turned into one in a click with all evidence prefilled.
3. **Decide:** a **Release Readiness** score per fix version that counts only real product risk, next to an **Evidence Confidence** score that says how much to trust the test evidence.
4. **Ask:** the **ShipProof Triage Agent** (Rovo) answers "Why did last night's run fail?", "Can we ship 2.4.0?", "Which ACs of PROJ-20 have no tests?" Every answer is grounded in actions, never guessed.
5. **Everywhere:** the same actions are exposed as **MCP tools**, so Claude Code, Cursor, etc. can ask "what's failing for PROJ-12?" from the IDE.

**One-line pitch:** *"Red builds tell you something broke. ShipProof tells you what, whose problem it is, and whether it blocks the release."*

---

## 2. Competitive position

| Product / entry | What it does | Gap ShipProof fills |
|---|---|---|
| Testream (Marketplace) | CI results → Jira evidence, flaky detection, Rovo BDD coverage, release visibility | No **failure root-cause classification** (product vs test vs env), no signature clustering / bug dedupe, readiness not noise-adjusted |
| Release Readiness for Jira (Marketplace) | Steering-committee checklist, decision snapshot, explicitly "no readiness percentage" | No test evidence, no CI triage |
| Xray / AssertThat / Cucumber for Jira | Full test management, BDD, CI import, AI Gherkin | Heavy setup, test-case-centric, no triage intelligence, not agent/MCP-native |
| ShipReady, Precedent, Groundwork (Codegeist 2026 entries) | Readiness / confidence scores from Jira state (blockers, PRs, builds) | Use pass/fail at **build** level only; can't tell a real regression from a broken locator |
| TracePilot AI (Codegeist 2026 entry) | AI test recommendations from issues | Pre-execution only; doesn't read results |

**Differentiators to say out loud in the video and write-up:**
1. **Failure taxonomy:** Product / Maintenance / Environment / Flaky, from a signature rule engine built from real Selenium, Playwright, RestAssured and Cucumber failure messages. *It's written from an automation engineer's lived experience.*
2. **Two-axis decision:** readiness (product risk) **×** evidence confidence (how much to trust the tests). A release with 100% green but 40% confidence is *not* ready.
3. **Deterministic core, AI on top:** code decides the classification and the score. Rovo explains and drafts. Judges explicitly reward "not a shallow wrapper".
4. **Agent-native:** Rovo agent + MCP tools + Teamwork Graph context.

---

## 3. Goals and non-goals

### Goals
- G1: Ingest CI results from any runner with one command. Map them to Jira issue keys.
- G2: Cluster and classify every failure. Dedupe against open Jira bugs. Create bugs with evidence.
- G3: Show per-issue evidence (issue panel) and a release triage + readiness view (project page).
- G4: Compute an explainable readiness score and evidence confidence per fix version.
- G5: Rovo agent with grounded actions. The same actions are exposed as MCP tools.
- G6: Enrich readiness with Teamwork Graph context (linked PRs / builds / deployments).
- G7: Judges can see the full experience in < 3 minutes on their own site without CI ("Load demo workspace").
- G8: Runs on Atlassian: no external egress, no external backend, no Forge LLM.

### Non-goals
Manual test cases / test plans / execution cycles (Xray territory) · running tests from Jira · code coverage · Data Center · Confluence as a core dependency.

### Success metrics (demo-verifiable)
- Ingest of a 500-result run acknowledged in < 3 s. Triage complete in < 30 s.
- Classifier accuracy ≥ 90% on the labelled fixture corpus (≥ 120 real-world failure messages, §9).
- Panel resolver < 1.5 s. Readiness for 100 issues < 8 s.
- Duplicate failures across 5 nightly runs → **1 cluster, 1 bug**, not 5.

---

## 4. Personas

| Persona | Pain today | ShipProof surface |
|---|---|---|
| **Automation engineer** (primary, *that's us*) | Morning triage of nightly failures; locator breaks hidden among real bugs | Triage board, maintenance clusters, CI upload |
| **Developer** | "Is my story's failure my bug or a test problem?" | Issue panel |
| **QA lead / release manager** | Go/no-go based on a red dashboard | Readiness + confidence, agent, report export |
| **Product owner** | Are the ACs actually covered? | Coverage check via agent |
| **IDE agent user** | Context switching to Jenkins/Jira | MCP tools |

---

## 5. User stories and acceptance criteria (Gherkin, so they double as the test suite)

### US-1: Ingest results
```gherkin
Feature: CI result ingestion
  Scenario: Valid upload is accepted fast and processed async
    Given a project admin generated an ingest token in ShipProof settings
    And a Cucumber JSON report with scenarios tagged @PROJ-12 and @PROJ-15
    When the CI script POSTs the compact summary with header X-ShipProof-Token
    Then the response is 202 with a runId within 3 seconds
    And within 30 seconds PROJ-12 and PROJ-15 show the run in the ShipProof panel

  Scenario: Re-upload of the same build is idempotent
    Given run (PROJ, jenkins, build 1287) was already ingested
    When the same build is uploaded again
    Then the previous run is replaced and no duplicate clusters are created

  Scenario Outline: Rejected requests store nothing
    When a POST arrives with <problem>
    Then the response is <code>
    Examples:
      | problem                 | code |
      | missing or wrong token  | 401  |
      | invalid schema          | 400  |
      | payload over 200 KB     | 413  |

  Scenario: Result without issue key
    Given a result has no issue key in tags, name or properties
    Then it is stored as "Unmapped" and counted on the triage board
```

### US-2: Failure triage
```gherkin
Feature: Failure classification and clustering
  Scenario Outline: Deterministic classification
    Given a failed result with error "<error>"
    When triage runs
    Then the failure category is "<category>" with rule id "<rule>"
    Examples:
      | error                                                          | category         | rule        |
      | NoSuchElementException: Unable to locate element: #loginBtn    | Test maintenance | SEL-LOCATOR |
      | locator.click: Timeout 30000ms exceeded waiting for getByRole  | Test maintenance | PW-LOCATOR  |
      | ECONNREFUSED 10.0.0.5:8443                                     | Environment      | NET-REFUSED |
      | Expected status code <200> but was <503>                       | Environment      | HTTP-5XX-GW |
      | expected: <Order Placed> but was: <Payment Failed>             | Product defect   | ASSERT-EQ   |

  Scenario: Flaky overrides category
    Given a scenario's last 10 results have a pass rate between 20% and 90%
    And it failed in the latest run
    Then the failure is shown as "Flaky" with its original category as secondary

  Scenario: Clustering by signature
    Given 14 failures across 3 runs share the same normalized error signature and failing step
    Then they appear as 1 cluster with count 14, first seen and last seen

  Scenario: Dedupe against existing bugs
    Given an open Jira bug has label "sp-sig-7f3a9c"
    When a new failure with signature 7f3a9c is triaged
    Then the cluster links to that bug and no new bug is suggested

  Scenario: Create bug from cluster
    Given a Product defect cluster with no linked bug
    When I click "Create bug" and confirm
    Then a Bug is created with summary, failing step, error, build link, frequency, affected stories and label "sp-sig-<hash>"
    And the bug is linked to the affected stories with "relates to"
```

### US-3: Issue evidence
```gherkin
Feature: Issue panel
  Scenario: Story with mixed results
    Given PROJ-12 has 4 mapped scenarios: 2 passed, 1 product-defect failure, 1 flaky
    When I open PROJ-12
    Then the panel shows status "Failing – product defect"
    And each scenario with category badge, last 10-run history strip, duration and build link
    And the linked bug for the failing cluster

  Scenario: No evidence
    Given PROJ-20 has no mapped results
    Then the panel shows "No test evidence" and the hint "Ask the ShipProof agent to draft scenarios"
```

### US-4: Release readiness
```gherkin
Feature: Release readiness and evidence confidence
  Scenario: Green but untrustworthy is not ready
    Given fix version 2.4.0 where all stories pass but 60% of scenarios are flaky or stale
    Then readiness is 90+ but evidence confidence is below 70%
    And the verdict is "At risk – low evidence confidence"

  Scenario: Explained score
    When I open Release Readiness for 2.4.0
    Then I see readiness 0–100, confidence 0–100%, verdict, and every deduction with linked issues
```

### US-5: Rovo agent
```gherkin
Feature: ShipProof Triage Agent
  Scenario: Explain last night
    When I ask "Why did last night's run fail?"
    Then the agent summarises clusters by category with counts and the top product defects with keys

  Scenario: Go / no-go
    When I ask "Can we ship 2.4.0?"
    Then the agent states readiness, confidence, verdict, top 3 deductions and a one-line recommendation

  Scenario: Writes need confirmation
    When the agent proposes to create a bug or post a comment
    Then nothing is written until I confirm
```

### US-6: MCP
```gherkin
Feature: MCP tools
  Scenario: IDE agent queries failures
    Given the admin enabled external MCP exposure for ShipProof
    And Claude Code is connected to https://mcp.atlassian.com/forge/<appId>
    When it calls get_issue_evidence with issueKey "PROJ-12"
    Then it receives JSON with scenarios, categories and linked bugs, filtered by the user's permissions
```

### US-7: Judge / first-run experience
```gherkin
Feature: Demo workspace
  Scenario: Judge sees value in under 3 minutes
    Given ShipProof is freshly installed on a site with an empty project
    When an admin clicks "Load demo workspace" and picks project KEY
    Then 8 demo stories, 2 bugs and fix version "2.4.0" are created
    And 5 nightly runs (≈ 300 results) are ingested and triaged
    And the triage board, panels and readiness page are populated
  Scenario: Remove demo data
    When the admin clicks "Remove demo workspace"
    Then all demo issues, the version and stored runs are deleted after confirmation
```

---

## 6. Functional requirements

### 6.1 Scope and priority

| ID | Requirement | Pri |
|---|---|---|
| F1 | Web trigger ingest: token auth, schema validation, store raw run, enqueue | P0 |
| F2 | CI uploader `ci/shipproof-upload.mjs`: Cucumber JSON, JUnit XML, Playwright JSON → compact payload | P0 |
| F3 | Issue-key mapping: `@PROJ-123` tags, `[PROJ-123]` in names, JUnit `<property name="issue">` | P0 |
| F4 | Triage engine: normalise → signature → classify (rules) → flaky → cluster | P0 |
| F5 | Bug dedupe (signature label + JQL) and "Create bug" with evidence | P0 |
| F6 | Jira issue panel | P0 |
| F7 | Project page: **Triage board** tab + **Release readiness** tab | P0 |
| F8 | Readiness + evidence confidence engine (pure functions) | P0 |
| F9 | Rovo agent + actions (§6.6) | P0 |
| F10 | `rovo:mcp` exposing the read-only actions | P0 (cheap: manifest-level reuse) |
| F11 | Settings (admin page): token generate/rotate, weights, retention, custom rules, demo workspace | P0 (demo) / P1 (rest) |
| F12 | Teamwork Graph API: linked PRs / builds / deployments per release issue → readiness factors | P1 |
| F13 | Report export: Markdown download + "Post as comment on release issue" | P1 |
| F14 | Agent: AC extraction + coverage check + Gherkin draft (comment on confirm) | P1 |
| F15 | Marketplace submission (free, Jira-only listing) | P1 (bonus, low effort, do in Phase 6) |
| F16 | Scheduled purge of runs older than retention | P2 |
| F17 | Teamwork Graph **connector** pushing builds (`atlassian:build` with `testInfo`) | P3 stretch |
| F18 | Confluence report (multi-app compatibility, Preview) | P3, probably skip |

**Cut order if behind:** F18 → F17 → F16 → F15 → F14 → F13 → F12. **Never cut F1–F11.**

### 6.2 Ingest contract (F1–F3)

`POST <webtrigger-url>` · header `X-ShipProof-Token` (stored as SHA-256 hash, constant-time compare, rotatable) · `Content-Type: application/json` · body ≤ **200 KB** (the uploader chunks larger runs as `part i/n` under one `runId`).

```json
{
  "schemaVersion": 1,
  "source": "jenkins | azure-devops | github-actions | other",
  "projectKey": "PROJ",
  "buildId": "1287",
  "buildUrl": "https://ci.example.com/job/app/1287",
  "pipeline": "nightly-regression",
  "branch": "release/2.4.0",
  "commit": "a1b2c3d",
  "environment": "staging",
  "startedAt": "2026-12-01T10:15:00Z",
  "part": { "index": 1, "total": 1 },
  "results": [{
    "id": "checkout.feature:Pay with saved card",
    "name": "Pay with saved card",
    "suite": "checkout.feature",
    "status": "passed | failed | skipped",
    "durationMs": 4120,
    "issueKeys": ["PROJ-12"],
    "failedStep": "When I confirm the payment",
    "error": "first 1000 chars of message + top 5 stack frames"
  }]
}
```
Responses: `202 {runId}` · `400 {errors[]}` · `401` · `413`.
The web trigger only validates, writes the raw run, and pushes a job to an **async events queue**. All heavy work runs in the consumer.

**Uploader:** Node 20+, one dependency (`fast-xml-parser`). Parsing happens in CI, not in Forge. It ships with ready snippets for **Jenkinsfile**, **Azure Pipelines YAML** and **GitHub Actions** in `ci/README.md`.

### 6.3 Triage engine (F4), the heart of the app

**Pipeline per failed result:**
1. **Normalise** the error: strip timestamps, UUIDs, hex ids, numbers > 3 digits, ports, temp paths, quoted dynamic values. Keep the exception type + message skeleton.
2. **Signature** = `sha1(category-agnostic skeleton + failedStep text)` → first 6 hex chars (`7f3a9c`).
3. **Classify** with ordered rules (first match wins). Each rule has `id`, `category`, `pattern`, `explanation`:

| Category | Example rule ids → patterns (initial set, ~40 rules) |
|---|---|
| 🔧 Test maintenance | `SEL-LOCATOR` NoSuchElementException · `SEL-STALE` StaleElementReferenceException · `SEL-NOTINTERACT` ElementNotInteractable / ElementClickIntercepted · `PW-LOCATOR` `locator.*Timeout .* exceeded` · `PW-STRICT` strict mode violation · `CY-NOTFOUND` "Timed out retrying … expected to find element" · `CUKE-UNDEFINED` undefined/pending step |
| 🌩 Environment | `NET-REFUSED` ECONNREFUSED / Connection refused · `NET-DNS` ENOTFOUND / UnknownHost · `NET-RESET` ECONNRESET / socket hang up · `HTTP-5XX-GW` 502/503/504 · `DRV-SESSION` SessionNotCreated / chrome not reachable · `PW-BROWSER` browser has been closed / Target closed · `TIMEOUT-GLOBAL` test timeout with no locator context · `DB-CONN` connection pool / JDBC connect errors |
| 🐞 Product defect | `ASSERT-EQ` expected X but was Y (JUnit/AssertJ/TestNG/Chai/expect) · `RA-STATUS-4XX` RestAssured expected status 2xx but 4xx · `HTTP-500` 500 with assertion context · `ASSERT-VISIBLE-TEXT` toHaveText / toContainText mismatch |
| ❓ Unclassified | No rule matched. Shown for agent explanation and for a user to reclassify. |

4. **Flaky overlay:** in the scenario's last 10 results, pass rate between 20% and 90% → `flaky=true`. The UI shows 🎲 with the base category as secondary.
5. **Cluster** by `(projectKey, signature)`: count, firstSeen, lastSeen, affected scenarios, affected issue keys, category, rule id.
6. **User override:** reclassify a cluster (stored; that signature's future failures inherit the override). Custom regex rules in settings (P1).

Everything is a **pure function** in `src/services/triage/*`, unit-tested against the fixture corpus (§9).

### 6.4 Bug dedupe and creation (F5)
- Dedupe 1 (exact): JQL `project = X AND labels = "sp-sig-<hash>" AND statusCategory != Done`.
- Dedupe 2 (suggest): JQL text search on the exception type + 3 rarest skeleton tokens, restricted to Bugs updated in the last 90 days. Shown as "Possible duplicate", never auto-linked.
- Create (user-confirmed, `asUser`): Bug with summary `[ShipProof] <failedStep> – <exception>`, an ADF description (error, step, frequency, first/last seen, build links, environment, affected stories), label `sp-sig-<hash>`, and links "relates to" each affected story.
- Maintenance clusters: "Create task" goes to a *Test maintenance* task (assignee configurable in settings).

### 6.5 Readiness + confidence (F8)

**Readiness (product risk), start at 100:**

| Factor | Deduction | Cap |
|---|---|---|
| Open bug Highest/High in fix version | −15 each | −45 |
| Open bug Medium | −5 each | −20 |
| Story with latest **product-defect** failure | −12 each | −48 |
| Product-defect cluster with **no linked bug** ("untracked failure") | −5 each | −15 |
| Story with **no evidence** (types excluded in settings, e.g. Spike) | −3 each | −15 |
| Open PR linked to an issue in the release (Teamwork Graph, F12) | −2 each | −10 |
| Issue reopened (Done → earlier status) | −2 each | −10 |
| Issue not Done | −1 each | −10 |

**Evidence confidence (0–100%):** the average across stories with evidence of
`trusted / total` scenarios, where *trusted* = latest result passed or product-defect-failed, and **not** flaky, environment, maintenance, skipped or stale (latest run older than 72 h, configurable).

**Verdict:**
- **Ready:** readiness ≥ 80 **and** confidence ≥ 70%
- **At risk:** readiness 60–79, **or** readiness ≥ 80 with confidence < 70% ("low evidence confidence")
- **Not ready:** readiness < 60

`computeReadiness(input, weights)` and `computeConfidence(input, opts)` are pure functions with exhaustive tests. Every deduction becomes a factor row `{factor, points, issueKeys[], explanation}`.

### 6.6 Rovo agent + actions (F9, F14) and MCP (F10)

**Agent:** *ShipProof Triage Agent*
**Conversation starters:** "Why did last night's run fail?" · "Can we ship <version>?" · "What's failing for <issue>?" · "Which acceptance criteria of <issue> have no tests?"

**Prompt rules (`prompts/agent.md`):**
- You are a senior SDET.
- Always call an action before answering. Never invent results, counts or keys.
- Report categories with their emoji and the rule id.
- For go/no-go, give: readiness, confidence, verdict, top 3 deductions, one-line recommendation.
- For unclassified clusters, propose a likely category with reasoning but label it "suggestion".
- Gherkin drafts: ≥ 1 scenario per AC plus negative/edge cases, tagged with the issue key.
- Never call a write action without explicit user confirmation in chat.

**Actions** (one service layer; the read-only ones are also MCP tools):

| Action key | Verb | Inputs | Returns | MCP tool |
|---|---|---|---|---|
| `get-latest-triage` | GET | projectKey, runId? | clusters grouped by category | ✅ |
| `get-issue-evidence` | GET | issueKey | scenarios, categories, history, linked bugs | ✅ |
| `get-release-readiness` | GET | projectKey, fixVersion | readiness, confidence, verdict, factors | ✅ |
| `list-failure-clusters` | GET | projectKey, category?, sinceDays=7 | clusters | ✅ |
| `get-issue-context` | GET | issueKey | summary, extracted ACs, mapped scenarios | ✅ |
| `create-bug-from-cluster` | CREATE | projectKey, signature | bug key/url | ❌ (agent only, confirm) |
| `add-issue-comment` | CREATE | issueKey, body | comment url | ❌ (agent only, confirm) |

Writes are deliberately **not** exposed over MCP. This is a security talking point for the MCP bonus write-up.

**MCP notes (verified):** at most one `rovo:mcp` module per app · `name` ≤ 30 chars · `tools` = action keys (≤ 50) · tools run with the invoking user's permissions · external exposure is **off by default**: admin enables it in *Atlassian Administration → Apps → Sites → <site> → Connected apps → ShipProof*. Endpoint: `https://mcp.atlassian.com/forge/<appId>` (OAuth 2.1 consent). Ship `docs/skill.md` describing the tools for third-party agents.

**AC extraction:** the section under a line matching `/acceptance criteria|^ACs?\b/i` until the next heading. Each bullet / numbered / Given-When-Then block = 1 AC. If there's no section, fall back to the description and flag it.

### 6.7 Teamwork Graph (F12)
- Consume via `api.asUser().requestTeamworkGraph(...)`. The Teamwork Graph API supports **asUser only**. Apps **can't send raw Cypher** and must use **persisted queries** with an operation name.
- Query per release issue: linked external builds, deployments and pull requests. Use for the "open PR" factor and an informational "deployed to staging?" column.
- **Phase 0 spike (1 day):** confirm API access on the dev site (it's EAP/Preview; register for the EAP if required) and that GitHub/Bitbucket links exist in the demo project. **If the spike fails, drop F12** and remove that factor (weight 0). Nothing else depends on it.
- F17 stretch: a `graph:connector` pushing `atlassian:build` objects with `testInfo`. Caveats: Build/Test association to Jira work items isn't documented in the relationship table, Build/Test types are **not** indexed in Rovo Search/Chat, and an admin must connect the connector. Attempt it only if everything else is done.

### 6.8 Report export (F13)
Markdown with: header (project, version, date, readiness, confidence, verdict), factor table, triage summary by category, untracked product defects, stories without evidence. Two buttons: **Download .md** and **Post to release issue** (comment, confirm).

---

## 7. Architecture

### 7.1 Decisions
| Decision | Choice | Why |
|---|---|---|
| Atlassian apps | **Jira only** | Avoids multi-app Preview, the paid-only Marketplace rule for multi-app, and MCP storage-context issues |
| UI | **UI Kit** (`@forge/react`) | Native look (Design criterion), fastest to build, no Custom UI bundle |
| AI | **Rovo agent only** | No Forge LLM billing/credits. AI explains; code decides. |
| Storage | **Forge KVS + Custom Entities** (clusters, runs indexed by project/time) | KVS value ≤ 240 KiB; 25 ops per transaction |
| Heavy work | **Async events queue** consumer (`timeoutSeconds` up to 900) | Web trigger/action limit is 55 s |
| Runtime | Node 22 Forge runtime (confirm in `forge create` template) | |
| Egress | **None** | Runs on Atlassian + trust story |

### 7.2 Diagram
```
CI (Jenkins / ADO / GH Actions)
  └─ shipproof-upload.mjs ── POST ──► webtrigger: ingest (≤55 s: validate, store raw, enqueue)
                                             │
                                             ▼
                                async queue consumer: triage (normalise → classify → flaky → cluster → dedupe JQL)
                                             │
                                             ▼
                               Forge KVS + Custom Entities  ◄── settings, overrides, rules
                                             ▲
  ┌──────────────────┬────────────────────┬──┴────────────────┬──────────────────────┐
  │ jira:issuePanel  │ jira:projectPage   │ rovo:agent +      │ rovo:mcp             │
  │ (evidence)       │ (triage+readiness) │ actions (R + W)   │ (read-only actions)  │
  └────────┬─────────┴─────────┬──────────┴─────────┬─────────┴──────────┬───────────┘
           └─────────── src/services: triage · readiness · evidence · acParser · report ─┘
                                             │
                     Jira REST (asUser for reads/writes users see) · Teamwork Graph (asUser)
```

### 7.3 Manifest sketch
`rovo:mcp` and `action` are verified against the docs. Generate the others with `forge module add` and keep whatever field names the CLI produces.
```yaml
modules:
  webtrigger:
    - key: ingest
      function: ingest-fn
      response: { type: dynamic }
  consumer:
    - key: triage-consumer
      queue: triage-queue
      function: triage-fn
  jira:issuePanel:
    - key: sp-panel
      resource: panel
      resolver: { function: resolver-fn }
      render: native
      title: ShipProof
      icon: resource:static;icon.svg
  jira:projectPage:
    - key: sp-project
      resource: project
      resolver: { function: resolver-fn }
      render: native
      title: ShipProof
  jira:adminPage:
    - key: sp-settings
      resource: settings
      resolver: { function: resolver-fn }
      render: native
      title: ShipProof settings
  rovo:agent:
    - key: sp-agent
      name: ShipProof Triage Agent
      prompt: resource:prompts;agent.md
      conversationStarters:
        - Why did last night's run fail?
        - Can we ship 2.4.0?
      actions: [get-latest-triage, get-issue-evidence, get-release-readiness,
                list-failure-clusters, get-issue-context,
                create-bug-from-cluster, add-issue-comment]
  rovo:mcp:
    - key: sp-mcp
      name: ShipProof
      tools: [get-latest-triage, get-issue-evidence, get-release-readiness,
              list-failure-clusters, get-issue-context]
  action:
    - key: get-release-readiness
      name: Get release readiness
      function: action-fn
      actionVerb: GET
      description: Readiness score, evidence confidence, verdict and factors for a Jira fix version
      inputs:
        projectKey: { title: Project key, type: string, required: true, description: Jira project key }
        fixVersion: { title: Fix version, type: string, required: true, description: Version name }
    # …one entry per action in §6.6
  scheduledTrigger:
    - key: purge
      function: purge-fn
      interval: day
  function:
    - { key: ingest-fn,   handler: index.ingest }
    - { key: triage-fn,   handler: index.triage, timeoutSeconds: 300 }
    - { key: resolver-fn, handler: index.resolver }
    - { key: action-fn,   handler: index.action }
    - { key: purge-fn,    handler: index.purge }
permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - read:jira-user
    - storage:app
    # + Teamwork Graph scope per the TWG docs (F12)
```

### 7.4 Data model
| Store | Key / entity | Shape |
|---|---|---|
| KVS | `settings` | tokenHash, weights, retentionDays, staleHours, excludedTypes, maintenanceAssignee, customRules[] |
| Entity `run` | runId · idx (projectKey, startedAt) | source, buildId, buildUrl, pipeline, branch, commit, environment, totals, unmappedCount, status (queued/triaged) |
| KVS | `res:<issueKey>` | `{ [scenarioId]: { name, suite, history: [{runId, status, category?, signature?, durationMs, at}] (≤10) } }` |
| Entity `cluster` | `<projectKey>:<signature>` · idx (projectKey, lastSeen), (projectKey, category) | category, ruleId, override?, flaky, skeleton, failedStep, count, firstSeen, lastSeen, issueKeys[], scenarioIds[], bugKey?, sampleError |
| KVS | `raw:<runId>:<part>` | raw payload part (deleted after triage) |
| KVS | `demo` | created issue keys/version id for clean removal |

### 7.5 Repository layout
```
shipproof/
├─ manifest.yml
├─ CLAUDE.md
├─ docs/  PRD.md · skill.md · architecture.png · bonus-writeups.md
├─ prompts/agent.md
├─ src/
│  ├─ index.ts
│  ├─ ingest/            webtrigger + schema (zod)
│  ├─ triage/            consumer entry
│  ├─ services/
│  │  ├─ triage/         normalise.ts · signature.ts · rules.ts · classify.ts · flaky.ts · cluster.ts
│  │  ├─ readiness.ts    computeReadiness · computeConfidence (pure)
│  │  ├─ evidence.ts · acParser.ts · report.ts · dedupe.ts
│  │  ├─ jira.ts · twg.ts
│  │  └─ demo.ts
│  ├─ storage/           kvs + entities repo
│  ├─ resolvers/ · actions/
│  └─ frontend/          panel.tsx · project.tsx (Triage | Readiness tabs) · settings.tsx
├─ ci/  shipproof-upload.mjs · README.md · samples/{cucumber.json, junit.xml, playwright.json}
├─ demo/ runs/*.json (5 nightly runs, ~300 results, realistic errors)
└─ test/ fixtures/failures.yaml (≥120 labelled messages) · *.test.ts
```

---

## 8. Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | Ingest ACK < 3 s · triage < 30 s per 500 results · panel < 1.5 s · readiness < 8 s for 100 issues (paginate JQL `/search/jql`) |
| Limits | Web trigger/action 55 s · KVS value 240 KiB · 25 ops per transaction · payload ≤ 200 KB per part |
| Security | Hashed token, constant-time compare, rotate · zod validation · never log tokens or raw payloads · writes only after confirmation · MCP read-only |
| Permissions | User-facing reads via `asUser()` so users only see issues they can access. Ingest/triage run as app. |
| Privacy | Store test metadata + truncated errors only · retention 30 days default · demo data removable |
| Accessibility | UI Kit only · category = emoji + text label + lozenge (never colour alone) |
| Reliability | Idempotent per (projectKey, source, buildId) · queue retries with backoff on 429 |

---

## 9. Quality plan (this is your edge: show it)
| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | normalise, signature stability, every rule, flaky, cluster merge, readiness/confidence edge cases, AC parser. ≥ 90% coverage of `services/` |
| **Classifier corpus** | Vitest table tests | `test/fixtures/failures.yaml`: ≥ 120 real-world messages (Selenium Java, Playwright TS, Cypress, RestAssured, JUnit5/TestNG/AssertJ, Cucumber), each labelled. CI fails if accuracy < 90%. **Publish the accuracy number in the README and video.** |
| Contract | Vitest | ingest 202/400/401/413, idempotency, chunking |
| Manifest | Vitest | every action key referenced by agent/MCP exists; every function handler exported |
| E2E | Playwright + `forge tunnel` | load demo workspace → panel, triage board, readiness values match expected |
| Agent eval | `docs/agent-eval.md` | 15 prompts with expected grounded facts; no hallucinated keys; confirmation before writes |
| Install test | Second dev site (or swap with another participant) | Install link + README steps work cold |

---

## 10. Plan (today Tue Nov 24 → submit Sun Dec 20)

| Phase | Dates (IST) | Deliverables | Exit criteria |
|---|---|---|---|
| 0. Setup + spikes | Nov 24–26 | Devpost registration · **Forge demo site with Rovo** (`npm i -g @forge/cli@latest` → `forge login` → `forge site provision`; free, 90 days. The free developer bundle site has no Rovo.) · **verify Rovo chat + agents are visible** · install Forge AI Plugin / Forge MCP server for Claude Code · `forge create` · repo + CLAUDE.md · **spikes:** async queue, `rovo:mcp` hello world, Teamwork Graph API access | Hello-world agent answers in Rovo chat; MCP tool callable; TWG go/no-go decided |
| 1. Ingest | Nov 27–29 | F1–F3, uploader + 3 CI snippets, storage repo | Sample runs ingested via curl and uploader |
| 2. Triage engine | Nov 30–Dec 3 | F4 + corpus ≥ 120 + F5 dedupe/create | Corpus accuracy ≥ 90%; 5 runs → stable clusters |
| 3. Jira UI | Dec 4–7 | F6 panel, F7 triage board, F11 settings + **demo workspace** | Fresh site: demo loads in < 3 min |
| 4. Readiness | Dec 8–10 | F8 + readiness tab + F13 export; F12 if spike passed | Scores match hand calculations in tests |
| 5. Agent + MCP | Dec 11–14 | F9, F10, F14, skill.md, agent eval | 15/15 eval prompts grounded; MCP call from Claude Code works |
| 6. Polish + Marketplace | Dec 15–17 | Empty/error/loading states, icon, copy, F15 listing submission (privacy policy page, screenshots) | Review ticket link obtained |
| 7. Video + submit | Dec 18–20 | Video, Devpost page, bonus write-ups, install-link cold test | **Submitted Dec 20** |
| Buffer | Dec 21–22 | Fixes only, no new features | — |

---

## 11. Submission checklist (from the official rules)
- [ ] Forge app (manifest + ≥ 1 module), created after Oct 27, 2026, integrating Jira + Rovo (+ Teamwork Graph)
- [ ] **Installation link** (Developer Console → Distribution → "Start sharing your app"), tested cold on a second site
- [ ] **Public YouTube video < 5 min**: working app end to end, problem/audience/why, **plus each bonus's specifics**. No copyrighted music or unlicensed trademarks.
- [ ] Complete setup instructions incl. "Load demo workspace", token, uploader, enabling MCP exposure
- [ ] Text description of features
- [ ] How it meets the technology requirement
- [ ] Category: Apps for Software Teams
- [ ] Bonus write-ups (one each): Best Agents · Atlassian MCP · Teamwork Graph (if F12 shipped) · Marketplace (listing or review-ticket link)
- [ ] All materials in English
- [ ] Repo link, README with architecture image, classifier accuracy, test count

### Judging map (5 criteria, 20% each)
| Criterion | What judges look for | ShipProof evidence |
|---|---|---|
| Technological implementation | Working, non-trivial, not a wrapper or hardcoded path | Async pipeline, rule engine + corpus, two scores, shared service layer for UI/Rovo/MCP, idempotent ingest, test suite |
| Design | Complete, coherent product, not a PoC | Native UI Kit, demo workspace onboarding, empty/error states, consistent category language |
| Potential impact | Credible, specific problem + audience | Every team with CI + Jira; morning-triage hours saved; a go/no-go you can explain |
| Innovation | Differs from existing ideas | Failure taxonomy + noise-free readiness × confidence. §2 shows the gap vs Testream/Xray/other entries. |
| Presentation | Video shows it working end to end with a clear pitch | Script §12 |

---

## 12. Demo video script (4:40)
1. **0:00–0:25 Hook:** a red nightly run with 37 failures. "Which of these should stop the release?"
2. **0:25–0:50 Who/why:** "I'm an automation engineer. This is my morning, every morning."
3. **0:50–1:40 Triage board:** 37 failures → 6 clusters: 2 🐞, 2 🔧 locator breaks, 1 🌩 staging 503, 1 🎲. Open a 🐞 cluster → "Create bug" → evidence-filled Jira bug. The next run adds 4 more hits to the same cluster and no new bug.
4. **1:40–2:15 Issue panel:** PROJ-12, history strip, category badges, linked bug.
5. **2:15–3:00 Readiness:** 2.4.0 → readiness 84 but confidence 52% → **At risk**. Fix the env + rerun → confidence 88% → Ready. *This is the "aha" moment.*
6. **3:00–3:50 Rovo agent:** "Why did last night's run fail?" → "Can we ship 2.4.0?" → "Which ACs of PROJ-20 have no tests?" → draft Gherkin → confirm comment.
7. **3:50–4:20 MCP:** Claude Code in the terminal: "what's failing for PROJ-12?" → ShipProof tool answer. Mention read-only by design.
8. **4:20–4:40 Close:** Runs on Atlassian, no external backend, X tests, 9X% classifier accuracy, Marketplace submitted. "ShipProof: proof before you ship."

---

## 13. Risks and mitigations
| Risk | Likelihood | Mitigation |
|---|---|---|
| Rovo doesn't appear on the free developer site (confirmed by other participants) | High | Use `forge site provision` (Forge demo site includes Rovo) from day 0. Don't pay for a Standard trial. |
| Accidental paid usage | Low | No Forge LLM (always billed, no free tier), no Rovo Dev. Forge functions/KVS stay inside the free monthly allowance. |
| `rovo:mcp` is Preview, so the external client connection may be flaky | Med | Demo the tools inside Rovo Studio first; external client is a bonus moment |
| Teamwork Graph API access / persisted queries friction | Med-High | Day-0 spike; F12 is optional with zero coupling |
| Classifier mislabels | Med | Corpus + accuracy gate, ❓ Unclassified bucket, user override, agent suggestions |
| Forge limits (55 s, 240 KiB) | Low | Queue consumer, rolling history, chunked uploads |
| Judges can't produce CI data | High if ignored | Demo workspace (US-7) |
| Name confusion with "ShipReady" entry | Low | Distinct tagline + triage-first positioning (optional rename: "RedRoot", "TriageProof") |
| Solo time pressure | High | Phase exits; cut list §6.1; no new features after Dec 17 |

---

## 14. Claude Code build kit

### 14.1 Before coding
1. Install the **Forge AI Plugin / Forge MCP Server** for Claude Code. It gives up-to-date Forge docs, manifest syntax and UI Kit guides. Atlassian publishes it for AI coding agents.
2. Put this file at `docs/PRD.md`.

### 14.2 `CLAUDE.md`
```markdown
# ShipProof – Claude Code guide
- Source of truth: docs/PRD.md. Work phase by phase (§10). Don't start a phase until the previous exit criteria pass.
- Stack: Forge (Jira only), TypeScript, UI Kit (@forge/react), @forge/api, @forge/kvs, @forge/events, zod, vitest.
- ALWAYS check Forge module/API syntax with the Forge MCP server/docs before writing manifest or API code. Never rely on memory: Rovo, rovo:mcp and Teamwork Graph change often.
- Business logic = pure functions in src/services with unit tests. Resolvers/actions/consumers are thin adapters.
- No Forge LLM (@forge/llm is always billed). No external egress. No logging of tokens or raw payloads.
- Dev site = the Forge demo site from `forge site provision` (it has Rovo). Install with `forge install --site <demo-site>`.
- Write actions require user confirmation and are NOT exposed via rovo:mcp.
- Before each commit: npm test, forge lint. Deploy: forge deploy -e development && forge install --upgrade.
```

### 14.3 Phase prompts
- **P0:** "Read docs/PRD.md. Scaffold the Jira-only Forge app per §7.3/§7.5 with TypeScript, zod, vitest. Add a hello-world Rovo agent, one GET action, and a rovo:mcp module exposing it. Add an async queue + consumer that logs. Deploy and give me the verification steps."
- **P1:** "Implement §6.2: ingest webtrigger (token hash, zod, 200 KB limit, idempotency, enqueue) and ci/shipproof-upload.mjs for Cucumber JSON, JUnit XML, Playwright JSON with chunking. Add sample reports, CI snippets and contract tests."
- **P2:** "Implement the triage engine per §6.3 as pure functions, then the consumer that clusters into Custom Entities. Build test/fixtures/failures.yaml with ≥120 realistic labelled failure messages across Selenium, Playwright, Cypress, RestAssured, JUnit/TestNG/AssertJ and Cucumber. Fail the test run if accuracy < 90%. Then implement §6.4 dedupe + create bug."
- **P3:** "Build the issue panel, project page (Triage board tab) and admin settings in UI Kit per US-2/US-3/US-7, including Load/Remove demo workspace using demo/runs."
- **P4:** "Implement computeReadiness and computeConfidence per §6.5 with exhaustive tests, the Readiness tab, and the Markdown report export per §6.8. If the TWG spike passed, add src/services/twg.ts per §6.7."
- **P5:** "Implement all actions in §6.6, the agent prompt, the MCP tool list (read-only only), docs/skill.md and docs/agent-eval.md. Add the manifest consistency test."
- **P6:** "Polish: empty/loading/error states everywhere, copy review, icon. Write README (setup for judges, architecture, accuracy, test count) and docs/bonus-writeups.md."

---

## Appendix A: verified facts and sources (checked Nov 24, 2026)
| Fact | Source |
|---|---|
| Deadline Dec 22 2026 12:00 PM PT; categories; prizes $15K/$8K/$5K; bonus $1,500 × 6 in 4 areas | codegeist2026.devpost.com, /rules |
| Judging: Tech implementation, Design, Impact, Innovation, Presentation (equal); "not a shallow wrapper or hardcoded demo path" | codegeist2026.devpost.com |
| Submission: install link, public YouTube < 5 min incl. bonus specifics, setup steps, tech explanation, category + bonus write-ups, English | codegeist2026.devpost.com/rules |
| Best Agents = rovo:agent / agentConnector / reusable skill+action; MCP = rovo:mcp; TWG = push and/or consume; Marketplace = listed or submitted with ticket | codegeist2026.devpost.com/rules |
| Forge LLM off by default, billed, no credits; Rovo recommended | codegeist2026.devpost.com |
| rovo:mcp: one per app, name ≤ 30 chars, tools = action keys ≤ 50, user permissions, admin enables external exposure, endpoint mcp.atlassian.com/forge/<appId>, OAuth 2.1, Preview | developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp |
| Web trigger/action runtime 55 s; async/scheduled up to 900 s | developer.atlassian.com/platform/forge/limits-invocation |
| KVS value 240 KiB; 25 ops per transaction | developer.atlassian.com/platform/forge/limits-kvs-ce |
| TWG API: asUser only; persisted queries (no raw Cypher); EAP/Preview | Forge docs + developer community threads |
| TWG connector object types incl. Build (`testInfo`), Test, Test run; Build/Test not indexed in Rovo Search/Chat | developer.atlassian.com/platform/teamwork-graph |
| Multi-app compatibility Preview; Marketplace multi-app listings must be paid | developer.atlassian.com/platform/forge/app-compatibility, migrating-…-multiple-atlassian-apps |
| Competitors: Testream, Release Readiness for Jira, Xray, AssertThat, Cucumber for Jira | marketplace.atlassian.com |
| Other 2026 entries: ShipReady, Precedent, Groundwork, TracePilot AI, Bastion, Gatekeeper | GitHub / Devpost / dev.to / developer community |
| Past winners favour focused, polished apps solving real problems (2025 Software Teams 1st: Secure Notes for Jira) | atlassian.com/blog, gocapable.com |
