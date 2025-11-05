import { test as base, chromium } from '@playwright/test';
import path from 'path';

export const test = base.extend<{ extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async({}, use) => {
    const pathToExtension = path.join(__dirname, '..', '..', 'dist');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
  },
  extensionId: async({ context }, use) => {
    // for manifest v3:
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  },
});
export const expect = test.expect;
