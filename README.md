# ShipProof

**Know *why* your tests failed. Know *if* you can ship.**
CI failure triage and noise-free release evidence for Jira, built on Atlassian Forge, Rovo, MCP and Teamwork Graph. Codegeist 2026 · Apps for Software Teams.

> Red builds tell you something broke. ShipProof tells you what, whose problem it is, and whether it blocks the release.

Every automation team starts the day the same way: the nightly run is red and someone spends an hour or two working out which failures are **real product bugs** and which are **broken locators, a dead environment or flaky tests**. ShipProof does that triage inside Jira, deterministically and explainably:

1. **Ingest:** one CI step posts Cucumber, JUnit or Playwright results (Jenkins, Azure DevOps, GitHub Actions).
2. **Triage:** a signature rule engine clusters failures and classifies each cluster: 🐞 Product defect · 🔧 Test maintenance · 🌩 Environment · 🎲 Flaky · ❓ Unclassified. Each cluster is linked to an existing bug by its `sp-sig-<hash>` label, or turned into one in a click with all evidence prefilled. Five nights of the same failure = **1 cluster, 1 bug**.
3. **Decide:** a **Release readiness** score per fix version that counts only real product risk, next to an **Evidence confidence** score that says how far to trust the tests. 100% green with 40% confidence is *not* ready.
4. **Ask:** the **ShipProof Triage Agent** in Rovo answers "Why did last night's run fail?", "Can we ship 2.4.0?", "Which ACs of PROJ-20 have no tests?", always by calling an action first.
5. **Everywhere:** the read-only actions are **MCP tools**, so Claude Code or Cursor can ask "what's failing for PROJ-12?" from the IDE.

**Deterministic core, AI on top.** Code decides the classification and the scores; Rovo explains and drafts. No Forge LLM, no external backend, no egress: `forge eligibility` is the check for **Runs on Atlassian**.

## Quality numbers

| | |
|---|---|
| Unit, contract, pipeline and manifest tests | **109 passing** (`npm test`) |
| Coverage of `src/services` + `src/ingest` | **97.9 % lines** (gate: 90 %) |
| Classifier, labelled corpus (153 real-world messages: Selenium, Playwright, Cypress, RestAssured, JUnit/TestNG/AssertJ/Hamcrest, Jest/Mocha, Cucumber, CI infra) | **100 %** (gate: 90 %). The rules were tuned on this set, so treat it as a regression gate, not a real-world estimate. |
| Classifier, **hold-out** set (32 messages written after tuning, never used to tune) | **75 % correct, 0 % wrong**: every miss falls into ❓ Unclassified (pytest, Karate, WebdriverIO phrasings), none into a wrong category. |
| Demo pipeline test | 5 nights → 275 results → night 5: 24 failures in 6 clusters (2 🐞, 2 🔧, 1 🌩, 1 🎲); release 2.4.0 readiness 82 / confidence 57 % → **At risk**, after the env-fixed rerun 82 / 78 % → **Ready** |

## Try it in 3 minutes (judges)

1. Install ShipProof from the installation link on your Jira Cloud site.
2. Jira → **Settings → Apps → Manage apps → ShipProof settings** (if the page stays blank on the very first open of a new install, reload it once) → *Demo workspace* → pick an (ideally empty) project → **Load demo workspace**. It creates 8 stories, 2 bugs and fix version **2.4.0** as you, then ingests 5 nightly runs through the same queue CI uses. Wait for "Runs triaged: 5/5" (~30 s).
3. Open the project's **ShipProof** page. Jira doesn't always show app pages in a project's tabs: if there's no **ShipProof** tab, click **+** at the end of the tabs → **Apps → ShipProof → Add to navigation**. On some sites (e.g. new Free-plan sites) that menu has no Apps section: open `https://<your-site>.atlassian.net/jira/software/projects/<KEY>/apps/` followed by the app path from **Settings → Apps → Manage apps → ShipProof settings** (the same two ids), and the tab appears after the first visit. The page has two tabs:
   - **Triage board**: 24 failures → 6 clusters. The checkout 🐞 cluster is already linked to the demo bug through its signature label; the wishlist 🐞 cluster is untracked → **Create bug** (evidence-filled bug, linked to the story). Maintenance clusters offer **Create task**; any cluster can be **reclassified**, and future failures with that signature inherit it.
   - **Release readiness** → 2.4.0: readiness 82, confidence 57 % → *At risk – low evidence confidence*. Every deduction is listed with its issues. *Show Markdown report* / *Post to release issue*.
4. Open the checkout story and click the apps icon under its title → **ShipProof** to add the issue panel. It shows "Failing – product defect", the category per scenario, a 10-run history strip, durations, build links and the linked bug. Open the gift-card story: "No test evidence".
5. Back in settings → **Ingest rerun (environment fixed)** → reopen Release readiness for 2.4.0: confidence 78 % → **Ready**. *This is the point: the release didn't change, the trust in its evidence did.*
6. Rovo chat → **ShipProof Triage Agent** → "Why did last night's run fail?", "Can we ship 2.4.0?", "Which acceptance criteria of <gift-card key> have no tests?", "Draft Gherkin for it" → confirm → posted as a comment.
7. **Remove demo workspace** deletes everything it created (after confirmation). Deleting the issues needs the **Delete issues** project permission, which a new project's default scheme may not give even to a site admin. Without it, ShipProof still removes all of its own data, takes the issues out of the demo version, and lists the issues Jira kept so you can delete them yourself.

If your project's create screen has no Priority field, the demo bug gets the default priority (usually Medium, −5) and readiness shows 77 → plain *At risk*.

## Connect your CI

Settings → *CI ingest* → **Generate token** (shown once, stored as a SHA-256 hash). Then add one step after your tests; full Jenkins, Azure Pipelines and GitHub Actions snippets are in [ci/README.md](ci/README.md):

```bash
npm i --no-save fast-xml-parser
SHIPPROOF_URL=… SHIPPROOF_TOKEN=… node ci/shipproof-upload.mjs --file target/cucumber.json \
  --project PROJ --build-id "$BUILD_NUMBER" --build-url "$BUILD_URL" --environment staging
```

Map tests to issues with `@PROJ-123` tags, `[PROJ-123]` in names or a JUnit `<property name="issue">`.

## MCP (IDE agents)

A site admin enables external exposure in *Atlassian Administration → Apps → Sites → <site> → Connected apps → ShipProof*. Endpoint `https://mcp.atlassian.com/forge/<appId>` (OAuth 2.1). Tools: `get-latest-triage`, `get-issue-evidence`, `get-release-readiness`, `list-failure-clusters`, `get-issue-context`. **Read-only by design**: bug creation and comments exist only in the Rovo agent, behind explicit confirmation. See [docs/skill.md](docs/skill.md).

## How it works

```
CI (Jenkins / ADO / GH Actions)
  └─ shipproof-upload.mjs ── POST ──► webtrigger: ingest (validate, token check, store raw part, enqueue; < 3 s)
                                             │  async events queue (one consumer per project at a time)
                                             ▼
                              consumer: triage (normalise → signature → classify → flaky → cluster → dedupe JQL)
                                             ▼
                          Forge KVS (settings, per-issue history) + Custom Entities (runs, clusters)
                                             ▲
  ┌──────────────────┬────────────────────┬──┴────────────────┬──────────────────────┐
  │ jira:issuePanel  │ jira:projectPage   │ rovo:agent +      │ rovo:mcp             │
  │ (evidence)       │ (triage+readiness) │ actions (R + W)   │ (read-only actions)  │
  └────────┬─────────┴─────────┬──────────┴─────────┬─────────┴──────────┬───────────┘
           └──────── src/services/app.ts: one service layer for UI, agent and MCP ───┘
                                             │
                  Jira REST as the user (asUser) · Teamwork Graph (asUser, optional)
```

- **Triage engine** (`src/services/triage/`, pure functions): normalisation strips timestamps, UUIDs, hex ids, ports, paths, big numbers and quoted data while keeping locators; 33 ordered rules (first match wins; custom rules from settings run first); flaky = pass rate 20–90 % over the last 10 runs **with ≥ 2 pass/fail flips** and failed last (so a fresh regression `PPPPPPPPPF` is not mistaken for flakiness); clusters store per-run counts, so re-uploading a build is idempotent.
- **Readiness** (`src/services/readiness.ts`): starts at 100, capped deductions (High bugs −15, Medium bugs −5, stories with a product-defect failure −12, untracked product clusters −5, stories without evidence −3, open PRs via Teamwork Graph −2, reopened −2, not Done −1). **Confidence** = mean over stories of trusted/total scenarios, where trusted = latest result passed or failed as a product defect, and not flaky/environment/maintenance/skipped/stale (72 h).
- **Runs on Atlassian:** the ingest web trigger is **static**: it can only return one of 7 fixed responses declared in the manifest (202/400/401/405/413/500), so nothing stored can leave through it. Validation details go to `forge logs`; the uploader computes the run id itself.
- **Security:** hashed token, constant-time compare, rotate any time; zod validation; 200 KB limit; tokens and payloads are never logged; UI resolvers take issue/project keys from the module context, not the payload; settings and demo actions need the admin page **and** Jira admin permission; actions check the user's access before returning stored data; MCP is read-only.
- **Privacy:** no personal data is stored (no account IDs, names or emails); only test names, statuses, durations and truncated errors; runs older than the retention (30 days) are purged daily; demo data is removable. See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## Develop

```bash
npm install
npm test            # vitest: 109 tests incl. classifier corpus gate
npm run typecheck
npm run demo:generate PROJ   # demo/runs/*.json for curl / uploader tests

npm i -g @forge/cli@latest && forge login
forge register      # writes the real app id into manifest.yml
forge lint
forge deploy -e development
forge install --site <your-site>.atlassian.net --product jira
```

Use a Forge demo site (`forge site provision`): it includes Rovo. Details and phase plan: [docs/PRD.md](docs/PRD.md). Agent evaluation script: [docs/agent-eval.md](docs/agent-eval.md). Bonus write-ups: [docs/bonus-writeups.md](docs/bonus-writeups.md).

## Status

**Verified on a live Jira Cloud site** (development environment, Nov 2026): `forge lint` clean; deployed; `forge eligibility` → **eligible for Runs on Atlassian**; demo workspace load (5 runs triaged through the real queue); triage board (24 → 6 clusters, automatic link to the labelled demo bug); Create bug and Create task (labelled, linked, evidence-filled); reclassify and undo (readiness 82 → 65 → 82); issue panel; release readiness 82 / 57 % *At risk* → rerun → 82 / 78 % **Ready**; Markdown report and posting it as a Jira comment; Rovo agent ("Can we ship 2.4.0?", AC coverage, Gherkin draft that asks before posting).

Not verified yet:
- MCP from an external client (needs a site admin to enable exposure), the CI uploader against the live web trigger with a real token, and the daily purge.
- Teamwork Graph (F12): `src/services/twg.ts` is wired into readiness but **off by default** (`twgEnabled`). The persisted-query name and TWG scope must be confirmed in the Phase 0 spike; if access isn't available the factor is simply absent.
- The report is shown as Markdown (copy from the code block) and posted as a comment; UI Kit has no file-download API, so "Download .md" is copy-to-clipboard.
- E2E (Playwright + `forge tunnel`) is not written yet; the 15-prompt agent eval (docs/agent-eval.md) has been run only partially.
