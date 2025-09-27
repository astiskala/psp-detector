import { DOMObserverService } from './dom-observer';
import {
  setupMutationObserverMock,
  setupCleanDOM,
  waitFor,
} from '../test-helpers/utilities';
import { TEST_TIMEOUTS } from '../test-helpers/constants';

// Setup global mocks
setupMutationObserverMock();

describe('DOMObserverService', () => {
  let service: DOMObserverService;
  let callback: jest.Mock;

  beforeEach(() => {
    service = new DOMObserverService();
    callback = jest.fn();
    setupCleanDOM();
  });

  it('should initialize and start observing mutations', async() => {
    service.initialize(callback, 0); // no debounce for test
    service.startObserving();

    // Trigger a mutation
    const newNode = document.createElement('div');
    document.body.appendChild(newNode);

    // Wait for the mock observer to trigger
    await waitFor(TEST_TIMEOUTS.DOM_MUTATION_DELAY);

    expect(callback).toHaveBeenCalled();
    expect(service.isActive()).toBe(true);
  });

  it('should stop observing mutations', async() => {
    service.initialize(callback, 0);
    service.startObserving();
    service.stopObserving();
    const newNode = document.createElement('div');
    document.body.appendChild(newNode);

    await waitFor(TEST_TIMEOUTS.DEBOUNCE_SHORT);

    expect(callback).not.toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
  });

  it('should cleanup observer', () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.cleanup();
    expect(service.isActive()).toBe(false);
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
    expect(service.isActive()).toBe(false);

    // Restore document.body
    Object.defineProperty(document, 'body', {
      get: () => originalBody,
      configurable: true,
    });
  });

  it('should handle observer start errors gracefully', () => {
    // Mock observer.observe to throw error
    const originalMutationObserver = global.MutationObserver;
    global.MutationObserver = class {
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

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // No-op for testing
      });

    service = new DOMObserverService();
    service.initialize(callback, 0);
    service.startObserving();

    expect(service.isActive()).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    // Restore
    global.MutationObserver = originalMutationObserver;
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
