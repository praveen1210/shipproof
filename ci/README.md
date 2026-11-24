# ShipProof CI uploader

`shipproof-upload.mjs` parses your test report **in CI**, maps results to Jira issue keys and posts a compact summary to ShipProof. Node 20+, one dependency (`fast-xml-parser`, JUnit only).

| Format | Flag | Issue keys come from |
|---|---|---|
| Cucumber JSON | `--format cucumber` | `@PROJ-123` tags on the feature or scenario, or `PROJ-123` in the scenario name |
| JUnit XML | `--format junit` | `<property name="issue" value="PROJ-123"/>` on the test case or suite, or `[PROJ-123]` in the test name |
| Playwright JSON | `--format playwright` | `@PROJ-123` tags, `test.info().annotations.push({ type: 'issue', description: 'PROJ-123' })`, or the title |

The format is auto-detected when `--format` is omitted. Only keys of `--project` are mapped. Results with no key are stored as **Unmapped** and counted on the triage board.

**Secrets:** set `SHIPPROOF_URL` (shown in Jira → Apps → ShipProof settings) and `SHIPPROOF_TOKEN` (generated there, shown once) as CI secrets.
**Never breaks your build:** upload errors are printed and the script exits 0. Set `SHIPPROOF_STRICT=1` to fail instead.
**Large runs** are split into parts of ≤ 190 KB under one run id. Re-uploading the same build replaces the run (idempotent per project + source + build id).

```bash
node shipproof-upload.mjs --file target/cucumber.json --project PROJ --dry-run   # inspect the payload
```

## Jenkins (Jenkinsfile)

```groovy
post {
  always {
    withCredentials([string(credentialsId: 'shipproof-token', variable: 'SHIPPROOF_TOKEN'),
                     string(credentialsId: 'shipproof-url', variable: 'SHIPPROOF_URL')]) {
      sh '''
        npm i --no-save fast-xml-parser
        node ci/shipproof-upload.mjs --file target/cucumber-reports/cucumber.json \
          --project PROJ --source jenkins --build-id "$BUILD_NUMBER" --build-url "$BUILD_URL" \
          --pipeline "$JOB_NAME" --branch "$GIT_BRANCH" --commit "$GIT_COMMIT" --environment staging
      '''
    }
  }
}
```

## Azure Pipelines (azure-pipelines.yml)

```yaml
- script: |
    npm i --no-save fast-xml-parser
    node ci/shipproof-upload.mjs --file $(System.DefaultWorkingDirectory)/test-results/junit.xml \
      --project PROJ --source azure-devops --build-id "$(Build.BuildId)" \
      --build-url "$(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)" \
      --pipeline "$(Build.DefinitionName)" --branch "$(Build.SourceBranchName)" --commit "$(Build.SourceVersion)" \
      --environment staging
  displayName: Upload results to ShipProof
  condition: always()
  env:
    SHIPPROOF_URL: $(SHIPPROOF_URL)
    SHIPPROOF_TOKEN: $(SHIPPROOF_TOKEN)
```

## GitHub Actions

```yaml
- name: Upload results to ShipProof
  if: always()
  env:
    SHIPPROOF_URL: ${{ secrets.SHIPPROOF_URL }}
    SHIPPROOF_TOKEN: ${{ secrets.SHIPPROOF_TOKEN }}
  run: |
    npm i --no-save fast-xml-parser
    node ci/shipproof-upload.mjs --file playwright-report/results.json --project PROJ \
      --source github-actions --build-id "${{ github.run_id }}-${{ github.run_attempt }}" \
      --build-url "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
      --pipeline "${{ github.workflow }}" --branch "${{ github.ref_name }}" --commit "${{ github.sha }}" \
      --environment staging
```

Playwright needs the JSON reporter: `reporter: [['json', { outputFile: 'playwright-report/results.json' }]]`.

## Raw HTTP

```bash
curl -X POST "$SHIPPROOF_URL" -H "Content-Type: application/json" -H "X-ShipProof-Token: $SHIPPROOF_TOKEN" \
  --data @demo/runs/night-5.json
# 202 accepted · 400 invalid JSON or schema · 401 bad token · 405 not POST · 413 over 200 KB · 500 retry later
# Responses are fixed (static web trigger, so ShipProof stays eligible for Runs on Atlassian).
# The run id is sha1("<project>|<source>|<buildId>") (the uploader prints it); schema errors are in `forge logs`.
```
