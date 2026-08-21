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

function getObserverInternals(service: DOMObserverService): {
  isRelevantNode: (nodes: NodeList) => boolean;
  isRelevantAttributeMutation: (mutation: MutationRecord) => boolean;
} {
  return service as unknown as {
    isRelevantNode: (nodes: NodeList) => boolean;
    isRelevantAttributeMutation: (mutation: MutationRecord) => boolean;
  };
}

function createAttributeMutation(
  target: Node,
  attributeName: string | null,
): MutationRecord {
  return { target, attributeName, type: 'attributes' } as MutationRecord;
}

function throwDisconnectError(): never {
  throw new Error('disconnect failed');
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

    const firstCallArguments = callback.mock.calls[0] as
      [MutationRecord[] | undefined] | undefined;
    expect(firstCallArguments?.[0]).toBeDefined();
    expect(Array.isArray(firstCallArguments?.[0])).toBe(true);
  });

  it('observes relevant attribute changes for dynamic sources', () => {
    service.initialize(callback, 0);
    service.startObserving();

    const observerReference = service as unknown as {
      observer: null | { observe: jest.Mock };
    };
    const observeMock = observerReference.observer?.observe;
    expect(observeMock).toBeDefined();

    const options = observeMock?.mock.calls[0]?.[1] as MutationObserverInit;
    expect(options.attributes).toBe(true);
    expect(options.attributeFilter).toEqual(
      expect.arrayContaining(['src', 'href', 'action', 'rel', 'as']),
    );
  });

  it('forwards relevant attribute mutation records', async () => {
    const originalMutationObserver = MutationObserver;

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
      };

      service = new DOMObserverService();
      service.initialize(callback, 0);
      service.startObserving();

      await waitFor(TEST_TIMEOUTS.DEBOUNCE_SHORT);

      expect(callback).toHaveBeenCalled();
      const firstCallArguments = callback.mock.calls[0] as
        [MutationRecord[] | undefined] | undefined;
      expect(firstCallArguments?.[0]?.[0]?.type).toBe('attributes');
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('only treats nested script preloads and payment resource hints as relevant', () => {
    const internals = getObserverInternals(service);
    const container = document.createElement('div');
    container.innerHTML =
      '<section><link rel="preload" as="style" href="theme.css"></section>';

    expect(internals.isRelevantNode(container.childNodes)).toBe(false);

    container.innerHTML =
      '<section><link rel="preload" as="script" href="checkout.js"></section>';
    const scriptPreload = container.querySelector<HTMLLinkElement>('link');
    if (scriptPreload === null) {
      throw new Error('Expected nested preload link');
    }
    scriptPreload.as = 'script';
    expect(internals.isRelevantNode(container.childNodes)).toBe(true);

    container.innerHTML =
      '<section><link rel="alternate preconnect" href="https://pay.example"></section>';
    expect(internals.isRelevantNode(container.childNodes)).toBe(true);
  });

  it('filters attribute changes by element and attribute semantics', () => {
    const internals = getObserverInternals(service);

    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(document.createTextNode('text'), 'src'),
      ),
    ).toBe(false);
    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(document.createElement('script'), 'href'),
      ),
    ).toBe(false);
    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(document.createElement('form'), 'action'),
      ),
    ).toBe(true);

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'style';
    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(link, 'href'),
      ),
    ).toBe(false);
    link.as = 'script';
    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(link, 'as'),
      ),
    ).toBe(true);
    expect(
      internals.isRelevantAttributeMutation(
        createAttributeMutation(link, 'media'),
      ),
    ).toBe(false);
  });

  it('should stop observing mutations', async () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.stopObserving();
    const newNode = document.createElement('div');
    document.body.append(newNode);

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
      // eslint-disable-next-line unicorn/no-null -- mocking the DOM null body that startObserving must handle
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
    const originalMutationObserver = MutationObserver;
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

  it('clears observing state even when disconnect throws', () => {
    const originalMutationObserver = MutationObserver;
    globalThis.MutationObserver = class {
      constructor(callback: MutationCallback) {
        this.callback = callback;
      }
      callback: MutationCallback;
      observe = jest.fn();
      disconnect = jest.fn(throwDisconnectError);
      takeRecords(): MutationRecord[] {
        return [];
      }
    };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      // Expected resilience path.
    });

    try {
      service = new DOMObserverService();
      service.initialize(callback, 0);
      service.startObserving();
      service.stopObserving();

      expect(isObserverActive(service)).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('handles MutationObserver construction failures', () => {
    const originalMutationObserver = MutationObserver;
    globalThis.MutationObserver = class {
      constructor() {
        throw new Error('observer unavailable');
      }
      observe = jest.fn();
      disconnect = jest.fn();
      takeRecords(): MutationRecord[] {
        return [];
      }
    };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      // Expected resilience path.
    });

    try {
      expect(() => service.initialize(callback)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('should handle rapid mutations efficiently', async () => {
    let callCount = 0;
    const countingCallback = jest.fn(() => {
      callCount++;
    });

    service.initialize(countingCallback, 10); // 10ms debounce
    service.startObserving();

    // Due to debouncing, multiple rapid calls should result in fewer executions
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The mock observer fires once when startObserving is called
    expect(callCount).toBeLessThanOrEqual(1);
  });
});
