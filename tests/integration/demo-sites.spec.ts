import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PSPDetectorService } from '../../src/services/psp-detector';
import { TypeConverters, PSPConfig, PSPDetectionResult, PSP } from '../../src/types';
import { PSPGroup } from '../../src/types/psp';

interface SiteCase {
  url: string;
  expected: string;
}
const SITES: SiteCase[] = [
  // { url: 'https://cbcheckoutapp.herokuapp.com', expected: 'Chargebee' },
  // { url: 'https://easebuzz.in/demo/', expected: 'Easebuzz' },
  { url: 'https://checkout.bluesnapdemo.com', expected: 'BlueSnap' },
  { url: 'https://checkout.stripe.dev/checkout', expected: 'Stripe' },
  { url: 'https://demos.nuvei.com/intdemo-ecom/checkout/', expected: 'Nuvei' },
  { url: 'https://dev.shift4.com/examples/checkout', expected: 'Shift4' },
  { url: 'https://flow-demo.sandbox.checkout.com', expected: 'Checkout.com' },
  { url: 'https://fs-react-devrels.vercel.app', expected: 'FastSpring' },
  { url: 'https://pay.skrill.com/assets/skrill-demo/ecommerce.html', expected: 'Skrill' },
  { url: 'https://square.github.io/web-payments-showcase/', expected: 'Square' },
  { url: 'https://widget.payu.in/demo', expected: 'PayU' },
  { url: 'https://www.cashfree.com/demo/payment-gateway-demo/', expected: 'Cashfree Payments' },
  { url: 'https://www.mystoredemo.io', expected: 'Adyen' },
];

function loadConfig(): PSPConfig {
  type RawEntry = Record<string, unknown>;
  interface RawGroup { notice?: string; list?: RawEntry[] }
  interface RawFile {
    psps?: RawEntry[];
    orchestrators?: RawGroup;
    tsps?: RawGroup;
  }

  const file = path.join(__dirname, '..', '..', 'public', 'psps.json');
  if (!fs.existsSync(file)) throw new Error('psps.json not found');

  const raw: RawFile = JSON.parse(fs.readFileSync(file, 'utf8')) as RawFile;
  const convert = (p?: RawEntry): PSP | null => {
    if (!p) return null;
    const name = typeof p.name === 'string' ? TypeConverters.toPSPName(p.name) : null;
    const url = typeof p.url === 'string' ? TypeConverters.toURL(p.url) : null;
    if (!name || !url) return null;
    return {
      name,
      matchStrings: Array.isArray(p.matchStrings)
        ? (p.matchStrings as string[])
        : undefined,
      regex: typeof p.regex === 'string' ? p.regex : undefined,
      url,
      image: typeof p.image === 'string' ? p.image : '',
      summary: typeof p.summary === 'string' ? p.summary : '',
    } as PSP;
  };

  const buildGroup = (g?: RawGroup): PSPGroup | undefined =>
    g && g.list
      ? { notice: g.notice || '', list: g.list.map(convert).filter(Boolean) as PSP[] }
      : undefined;

  const psps = (raw.psps || []).map(convert).filter(Boolean) as PSP[];
  return {
    psps,
    orchestrators: buildGroup(raw.orchestrators),
    tsps: buildGroup(raw.tsps),
  };
}

const config = loadConfig();

// Helper: detect a single site; throws with diagnostics on mismatch.
async function detectAndAssert(page: import('@playwright/test').Page, site: SiteCase): Promise<void> {
  const requests: string[] = [];
  const listener = (r: {url: () => string}): void => {
    try { requests.push(r.url()); } catch { /* ignore */ }
  };

  page.on('request', listener);
  await page.goto(site.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  page.off('request', listener);

  const html = await page.content();
  const surface = [page.url(), html, ...requests].join('\n');

  const detector = new PSPDetectorService();
  detector.initialize(config);
  detector.setExemptDomains([]);
  const result = detector.detectPSP(site.url, surface);

  if (!PSPDetectionResult.isDetected(result) || result.psp !== site.expected) {
    // Provide concise diagnostics
    const hostSet = Array.from(new Set(requests
      .map(u => { try { return new URL(u).host; } catch { return ''; } })
      .filter(Boolean))).slice(0, 15);
    const snippet = html.slice(0, 5000); // cap output size
    const diag = {
      expected: site.expected,
      received: PSPDetectionResult.isDetected(result) ? result.psp : 'NONE',

      // detectionInfo is optional on result; cast to access safely
      detectionInfo: (
        result as unknown as { detectionInfo?: unknown }
      ).detectionInfo || null,
      firstHosts: hostSet,
      requestCount: requests.length,
      htmlPrefixSample: snippet,
    };
    throw new Error('PSP detection mismatch for ' + site.url + '\n' + JSON.stringify(diag, null, 2));
  }
}

// One test per site so failures clearly identify the PSP.
for (const site of SITES) {
  test(`${site.expected} demo detects ${site.expected}`, async({ page }) => {
    await detectAndAssert(page, site);
  });
}
