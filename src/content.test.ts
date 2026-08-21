import { MessageAction } from './types';
import type * as Types from './types';

const setExemptDomainsMock = jest.fn();
const initializePspMock = jest.fn();
const isInitializedMock = jest.fn();
const detectPSPMock = jest.fn();

const domObserverInitializeMock = jest.fn();
const domObserverStartObservingMock = jest.fn();
const domObserverStopObservingMock = jest.fn();
const domObserverCleanupMock = jest.fn();

const loggerDebugMock = jest.fn();
const loggerInfoMock = jest.fn();
const loggerWarnMock = jest.fn();
const loggerErrorMock = jest.fn();

interface RuntimeMessage {
  // MessageAction is a union of string literals, so `| string` would subsume it;
  // a mock message may carry any action string.
  action: string;
}

interface RuntimeMockOverrides {
  exemptDomainsResponse?: unknown;
  pspConfigResponse?: unknown;
  tabIdResponse?: unknown;
}

interface DetectionMessage {
  action: string;
  data: {
    psp?: string;
    tabId?: number;
    detectionInfo?: { sourceType?: string };
    merchantOrigin?: string;
  };
}

type MutationCallbackArgument = (mutations?: MutationRecord[]) => Promise<void>;

interface WindowContentState {
  pspDetectorContentScript?: {
    initialized: boolean;
    url: string;
  };
}

jest.mock('./services/psp-detector', () => {
  return {
    PSPDetectorService: jest.fn().mockImplementation(() => {
      return {
        setExemptDomains: setExemptDomainsMock,
        initialize: initializePspMock,
        isInitialized: isInitializedMock,
        detectPSP: detectPSPMock,
      };
    }),
  };
});

jest.mock('./services/dom-observer', () => {
  return {
    DOMObserverService: jest.fn().mockImplementation(() => {
      return {
        initialize: domObserverInitializeMock,
        startObserving: domObserverStartObservingMock,
        stopObserving: domObserverStopObservingMock,
        cleanup: domObserverCleanupMock,
      };
    }),
  };
});

jest.mock('./lib/utilities', () => {
  return {
    logger: {
      debug: loggerDebugMock,
      info: loggerInfoMock,
      warn: loggerWarnMock,
      error: loggerErrorMock,
    },
  };
});

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
      });

      return 1;
    },
    configurable: true,
    writable: true,
  });
}

function setupChromeRuntimeMock(
  checkTabState: boolean,
  overrides: RuntimeMockOverrides = {},
): jest.Mock {
  const sendMessage = jest.fn(
    (
      message: RuntimeMessage,
      callback?: (response: unknown) => void,
    ): Promise<unknown> | void => {
      if (typeof callback === 'function') {
        switch (message.action) {
          case MessageAction.GET_EXEMPT_DOMAINS: {
            callback(
              overrides.exemptDomainsResponse ?? {
                exemptDomains: ['example.com'],
              },
            );
            return;
          }
          case MessageAction.GET_PSP_CONFIG: {
            callback(
              'pspConfigResponse' in overrides
                ? overrides.pspConfigResponse
                : { config: { psps: [] } },
            );
            return;
          }
          case MessageAction.GET_TAB_ID: {
            callback(overrides.tabIdResponse ?? { tabId: 123 });
            return;
          }
          default: {
            callback({});
            return;
          }
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

function getMutationCallback(): MutationCallbackArgument {
  const callback = domObserverInitializeMock.mock.calls[0]?.[0] as
    MutationCallbackArgument | undefined;
  expect(callback).toBeDefined();
  return callback!;
}

function getDetectionMessages(sendMessageMock: jest.Mock): DetectionMessage[] {
  return sendMessageMock.mock.calls
    .map((call) => call[0] as { action: string; data?: unknown })
    .filter(
      (message) => message.action === MessageAction.DETECT_PSP,
    ) as DetectionMessage[];
}

function advancePastDetectionCooldown(): void {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
}

function setRuntimeLastError(message?: string): void {
  (
    globalThis.chrome.runtime as unknown as {
      lastError: { message?: string } | undefined;
    }
  ).lastError = message === undefined ? undefined : { message };
}

// eslint-disable-next-line max-statements -- comprehensive bootstrap cases share module-reset setup
describe('content bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setupContentDOM();
    setupIdleCallbackMock();
    Object.defineProperty(document, 'referrer', {
      value: '',
      configurable: true,
    });

    const windowState = globalThis as typeof globalThis & WindowContentState;
    delete windowState.pspDetectorContentScript;

    isInitializedMock.mockReturnValue(true);
    detectPSPMock.mockReturnValue({
      type: 'none',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('./types');
  });

  it('initializes and runs detection flow on first bootstrap', async () => {
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

    dispatchEvent(new Event('beforeunload'));
    expect(domObserverCleanupMock).toHaveBeenCalledTimes(1);
  });

  it('skips re-initialization when state already exists in background', async () => {
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

  it('forwards merchant origin from document.referrer on a redirect detection', async () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://shop.merchant.example/checkout?session=abc',
      configurable: true,
    });

    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [
        {
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'pageUrl',
          },
        },
      ],
    });

    const sendMessageMock = setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();

    const detectCall = sendMessageMock.mock.calls.find((call) => {
      const [message] = call as [RuntimeMessage];
      return message.action === MessageAction.DETECT_PSP;
    });
    expect(detectCall).toBeDefined();

    const [detectMessage] = detectCall as [
      { data: { merchantOrigin?: string } },
    ];
    expect(detectMessage.data.merchantOrigin).toBe(
      'https://shop.merchant.example',
    );
  });

  it('omits merchant origin when referrer is empty', async () => {
    Object.defineProperty(document, 'referrer', {
      value: '',
      configurable: true,
    });

    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [
        {
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'pageUrl',
          },
        },
      ],
    });

    const sendMessageMock = setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();

    const detectCall = sendMessageMock.mock.calls.find((call) => {
      const [message] = call as [RuntimeMessage];
      return message.action === MessageAction.DETECT_PSP;
    });
    expect(detectCall).toBeDefined();
    const [detectMessage] = detectCall as [{ data: Record<string, unknown> }];
    expect(detectMessage.data).not.toHaveProperty('merchantOrigin');
  });

  it('detects iframe src added via attributes mutation', async () => {
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    const mutationCallback = getMutationCallback();

    detectPSPMock.mockClear();

    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    iframe.src =
      'https://assets.braintreegateway.com/web/3.123.2/html/hosted-fields-frame.min.html';

    const mutation = {
      type: 'attributes',
      target: iframe,
      attributeName: 'src',
    } as unknown as MutationRecord;

    advancePastDetectionCooldown();

    await mutationCallback([mutation]);

    const scanContent = detectPSPMock.mock.calls[0]?.[1] as string | undefined;
    expect(scanContent).toContain('assets.braintreegateway.com/web/3.123.2');
  });

  it('uses the timer fallback when requestIdleCallback is unavailable', async () => {
    delete (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();
    await flushAsyncTasks();

    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
    expect(detectPSPMock).toHaveBeenCalledTimes(1);
  });

  it('skips initialization when the extension context is invalid', async () => {
    setupChromeRuntimeMock(false);
    delete (globalThis.chrome.runtime as { id?: string }).id;

    await import('./content');
    await flushAsyncTasks();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Extension context invalidated, skipping initialization',
    );
    expect(domObserverStartObservingMock).not.toHaveBeenCalled();
  });

  it('continues setup when configuration messages fail', async () => {
    const sendMessageMock = setupChromeRuntimeMock(false);
    sendMessageMock.mockImplementation(
      (message: RuntimeMessage, callback?: (response: unknown) => void) => {
        if (
          typeof callback === 'function' &&
          (message.action === MessageAction.GET_EXEMPT_DOMAINS ||
            message.action === MessageAction.GET_PSP_CONFIG)
        ) {
          setRuntimeLastError('permission denied');
          callback(undefined);
          setRuntimeLastError();
          return;
        }

        callback?.({});
      },
    );

    await import('./content');
    await flushAsyncTasks();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to initialize exempt domains:',
      expect.any(Error),
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to initialize PSP config:',
      expect.any(Error),
    );
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
  });

  it('logs an initial detection failure without rejecting bootstrap', async () => {
    detectPSPMock.mockImplementation(() => {
      throw new Error('detector failed');
    });
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Initial PSP detection failed:',
      expect.objectContaining({ message: 'detector failed' }),
    );
  });

  it.each([
    [
      'generic setup failure',
      'observer failed',
      'error',
      'Failed to initialize content script:',
    ],
    [
      'context invalidation',
      'Extension context invalidated',
      'warn',
      'Extension context invalidated during initialization',
    ],
  ])(
    'handles %s during observer setup',
    async (_label, message, level, expectedLog) => {
      domObserverInitializeMock.mockImplementationOnce(() => {
        throw new Error(message);
      });
      setupChromeRuntimeMock(false);

      await import('./content');
      await flushAsyncTasks();

      if (level === 'warn') {
        expect(loggerWarnMock).toHaveBeenCalledWith(expectedLog);
      } else {
        expect(loggerErrorMock).toHaveBeenCalledWith(
          expectedLog,
          expect.objectContaining({ message }),
        );
      }
      expect(domObserverStartObservingMock).not.toHaveBeenCalled();
    },
  );

  it('ignores malformed configuration responses', async () => {
    setupChromeRuntimeMock(false, {
      exemptDomainsResponse: { exemptDomains: 'example.com' },
      pspConfigResponse: 42,
    });

    await import('./content');
    await flushAsyncTasks();

    expect(setExemptDomainsMock).not.toHaveBeenCalled();
    expect(initializePspMock).not.toHaveBeenCalled();
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
  });

  it('does not let an early uninitialized scan start the cooldown', async () => {
    isInitializedMock.mockReturnValue(false);
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();
    expect(detectPSPMock).not.toHaveBeenCalled();

    isInitializedMock.mockReturnValue(true);
    await getMutationCallback()();

    expect(detectPSPMock).toHaveBeenCalledTimes(1);
  });

  it('skips mutation scans during the detection cooldown', async () => {
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();

    await getMutationCallback()([]);

    expect(detectPSPMock).not.toHaveBeenCalled();
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Detection skipped - cooldown active',
    );
  });

  it('warns and skips detection when the page URL cannot be branded', async () => {
    jest.doMock('./types', () => {
      const actual = jest.requireActual<typeof Types>('./types');
      return {
        ...actual,
        TypeConverters: {
          ...actual.TypeConverters,
          toURL: jest.fn(),
        },
      };
    });
    setupChromeRuntimeMock(false);

    await import('./content');
    jest.dontMock('./types');
    await flushAsyncTasks();

    expect(detectPSPMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Invalid URL for PSP detection:',
      document.URL,
    );
  });

  it('reports all source types and skips a duplicate provider', async () => {
    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [
        {
          psp: 'Script PSP',
          detectionInfo: { method: 'matchString', value: 'cdn.test.com' },
        },
        {
          psp: 'Iframe PSP',
          detectionInfo: { method: 'matchString', value: 'frames.example.com' },
        },
        {
          psp: 'Form PSP',
          detectionInfo: {
            method: 'matchString',
            value: 'checkout.example.com',
          },
        },
        {
          psp: 'Link PSP',
          detectionInfo: { method: 'matchString', value: 'assets.example.com' },
        },
        {
          psp: 'Page PSP',
          detectionInfo: { method: 'matchString', value: 'not-a-dom-source' },
        },
        { psp: 'No Evidence PSP' },
        { psp: 'Script PSP' },
      ],
    });
    const sendMessageMock = setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    const messages = getDetectionMessages(sendMessageMock);
    expect(
      messages.map((message) => message.data.detectionInfo?.sourceType),
    ).toEqual([
      'scriptSrc',
      'iframeSrc',
      'formAction',
      'linkHref',
      'pageUrl',
      undefined,
    ]);
    expect(messages).toHaveLength(6);
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'PSP Script PSP already reported, skipping',
    );
    expect(domObserverStopObservingMock).toHaveBeenCalledTimes(6);
  });

  it('reports a valid detection for tab id zero', async () => {
    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [{ psp: 'Zero Tab PSP' }],
    });
    const sendMessageMock = setupChromeRuntimeMock(false, {
      tabIdResponse: { tabId: 0 },
    });

    await import('./content');
    await flushAsyncTasks();

    expect(getDetectionMessages(sendMessageMock)[0]?.data.tabId).toBe(0);
  });

  it('does not report an empty provider name', async () => {
    const emptyPspName = ' '.repeat(3);
    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [{ psp: emptyPspName }],
    });
    const sendMessageMock = setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(getDetectionMessages(sendMessageMock)).toHaveLength(0);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Content: Skipping detection report for empty PSP name:',
      emptyPspName,
    );
  });

  it('handles exempt and detector error results', async () => {
    detectPSPMock.mockReturnValueOnce({ type: 'exempt' });
    const sendMessageMock = setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(getDetectionMessages(sendMessageMock)[0]?.data.psp).toBe(
      '__PSP_DETECTION_EXEMPT__',
    );
    expect(domObserverStopObservingMock).toHaveBeenCalledTimes(1);

    const windowState = globalThis as typeof globalThis & WindowContentState;
    delete windowState.pspDetectorContentScript;
    jest.resetModules();
    jest.clearAllMocks();
    setupContentDOM();
    setupIdleCallbackMock();
    isInitializedMock.mockReturnValue(true);
    detectPSPMock.mockReturnValue({ type: 'error', error: 'bad config' });
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'PSP detection error:',
      'bad config',
    );
  });

  it('stops observing when exempt reporting sees an invalidated context', async () => {
    jest.useFakeTimers();
    detectPSPMock.mockReturnValue({ type: 'exempt' });
    const sendMessageMock = setupChromeRuntimeMock(false);
    sendMessageMock.mockImplementation(
      (message: RuntimeMessage, callback?: (response: unknown) => void) => {
        if (message.action === MessageAction.GET_EXEMPT_DOMAINS) {
          callback?.({ exemptDomains: [] });
          return;
        }
        if (message.action === MessageAction.GET_PSP_CONFIG) {
          callback?.({ config: { psps: [] } });
          delete (globalThis.chrome.runtime as { id?: string }).id;
          return;
        }

        callback?.({});
      },
    );

    await import('./content');
    await jest.runAllTimersAsync();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Extension context invalidated, stopping content script',
    );
    expect(domObserverStopObservingMock).toHaveBeenCalledTimes(1);
  });

  it('logs a non-retryable exempt reporting failure', async () => {
    detectPSPMock.mockReturnValue({ type: 'exempt' });
    const sendMessageMock = setupChromeRuntimeMock(false);
    sendMessageMock.mockImplementation(
      (message: RuntimeMessage, callback?: (response: unknown) => void) => {
        if (message.action === MessageAction.GET_EXEMPT_DOMAINS) {
          callback?.({ exemptDomains: [] });
          return;
        }
        if (message.action === MessageAction.GET_PSP_CONFIG) {
          callback?.({ config: { psps: [] } });
          return;
        }

        setRuntimeLastError('permission denied');
        callback?.(undefined);
        setRuntimeLastError();
      },
    );

    await import('./content');
    await flushAsyncTasks();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to report detected PSP:',
      expect.objectContaining({ message: 'permission denied' }),
    );
    expect(domObserverStopObservingMock).not.toHaveBeenCalled();
  });

  it('scans child-list subtrees and only relevant script links', async () => {
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const addedTree = document.createElement('section');
    addedTree.innerHTML = `
      <script src="https://sdk.example/new.js"></script>
      <form action="https://pay.example/submit"></form>
      <link rel="preload" as="style" href="https://ignored.example/style.css" />
      <link rel="preload stylesheet" as="script" href="https://sdk.example/preload.js" />
      <link rel="modulepreload" as="script" href="https://sdk.example/module.js" />
      <link href="https://ignored.example/no-rel" />
    `;
    const textNode = document.createTextNode('ignored');
    addedTree.querySelectorAll('link[as]').forEach((link) => {
      Object.defineProperty(link, 'as', {
        value: link.getAttribute('as') ?? '',
        configurable: true,
      });
    });
    const mutation = {
      type: 'childList',
      addedNodes: [textNode, addedTree],
    } as unknown as MutationRecord;

    await getMutationCallback()([mutation]);

    const scanContent = detectPSPMock.mock.calls[0]?.[1] as string;
    expect(scanContent).toContain('sdk.example/new.js');
    expect(scanContent).toContain('pay.example/submit');
    expect(scanContent).toContain('sdk.example/preload.js');
    expect(scanContent).toContain('sdk.example/module.js');
    expect(scanContent).not.toContain('ignored.example');
  });

  it('extracts nested signals from an accessible same-origin iframe once', async () => {
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const iframe = document.createElement('iframe');
    iframe.src = '/embedded-checkout';
    const iframeDocument =
      document.implementation.createHTMLDocument('checkout');
    iframeDocument.body.innerHTML = `
      <iframe src="/nested-frame"></iframe>
      <script src="https://sdk.processor.example/client.js"></script>
      <form action="https://api.processor.example/pay"></form>
    `;
    Object.defineProperty(iframe, 'contentDocument', {
      value: iframeDocument,
      configurable: true,
    });

    await getMutationCallback()([
      {
        type: 'childList',
        addedNodes: [iframe],
      } as unknown as MutationRecord,
    ]);

    const scanContent = detectPSPMock.mock.calls[0]?.[1] as string;
    expect(scanContent).toContain('/nested-frame');
    expect(scanContent).toContain('sdk.processor.example/client.js');
    expect(scanContent).toContain('api.processor.example/pay');

    detectPSPMock.mockClear();
    advancePastDetectionCooldown();
    await getMutationCallback()([
      {
        type: 'attributes',
        target: iframe,
      } as unknown as MutationRecord,
    ]);
    expect(detectPSPMock.mock.calls[0]?.[1]).not.toContain(
      'sdk.processor.example/client.js',
    );
  });

  it('skips an iframe with no browsing context', async () => {
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const iframe = document.createElement('iframe');
    iframe.src = '/unavailable-frame';
    Object.defineProperties(iframe, {
      contentDocument: {
        // eslint-disable-next-line unicorn/no-null -- DOM APIs use null for a missing browsing context
        value: null,
        configurable: true,
      },
      contentWindow: {
        // eslint-disable-next-line unicorn/no-null -- DOM APIs use null for a missing browsing context
        value: null,
        configurable: true,
      },
    });

    await getMutationCallback()([
      {
        type: 'attributes',
        target: iframe,
      } as unknown as MutationRecord,
    ]);

    expect(detectPSPMock).toHaveBeenCalledTimes(1);
  });

  it('continues detection when reading an iframe throws', async () => {
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const iframe = document.createElement('iframe');
    iframe.src = '/throwing-frame';
    Object.defineProperty(iframe, 'contentDocument', {
      get: () => {
        throw new Error('blocked document');
      },
      configurable: true,
    });

    await getMutationCallback()([
      {
        type: 'attributes',
        target: iframe,
      } as unknown as MutationRecord,
    ]);

    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Skipping iframe content due to access error',
      expect.objectContaining({ message: 'blocked document' }),
    );
    expect(detectPSPMock).toHaveBeenCalledTimes(1);
  });

  it('waits for an iframe load before extracting its document', async () => {
    document.body.innerHTML = '<script src="/merchant.js"></script>';
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const iframe = document.createElement('iframe');
    iframe.src = '/loading-frame';
    let loadedDocument: Document | undefined;
    Object.defineProperties(iframe, {
      contentDocument: {
        get: () => loadedDocument,
        configurable: true,
      },
      contentWindow: {
        value: {
          get document(): Document | undefined {
            return loadedDocument;
          },
        },
        configurable: true,
      },
    });

    setTimeout(() => {
      loadedDocument = document.implementation.createHTMLDocument('loaded');
      loadedDocument.body.innerHTML =
        '<script src="https://loaded.processor.example/sdk.js"></script>';
      iframe.dispatchEvent(new Event('load'));
    }, 0);

    await getMutationCallback()([
      {
        type: 'attributes',
        target: iframe,
      } as unknown as MutationRecord,
    ]);

    expect(detectPSPMock.mock.calls[0]?.[1]).toContain(
      'loaded.processor.example/sdk.js',
    );
  });

  it('rejects a malformed iframe source without aborting detection', async () => {
    document.body.innerHTML = '<script src="/merchant.js"></script>';
    setupChromeRuntimeMock(false);
    await import('./content');
    await flushAsyncTasks();
    detectPSPMock.mockClear();
    advancePastDetectionCooldown();

    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'src', {
      value: 'https://[',
      configurable: true,
    });

    await getMutationCallback()([
      {
        type: 'attributes',
        target: iframe,
      } as unknown as MutationRecord,
    ]);

    expect(detectPSPMock).toHaveBeenCalledTimes(1);
  });

  it('limits iframe reads to ten unique sources', async () => {
    document.body.innerHTML = Array.from(
      { length: 11 },
      (_, index) => `<iframe src="/frame-${index}"></iframe>`,
    ).join('');
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Iframe processing limit reached (10)',
    );
  });

  it('retries transient service-worker errors and then succeeds', async () => {
    jest.useFakeTimers();
    const sendMessageMock = setupChromeRuntimeMock(false);
    let exemptAttempts = 0;
    sendMessageMock.mockImplementation(
      (message: RuntimeMessage, callback?: (response: unknown) => void) => {
        if (message.action === MessageAction.GET_EXEMPT_DOMAINS) {
          exemptAttempts += 1;
          if (exemptAttempts < 3) {
            setRuntimeLastError('service worker was stopped');
            callback?.(undefined);
            setRuntimeLastError();
            return;
          }
          callback?.({ exemptDomains: [] });
          return;
        }
        if (message.action === MessageAction.GET_PSP_CONFIG) {
          callback?.({ config: { psps: [] } });
          return;
        }
        callback?.({});
      },
    );

    await import('./content');
    await jest.runAllTimersAsync();

    expect(exemptAttempts).toBe(3);
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
  });

  it('wraps exhausted service-worker retries', async () => {
    jest.useFakeTimers();
    const sendMessageMock = setupChromeRuntimeMock(false);
    let exemptAttempts = 0;
    sendMessageMock.mockImplementation(
      (message: RuntimeMessage, callback?: (response: unknown) => void) => {
        if (message.action === MessageAction.GET_EXEMPT_DOMAINS) {
          exemptAttempts += 1;
          setRuntimeLastError('receiving end does not exist');
          callback?.(undefined);
          setRuntimeLastError();
          return;
        }
        if (message.action === MessageAction.GET_PSP_CONFIG) {
          callback?.({ config: { psps: [] } });
          return;
        }
        callback?.({});
      },
    );

    await import('./content');
    await jest.runAllTimersAsync();

    expect(exemptAttempts).toBe(3);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to communicate with service worker after retries',
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to initialize exempt domains:',
      expect.objectContaining({
        message: 'Service worker communication failed',
      }),
    );
  });

  it.each([
    ['same-host', 'https://localhost/checkout'],
    ['non-http', 'mailto:billing@example.com'],
    ['malformed', 'not a url'],
  ])('omits merchant origin for a %s referrer', async (_label, referrer) => {
    Object.defineProperty(document, 'referrer', {
      value: referrer,
      configurable: true,
    });
    detectPSPMock.mockReturnValue({
      type: 'detected',
      psps: [{ psp: 'Referrer PSP' }],
    });
    const sendMessageMock = setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(getDetectionMessages(sendMessageMock)[0]?.data).not.toHaveProperty(
      'merchantOrigin',
    );
  });

  it('reinitializes when the background loses same-page state', async () => {
    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = {
      initialized: true,
      url: document.URL,
    };
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Background script lost state, forcing re-initialization',
    );
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Content script state reset for new page',
    );
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
  });

  it('reinitializes when the existing content state belongs to another URL', async () => {
    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = {
      initialized: true,
      url: 'https://previous.example/',
    };
    setupChromeRuntimeMock(false);

    await import('./content');
    await flushAsyncTasks();

    expect(loggerDebugMock).toHaveBeenCalledWith(
      expect.stringContaining('Content script URL changed from'),
    );
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Content script state reset for new page',
    );
  });

  it('treats a missing runtime as lost background state', async () => {
    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = {
      initialized: true,
      url: document.URL,
    };
    const sendMessageMock = setupChromeRuntimeMock(false);
    delete (globalThis.chrome.runtime as { id?: string }).id;

    await import('./content');
    await flushAsyncTasks();

    expect(sendMessageMock).not.toHaveBeenCalledWith({
      action: MessageAction.CHECK_TAB_STATE,
    });
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Background script lost state, forcing re-initialization',
    );
  });

  it('treats a rejected background state check as lost state', async () => {
    const windowState = globalThis as typeof globalThis & WindowContentState;
    windowState.pspDetectorContentScript = {
      initialized: true,
      url: document.URL,
    };
    const sendMessageMock = setupChromeRuntimeMock(false);
    sendMessageMock.mockRejectedValueOnce(new Error('background unavailable'));

    await import('./content');
    await flushAsyncTasks();

    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Background state check failed',
      expect.objectContaining({ message: 'background unavailable' }),
    );
    expect(domObserverStartObservingMock).toHaveBeenCalledTimes(1);
  });
});
