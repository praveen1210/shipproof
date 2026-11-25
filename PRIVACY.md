# ShipProof privacy policy

_Last updated: 25 November 2026_

ShipProof is a free Atlassian Forge app for Jira Cloud, built by Praveenkumar as an independent developer. This page explains what data the app handles, where it is stored and for how long.

## Where ShipProof runs and stores data

ShipProof runs entirely on Atlassian's Forge platform ("Runs on Atlassian"). It has **no external backend and makes no network calls outside Atlassian**. All data it stores is kept in Forge storage, hosted by Atlassian in your Atlassian Cloud environment. The developer has no access to your site's data.

## What ShipProof stores

When your CI pipeline sends test results, or when an admin loads the demo workspace, ShipProof stores:

- **Test results:** test and suite names, status (passed/failed/skipped), duration, the failing step, and the failure message truncated to 2,000 characters.
- **Run details:** project key, CI source, build id and URL, pipeline, branch, commit, environment name and start time.
- **Triage data:** failure clusters (error signature, category, counts, first/last seen, affected Jira issue keys, linked bug key).
- **Settings:** a SHA-256 hash of the ingest token (never the token itself), scoring weights, retention period and custom classification rules.

ShipProof **does not store personal data**: it stores no Atlassian account IDs, names or email addresses. Jira issue data (summaries, descriptions, versions) is read at request time with the viewing user's permissions and is not copied into storage. Test failure messages come from your own test suites; avoid putting personal data in them.

## How long data is kept

- Raw uploaded results are deleted after they are processed (and after 2 days at most).
- Runs, per-scenario history and clusters older than the retention period (30 days by default, configurable from 1 to 365 days by a Jira admin) are deleted by a daily job.
- The demo workspace can be removed completely from ShipProof settings.
- When the app is uninstalled, Atlassian removes the app's Forge storage under its Forge data retention policy.

## Writes to Jira

ShipProof only changes Jira when a user asks it to: creating a bug or task from a failure cluster, posting a report or comment, or loading/removing the demo workspace. Each of these runs with that user's permissions. The Rovo agent asks for explicit confirmation in chat before any write, and write actions are never exposed over MCP.

## AI features

The ShipProof Triage Agent runs in Atlassian Rovo. Conversations with it are processed by Atlassian under Atlassian's terms. ShipProof's own classification and scoring are deterministic code: it does not send your data to any AI service of its own.

## Contact

Questions or requests: praveenkumarrmuckpk@gmail.com, or open an issue at https://github.com/praveen1210/shipproof/issues.
