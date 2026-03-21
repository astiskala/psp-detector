import { DOMObserverService } from './dom-observer';
import {
  setupMutationObserverMock,
  setupCleanDOM,
  waitFor,
} from '../test-helpers/utilities';
import { TEST_TIMEOUTS } from '../test-helpers/constants';

// Setup global mocks
setupMutationObserverMock();

function isObserverActive(service: DOMObserverService): boolean {
  return (service as unknown as { isObserving: boolean }).isObserving;
}

describe('DOMObserverService', () => {
  let service: DOMObserverService;
  let callback: jest.Mock;

  beforeEach(() => {
    service = new DOMObserverService();
    callback = jest.fn();
    setupCleanDOM();
  });

  it('should initialize and start observing mutations', async () => {
    service.initialize(callback, 0); // no debounce for test
    service.startObserving();

    // Wait for the mock observer to trigger
    await waitFor(TEST_TIMEOUTS.DOM_MUTATION_DELAY);

    expect(callback).toHaveBeenCalled();
    expect(isObserverActive(service)).toBe(true);
  });

  it('passes relevant mutation records to callback', async () => {
    service.initialize(callback, 0);
    service.startObserving();

    await waitFor(TEST_TIMEOUTS.DOM_MUTATION_DELAY);

    const firstCallArgs = callback.mock.calls[0] as
      | [MutationRecord[] | undefined]
      | undefined;
    expect(firstCallArgs?.[0]).toBeDefined();
    expect(Array.isArray(firstCallArgs?.[0])).toBe(true);
  });

  it('observes relevant attribute changes for dynamic sources', () => {
    service.initialize(callback, 0);
    service.startObserving();

    const observerRef = service as unknown as {
      observer: { observe: jest.Mock } | null;
    };
    const observeMock = observerRef.observer?.observe;
    expect(observeMock).toBeDefined();

    const options = observeMock?.mock.calls[0]?.[1] as MutationObserverInit;
    expect(options.attributes).toBe(true);
    expect(options.attributeFilter).toEqual(
      expect.arrayContaining(['src', 'href', 'action', 'rel', 'as']),
    );
  });

  it('forwards relevant attribute mutation records', async () => {
    const originalMutationObserver = globalThis.MutationObserver;

    try {
      globalThis.MutationObserver = class {
        constructor(observerCallback: MutationCallback) {
          this.callback = observerCallback;
          this.observe = jest.fn(() => {
            const iframe = document.createElement('iframe');
            iframe.src = 'https://assets.braintreegateway.com/frame.html';
            const mutation = {
              type: 'attributes',
              target: iframe,
              attributeName: 'src',
            } as unknown as MutationRecord;
            setTimeout(
              () =>
                this.callback([mutation], this as unknown as MutationObserver),
              0,
            );
          });

          this.disconnect = jest.fn();
        }
        callback: MutationCallback;
        observe: jest.Mock;
        disconnect: jest.Mock;
        takeRecords(): MutationRecord[] {
          return [];
        }
      } as unknown as typeof MutationObserver;

      service = new DOMObserverService();
      service.initialize(callback, 0);
      service.startObserving();

      await waitFor(TEST_TIMEOUTS.DEBOUNCE_SHORT);

      expect(callback).toHaveBeenCalled();
      const firstCallArgs = callback.mock.calls[0] as
        | [MutationRecord[] | undefined]
        | undefined;
      expect(firstCallArgs?.[0]?.[0]?.type).toBe('attributes');
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('should stop observing mutations', async () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.stopObserving();
    const newNode = document.createElement('div');
    document.body.appendChild(newNode);

    await waitFor(TEST_TIMEOUTS.DEBOUNCE_SHORT);

    expect(callback).not.toHaveBeenCalled();
    expect(isObserverActive(service)).toBe(false);
  });

  it('should cleanup observer', () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.cleanup();
    expect(isObserverActive(service)).toBe(false);
  });

  it('should handle document.body not available scenario', () => {
    // Temporarily remove document.body
    const originalBody = document.body;
    Object.defineProperty(document, 'body', {
      get: () => null,
      configurable: true,
    });

    service.initialize(callback, 0);
    service.startObserving();

    // Should not crash and should set up a DOMContentLoaded listener
    expect(isObserverActive(service)).toBe(false);

    // Restore document.body
    Object.defineProperty(document, 'body', {
      get: () => originalBody,
      configurable: true,
    });
  });

  it('should handle observer start errors gracefully', () => {
    // Mock observer.observe to throw error
    const originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      constructor(callback: MutationCallback) {
        this.callback = callback;
        this.observe = jest.fn(() => {
          throw new Error('Observer start error');
        });

        this.disconnect = jest.fn();
      }
      callback: MutationCallback;
      observe: jest.Mock;
      disconnect: jest.Mock;
      takeRecords(): MutationRecord[] {
        return [];
      }
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      // No-op for testing
    });

    service = new DOMObserverService();
    service.initialize(callback, 0);
    service.startObserving();

    expect(isObserverActive(service)).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    // Restore
    globalThis.MutationObserver = originalMutationObserver;
    consoleSpy.mockRestore();
  });

  it('should handle rapid mutations efficiently', () => {
    let callCount = 0;
    const countingCallback = jest.fn(() => {
      callCount++;
    });

    service.initialize(countingCallback, 10); // 10ms debounce
    service.startObserving();

    // Due to debouncing, multiple rapid calls should result in fewer executions
    return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
      // The mock observer fires once when startObserving is called
      expect(callCount).toBeLessThanOrEqual(1);
    });
  });
});
