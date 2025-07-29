// Enhanced MutationObserver mock for Jest/JSDOM
global.MutationObserver = class {
  constructor(callback: MutationCallback) {
    this.callback = callback;
    this.observe = jest.fn(() => {
      // Simulate mutation when observe is called
      const mutation = {
        type: "childList",
        addedNodes: [{}],
      } as unknown as MutationRecord;
      setTimeout(() => this.callback([mutation], this), 0);
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

import { DOMObserverService } from "./dom-observer";

describe("DOMObserverService", () => {
  let service: DOMObserverService;
  let callback: jest.Mock;

  beforeEach(() => {
    service = new DOMObserverService();
    callback = jest.fn();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("should initialize and start observing mutations", () => {
    service.initialize(callback, 0); // no debounce for test
    service.startObserving();
    const newNode = document.createElement("div");
    document.body.appendChild(newNode);
    // MutationObserver is async, so we use setTimeout
    return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
      expect(callback).toHaveBeenCalled();
      expect(service.isActive()).toBe(true);
    });
  });

  it("should stop observing mutations", () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.stopObserving();
    const newNode = document.createElement("div");
    document.body.appendChild(newNode);
    return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
      expect(callback).not.toHaveBeenCalled();
      expect(service.isActive()).toBe(false);
    });
  });

  it("should cleanup observer", () => {
    service.initialize(callback, 0);
    service.startObserving();
    service.cleanup();
    expect(service.isActive()).toBe(false);
  });
});
