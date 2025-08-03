/**
 * Shared test utilities and helpers
 */

// MutationObserver mock for Jest/JSDOM - centralized implementation
export class MockMutationObserver {
  private callback: MutationCallback;
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

/**
 * Sets up the global MutationObserver mock
 */
export function setupMutationObserverMock(): void {
  global.MutationObserver =
    MockMutationObserver as unknown as typeof MutationObserver;
}

/**
 * Creates a clean DOM environment for testing
 */
export function setupCleanDOM(): void {
  document.body.innerHTML = '<div id="root"></div>';
}

/**
 * Sets up Chrome runtime mock for extension testing
 */
export function setupChromeRuntimeMock(): void {
  global.chrome = {
    runtime: {
      getURL: jest.fn((path: string) => `chrome-extension://test-id/${path}`),
    },
  } as unknown as typeof chrome;
}

/**
 * Creates a promise that resolves after a specified delay
 * Useful for testing async operations with deterministic timing
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a mock console implementation that captures calls
 */
export function createMockConsole(): {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  info: jest.Mock;
  debug: jest.Mock;
  } {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

/**
 * Restores the original window object after modification
 */
export function restoreWindow(
  originalWindow: Window & typeof globalThis,
): void {
  global.window = originalWindow;
}

/**
 * Creates a mock window.top object that throws cross-origin errors
 */
export function createCrossOriginWindowMock(): Window & typeof globalThis {
  return {
    top: {
      get location() {
        throw new Error('Cross-origin access denied');
      },
    },
  } as unknown as Window & typeof globalThis;
}

/**
 * Test helper functions for PSP detector service
 * These methods were moved from the main service as they're only used in tests
 */
import type { PSP, PSPConfig, PSPName, URL } from '../types';
import { PSPDetectorService } from '../services/psp-detector';

/**
 * Interface for accessing private members of PSPDetectorService in tests
 */
interface PSPDetectorServiceInternal {
  pspConfig: PSPConfig | null;
  exemptDomains: string[];
}

/**
 * Get PSP by branded PSP name - test helper version
 * @param {PSPDetectorService} service - PSP detector service instance
 * @param {PSPName} pspName - Branded PSP name
 * @return {PSP|null} PSP object or null
 */
export function getPSPByPSPName(
  service: PSPDetectorService,
  pspName: PSPName,
): PSP | null {
  // Access private pspConfig through type assertion for testing
  const config = (service as unknown as PSPDetectorServiceInternal).pspConfig;
  if (!config) {
    return null;
  }

  return config.psps.find((psp: PSP) => psp.name === pspName) || null;
}

/**
 * Check if a URL matches exempt domains - test helper version
 * @param {PSPDetectorService} service - PSP detector service instance
 * @param {URL} url - Branded URL to check
 * @return {boolean} True if URL is exempt, false otherwise
 */
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
