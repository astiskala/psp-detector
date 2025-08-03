/**
 * Shared test fixtures and helper functions for consistent testing
 */

import type { PSP, PSPConfig } from '../types';
import { TypeConverters } from '../types';

/**
 * Factory function to create test PSP objects
 */
export const createTestPSP = (overrides: Partial<PSP> = {}): PSP => {
  const defaults: PSP = {
    name: TypeConverters.toPSPName('TestPSP')!,
    regex: TypeConverters.toRegexPattern('test\\.com')!,
    url: TypeConverters.toURL('https://test.com')!,
    image: 'test',
    summary: 'Test PSP summary',
  };

  return { ...defaults, ...overrides };
};

/**
 * Factory function to create test PSP configs
 */
export const createTestPSPConfig = (psps: PSP[] = []): PSPConfig => {
  const defaultPSPs = psps.length > 0 ? psps : [createTestPSP()];
  return { psps: defaultPSPs };
};

/**
 * Common DOM setup for UI tests
 */
export const setupTestDOM = (): Record<string, HTMLElement> => {
  document.body.innerHTML = `
    <div id="psp-name"></div>
    <div id="psp-description"></div>
    <div id="psp-notice"></div>
    <div id="psp-url"></div>
    <img id="psp-image" />
  `;

  return {
    name: document.getElementById('psp-name')!,
    description: document.getElementById('psp-description')!,
    notice: document.getElementById('psp-notice')!,
    url: document.getElementById('psp-url')!,
    image: document.getElementById('psp-image')!,
  };
};

/**
 * Mock console methods for testing
 */
export const mockConsoleMethod = (
  method: 'error' | 'warn' | 'log' | 'debug' | 'time' | 'timeEnd',
): jest.SpyInstance => {
  return jest
    .spyOn(console, method)
    .mockImplementation((...args: unknown[]) => {
      // No-op for testing, but maintain signature
      return args;
    });
};

/**
 * Create mock Chrome runtime for testing
 */
export const createMockChrome = (): typeof chrome => ({
  runtime: {
    getURL: (path: string): string => path,
  },
} as typeof chrome);

/**
 * Common test data for PSP detection
 */
export const testUrls = {
  stripe: 'https://checkout.stripe.com/session/pay_123',
  paypal: 'https://www.paypal.com/checkout',
  unknown: 'https://unknown.com',
  exempt: 'https://example.com/checkout',
} as const;

export const testContent = {
  stripe: '<script src="https://js.stripe.com/v3/"></script>',
  paypal: '<script src="https://www.paypal.com/sdk/js"></script>',
  empty: '<div>No PSP here</div>',
} as const;

/**
 * Assertion helpers for better test readability
 */
export const assertElementText = (
  element: HTMLElement,
  expectedText: string,
): void => {
  expect(element.textContent).toBe(expectedText);
};

export const assertElementVisibility = (
  element: HTMLElement,
  visible: boolean,
): void => {
  expect(element.style.display).toBe(visible ? 'block' : 'none');
};
