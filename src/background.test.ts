import { STORAGE_KEYS } from './lib/storage-keys';
import { MessageAction } from './types';

type StorageQuery = string | string[] | Record<string, unknown>;

type InstalledListener = (details: chrome.runtime.InstalledDetails) => void;
type StartupListener = () => void;
type SuspendListener = () => void;
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;
type TabActivatedListener = (activeInfo: { tabId: number }) => void;
type TabUpdatedListener = (
  tabId: number,
  changeInfo: unknown,
  tab: chrome.tabs.Tab,
) => void;
type TabRemovedListener = (tabId: number) => void;
type PermissionAddedListener = (
  permissions: chrome.permissions.Permissions,
) => void;

interface EventMock<T extends (...args: never[]) => unknown> {
  addListener: jest.Mock<void, [T]>;
  getListener: () => T | null;
}

interface ChromeMockContext {
  onInstalled: EventMock<InstalledListener>;
  onActivated: EventMock<TabActivatedListener>;
  onSuspend: EventMock<SuspendListener>;
  onMessage: EventMock<MessageListener>;
  onRemoved: EventMock<TabRemovedListener>;
  tabsCreate: jest.Mock<Promise<unknown>, [chrome.tabs.CreateProperties]>;
  tabsQuery: jest.Mock<Promise<chrome.tabs.Tab[]>, [chrome.tabs.QueryInfo]>;
  tabsGet: jest.Mock<Promise<chrome.tabs.Tab>, [number]>;
  executeScript: jest.Mock;
  actionSetIcon: jest.Mock;
  actionSetBadgeText: jest.Mock;
  actionSetBadgeBackgroundColor: jest.Mock;
  permissionContains: jest.Mock<
    Promise<boolean>,
    [chrome.permissions.Permissions]
  >;
  localSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  localRemove: jest.Mock<Promise<void>, [string | string[]]>;
  sessionGet: jest.Mock;
  sessionSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  webRequestAddListener: jest.Mock;
  getURL: jest.Mock<string, [string]>;
}

interface ChromeMockOptions {
  activeTabUrl?: string;
  exemptDomains?: string[];
  hasHostPermission?: boolean;
  hasWebRequestPermission?: boolean;
  pspConfig?: Record<string, unknown>;
}

const DEFAULT_ACTIVE_TAB_URL = 'https://shop.example.com/cart';
const CHECKOUT_EXAMPLE_URL = 'https://checkout.example.com';
const STRIPE_MATCH_STRING = 'js.stripe.com';
const ON_MESSAGE_LISTENER_ERROR =
  'Expected onMessage listener to be registered';
const WEBREQUEST_LISTENER_ERROR =
  'Expected webRequest listener to be registered';

interface NormalizedChromeMockOptions {
  activeTabUrl: string;
  exemptDomains: string[];
  hasHostPermission: boolean;
  hasWebRequestPermission: boolean;
  pspConfig: Record<string, unknown>;
}

interface ChromeEventMocks {
  onInstalled: EventMock<InstalledListener>;
  onStartup: EventMock<StartupListener>;
  onSuspend: EventMock<SuspendListener>;
  onMessage: EventMock<MessageListener>;
  onActivated: EventMock<TabActivatedListener>;
  onUpdated: EventMock<TabUpdatedListener>;
  onRemoved: EventMock<TabRemovedListener>;
  onPermissionAdded: EventMock<PermissionAddedListener>;
}

function createDefaultPSPConfig(): Record<string, unknown> {
  return {
    psps: [
      {
        name: 'Stripe',
        matchStrings: [STRIPE_MATCH_STRING],
        image: 'stripe',
        summary: 'Stripe',
        url: 'https://stripe.com',
      },
    ],
  };
}

function normalizeChromeMockOptions(
  options: ChromeMockOptions,
): NormalizedChromeMockOptions {
  return {
    activeTabUrl: options.activeTabUrl ?? DEFAULT_ACTIVE_TAB_URL,
    exemptDomains: options.exemptDomains ?? [],
    hasHostPermission: options.hasHostPermission ?? true,
    hasWebRequestPermission: options.hasWebRequestPermission ?? false,
    pspConfig: options.pspConfig ?? createDefaultPSPConfig(),
  };
}

function createChromeEventMocks(): ChromeEventMocks {
  return {
    onInstalled: createEventMock<InstalledListener>(),
    onStartup: createEventMock<StartupListener>(),
    onSuspend: createEventMock<SuspendListener>(),
    onMessage: createEventMock<MessageListener>(),
    onActivated: createEventMock<TabActivatedListener>(),
    onUpdated: createEventMock<TabUpdatedListener>(),
    onRemoved: createEventMock<TabRemovedListener>(),
    onPermissionAdded: createEventMock<PermissionAddedListener>(),
  };
}

function createEventMock<
  T extends (...args: never[]) => unknown,
>(): EventMock<T> {
  let listener: T | null = null;
  const addListener = jest.fn<void, [T]>((nextListener: T) => {
    listener = nextListener;
  });
  return {
    addListener,
    getListener: () => listener,
  };
}

function readStorage(
  store: Record<string, unknown>,
  query: StorageQuery,
): Record<string, unknown> {
  if (typeof query === 'string') {
    return { [query]: store[query] };
  }

  if (Array.isArray(query)) {
    return query.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = store[key];
      return acc;
    }, {});
  }

  return Object.entries(query).reduce<Record<string, unknown>>(
    (acc, [key, fallback]) => {
      const value = store[key];
      acc[key] = value === undefined ? fallback : value;
      return acc;
    },
    {},
  );
}

function createFetchResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  } as Response;
}

function setupChromeMocks(options: ChromeMockOptions = {}): ChromeMockContext {
  const normalized = normalizeChromeMockOptions(options);
  const {
    activeTabUrl,
    exemptDomains,
    hasHostPermission,
    hasWebRequestPermission,
    pspConfig,
  } = normalized;

  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {
    [STORAGE_KEYS.TAB_PSPS]: {
      12: [{ psp: 'Stripe' }],
    } as Record<number, { psp: string }[]>,
  };

  const eventMocks = createChromeEventMocks();
  const {
    onInstalled,
    onStartup,
    onSuspend,
    onMessage,
    onActivated,
    onUpdated,
    onRemoved,
    onPermissionAdded,
  } = eventMocks;

  const getURL = jest.fn(
    (assetPath: string) => `chrome-extension://test/${assetPath}`,
  );
  const tabsCreate = jest.fn().mockResolvedValue({ id: 999 });
  const tabsQuery = jest
    .fn()
    .mockResolvedValue([{ id: 12, url: activeTabUrl } as chrome.tabs.Tab]);
  const tabsGet = jest
    .fn()
    .mockImplementation(async (tabId: number): Promise<chrome.tabs.Tab> => {
      return { id: tabId, url: activeTabUrl } as chrome.tabs.Tab;
    });
  const executeScript = jest.fn().mockResolvedValue([]);
  const permissionContains = jest.fn().mockResolvedValue(hasHostPermission);
  const permissionRequest = jest.fn().mockResolvedValue(false);
  const permissionGetAll = jest.fn().mockResolvedValue({
    permissions: hasWebRequestPermission ? ['webRequest'] : [],
  });

  const localGet = jest
    .fn()
    .mockImplementation(async (query: StorageQuery) =>
      readStorage(localStore, query),
    );
  const localSet = jest
    .fn()
    .mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(localStore, items);
    });
  const localRemove = jest
    .fn()
    .mockImplementation(async (keys: string | string[]) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      for (const key of normalizedKeys) {
        delete localStore[key];
      }
    });

  const sessionGet = jest
    .fn()
    .mockImplementation(async (query: StorageQuery) =>
      readStorage(sessionStore, query),
    );
  const sessionSet = jest
    .fn()
    .mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(sessionStore, items);
    });
  const actionSetIcon = jest.fn();
  const actionSetTitle = jest.fn();
  const actionSetBadgeText = jest.fn();
  const actionSetBadgeBackgroundColor = jest.fn();

  const fetchMock = jest.fn().mockImplementation(async (resource: unknown) => {
    const url = typeof resource === 'string' ? resource : String(resource);
    if (url.includes('psps.json')) {
      return createFetchResponse(pspConfig);
    }

    return createFetchResponse({ exemptDomains });
  });

  const webRequestAddListener = jest.fn();

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener: onInstalled.addListener },
      onStartup: { addListener: onStartup.addListener },
      onSuspend: { addListener: onSuspend.addListener },
      onMessage: { addListener: onMessage.addListener },
      getURL,
      lastError: undefined,
    },
    tabs: {
      onActivated: { addListener: onActivated.addListener },
      onUpdated: { addListener: onUpdated.addListener },
      onRemoved: { addListener: onRemoved.addListener },
      create: tabsCreate,
      query: tabsQuery,
      get: tabsGet,
    },
    storage: {
      local: {
        get: localGet,
        set: localSet,
        remove: localRemove,
      },
      session: {
        get: sessionGet,
        set: sessionSet,
      },
    },
    permissions: {
      contains: permissionContains,
      request: permissionRequest,
      getAll: permissionGetAll,
      onAdded: { addListener: onPermissionAdded.addListener },
    },
    scripting: {
      executeScript,
    },
    action: {
      setIcon: actionSetIcon,
      setTitle: actionSetTitle,
      setBadgeText: actionSetBadgeText,
      setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
    },
    webRequest: {
      onBeforeRequest: {
        addListener: webRequestAddListener,
      },
    },
  } as unknown as typeof chrome;

  return {
    onInstalled,
    onActivated,
    onSuspend,
    onMessage,
    onRemoved,
    tabsCreate,
    tabsQuery,
    tabsGet,
    executeScript,
    actionSetIcon,
    actionSetBadgeText,
    actionSetBadgeBackgroundColor,
    permissionContains,
    localSet,
    localRemove,
    sessionGet,
    sessionSet,
    webRequestAddListener,
    getURL,
  };
}

async function flushAsyncTasks(waitMs = 0): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, waitMs);
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getRegisteredMessageListener(
  mocks: ChromeMockContext,
): MessageListener {
  const messageListener = mocks.onMessage.getListener();
  if (messageListener === null) {
    throw new Error(ON_MESSAGE_LISTENER_ERROR);
  }

  return messageListener;
}

function getRegisteredWebRequestListener(
  mocks: ChromeMockContext,
): (details: chrome.webRequest.WebRequestDetails) => void {
  const networkListener = mocks.webRequestAddListener.mock.calls[0]?.[0] as
    | ((details: chrome.webRequest.WebRequestDetails) => void)
    | undefined;
  if (networkListener === undefined) {
    throw new Error(WEBREQUEST_LISTENER_ERROR);
  }

  return networkListener;
}

async function getDetectedPspsForTab(
  messageListener: MessageListener,
  tabId: number,
): Promise<unknown> {
  const sendResponse = jest.fn();
  messageListener(
    { action: MessageAction.GET_PSP },
    { tab: { id: tabId } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
    sendResponse,
  );

  await flushAsyncTasks();

  const payload = sendResponse.mock.calls.at(-1)?.[0] as
    | { psps?: unknown }
    | undefined;
  return payload?.psps ?? [];
}

describe('background service onboarding and re-detect flow', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('opens onboarding instructions when extension is installed', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const installedListener = mocks.onInstalled.getListener();
    if (installedListener === null) {
      throw new Error('Expected onInstalled listener to be registered');
    }

    installedListener({
      reason: 'install',
    } as chrome.runtime.InstalledDetails);

    await flushAsyncTasks();

    expect(mocks.tabsCreate).toHaveBeenCalledWith({
      url: mocks.getURL('onboarding.html'),
    });

    expect(mocks.sessionSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.TAB_PSPS]: {},
    });

    expect(mocks.localRemove).toHaveBeenCalledWith([
      STORAGE_KEYS.CACHED_PSP_CONFIG,
      STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE,
    ]);
  });

  it('re-detects PSP on the current tab when requested', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.REDETECT_CURRENT_TAB },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await flushAsyncTasks();

    expect(mocks.tabsQuery).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });

    expect(mocks.permissionContains).toHaveBeenCalledWith({
      origins: ['https://*/*'],
    });

    expect(mocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 12 },
      files: ['content.js'],
    });

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('skips re-detection and returns exempt reason for exempt domain tabs', async () => {
    const mocks = setupChromeMocks({
      activeTabUrl: CHECKOUT_EXAMPLE_URL,
      exemptDomains: ['example.com'],
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.REDETECT_CURRENT_TAB },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await flushAsyncTasks();

    expect(mocks.executeScript).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      reason: 'Tab is exempt or restricted',
    });
  });

  it('keeps tab PSP state in memory instead of re-reading session storage', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 12 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await flushAsyncTasks();

    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 12 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await flushAsyncTasks();

    // One session read at restoreState; subsequent calls use in-memory cache.
    expect(mocks.sessionGet).toHaveBeenCalledTimes(1);
  });

  it('flushes debounced tab PSP persistence on suspend', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    const onSuspendListener = mocks.onSuspend.getListener();
    if (messageListener === null || onSuspendListener === null) {
      throw new Error('Expected listeners to be registered');
    }

    const sendResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Primer',
          tabId: 77,
          detectionInfo: {
            method: 'matchString',
            value: 'api.primer.io',
            sourceType: 'networkRequest',
          },
        },
      },
      { tab: { id: 77, url: 'https://shop.example.com' } as chrome.tabs.Tab },
      sendResponse,
    );

    await flushAsyncTasks();

    expect(sendResponse).toHaveBeenCalledWith(null);
    expect(mocks.sessionSet).not.toHaveBeenCalled();

    onSuspendListener();
    await flushAsyncTasks();

    expect(mocks.sessionSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.TAB_PSPS]: expect.objectContaining({
        77: expect.arrayContaining([
          expect.objectContaining({ psp: 'Primer' }),
        ]),
      }),
    });
  });

  it('registers webRequest listener with narrowed request types', async () => {
    const mocks = setupChromeMocks({ hasWebRequestPermission: true });
    await import('./background');
    await flushAsyncTasks();

    expect(mocks.webRequestAddListener).toHaveBeenCalledTimes(1);
    const requestFilter = mocks.webRequestAddListener.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(requestFilter).toEqual({
      urls: ['https://*/*'],
      types: ['script', 'xmlhttprequest', 'sub_frame'],
    });
  });

  it('deduplicates repeated network matches per tab', async () => {
    const mocks = setupChromeMocks({
      hasWebRequestPermission: true,
      pspConfig: {
        psps: [
          {
            name: 'Stripe',
            matchStrings: [STRIPE_MATCH_STRING],
            image: 'stripe',
            summary: 'Stripe',
            url: 'https://stripe.com',
          },
        ],
      },
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);

    const getConfigResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {} as chrome.runtime.MessageSender,
      getConfigResponse,
    );

    await flushAsyncTasks();

    const networkListener = getRegisteredWebRequestListener(mocks);

    networkListener({
      tabId: 91,
      url: 'https://js.stripe.com/v3/elements.js',
      type: 'script',
    } as chrome.webRequest.WebRequestDetails);

    await flushAsyncTasks();

    const firstPsps = await getDetectedPspsForTab(messageListener, 91);
    expect(firstPsps).toEqual([expect.objectContaining({ psp: 'Stripe' })]);

    networkListener({
      tabId: 91,
      url: 'https://js.stripe.com/v3/elements.js',
      type: 'script',
    } as chrome.webRequest.WebRequestDetails);

    await flushAsyncTasks();

    const secondPsps = await getDetectedPspsForTab(messageListener, 91);
    expect(secondPsps).toEqual([expect.objectContaining({ psp: 'Stripe' })]);

    const onSuspendListener = mocks.onSuspend.getListener();
    if (onSuspendListener === null) {
      throw new Error('Expected onSuspend listener to be registered');
    }

    onSuspendListener();
    await flushAsyncTasks();

    expect(mocks.sessionSet).toHaveBeenCalled();
    const persisted = mocks.sessionSet.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const tabPsps = persisted?.[STORAGE_KEYS.TAB_PSPS] as
      | Record<string, { psp: string }[]>
      | undefined;
    const tabEntries = tabPsps?.['91'] ?? [];
    expect(tabEntries).toHaveLength(1);
    expect(tabEntries[0]).toMatchObject({ psp: 'Stripe' });
  });

  it('upgrades network match to higher-priority DOM source for the same PSP', async () => {
    const mocks = setupChromeMocks({
      hasWebRequestPermission: true,
      activeTabUrl: CHECKOUT_EXAMPLE_URL,
      pspConfig: {
        psps: [
          {
            name: 'Stripe',
            matchStrings: [STRIPE_MATCH_STRING],
            image: 'stripe',
            summary: 'Stripe',
            url: 'https://stripe.com',
          },
        ],
      },
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const getConfigResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {} as chrome.runtime.MessageSender,
      getConfigResponse,
    );

    await flushAsyncTasks();

    const networkListener = mocks.webRequestAddListener.mock.calls[0]?.[0] as
      | ((details: chrome.webRequest.WebRequestDetails) => void)
      | undefined;
    if (networkListener === undefined) {
      throw new Error(WEBREQUEST_LISTENER_ERROR);
    }

    networkListener({
      tabId: 91,
      url: 'https://js.stripe.com/v3/elements.js',
      type: 'script',
    } as chrome.webRequest.WebRequestDetails);

    await flushAsyncTasks();

    const detectResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          tabId: 91,
          detectionInfo: {
            method: 'matchString',
            value: STRIPE_MATCH_STRING,
            sourceType: 'scriptSrc',
          },
        },
      },
      {
        tab: {
          id: 91,
          url: CHECKOUT_EXAMPLE_URL,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
      detectResponse,
    );

    await flushAsyncTasks();
    expect(detectResponse).toHaveBeenCalledWith(null);

    const pspResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 91 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
      pspResponse,
    );

    await flushAsyncTasks();

    expect(pspResponse).toHaveBeenLastCalledWith({
      psps: [
        expect.objectContaining({
          psp: 'Stripe',
          detectionInfo: expect.objectContaining({
            sourceType: 'scriptSrc',
          }) as unknown,
        }),
      ],
    });
  });

  it('shows the highest-priority PSP icon and +N badge for extra detections', async () => {
    const mocks = setupChromeMocks({
      activeTabUrl: CHECKOUT_EXAMPLE_URL,
      pspConfig: {
        psps: [
          {
            name: 'Adyen',
            matchStrings: ['checkoutshopper-live.adyen.com'],
            image: 'adyen',
            summary: 'Adyen',
            url: 'https://adyen.com',
          },
          {
            name: 'Stripe',
            matchStrings: [STRIPE_MATCH_STRING],
            image: 'stripe',
            summary: 'Stripe',
            url: 'https://stripe.com',
          },
        ],
      },
    });
    await import('./background');
    await flushAsyncTasks();

    const activatedListener = mocks.onActivated.getListener();
    if (activatedListener === null) {
      throw new Error('Expected onActivated listener to be registered');
    }

    activatedListener({ tabId: 91 });
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    const configResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {} as chrome.runtime.MessageSender,
      configResponse,
    );

    await flushAsyncTasks();

    const stripeResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          tabId: 91,
          detectionInfo: {
            method: 'matchString',
            value: STRIPE_MATCH_STRING,
            sourceType: 'scriptSrc',
          },
        },
      },
      {
        tab: {
          id: 91,
          url: CHECKOUT_EXAMPLE_URL,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
      stripeResponse,
    );

    await flushAsyncTasks();

    const adyenResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Adyen',
          tabId: 91,
          detectionInfo: {
            method: 'matchString',
            value: 'checkoutshopper-live.adyen.com',
            sourceType: 'iframeSrc',
          },
        },
      },
      {
        tab: {
          id: 91,
          url: CHECKOUT_EXAMPLE_URL,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
      adyenResponse,
    );

    await flushAsyncTasks();

    expect(stripeResponse).toHaveBeenCalledWith(null);
    expect(adyenResponse).toHaveBeenCalledWith(null);
    expect(await getDetectedPspsForTab(messageListener, 91)).toEqual([
      expect.objectContaining({ psp: 'Adyen' }),
      expect.objectContaining({ psp: 'Stripe' }),
    ]);

    expect(mocks.actionSetIcon.mock.calls.at(-1)?.[0]).toEqual({
      path: {
        48: 'images/adyen_48.png',
        128: 'images/adyen_128.png',
      },
    });

    expect(mocks.actionSetBadgeText).toHaveBeenLastCalledWith({
      text: '+1',
    });

    expect(mocks.actionSetBadgeBackgroundColor).toHaveBeenLastCalledWith({
      color: '#6B7280',
    });
  });
});
