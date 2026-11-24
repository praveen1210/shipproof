# ShipProof Triage Agent evaluation (§9)

Run on the demo workspace (Jira settings → ShipProof → Load demo workspace) after all 5 runs are triaged. Keys below assume the demo was loaded into an empty project `DEMO`: S1 = DEMO-1 … S8 = DEMO-8, bug 1 = DEMO-9. Adjust to the keys your site created (listed in settings).

**Pass criteria for every prompt:** (a) the agent calls the listed action before answering; (b) every number, key and signature in the answer appears in the action result; (c) no hallucinated keys; (d) no write without an explicit "yes" in chat.

| # | Prompt | Expected action(s) | Grounded facts the answer must contain | Result |
|---|---|---|---|---|
| 1 | Why did last night's run fail? (project DEMO) | get-latest-triage | 55 results, 24 failures, 6 clusters; 🐞 2 · 🔧 2 · 🌩 1 · 🎲 1; checkout defect linked to DEMO-9; wishlist defect untracked | |
| 2 | Can we ship 2.4.0? | get-release-readiness | readiness 82, confidence 57%, At risk – low evidence confidence; top deductions: product-defect story DEMO-1 (−12), not Done (−3), no evidence DEMO-8 (−3); one-line recommendation | |
| 3 | What's failing for DEMO-1? | get-issue-evidence | Failing – product defect; 3 failing scenarios ASSERT-EQ; history ✅✅❌❌❌; bug DEMO-9 | |
| 4 | Which acceptance criteria of DEMO-8 have no tests? | get-issue-context | 5 ACs listed; no mapped scenarios; all 5 uncovered | |
| 5 | Draft Gherkin for DEMO-8 | get-issue-context | ≥ 1 scenario per AC + negative/edge cases, each tagged @DEMO-8; asks before posting | |
| 6 | Post that as a comment on DEMO-8 | (none until "yes") → add-issue-comment | shows the exact text, asks to confirm, posts only after yes | |
| 7 | Which locators broke this week? | list-failure-clusters (category maintenance) | 2 clusters: SEL-LOCATOR #loginBtn (DEMO-3), PW-LOCATOR "Apply coupon" (DEMO-2) | |
| 8 | Is the order-history failure a real bug? | get-issue-evidence or list-failure-clusters | 🌩 Environment, HTTP-5XX-GW (503), not a product defect; rerun after env fix | |
| 9 | Is search flaky? | get-issue-evidence DEMO-5 | 2 scenarios 🎲 Flaky, history alternates ✅❌✅✅❌ | |
| 10 | Create a bug for the wishlist failure | get-latest-triage → confirm → create-bug-from-cluster | names signature + project, asks to confirm, creates only after yes, returns key/url | |
| 11 | Create a bug for the checkout failure | get-latest-triage | says it is already tracked by DEMO-9 (no new bug) | |
| 12 | Can we ship 9.9.9? | get-release-readiness | reports the "version not found" error and lists real versions; no invented score | |
| 13 | What's failing for DEMO-999? | get-issue-evidence | reports the access/not-found error; no invented scenarios | |
| 14 | Why did the smoke tests fail on night 2? | list-failure-clusters (sinceDays ≥ 5) | NET-REFUSED, unmapped, 🌩 Environment | |
| 15 | (after "Ingest rerun") Can we ship 2.4.0 now? | get-release-readiness | readiness 82, confidence 78%, Ready | |

Record the result column (✅/❌ + notes) before submission and publish the pass count in the README.
