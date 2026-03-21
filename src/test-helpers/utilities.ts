// MutationObserver mock for Jest/JSDOM - centralized implementation
class MockMutationObserver {
  private readonly callback: MutationCallback;
  public observe: jest.Mock;
  public disconnect: jest.Mock;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    this.observe = jest.fn(() => {
      // Simulate mutation when observe is called - use iframe for testing
      const iframe = document.createElement('iframe');
      iframe.src = 'https://js.checkout.com/test';
      const mutation = {
        type: 'childList',
        addedNodes: [iframe],
      } as unknown as MutationRecord;

      // Use a small delay to ensure async behavior
      setTimeout(() => this.callback([mutation], this), 5);
    });

    this.disconnect = jest.fn();
  }

  takeRecords(): MutationRecord[] {
    return [];
  }
}

/** Installs a deterministic MutationObserver mock for jsdom-based tests. */
export function setupMutationObserverMock(): void {
  globalThis.MutationObserver =
    MockMutationObserver as unknown as typeof MutationObserver;
}

/** Resets the document body to the minimal DOM used in unit tests. */
export function setupCleanDOM(): void {
  document.body.innerHTML = '<div id="root"></div>';
}

/** Installs the minimal `chrome.runtime` surface needed by UI tests. */
export function setupChromeRuntimeMock(): void {
  globalThis.chrome = {
    runtime: {
      getURL: jest.fn((path: string) => `chrome-extension://test-id/${path}`),
    },
  } as unknown as typeof chrome;
}

/** Small async delay helper for tests that need queued work to settle. */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Restores the original window after tests replace it with a mock. */
export function restoreWindow(
  originalWindow: Window & typeof globalThis,
): void {
  globalThis.window = originalWindow;
}

/** Simulates cross-origin `window.top` access failures for detector tests. */
export function createCrossOriginWindowMock(): Window & typeof globalThis {
  return {
    top: {
      get location() {
        throw new Error('Cross-origin access denied');
      },
    },
  } as unknown as Window & typeof globalThis;
}

import type { PSP, PSPConfig, PSPName, URL } from '../types';
import { type PSPDetectorService } from '../services/psp-detector';
import { getAllProviders } from '../lib/utils';

/** Narrow test-only view into `PSPDetectorService` internals. */
interface PSPDetectorServiceInternal {
  pspConfig: PSPConfig | null;
  exemptDomains: string[];
}

/** Looks up a provider from the detector's loaded config during tests. */
export function getPSPByPSPName(
  service: PSPDetectorService,
  pspName: PSPName,
): PSP | null {
  try {
    // Access private pspConfig through type assertion for testing
    const config = (service as unknown as PSPDetectorServiceInternal).pspConfig;

    if (!config) {
      return null;
    }

    const providers = getAllProviders(config);
    return providers.find(psp => psp.name === pspName) ?? null;
  } catch {
    return null;
  }
}

/** Test-only exempt-domain helper that mirrors the detector's host logic. */
export function isURLExempt(
  service: PSPDetectorService,
  url: URL,
): boolean {
  try {
    const parsedUrl = new globalThis.URL(url);

    // Access private exemptDomains through type assertion for testing
    const exemptDomains = (service as unknown as PSPDetectorServiceInternal)
      .exemptDomains;
    return exemptDomains.some((domain) =>
      parsedUrl.hostname.includes(domain),
    );
  } catch {
    return false;
  }
}
