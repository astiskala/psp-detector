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
 * Validates that a function throws with a specific error message
 */
export function expectToThrowWithMessage(
  fn: () => void,
  expectedMessage: string,
): void {
  expect(fn).toThrow();
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expectedMessage);
  }
}

/**
 * Creates a test-specific performance measurement
 */
export function measureTestPerformance<T>(
  testName: string,
  operation: () => T,
): T {
  const start = performance.now();
  const result = operation();
  const end = performance.now();
  console.log(`[Test Performance] ${testName}: ${end - start}ms`);
  return result;
}

/**
 * Type-safe test helper for checking branded types
 */
export function isBrandedType<T extends string>(value: unknown): value is T {
  return typeof value === 'string' && value.length > 0;
}
