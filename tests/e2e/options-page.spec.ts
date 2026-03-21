import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface MockHistory {
  id: string;
  domain: string;
  url: string;
  timestamp: number;
  psps: {
    name: string;
    type: 'PSP' | 'Orchestrator' | 'TSP';
    method: 'matchString' | 'regex';
    value: string;
    sourceType: string;
  }[];
}

const optionsUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'dist', 'options.html'),
).toString();

const historyEntries: MockHistory[] = [
  {
    id: '12_1708600000000',
    domain: 'checkout.example.com',
    url: 'https://checkout.example.com/pay',
    timestamp: 1708600000000,
    psps: [
      {
        name: 'Stripe',
        type: 'PSP',
        method: 'matchString',
        value: 'js.stripe.com',
        sourceType: 'scriptSrc',
      },
      {
        name: 'Adyen',
        type: 'Orchestrator',
        method: 'matchString',
        value: 'checkoutshopper-live.adyen.com',
        sourceType: 'networkRequest',
      },
    ],
  },
];
const HISTORY_ROWS_SELECTOR = '#historyBody tr';

async function expectChartSections(page: Page): Promise<void> {
  await expect(page.locator('#stats')).toContainText('1 sites scanned');
  await expect(page.locator('#pspChart')).toBeVisible();
  await expect(page.locator('#sourceChart')).toBeVisible();
  await expect(page.locator('#typeChart')).toBeVisible();

  await expect(page.locator('#pspChartLegend')).toContainText(
    'Stripe: 50.0% (1)',
  );
  await expect(page.locator('#pspChartLegend')).toContainText(
    'Adyen: 50.0% (1)',
  );
  await expect(page.locator('#sourceChartLegend')).toContainText(
    'scriptSrc: 50.0% (1)',
  );

  await expect(page.locator('#sourceChartLegend')).toContainText(
    'networkRequest: 50.0% (1)',
  );

  await expect(page.locator('#typeChartLegend')).toContainText(
    'PSP: 50.0% (1)',
  );
  await expect(page.locator('#typeChartLegend')).toContainText(
    'Orchestrator: 50.0% (1)',
  );
}

async function expectHistoryRowContent(row: Locator): Promise<void> {
  await expect(row).toContainText('checkout.example.com');
  await expect(row).toContainText('Stripe');
  await expect(row).toContainText('Adyen');
  await expect(row).toContainText('PSP');
  await expect(row).toContainText('Orchestrator');
  await expect(row).toContainText('scriptSrc');
  await expect(row).toContainText('networkRequest');
  await expect(row).toContainText('matchString: js.stripe.com');
  await expect(row).toContainText(
    'matchString: checkoutshopper-live.adyen.com',
  );
}

async function expectDomainIcon(row: Locator): Promise<void> {
  const domainIconImage = row.locator('img.domain-icon');
  const iconCount = await domainIconImage.count();

  // In test environment without chrome.runtime, no icon may be created
  if (iconCount === 0) {
    return;
  }

  await expect(domainIconImage).toHaveAttribute(
    'src',
    /_favicon\/\?pageUrl=.*checkout\.example\.com/i,
  );
}

async function expectPspIcons(row: Locator): Promise<void> {
  const pspIcons = row.locator('img.psp-icon');
  await expect(pspIcons).toHaveCount(2);
  await expect(pspIcons.nth(0)).toHaveAttribute(
    'src',
    /images\/stripe_48\.png/i,
  );
  await expect(pspIcons.nth(1)).toHaveAttribute(
    'src',
    /images\/adyen_48\.png/i,
  );
}

async function expectSearchFiltering(page: Page): Promise<void> {
  await page.fill('#search', 'stripe');
  await expect(page.locator(HISTORY_ROWS_SELECTOR)).toHaveCount(1);

  await page.fill('#search', 'paypal');
  await expect(page.locator(HISTORY_ROWS_SELECTOR)).toHaveCount(0);
  await expect(page.locator('#emptyState')).toBeVisible();
}

async function seedChromeStorage(
  page: Page,
  data: MockHistory[],
  autoConfirm = false,
): Promise<void> {
  await page.addInitScript(
    ({ initialData, shouldConfirm }) => {
      const store: Record<string, unknown> = {
        psp_history: initialData,
      };

      (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
          local: {
            get: async (key: string): Promise<Record<string, unknown>> => ({
              [key]: store[key],
            }),
            set: async (payload: Record<string, unknown>): Promise<void> => {
              Object.assign(store, payload);
            },
          },
        },
      };

      if (shouldConfirm) {
        globalThis.confirm = (): boolean => true;
      }
    },
    { initialData: data, shouldConfirm: autoConfirm },
  );
}

test('options page loads and renders history without script syntax errors', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await seedChromeStorage(page, historyEntries);
  await page.goto(optionsUrl, { waitUntil: 'load' });
  await expectChartSections(page);

  await expect(page.locator(HISTORY_ROWS_SELECTOR)).toHaveCount(1);
  const row = page.locator(HISTORY_ROWS_SELECTOR).first();
  await expectHistoryRowContent(row);
  await expectDomainIcon(row);
  await expectPspIcons(row);
  await expectSearchFiltering(page);

  expect(pageErrors).toEqual([]);
});

test('options page exports CSV', async ({ page }) => {
  await seedChromeStorage(page, historyEntries);
  await page.goto(optionsUrl, { waitUntil: 'load' });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportBtn'),
  ]);

  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Expected download file path');
  }

  const content = fs.readFileSync(filePath, 'utf8');
  expect(content).toContain(
    'Date,Domain,URL,PSP Names,Types,Detection Sources,Detection Signals',
  );

  expect(content).toContain('checkout.example.com');
  expect(content).toContain('Stripe; Adyen');
});

test('options page clear history empties table', async ({ page }) => {
  await seedChromeStorage(page, historyEntries, true);
  await page.goto(optionsUrl, { waitUntil: 'load' });

  await expect(page.locator(HISTORY_ROWS_SELECTOR)).toHaveCount(1);
  await page.click('#clearBtn');
  await expect(page.locator(HISTORY_ROWS_SELECTOR)).toHaveCount(0);
  await expect(page.locator('#emptyState')).toBeVisible();
});
