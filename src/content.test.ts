import { MessageAction, type PSPDetectionResult } from './types';

const setExemptDomainsMock = jest.fn();
const initializePspMock = jest.fn();
const isInitializedMock = jest.fn();
const detectPSPMock = jest.fn();

const domObserverInitializeMock = jest.fn();
const domObserverStartObservingMock = jest.fn();
const domObserverStopObservingMock = jest.fn();
const domObserverCleanupMock = jest.fn();

interface RuntimeMessage {
  action: MessageAction | string;
}

type MutationCallbackArg = (mutations?: MutationRecord[]) => Promise<void>;

interface WindowContentState {
  pspDetectorContentScript?: {
    initialized: boolean;
    url: string;
  } | undefined;
}

jest.mock('./services/psp-detector', () => ({
  PSPDetectorService: jest.fn().mockImplementation(() => ({
    setExemptDomains: setExemptDomainsMock,
    initialize: initializePspMock,
    isInitialized: isInitializedMock,
    detectPSP: detectPSPMock,
  })),
}));

jest.mock('./services/dom-observer', () => ({
  DOMObserverService: jest.fn().mockImplementation(() => ({
    initialize: domObserverInitializeMock,
    startObserving: domObserverStartObservingMock,
    stopObserving: domObserverStopObservingMock,
    cleanup: domObserverCleanupMock,
  })),
}));

function setupContentDOM(): void {
  document.body.innerHTML = `
    <script src="https://cdn.test.com/script.js"></script>
    <iframe src="https://frames.example.com/frame"></iframe>
    <form action="https://checkout.example.com/pay" method="post"></form>
    <link rel="preconnect" href="https://assets.example.com" />
    <link rel="canonical" href="https://merchant.example.com/checkout" />
  `;
}

function setupIdleCallbackMock(): void {
  Object.defineProperty(globalThis, 'requestIdleCallback', {
    value: (callback: IdleRequestCallback): number => {
      callback({
        didTimeout: false,
        timeRemaining: (): number => 50,
      } as IdleDeadline);

      return 1;
    },
    configurable: true,
    writable: true,
  });
}

function setupChromeRuntimeMock(checkTabState: boolean): jest.Mock {
  const sendMessage = jest.fn(
    (
      message: RuntimeMessage,
      callback?: (response: unknown) => void,
    ): Promise<unknown> | void => {
      if (typeof callback === 'function') {
        switch (message.action) {
        case MessageAction.GET_EXEMPT_DOMAINS:
          callback({ exemptDomains: ['example.com'] });
          return;
        case MessageAction.GET_PSP_CONFIG:
          callback({ config: { psps: [] } });
          return;
        case MessageAction.GET_TAB_ID:
          callback({ tabId: 123 });
          return;
        default:
          callback({});
          return;
        }
      }

      if (message.action === MessageAction.CHECK_TAB_STATE) {
        return Promise.resolve({ hasState: checkTabState });
      }

      return Promise.resolve({});
    },
  );

  globalThis.chrome = {
    runtime: {
      id: 'test-extension-id',
      sendMessage,
      lastError: undefined,
    },
  } as unknown as typeof chrome;

  return sendMessage;
}

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('content bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setupContentDOM();
    setupIdleCallbackMock();

    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = undefined;

    isInitializedMock.mockReturnValue(true);
    detectPSPMock.mockReturnValue({
      type: 'none',
    } as PSPDetectionResult);
  });

  it('initializes and runs detection flow on first bootstrap', async() => {
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(setExemptDomainsMock).toHaveBeenCalledWith(['example.com']);
    expect(initializePspMock).toHaveBeenCalledWith({ psps: [] });
    expect(domObserverInitializeMock).toHaveBeenCalledTimes(1);
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
    expect(detectPSPMock).toHaveBeenCalledTimes(1);

    const scanContent = detectPSPMock.mock.calls[0]?.[1] as string | undefined;
    expect(scanContent).toContain('cdn.test.com/script.js');
    expect(scanContent).toContain('checkout.example.com/pay');
    expect(scanContent).toContain('assets.example.com');
    expect(scanContent).not.toContain('merchant.example.com/checkout');

    const windowState = globalThis as typeof globalThis & WindowContentState;
    expect(windowState.pspDetectorContentScript?.initialized).toBe(true);

    window.dispatchEvent(new Event('beforeunload'));
    expect(domObserverCleanupMock).toHaveBeenCalledTimes(1);
  });

  it('skips re-initialization when state already exists in background', async() => {
    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = {
      initialized: true,
      url: document.URL,
    };

    const sendMessageMock = setupChromeRuntimeMock(true);

    await import('./content');
    await flushAsyncTasks();

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: MessageAction.CHECK_TAB_STATE,
    });

    expect(setExemptDomainsMock).not.toHaveBeenCalled();
    expect(domObserverStartObservingMock).not.toHaveBeenCalled();
  });

  it('detects iframe src added via attributes mutation', async() => {
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    const mutationCallback = domObserverInitializeMock.mock.calls[0]?.[0] as
      | MutationCallbackArg
      | undefined;
    expect(mutationCallback).toBeDefined();

    detectPSPMock.mockClear();

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframe.src =
      'https://assets.braintreegateway.com/web/3.123.2/html/hosted-fields-frame.min.html';

    const mutation = {
      type: 'attributes',
      target: iframe,
      attributeName: 'src',
    } as unknown as MutationRecord;

    // Respect detection cooldown before triggering a mutation-driven scan.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 550);
    });

    await mutationCallback?.([mutation]);

    const scanContent = detectPSPMock.mock.calls[0]?.[1] as string | undefined;
    expect(scanContent).toContain('assets.braintreegateway.com/web/3.123.2');
  });
});
