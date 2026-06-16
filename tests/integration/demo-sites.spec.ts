import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PSPDetectorService } from '../../src/services/psp-detector';
import {
  TypeConverters,
  type PSPConfig,
  PSPDetectionResult,
  type PSP,
} from '../../src/types';
import { type PSPGroup } from '../../src/types/psp';

interface SiteCase {
  url: string;
  expected: string;
}

const ADYEN_SITE: SiteCase = {
  url: 'https://www.mystoredemo.io',
  expected: 'Adyen',
};
const BLUESNAP_SITE: SiteCase = {
  url: 'https://checkout.bluesnapdemo.com',
  expected: 'BlueSnap',
};
const CHECKOUT_SITE: SiteCase = {
  url: 'https://flow-demo.sandbox.checkout.com',
  expected: 'Checkout.com',
};
const CHARGEBEE_SITE: SiteCase = {
  url: 'https://cbcheckoutapp.herokuapp.com',
  expected: 'Chargebee',
};
const FASTSPRING_SITE: SiteCase = {
  url: 'https://fs-react-devrels.vercel.app',
  expected: 'FastSpring',
};
const GLOBAL_PAYMENTS_SITE: SiteCase = {
  url: 'https://demo.globalpay.com/merchants/dropin-ui',
  expected: 'Global Payments',
};
const NUVEI_SITE: SiteCase = {
  url: 'https://demos.nuvei.com/intdemo-ecom/checkout/',
  expected: 'Nuvei',
};
const SKRILL_SITE: SiteCase = {
  url: 'https://pay.skrill.com/assets/skrill-demo/ecommerce.html',
  expected: 'Skrill',
};
const SHIFT4_SITE: SiteCase = {
  url: 'https://dev.shift4.com/examples/checkout',
  expected: 'Shift4',
};
const STRIPE_SITE: SiteCase = {
  url: 'https://checkout.stripe.dev/checkout',
  expected: 'Stripe',
};
const SQUARE_SITE: SiteCase = {
  url: 'https://square.github.io/web-payments-showcase/',
  expected: 'Square',
};
const PAYU_SITE: SiteCase = {
  url: 'https://widget.payu.in/demo',
  expected: 'PayU',
};
const UNZER_SITE: SiteCase = {
  url: 'https://demo.unzer.com/demo/resources/paypage_manual.html',
  expected: 'Unzer',
};
const WORLDLINE_SITE: SiteCase = {
  url: 'https://test.saferpay.com/DemoShop',
  expected: 'Worldline',
};

function loadConfig(): PSPConfig {
  type RawEntry = Record<string, unknown>;
  interface RawGroup {
    notice?: string;
    list?: RawEntry[];
  }
  interface RawFile {
    psps?: RawEntry[];
    orchestrators?: RawGroup;
    tsps?: RawGroup;
  }

  const file = path.join(__dirname, '..', '..', 'public', 'psps.json');
  if (!fs.existsSync(file)) throw new Error('psps.json not found');

  const raw: RawFile = JSON.parse(fs.readFileSync(file, 'utf8')) as RawFile;
  const convert = (p?: RawEntry): PSP | undefined => {
    if (!p) return undefined;
    const name =
      typeof p['name'] === 'string'
        ? TypeConverters.toPSPName(p['name'])
        : undefined;
    const url =
      typeof p['url'] === 'string' ? TypeConverters.toURL(p['url']) : undefined;
    if (!name || !url) return undefined;
    return {
      name,
      matchStrings: Array.isArray(p['matchStrings'])
        ? (p['matchStrings'] as string[])
        : undefined,
      regex: typeof p['regex'] === 'string' ? p['regex'] : undefined,
      url,
      image: typeof p['image'] === 'string' ? p['image'] : '',
      summary: typeof p['summary'] === 'string' ? p['summary'] : '',
    } as PSP;
  };

  const buildGroup = (group?: RawGroup): PSPGroup | undefined => {
    const providers = group?.list;
    if (providers === undefined) {
      return undefined;
    }

    return {
      notice: group?.notice ?? '',
      list: providers
        .map((provider) => convert(provider))
        .filter((p): p is PSP => p !== undefined),
    };
  };

  const psps = (raw.psps ?? [])
    .map((provider) => convert(provider))
    .filter((p): p is PSP => p !== undefined);
  const orchestrators = buildGroup(raw.orchestrators);
  const tsps = buildGroup(raw.tsps);
  return {
    psps,
    ...(orchestrators !== undefined && { orchestrators }),
    ...(tsps !== undefined && { tsps }),
  };
}

let cachedConfig: PSPConfig | undefined;

function getConfig(): PSPConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

// Helper: detect a single site; throws with diagnostics on mismatch.
async function detectAndAssert(page: Page, site: SiteCase): Promise<void> {
  const requests: string[] = [];
  const listener = (r: { url: () => string }): void => {
    try {
      requests.push(r.url());
    } catch {
      /* ignore */
    }
  };

  page.on('request', listener);
  await page.goto(site.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  page.off('request', listener);

  const html = await page.content();
  const surface = [page.url(), html, ...requests].join('\n');

  const detector = new PSPDetectorService();
  detector.initialize(getConfig());
  detector.setExemptDomains([]);
  const result = detector.detectPSP(site.url, surface);
  const matchedNames = PSPDetectionResult.isDetected(result)
    ? result.psps.map((match): string => match.psp)
    : [];
  if (!matchedNames.includes(site.expected)) {
    // Provide concise diagnostics
    const hostSet = [
      ...new Set(
        requests
          .map((u) => {
            try {
              const parsed = new URL(u);
              return parsed.host;
            } catch {
              return '';
            }
          })
          .filter(Boolean),
      ),
    ].slice(0, 15);
    const snippet = html.slice(0, 5000); // cap output size
    const diag = {
      expected: site.expected,
      received: matchedNames.length > 0 ? matchedNames : 'NONE',
      detectionInfo: PSPDetectionResult.isDetected(result)
        ? result.psps.map((match) => match.detectionInfo)
        : undefined,
      firstHosts: hostSet,
      requestCount: requests.length,
      htmlPrefixSample: snippet,
    };
    throw new Error(
      `PSP detection mismatch for ${site.url}\n${JSON.stringify(
        diag,
        undefined,
        2,
      )}`,
    );
  }
}

// One test per site so failures clearly identify the PSP.
test.describe('demo-site coverage', () => {
  test('Adyen demo detects Adyen', async ({ page }) => {
    await detectAndAssert(page, ADYEN_SITE);
  });

  test('BlueSnap demo detects BlueSnap', async ({ page }) => {
    await detectAndAssert(page, BLUESNAP_SITE);
  });

  test('Checkout.com demo detects Checkout.com', async ({ page }) => {
    await detectAndAssert(page, CHECKOUT_SITE);
  });

  test('Chargebee demo detects Chargebee', async ({ page }) => {
    await detectAndAssert(page, CHARGEBEE_SITE);
  });

  test('FastSpring demo detects FastSpring', async ({ page }) => {
    await detectAndAssert(page, FASTSPRING_SITE);
  });

  test('Global Payments demo detects Global Payments', async ({ page }) => {
    await detectAndAssert(page, GLOBAL_PAYMENTS_SITE);
  });

  test('Nuvei demo detects Nuvei', async ({ page }) => {
    await detectAndAssert(page, NUVEI_SITE);
  });

  test('Skrill demo detects Skrill', async ({ page }) => {
    await detectAndAssert(page, SKRILL_SITE);
  });

  test('Shift4 demo detects Shift4', async ({ page }) => {
    await detectAndAssert(page, SHIFT4_SITE);
  });

  test('Stripe demo detects Stripe', async ({ page }) => {
    await detectAndAssert(page, STRIPE_SITE);
  });

  test('Square demo detects Square', async ({ page }) => {
    await detectAndAssert(page, SQUARE_SITE);
  });

  test('PayU demo detects PayU', async ({ page }) => {
    await detectAndAssert(page, PAYU_SITE);
  });

  test('Unzer demo detects Unzer', async ({ page }) => {
    await detectAndAssert(page, UNZER_SITE);
  });

  test('Worldline demo detects Worldline', async ({ page }) => {
    await detectAndAssert(page, WORLDLINE_SITE);
  });
});
