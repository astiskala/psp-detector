import { test, expect } from './fixtures';

interface SiteCase {
  url: string;
  expected: string;
  expectedTitle: string;
}

const SITES: SiteCase[] = [
  {
    url: 'https://www.mystoredemo.io',
    expected: 'Adyen',
    expectedTitle: 'Adyen',
  },
  {
    url: 'https://checkout.bluesnapdemo.com',
    expected: 'BlueSnap',
    expectedTitle: 'BlueSnap',
  },
  {
    url: 'https://flow-demo.sandbox.checkout.com',
    expected: 'Checkout.com',
    expectedTitle: 'Checkout.com',
  },
  {
    url: 'https://cbcheckoutapp.herokuapp.com',
    expected: 'Chargebee',
    expectedTitle: 'Chargebee',
  },
  {
    url: 'https://fs-react-devrels.vercel.app',
    expected: 'FastSpring',
    expectedTitle: 'FastSpring',
  },
  {
    url: 'https://demos.nuvei.com/intdemo-ecom/checkout/',
    expected: 'Nuvei',
    expectedTitle: 'Nuvei',
  },
  {
    url: 'https://pay.skrill.com/assets/skrill-demo/ecommerce.html',
    expected: 'Skrill',
    expectedTitle: 'Skrill',
  },
  {
    url: 'https://dev.shift4.com/examples/checkout',
    expected: 'Shift4',
    expectedTitle: 'Shift4',
  },
  {
    url: 'https://checkout.stripe.dev/checkout',
    expected: 'Stripe',
    expectedTitle: 'Stripe',
  },
  {
    url: 'https://square.github.io/web-payments-showcase/',
    expected: 'Square',
    expectedTitle: 'Square',
  },
  {
    url: 'https://widget.payu.in/demo',
    expected: 'PayU',
    expectedTitle: 'PayU',
  },
];

for (const site of SITES) {
  test(`${site.expected} demo detects ${site.expected}`, async({
    page,
    extensionId,
  }) => {
    await page.goto(site.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000); // Wait for detection

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const pspTitle = await page.locator('#psp-title').textContent();
    expect(pspTitle).toBe(site.expectedTitle);
  });
}
