import type { IngestPayload } from '../ingest/schema';
import type { IngestResult } from './types';
import { normalise } from './triage/normalise';
import { signature } from './triage/signature';

/**
 * Demo workspace content (US-7): 8 stories, 2 bugs, fix version 2.4.0 and 5 nightly runs of ~55
 * results with realistic failures. Deterministic, so the story it tells is the same on every site:
 *
 *   🐞 S1 checkout: real regression from night 3, tracked by demo bug 1 (signature label)
 *   🐞 S7 wishlist: new regression on night 5, untracked → "Create bug" on the triage board
 *   🔧 S2 coupon button renamed (Playwright locator) and S3 #loginBtn removed (Selenium) from night 4
 *   🌩 S4 order-history API 503 on night 5 (and an unmapped smoke test hit a refused connection on night 2)
 *   🎲 S5 search: two flaky scenarios
 *   ✅ S6 refunds: always green          ∅ S8 gift cards: no tests (AC coverage demo)
 *
 * The "rerun" (night 6) is the same suite after the environment is fixed: S4 goes green and the
 * release flips from "At risk – low evidence confidence" to "Ready".
 */

export type Slot = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'B1' | 'B2';

export interface DemoIssueDef {
  slot: Slot;
  kind: 'story' | 'bug';
  summary: string;
  description: string;
  inVersion: boolean;
  /** move to a Done status after creation (dev work finished, only tests are red) */
  done?: boolean;
  priority?: string;
  labels?: string[];
}

export const DEMO_VERSION = '2.4.0';
export const DEMO_LABEL = 'shipproof-demo';

const CHECKOUT_STEP = 'Then the order is placed';
const CHECKOUT_ERROR = `org.opentest4j.AssertionFailedError: expected: <Order Placed> but was: <Payment Failed>
\tat org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:55)
\tat com.acme.steps.CheckoutSteps.orderIsPlaced(CheckoutSteps.java:57)`;

/** Signature of the tracked checkout regression: demo bug 1 carries its label, so dedupe links it. */
export const CHECKOUT_SIGNATURE = signature(normalise(CHECKOUT_ERROR), CHECKOUT_STEP);

export const DEMO_ISSUES: DemoIssueDef[] = [
  {
    slot: 'S1',
    kind: 'story',
    summary: 'Pay with a saved card at checkout',
    inVersion: true,
    description: `As a returning shopper I want to pay with a saved card so that checkout is faster.

## Acceptance criteria
- Saved cards are listed at checkout
- Paying with a saved card places the order
- Expired saved cards are hidden
- Given a declined saved card When I pay Then I see "Card declined" and the order is not placed`,
  },
  {
    slot: 'S2',
    kind: 'story',
    summary: 'Apply a coupon code at checkout',
    inVersion: true,
    done: true,
    description: `## Acceptance criteria
- A valid coupon reduces the order total
- An expired coupon shows "Coupon expired"
- Only one coupon can be applied per order`,
  },
  {
    slot: 'S3',
    kind: 'story',
    summary: 'Log in with email and password',
    inVersion: true,
    done: true,
    description: `## Acceptance criteria
- A registered user can log in with email and password
- Five wrong passwords lock the account for 15 minutes
- "Remember me" keeps the session for 30 days`,
  },
  {
    slot: 'S4',
    kind: 'story',
    summary: 'Order history page',
    inVersion: true,
    done: true,
    description: `## Acceptance criteria
- Orders are listed newest first
- Each order shows status, total and delivery date
- Orders can be filtered by status`,
  },
  {
    slot: 'S5',
    kind: 'story',
    summary: 'Search products with filters',
    inVersion: true,
    done: true,
    description: `## Acceptance criteria
- Search returns matching products
- Results can be filtered by category and price
- Results can be sorted by price`,
  },
  {
    slot: 'S6',
    kind: 'story',
    summary: 'Refund to the original payment method',
    inVersion: true,
    done: true,
    description: `## Acceptance criteria
- Refunds go to the original card or UPI account
- The customer gets a refund confirmation email`,
  },
  {
    slot: 'S7',
    kind: 'story',
    summary: 'Wishlist: save items for later',
    inVersion: false,
    description: `## Acceptance criteria
- A logged-in user can add a product to the wishlist
- The wishlist badge shows the number of saved items`,
  },
  {
    slot: 'S8',
    kind: 'story',
    summary: 'Buy and redeem gift cards',
    inVersion: true,
    description: `As a shopper I want to buy gift cards for friends.

## Acceptance criteria
- A gift card can be bought in fixed amounts of ₹500, ₹1000 and ₹2000
- The recipient receives the gift card code by email
- A gift card code can be redeemed at checkout
- A redeemed gift card cannot be used twice
- Given a gift card with ₹200 left When the order total is ₹500 Then ₹300 is charged to the card`,
  },
  {
    slot: 'B1',
    kind: 'bug',
    summary: 'Saved-card payments fail with "Payment Failed" after gateway SDK upgrade',
    inVersion: true,
    priority: 'Low',
    labels: [`sp-sig-${CHECKOUT_SIGNATURE}`],
    description: `Seen in nightly regression since the payment-gateway SDK upgrade. Workaround: pay with UPI.
Reported before ShipProof was installed; ShipProof links matching failures to this bug by its signature label.`,
  },
  {
    slot: 'B2',
    kind: 'bug',
    summary: 'Order confirmation email shows the wrong delivery date',
    inVersion: false,
    priority: 'Medium',
    description: 'Delivery date in the email is one day earlier than on the order page.',
  },
];

interface ScenarioDef {
  slot: Slot | null;
  suite: string;
  name: string;
  /** outcome per night (index 0 = night 1 … 5 = rerun) */
  outcome: (night: number, index: number) => { status: 'passed' | 'failed' | 'skipped'; failedStep?: string; error?: string } | undefined;
}

const pass = () => ({ status: 'passed' as const });

const SEL_LOGIN = (selector: string) => `org.openqa.selenium.NoSuchElementException: no such element: Unable to locate element: {"method":"css selector","selector":"${selector}"}
  (Session info: chrome=131.0.6778.85)
\tat org.openqa.selenium.remote.RemoteWebDriver.findElement(RemoteWebDriver.java:351)
\tat com.acme.pages.LoginPage.submit(LoginPage.java:41)`;

const PW_COUPON = `locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Apply coupon' })
    at CheckoutPage.applyCoupon (tests/pages/checkout.page.ts:48:31)`;

const API_503 = `java.lang.AssertionError: 1 expectation failed.
Expected status code <200> but was <503>.
\tat io.restassured.internal.ValidatableResponseImpl.statusCode(ValidatableResponseImpl.groovy:89)
\tat com.acme.api.OrdersApi.history(OrdersApi.java:73)`;

const REFUSED = `java.net.ConnectException: Connection refused (Connection refused)
\tat java.base/sun.nio.ch.Net.connect0(Native Method)
\tat com.acme.api.OrdersApi.history(OrdersApi.java:70)`;

const SEARCH_FLAKY = `Error: Timed out 5000ms waiting for expect(locator).toHaveCount(expected)
Locator: locator('[data-test="product-card"]')
Expected: 12
Received: 0
    at tests/search.spec.ts:33:47`;

const WISHLIST = `Error: expect(locator).toHaveText(expected)
Locator: getByTestId('wishlist-badge')
Expected string: "2"
Received string: "0"
    at tests/wishlist.spec.ts:19:52`;

function scenarios(): ScenarioDef[] {
  const out: ScenarioDef[] = [];
  const add = (slot: Slot | null, suite: string, names: string[], outcome: ScenarioDef['outcome']) =>
    names.forEach((name) => out.push({ slot, suite, name, outcome }));

  add('S1', 'checkout.feature', [
    'Pay with saved Visa card',
    'Pay with saved Mastercard',
    'Pay with saved RuPay card',
  ], (n) => (n >= 2 ? { status: 'failed', failedStep: CHECKOUT_STEP, error: CHECKOUT_ERROR } : pass()));
  add('S1', 'checkout.feature', [
    'Saved cards are listed at checkout',
    'Expired saved cards are hidden',
    'Declined saved card shows Card declined',
    'Checkout total includes GST',
    'Pay with saved card on mobile web',
  ], pass);

  add('S2', 'coupon.spec.ts', ['Valid coupon reduces the total', 'Percentage coupon on sale items', 'Coupon removed after cart change', 'Coupon on mobile checkout'], (n) =>
    n >= 3 ? { status: 'failed', error: PW_COUPON } : pass(),
  );
  add('S2', 'coupon.spec.ts', ['Expired coupon shows Coupon expired', 'Only one coupon per order', 'Coupon field hidden for gift cards'], pass);

  add('S3', 'login.feature', [
    'Log in with email and password',
    'Remember me keeps the session',
    'Log in after password reset',
    'Log in redirects to the cart',
    'Log in as business customer',
    'Log in from the checkout page',
  ], (n) => (n >= 3 ? { status: 'failed', failedStep: 'When I submit the login form', error: SEL_LOGIN('#loginBtn') } : pass()));
  add('S3', 'login.feature', ['Five wrong passwords lock the account', 'Locked account shows unlock time'], pass);

  add('S4', 'OrdersApiTest', [
    'Orders are listed newest first',
    'Order shows status total and delivery date',
    'Filter orders by status',
    'Order history paginates',
    'Cancelled orders are listed',
    'Empty order history',
    'Order history for business account',
  ], (n) => (n === 4 ? { status: 'failed', error: API_503 } : pass()));

  add('S5', 'search.spec.ts', ['Filter search by category', 'Sort search results by price'], (n) =>
    ['P', 'F', 'P', 'P', 'F', 'P'][n] === 'F' ? { status: 'failed', error: SEARCH_FLAKY } : pass(),
  );
  add('S5', 'search.spec.ts', ['Search returns matching products', 'Search with no results', 'Search suggestions', 'Filter by price range', 'Search by brand', 'Search keeps filters on back'], pass);

  add('S6', 'refunds.feature', ['Refund to card', 'Refund to UPI', 'Refund email sent', 'Partial refund', 'Refund of cancelled order', 'Refund for returned item'], pass);

  add('S7', 'wishlist.spec.ts', ['Wishlist badge counts items', 'Add product to wishlist'], (n) => (n >= 4 ? { status: 'failed', error: WISHLIST } : pass()));
  add('S7', 'wishlist.spec.ts', ['Remove product from wishlist', 'Wishlist requires login', 'Move wishlist item to cart', 'Share wishlist'], pass);

  add(null, 'smoke.spec.ts', ['Home page loads'], (n) => (n === 1 ? { status: 'failed', error: REFUSED } : pass()));
  add(null, 'smoke.spec.ts', ['Footer links work', 'Cookie banner can be dismissed', 'Robots.txt is served'], pass);
  add(null, 'smoke.spec.ts', ['Newsletter sign-up'], (n) => (n === 2 ? { status: 'skipped' } : pass()));
  return out;
}

export const DEMO_NIGHTS = 5;

/**
 * Builds run payloads exactly as the CI uploader would send them. Night 6 (index 5) is the rerun.
 * `keyMap` maps slots to the issue keys created on this site.
 */
export function buildDemoRuns(projectKey: string, keyMap: Partial<Record<Slot, string>>, now: number, nights: number[] = [0, 1, 2, 3, 4]): IngestPayload[] {
  const defs = scenarios();
  return nights.map((n) => {
    // nights 1–5 at 02:00 on consecutive days ending ~6 hours ago; the rerun is "now"
    const startedAt = n === 5 ? now - 5 * 60_000 : now - (4 - n) * 86_400_000 - 6 * 3_600_000;
    const results: IngestResult[] = [];
    defs.forEach((d, i) => {
      const o = d.outcome(n, i);
      if (!o) return;
      const key = d.slot ? keyMap[d.slot] : undefined;
      results.push({
        id: `${d.suite}:${d.name}`,
        name: d.name,
        suite: d.suite,
        status: o.status,
        durationMs: 1200 + ((i * 7919 + n * 104729) % 9000),
        issueKeys: key ? [key] : [],
        ...(o.failedStep ? { failedStep: o.failedStep } : {}),
        ...(o.error ? { error: o.error } : {}),
      });
    });
    const build = String(1283 + n);
    return {
      schemaVersion: 1 as const,
      source: 'jenkins' as const,
      projectKey,
      buildId: n === 5 ? `${build}-rerun` : build,
      buildUrl: `https://ci.example.com/job/shop-app/job/nightly-regression/${build}/`,
      pipeline: 'nightly-regression',
      branch: 'release/2.4.0',
      commit: ['a1b2c3d', 'b2c3d4e', 'c3d4e5f', 'd4e5f60', 'e5f6071', 'e5f6071'][n],
      environment: 'staging',
      startedAt: new Date(startedAt).toISOString(),
      part: { index: 1, total: 1 },
      results,
    };
  });
}
