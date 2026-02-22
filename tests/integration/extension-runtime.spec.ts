import path from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const EXTENSION_PATH = path.join(__dirname, '..', '..', 'dist');
const CURRENT_TAB_ID_KEY = 'currentTabId';

const SEEDED_DETECTIONS = [
  {
    psp: 'Checkout.com',
    detectionInfo: {
      method: 'matchString',
      value: 'checkout-web-components.checkout.com',
      sourceType: 'scriptSrc',
    },
  },
  {
    psp: 'Primer',
    detectionInfo: {
      method: 'matchString',
      value: 'api.primer.io',
      sourceType: 'networkRequest',
    },
  },
] as const;

interface PspResponse {
  readonly psps: readonly unknown[];
}

async function launchExtensionContext(
  userDataDir: string,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent('serviceworker');

  return new URL(serviceWorker.url()).host;
}

async function sendRuntimeMessage<T>(
  page: Page,
  payload: Record<string, unknown>,
): Promise<T> {
  return page.evaluate(async(message) => {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }, payload) as Promise<T>;
}

async function resetStoredRuntimeState(page: Page): Promise<void> {
  await page.evaluate(async() => {
    await chrome.storage.local.set({
      detectedPsp: null,
      currentTabId: null,
      psp_history: [],
    });

    await chrome.storage.session.set({
      tabPsps: {},
    });
  });
}

async function setCurrentTabId(page: Page, tabId: number): Promise<void> {
  await page.evaluate(async(payload) => {
    await chrome.storage.local.set(payload);
  }, { [CURRENT_TAB_ID_KEY]: tabId });
}

async function createMerchantTab(
  page: Page,
  _pathSuffix: string,
): Promise<number> {
  // Use about:blank to avoid network-dependent navigation that could trigger
  // delayed onUpdated 'loading' events and wipe the seeded detection cache.
  const tabId = await page.evaluate(async() => {
    const tab = await chrome.tabs.create({
      active: false,
      url: 'about:blank',
    });

    return tab.id ?? null;
  });

  if (typeof tabId !== 'number') {
    throw new TypeError('Failed to create merchant tab for extension E2E test');
  }

  return tabId;
}

async function seedDetectionsForTab(page: Page, tabId: number): Promise<void> {
  await sendRuntimeMessage(page, { action: 'getPspConfig' });
  await setCurrentTabId(page, tabId);

  for (const detection of SEEDED_DETECTIONS) {
    await sendRuntimeMessage(page, {
      action: 'detectPsp',
      data: {
        tabId,
        psp: detection.psp,
        detectionInfo: detection.detectionInfo,
      },
    });
  }
}

async function getPspCount(page: Page): Promise<number> {
  const response = await sendRuntimeMessage<PspResponse>(page, {
    action: 'getPsp',
  });
  return response.psps.length;
}

async function openPopupPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 900, height: 700 });
  await popupPage.goto(
    `chrome-extension://${extensionId}/popup.html`,
    { waitUntil: 'domcontentloaded' },
  );

  await popupPage.bringToFront();
  return popupPage;
}

async function openHistoryPage(
  context: BrowserContext,
  popupPage: Page,
): Promise<Page> {
  const [optionsPage] = await Promise.all([
    context.waitForEvent('page'),
    popupPage.click('#history-link'),
  ]);
  await optionsPage.waitForLoadState('domcontentloaded');
  return optionsPage;
}

async function expectHistoryChartsAndColumns(
  optionsPage: Page,
  extensionId: string,
): Promise<void> {
  await expect(optionsPage).toHaveURL(
    new RegExp(`chrome-extension://${extensionId}/options.html`),
  );

  await expect(optionsPage.locator('#pspChart')).toBeVisible();
  await expect(optionsPage.locator('#sourceChart')).toBeVisible();
  await expect(optionsPage.locator('#typeChart')).toBeVisible();
  await expect(optionsPage.locator('#sourceChartLegend')).toContainText('scriptSrc');
  await expect(optionsPage.locator('#sourceChartLegend'))
    .toContainText('networkRequest');

  await expect(optionsPage.locator('#typeChartLegend')).toContainText('PSP');
  await expect(optionsPage.locator('#typeChartLegend')).toContainText('Orchestrator');
  await expect(optionsPage.getByRole('columnheader', { name: 'Type' })).toBeVisible();
  await expect(optionsPage.getByRole('columnheader', { name: 'Detection Source' }))
    .toBeVisible();

  await expect(optionsPage.getByRole('columnheader', { name: 'Detection Signal' }))
    .toBeVisible();
}

async function expectHistoryRowsAndMetadata(optionsPage: Page): Promise<void> {
  await expect(optionsPage.locator('#historyBody tr')).toHaveCount(1);
  await expect(optionsPage.locator('#historyBody .domain-icon')).toHaveCount(1);
  await expect(optionsPage.locator('#historyBody img.psp-icon')).toHaveCount(2);

  const pspIconSources = await optionsPage
    .locator('#historyBody img.psp-icon')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLImageElement).src),
    );
  expect(pspIconSources.some((src) => src.includes('checkout_48.png'))).toBe(true);
  expect(pspIconSources.some((src) => src.includes('primer_48.png'))).toBe(true);

  await expect(optionsPage.locator('#historyBody')).toContainText('scriptSrc');
  await expect(optionsPage.locator('#historyBody')).toContainText('networkRequest');
  await expect(optionsPage.locator('#historyBody'))
    .toContainText('matchString: checkout-web-components.checkout.com');

  await expect(optionsPage.locator('#historyBody'))
    .toContainText('matchString: api.primer.io');

  await expect(optionsPage.locator('body')).not.toContainText(/\b\d+\s+signals\b/i);
}

test(
  'popup renders seeded detections and keeps button sizing consistent',
  async({ page: _page }, testInfo) => {
    const context = await launchExtensionContext(
      testInfo.outputPath('ext-user-data-popup'),
    );

    try {
      const extensionId = await getExtensionId(context);
      const popupPage = await openPopupPage(context, extensionId);
      await resetStoredRuntimeState(popupPage);

      const merchantTabId = await createMerchantTab(
        popupPage,
        'popup-seeded',
      );
      await seedDetectionsForTab(popupPage, merchantTabId);
      await expect.poll(async() => getPspCount(popupPage)).toBe(2);

      await popupPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(popupPage.locator('#psp-name')).toHaveText(
        '2 PSPs detected',
      );

      await expect(popupPage.locator('.psp-card')).toHaveCount(2);
      await expect(popupPage.getByText('Detection Source:').first())
        .toBeVisible();

      await expect(popupPage.getByText('Detection Signal:').first())
        .toBeVisible();

      const bodyWidth = await popupPage.evaluate(() =>
        getComputedStyle(document.body).width,
      );
      expect(Number.parseInt(bodyWidth, 10)).toBeGreaterThanOrEqual(420);

      const styleComparison = await popupPage.evaluate(() => {
        const source = document.querySelector('.source-pill');
        const signal = document.querySelector('.match-value');
        if (!source || !signal) {
          return null;
        }

        const sourceStyle = getComputedStyle(source);
        const signalStyle = getComputedStyle(signal);
        return {
          sourceBorderRadius: sourceStyle.borderRadius,
          signalBorderRadius: signalStyle.borderRadius,
          sourceFontSize: sourceStyle.fontSize,
          signalFontSize: signalStyle.fontSize,
        };
      });

      expect(styleComparison).not.toBeNull();
      expect(styleComparison?.sourceBorderRadius).toBe(
        styleComparison?.signalBorderRadius,
      );

      expect(styleComparison?.sourceFontSize).toBe(
        styleComparison?.signalFontSize,
      );

      const actionHeights = await popupPage.evaluate(() => {
        const historyButton = document.getElementById('history-link');
        const suggestButton = document.querySelector('#psp-url a');
        if (!historyButton || !suggestButton) {
          return null;
        }

        return {
          historyMinHeight: getComputedStyle(historyButton).minHeight,
          suggestMinHeight: getComputedStyle(suggestButton).minHeight,
        };
      });

      expect(actionHeights).toEqual({
        historyMinHeight: '36px',
        suggestMinHeight: '36px',
      });
    } finally {
      await context.close();
    }
  },
);

test(
  'popup restores detected PSPs when current tab switches back',
  async({ page: _page }, testInfo) => {
    const context = await launchExtensionContext(
      testInfo.outputPath('ext-user-data-tab-switch'),
    );

    try {
      const extensionId = await getExtensionId(context);
      const popupPage = await openPopupPage(context, extensionId);
      await resetStoredRuntimeState(popupPage);

      const detectedTabId = await createMerchantTab(
        popupPage,
        'switch-detected',
      );
      const emptyTabId = await createMerchantTab(popupPage, 'switch-empty');
      await seedDetectionsForTab(popupPage, detectedTabId);

      await setCurrentTabId(popupPage, emptyTabId);
      await popupPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(popupPage.locator('#psp-name')).toHaveText(
        'No PSP detected',
      );

      await setCurrentTabId(popupPage, detectedTabId);
      await popupPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(popupPage.locator('#psp-name')).toHaveText(
        '2 PSPs detected',
      );

      await expect(popupPage.locator('.psp-card')).toHaveCount(2);
    } finally {
      await context.close();
    }
  },
);

test(
  'history page opened from popup shows charts and detection metadata columns',
  async({ page: _page }, testInfo) => {
    const context = await launchExtensionContext(
      testInfo.outputPath('ext-user-data-history'),
    );

    try {
      const extensionId = await getExtensionId(context);
      const popupPage = await openPopupPage(context, extensionId);
      await resetStoredRuntimeState(popupPage);

      const merchantTabId = await createMerchantTab(
        popupPage,
        'history-seeded',
      );
      await seedDetectionsForTab(popupPage, merchantTabId);
      await expect.poll(async() => getPspCount(popupPage)).toBe(2);
      await popupPage.reload({ waitUntil: 'domcontentloaded' });

      const optionsPage = await openHistoryPage(context, popupPage);
      await expectHistoryChartsAndColumns(optionsPage, extensionId);
      await expectHistoryRowsAndMetadata(optionsPage);
    } finally {
      await context.close();
    }
  },
);

test(
  'performance budget: popup renders seeded detections quickly',
  async({ page: _page }, testInfo) => {
    const context = await launchExtensionContext(
      testInfo.outputPath('ext-user-data-perf-budget'),
    );

    try {
      const extensionId = await getExtensionId(context);
      const popupPage = await openPopupPage(context, extensionId);
      await resetStoredRuntimeState(popupPage);

      const merchantTabId = await createMerchantTab(popupPage, 'perf-budget');
      await seedDetectionsForTab(popupPage, merchantTabId);
      await expect.poll(async() => getPspCount(popupPage)).toBe(2);

      const start = Date.now();
      await popupPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(popupPage.locator('.psp-card')).toHaveCount(2);
      const elapsedMs = Date.now() - start;

      console.info(
        `[perf] popup render with seeded detections: ${elapsedMs}ms`,
      );

      expect(elapsedMs).toBeLessThan(3000);
    } finally {
      await context.close();
    }
  },
);
