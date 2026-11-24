import type { Category, CustomRuleConfig, Rule } from '../types';

/**
 * Ordered rule set (§6.3): first match wins. Order matters:
 *   1. Hard environment signals (network, browser/driver death, gateway errors) — these
 *      explain any symptom that follows them, e.g. "locator.click: Target closed".
 *   2. Test maintenance (locators, stale DOM, undefined steps).
 *   3. Global timeouts with no locator context (environment).
 *   4. Product assertions.
 * Built from real Selenium, Playwright, Cypress, RestAssured, JUnit/TestNG/AssertJ/Chai and
 * Cucumber failure messages. See test/fixtures/failures.yaml for the labelled corpus.
 */
export const BUILT_IN_RULES: Rule[] = [
  // ── 1. Environment: hard infrastructure signals ─────────────────────────────
  r('DB-CONN', 'environment', /CannotGetJdbcConnection|SQLTransientConnectionException|Communications link failure|too many connections|Connection is not available, request timed out|connection pool|could not connect to server|JDBCConnectionException|Unable to acquire JDBC Connection|FATAL: the database system is starting up|MongoServerSelectionError|Redis connection.*(refused|lost)/i,
    'Database connectivity problem in the test environment.'),
  r('NET-REFUSED', 'environment', /ECONNREFUSED|Connection refused|ERR_CONNECTION_REFUSED|java\.net\.ConnectException|Failed to connect to/i,
    'The target service refused the connection: it was down or not listening on that port.'),
  r('NET-DNS', 'environment', /ENOTFOUND|UnknownHostException|getaddrinfo|ERR_NAME_NOT_RESOLVED|Name or service not known|EAI_AGAIN|nodename nor servname/i,
    'Host name could not be resolved: DNS or environment configuration problem.'),
  r('NET-RESET', 'environment', /ECONNRESET|socket hang up|Connection reset|ERR_CONNECTION_RESET|EPIPE|Broken pipe|ERR_EMPTY_RESPONSE|Unexpected end of file from server/i,
    'The connection was dropped mid-request: unstable network, proxy or a crashing service.'),
  r('NET-TIMEOUT', 'environment', /ETIMEDOUT|ESOCKETTIMEDOUT|SocketTimeoutException|Read timed out|connect timed out|ERR_CONNECTION_TIMED_OUT|ConnectTimeoutException|HttpTimeoutException/i,
    'A network call timed out at socket level: slow or unreachable environment.'),
  r('NET-SSL', 'environment', /SSLHandshakeException|ERR_CERT_|certificate has expired|self[- ]signed certificate|unable to verify the first certificate|PKIX path building failed|ERR_SSL_PROTOCOL_ERROR/i,
    'TLS/certificate problem on the test environment.'),
  r('HTTP-5XX-GW', 'environment', /Bad Gateway|Service Unavailable|Service Temporarily Unavailable|Gateway Time-?out|(?:status|code|response)[^\n]{0,60}\b50[234]\b|\b50[234]\b[^\n]{0,20}(?:Bad Gateway|Service Unavailable|Gateway)/i,
    'Gateway error (502/503/504): the service or a proxy in front of it was unavailable.'),
  r('ENV-RATE-LIMIT', 'environment', /\b429\b[^\n]{0,30}(Too Many|status|code)|(?:status|code)[^\n]{0,40}\b429\b|Too Many Requests|rate limit exceeded/i,
    'Rate limited by the environment (429): shared test environment overloaded.'),
  r('DRV-SESSION', 'environment', /SessionNotCreatedException|session not created|chrome not reachable|DevToolsActivePort|NoSuchSessionException|invalid session id|Could not start a new session|disconnected: not connected to DevTools|unable to discover open (pages|window)|Selenium Grid|No (nodes|slots) (are )?available|Error forwarding the new session|cannot find (Chrome|Firefox) binary|This version of ChromeDriver only supports/i,
    'The WebDriver session/browser could not start or died: grid, driver or browser version problem.'),
  r('PW-BROWSER', 'environment', /browser has been closed|Target (page, context or browser )?(has been )?closed|Browser closed|Executable doesn't exist|browserType\.launch|Protocol error \(Target\.|Page crashed|Navigation failed because page crashed|net::ERR_ABORTED.*frame was detached/i,
    'The Playwright browser/page died or never launched: infrastructure, not the app under test.'),
  r('ENV-RESOURCES', 'environment', /ENOSPC|No space left on device|OutOfMemoryError|JavaScript heap out of memory|ENOMEM|Cannot allocate memory|Too many open files|EMFILE|exit code 137|Killed signal 9/i,
    'The CI agent ran out of disk, memory or file handles.'),
  r('CY-NETWORK', 'environment', /cy\.(visit|request)\(\) failed (trying to load|on)|We attempted to make an http request to this URL but the request failed without a response|The response we received from your web server was:\s*>\s*5\d\d/i,
    'Cypress could not reach the application server.'),

  // ── 2. Test maintenance ───────────────────────────────────────────────────
  r('CUKE-UNDEFINED', 'maintenance', /Undefined step|step is undefined|UndefinedStepException|PendingException|Pending step|TODO: implement me|You can implement (missing )?steps? with the snippets|Step undefined|Undefined\. Implement with the following snippet/i,
    'A Gherkin step has no (or a pending) step definition: the test code needs updating.'),
  r('CUKE-AMBIGUOUS', 'maintenance', /AmbiguousStepDefinitionsException|Ambiguous step definitions|Multiple step definitions match/i,
    'Two step definitions match the same step: the test code needs updating.'),
  r('SEL-LOCATOR', 'maintenance', /NoSuchElementException|Unable to locate element|no such element|NoSuchElementError/i,
    'The locator matched nothing: the UI changed or the selector is wrong.'),
  r('SEL-STALE', 'maintenance', /StaleElementReferenceException|stale element reference|StaleElementReferenceError/i,
    'The element was re-rendered after it was found: the test must re-query or wait properly.'),
  r('SEL-NOTINTERACT', 'maintenance', /ElementNotInteractableException|ElementClickInterceptedException|element not interactable|element click intercepted|is not clickable at point|ElementNotVisibleException|MoveTargetOutOfBoundsException/i,
    'The element exists but could not be interacted with (hidden, covered or off-screen): test synchronisation or locator issue.'),
  r('SEL-INVALID-SELECTOR', 'maintenance', /InvalidSelectorException|invalid selector|is not a valid (XPath expression|selector)|SyntaxError: Failed to execute 'querySelector/i,
    'The selector itself is invalid.'),
  r('SEL-FRAME-WINDOW', 'maintenance', /NoSuchFrameException|NoSuchWindowException|NoAlertPresentException|UnexpectedAlertOpenException|unexpected alert open/i,
    'The test assumed a frame, window or alert that was not there.'),
  r('SEL-WAIT-LOCATOR', 'maintenance', /TimeoutException: Expected condition failed: waiting for (visibility|presence|element|elementToBeClickable|element to be clickable)|Expected condition failed: waiting for (visibility|presence) of/i,
    'An explicit wait for an element expired: the locator no longer matches or the wait is too short.'),
  r('PW-STRICT', 'maintenance', /strict mode violation/i,
    'The Playwright locator matched several elements: make it more specific.'),
  r('PW-LOCATOR-EXPECT', 'maintenance', /(element\(s\) not found|resolved to 0 elements|waiting for locator[^\n]*\n?[^\n]*element\(s\) not found)/i,
    'The locator in an assertion matched no element at all: likely a selector change.'),
  r('PW-DETACHED', 'maintenance', /element is not attached to the DOM|Element is not attached|element was detached from the DOM/i,
    'The element was detached between lookup and action: test synchronisation problem.'),
  r('PW-LOCATOR', 'maintenance', /(locator|page|frame|elementHandle)\.(?!goto|waitForNavigation|waitForLoadState|waitForURL|reload)\w+: Timeout \d+ms exceeded|waiting for (locator|getBy\w+|selector)\b|waiting for element to be (visible|enabled|stable|editable)/i,
    'A Playwright action timed out waiting for its locator: the UI changed or the element never became actionable.'),
  r('CY-NOTFOUND', 'maintenance', /Timed out retrying( after \d+ms)?: Expected to find (element|content)|Expected to find element: .*, but never found it|cy\.\w+\(\)`? failed because (this element is (not visible|disabled|being covered)|it requires a DOM element)/i,
    'Cypress could not find or act on the element: selector or synchronisation problem.'),
  r('CY-DETACHED', 'maintenance', /cy\.\w+\(\)`? failed because the page updated|detached from the DOM/i,
    'The DOM re-rendered under Cypress: test synchronisation problem.'),
  r('TEST-CODE-ERROR', 'maintenance', /IllegalArgumentException: (Locator|By|Selector)|java\.lang\.NoSuchMethodError|ClassNotFoundException|Cannot find module|is not a function\s*\n?\s*at .*(\.spec|\.test|steps?|Steps?|page|Page)\.|ReferenceError: \w+ is not defined/i,
    'An error inside the test code itself (missing class/module/function).'),

  // ── 3. Global timeouts with no locator context ────────────────────────────
  r('TIMEOUT-GLOBAL', 'environment', /Test timeout of \d+ms exceeded|Timeout of \d+ms exceeded\. For async tests|test timed out after|ThreadTimeoutException|exceeded timeout of \d+ ?ms|Exceeded timeout of \d+ ?ms for a test|Method \S+ didn't finish within the time-out|execution expired|Navigation timeout of \d+ ?ms exceeded|page\.(goto|waitForNavigation|waitForLoadState|waitForURL|reload): Timeout \d+ms exceeded|TimeoutException: .{0,120}timed out after \d+ ?(ms|seconds?|minutes?)/i,
    'The test hit a global/navigation timeout without pointing at a locator: usually a slow or hung environment.'),

  // ── 4. Product defects ───────────────────────────────────────────────────
  r('RA-STATUS-4XX', 'product', /Expected status code <?2\d\d>? but was <?4\d\d>?|expected (status|response) code[^\n]{0,30}\b2\d\d\b[^\n]{0,30}\b4\d\d\b|Request failed with status code 4\d\d|expected:? ?<?2\d\d>? but was:? ?<?4\d\d>?|Expected: 2\d\d\s+Actual: 4\d\d|expected 2\d\d "[^"]*", got 4\d\d/i,
    'The API returned a 4xx where the test expected success: likely a contract or validation regression.'),
  r('HTTP-500', 'product', /Expected status code <?2\d\d>? but was <?500>?|expected:? ?<?2\d\d>? but was:? ?<?500>?|Internal Server Error|status(?: code)?[^\n]{0,20}\b500\b|Request failed with status code 500|HTTP\/1\.1 500/i,
    'The application returned HTTP 500 to a valid request: a server-side bug.'),
  r('RA-BODY', 'product', /JSON path [^\n]+ doesn't match|Response body doesn't match expectation|JSON schema validation|does not match (the )?schema|JsonSchemaValidat|\$\.[\w.\[\]]+: (expected|was)/i,
    'The API response body or schema did not match the contract.'),
  r('ASSERT-VISIBLE-TEXT', 'product', /toHaveText|toContainText|toHaveValue|toHaveCount|toHaveURL|toHaveTitle|toHaveAttribute|toBeChecked|toBeVisible|toBeHidden|toBeEnabled|toBeDisabled|Expected (string|substring|pattern): /i,
    'A UI assertion on rendered text/state failed: the page showed something different from the spec.'),
  r('ASSERT-EQ', 'product', /expected:? ?<[^>]*> but was:? ?<|expected \[[^\]]*\] but found \[|AssertionFailedError|ComparisonFailure|AssertionError|expect\(received\)|Expected:? .{0,200}\b(Received|but was|but:|Actual):?|Expecting (actual|value|map|collection)|expected .{1,200} to (equal|be|deep equal|eql|include|have|contain|match)|assert(Equals|True|False|That)|The following asserts failed|SoftAssertionError|Multiple Failures/i,
    'An assertion on application behaviour failed: actual result differs from expected. Treat as a product defect until proven otherwise.'),
];

function r(id: string, category: Category, pattern: RegExp, explanation: string): Rule {
  return { id, category, pattern, explanation };
}

/** Custom rules from settings are compiled and evaluated before the built-in set. */
export function compileCustomRules(custom: CustomRuleConfig[] | undefined): Rule[] {
  const out: Rule[] = [];
  for (const c of custom ?? []) {
    try {
      out.push({
        id: c.id,
        category: c.category,
        pattern: new RegExp(c.pattern, 'i'),
        explanation: c.explanation ?? `Custom rule ${c.id}`,
      });
    } catch {
      // invalid regex in settings: skip it rather than failing triage
    }
  }
  return out;
}
