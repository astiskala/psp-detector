import { STORAGE_KEYS } from './lib/storage-keys';
import { MessageAction, PSP_DETECTION_EXEMPT } from './types';

interface HistoryEntryLike {
  readonly domain?: string;
  readonly merchantOrigin?: string;
}

type StorageQuery = string | string[] | Record<string, unknown>;

type InstalledListener = (
  details: chrome.runtime.InstalledDetails,
) => void | Promise<void>;
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

interface EventMock<T extends (...arguments_: never[]) => unknown> {
  addListener: jest.Mock<void, [T]>;
  getListener: () => T | undefined;
}

interface ChromeMockContext {
  onInstalled: EventMock<InstalledListener>;
  onStartup: EventMock<StartupListener>;
  onActivated: EventMock<TabActivatedListener>;
  onUpdated: EventMock<TabUpdatedListener>;
  onSuspend: EventMock<SuspendListener>;
  onMessage: EventMock<MessageListener>;
  onRemoved: EventMock<TabRemovedListener>;
  onPermissionAdded: EventMock<PermissionAddedListener>;
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
  permissionGetAll: jest.Mock;
  permissionRequest: jest.Mock;
  localGet: jest.Mock;
  localSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  localRemove: jest.Mock<Promise<void>, [string | string[]]>;
  sessionGet: jest.Mock;
  sessionSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  webRequestAddListener: jest.Mock;
  getURL: jest.Mock<string, [string]>;
  fetchMock: jest.Mock;
}

interface ChromeMockOptions {
  activeTabUrl?: string;
  exemptDomains?: string[];
  hasHostPermission?: boolean;
  hasWebRequestPermission?: boolean;
  localStore?: Record<string, unknown>;
  pspConfig?: Record<string, unknown>;
  sessionStore?: Record<string, unknown>;
}

const DEFAULT_ACTIVE_TAB_URL = 'https://shop.example.com/cart';
const CHECKOUT_EXAMPLE_URL = 'https://checkout.example.com';
const EXAMPLE_DOMAIN = 'example.com';
const STRIPE_MATCH_STRING = 'js.stripe.com';
const NULL_VALUE = JSON.parse('null') as Record<string, unknown>;
const ON_MESSAGE_LISTENER_ERROR =
  'Expected onMessage listener to be registered';
const WEBREQUEST_LISTENER_ERROR =
  'Expected webRequest listener to be registered';

interface NormalizedChromeMockOptions {
  activeTabUrl: string;
  exemptDomains: string[];
  hasHostPermission: boolean;
  hasWebRequestPermission: boolean;
  localStore: Record<string, unknown>;
  pspConfig: Record<string, unknown>;
  sessionStore: Record<string, unknown>;
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
    localStore: options.localStore ?? {},
    pspConfig: options.pspConfig ?? createDefaultPSPConfig(),
    sessionStore: options.sessionStore ?? {
      [STORAGE_KEYS.TAB_PSPS]: {
        12: [{ psp: 'Stripe' }],
      },
    },
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
  T extends (...arguments_: never[]) => unknown,
>(): EventMock<T> {
  let listener: T | undefined;
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
    return Object.fromEntries(query.map((key) => [key, store[key]]));
  }

  return Object.fromEntries(
    Object.entries(query).map(([key, fallback]) => {
      const value = store[key];
      return [key, value === undefined ? fallback : value];
    }),
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
    localStore: initialLocalStore,
    pspConfig,
    sessionStore: initialSessionStore,
  } = normalized;

  const localStore: Record<string, unknown> = { ...initialLocalStore };
  const sessionStore: Record<string, unknown> = { ...initialSessionStore };

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
    .mockImplementation(
      async (tabId: number): Promise<chrome.tabs.Tab> =>
        ({ id: tabId, url: activeTabUrl }) as chrome.tabs.Tab,
    );
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
        Reflect.deleteProperty(localStore, key);
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
  const actionSetIcon = jest.fn().mockResolvedValue(undefined);
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

  globalThis.fetch = fetchMock;

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
    onStartup,
    onActivated,
    onUpdated,
    onSuspend,
    onMessage,
    onRemoved,
    onPermissionAdded,
    tabsCreate,
    tabsQuery,
    tabsGet,
    executeScript,
    actionSetIcon,
    actionSetBadgeText,
    actionSetBadgeBackgroundColor,
    permissionContains,
    permissionGetAll,
    permissionRequest,
    localGet,
    localSet,
    localRemove,
    sessionGet,
    sessionSet,
    webRequestAddListener,
    getURL,
    fetchMock,
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
  if (messageListener === undefined) {
    throw new Error(ON_MESSAGE_LISTENER_ERROR);
  }

  return messageListener;
}

function getRegisteredWebRequestListener(
  mocks: ChromeMockContext,
): (details: chrome.webRequest.WebRequestDetails) => void {
  const networkListener = mocks.webRequestAddListener.mock.calls[0]?.[0] as
    ((details: chrome.webRequest.WebRequestDetails) => void) | undefined;
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
    { tab: { id: tabId } as chrome.tabs.Tab },
    sendResponse,
  );

  await flushAsyncTasks();

  const payload = sendResponse.mock.calls.at(-1)?.[0] as
    undefined | { psps?: unknown };
  return payload?.psps ?? [];
}

async function sendMessage(
  mocks: ChromeMockContext,
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
): Promise<unknown> {
  const sendResponse = jest.fn();
  getRegisteredMessageListener(mocks)(message, sender, sendResponse);
  await flushAsyncTasks();
  return sendResponse.mock.calls.at(-1)?.[0];
}

function getLatestHistoryEntries(
  localSet: jest.Mock<Promise<void>, [Record<string, unknown>]>,
): HistoryEntryLike[] | undefined {
  const historyWrites = localSet.mock.calls
    .map((call) => call[0])
    .filter(
      (
        payload,
      ): payload is { [STORAGE_KEYS.PSP_HISTORY]: HistoryEntryLike[] } => {
        if (typeof payload !== 'object' || payload === null) return false;
        return Object.hasOwn(payload, STORAGE_KEYS.PSP_HISTORY);
      },
    );
  return historyWrites.at(-1)?.[STORAGE_KEYS.PSP_HISTORY];
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
    if (installedListener === undefined) {
      throw new Error('Expected onInstalled listener to be registered');
    }

    await installedListener({
      reason: 'install',
    });

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
    if (messageListener === undefined) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.REDETECT_CURRENT_TAB },
      {},
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
      exemptDomains: [EXAMPLE_DOMAIN],
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === undefined) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.REDETECT_CURRENT_TAB },
      {},
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
    if (messageListener === undefined) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 12 } as chrome.tabs.Tab },
      sendResponse,
    );

    await flushAsyncTasks();

    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 12 } as chrome.tabs.Tab },
      sendResponse,
    );

    await flushAsyncTasks();

    // One session read at restoreState; subsequent calls use in-memory cache.
    expect(mocks.sessionGet).toHaveBeenCalledTimes(1);
  });

  it('persists tab PSP cache immediately and again on suspend', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    const onSuspendListener = mocks.onSuspend.getListener();
    if (messageListener === undefined || onSuspendListener === undefined) {
      throw new Error('Expected listeners to be registered');
    }

    const sendResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Primer',
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

    expect(sendResponse).toHaveBeenCalledWith();
    // Persist runs immediately so MV3 worker termination cannot drop the
    // detection while a debounce timer was still pending.
    expect(mocks.sessionSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.TAB_PSPS]: expect.objectContaining({
        77: expect.arrayContaining([
          expect.objectContaining({ psp: 'Primer' }),
        ]),
      }),
    });

    const sessionSetCallsBeforeSuspend = mocks.sessionSet.mock.calls.length;

    onSuspendListener();
    await flushAsyncTasks();

    // onSuspend keeps acting as a safety net but is a no-op here because the
    // cache is already clean.
    expect(mocks.sessionSet.mock.calls).toHaveLength(
      sessionSetCallsBeforeSuspend,
    );
  });

  it('registers webRequest listener with narrowed request types', async () => {
    const mocks = setupChromeMocks({ hasWebRequestPermission: true });
    await import('./background');
    await flushAsyncTasks();

    expect(mocks.webRequestAddListener).toHaveBeenCalledTimes(1);
    const requestFilter = mocks.webRequestAddListener.mock.calls[0]?.[1] as
      Record<string, unknown> | undefined;
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
      {},
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
    if (onSuspendListener === undefined) {
      throw new Error('Expected onSuspend listener to be registered');
    }

    onSuspendListener();
    await flushAsyncTasks();

    expect(mocks.sessionSet).toHaveBeenCalled();
    const persisted = mocks.sessionSet.mock.calls.at(-1)?.[0];
    const tabPsps = persisted?.[STORAGE_KEYS.TAB_PSPS] as
      Record<string, { psp: string }[]> | undefined;
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
    if (messageListener === undefined) {
      throw new Error(ON_MESSAGE_LISTENER_ERROR);
    }

    const getConfigResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {},
      getConfigResponse,
    );

    await flushAsyncTasks();

    const networkListener = mocks.webRequestAddListener.mock.calls[0]?.[0] as
      ((details: chrome.webRequest.WebRequestDetails) => void) | undefined;
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
      },
      detectResponse,
    );

    await flushAsyncTasks();
    expect(detectResponse).toHaveBeenCalledWith();

    const pspResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 91 } as chrome.tabs.Tab },
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
    if (activatedListener === undefined) {
      throw new Error('Expected onActivated listener to be registered');
    }

    activatedListener({ tabId: 91 });
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    const configResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {},
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
      },
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
      },
      adyenResponse,
    );

    await flushAsyncTasks();

    expect(stripeResponse).toHaveBeenCalledWith();
    expect(adyenResponse).toHaveBeenCalledWith();
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

  it('records merchantOrigin on the history entry for redirect detections', async () => {
    const mocks = setupChromeMocks({
      activeTabUrl: 'https://checkout.psp.example/pay',
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    const configResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {},
      configResponse,
    );
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
            sourceType: 'pageUrl',
          },
          merchantOrigin: 'https://shop.merchant.example',
        },
      },
      {
        tab: {
          id: 91,
          url: 'https://checkout.psp.example/pay',
        } as chrome.tabs.Tab,
      },
      detectResponse,
    );
    await flushAsyncTasks();

    const entries = getLatestHistoryEntries(mocks.localSet);
    expect(entries).toBeDefined();
    expect(entries?.[0]).toEqual(
      expect.objectContaining({
        domain: 'checkout.psp.example',
        merchantOrigin: 'https://shop.merchant.example',
      }),
    );
  });

  it('omits merchantOrigin when it matches the detection page domain', async () => {
    const mocks = setupChromeMocks({
      activeTabUrl: 'https://shop.merchant.example/cart',
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    const configResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      {},
      configResponse,
    );
    await flushAsyncTasks();

    const detectResponse = jest.fn();
    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          tabId: 92,
          detectionInfo: {
            method: 'matchString',
            value: STRIPE_MATCH_STRING,
            sourceType: 'scriptSrc',
          },
          merchantOrigin: 'https://shop.merchant.example',
        },
      },
      {
        tab: {
          id: 92,
          url: 'https://shop.merchant.example/cart',
        } as chrome.tabs.Tab,
      },
      detectResponse,
    );
    await flushAsyncTasks();

    const entries = getLatestHistoryEntries(mocks.localSet);
    expect(entries).toBeDefined();
    expect(entries?.[0]).not.toHaveProperty('merchantOrigin');
  });
});

describe('background service edge-case coverage', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  it('routes utility messages and rejects malformed or unknown messages', async () => {
    const mocks = setupChromeMocks({ exemptDomains: [EXAMPLE_DOMAIN] });
    await import('./background');
    await flushAsyncTasks();

    await expect(sendMessage(mocks, {})).resolves.toEqual({
      error: 'Invalid message format',
    });
    await expect(sendMessage(mocks, NULL_VALUE)).resolves.toEqual({
      error: 'Invalid message format',
    });
    await expect(
      sendMessage(mocks, { action: 'not-a-real-action' }),
    ).resolves.toEqual({ error: 'Unknown message action' });
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.GET_TAB_ID },
        { tab: { id: 44 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ tabId: 44 });
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_TAB_ID }),
    ).resolves.toEqual({ error: 'No tab ID available' });
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_EXEMPT_DOMAINS }),
    ).resolves.toEqual({ exemptDomains: [EXAMPLE_DOMAIN] });
    await expect(
      sendMessage(mocks, { action: MessageAction.CHECK_TAB_STATE }),
    ).resolves.toEqual({ hasState: false });
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.CHECK_TAB_STATE },
        { tab: { id: 12 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ hasState: true });
    await expect(
      sendMessage(mocks, {
        action: MessageAction.DETECT_PSP,
        data: NULL_VALUE,
      }),
    ).resolves.toEqual({ error: 'Invalid PSP detection data' });
  });

  it('handles update, startup, removal, and failed onboarding lifecycle events', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    mocks.onStartup.getListener()?.();
    await flushAsyncTasks();

    const installedListener = mocks.onInstalled.getListener();
    if (installedListener === undefined) {
      throw new Error('Expected onInstalled listener to be registered');
    }

    await installedListener({
      reason: 'update',
      previousVersion: '1.2.3',
    });
    expect(mocks.localRemove).toHaveBeenCalledWith([
      STORAGE_KEYS.CACHED_PSP_CONFIG,
      STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE,
    ]);

    mocks.tabsCreate.mockRejectedValueOnce(new Error('tab create failed'));
    await installedListener({ reason: 'install' });
    expect(mocks.tabsCreate).toHaveBeenCalled();

    mocks.onRemoved.getListener()?.(12);
    await flushAsyncTasks();
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.GET_PSP },
        { tab: { id: 12 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ psps: [] });
  });

  it('rehydrates only valid tab records and serves a valid cached config', async () => {
    const cachedConfig = createDefaultPSPConfig();
    const mocks = setupChromeMocks({
      localStore: {
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: cachedConfig,
        [STORAGE_KEYS.EXEMPT_DOMAINS]: [' Example.com ', EXAMPLE_DOMAIN],
      },
      sessionStore: {
        [STORAGE_KEYS.TAB_PSPS]: {
          '-1': [{ psp: 'Bad tab' }],
          nope: [{ psp: 'Bad tab' }],
          20: [NULL_VALUE, {}, { psp: '' }, { psp: 'Stripe' }],
          21: 'not-an-array',
        },
      },
    });
    await import('./background');
    await flushAsyncTasks();

    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toEqual({ config: cachedConfig });
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.GET_PSP },
        { tab: { id: 20 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ psps: [{ psp: 'Stripe' }] });
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.GET_PSP },
        { tab: { id: 21 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ psps: [] });
  });

  it('falls back safely when exempt-domain data is invalid or unavailable', async () => {
    const invalidMocks = setupChromeMocks();
    invalidMocks.fetchMock.mockResolvedValue(
      createFetchResponse({ exemptDomains: 'invalid' }),
    );
    await import('./background');
    await flushAsyncTasks();

    expect(invalidMocks.localSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
    });
    await expect(
      sendMessage(invalidMocks, { action: MessageAction.GET_EXEMPT_DOMAINS }),
    ).resolves.toEqual({ exemptDomains: [] });

    jest.resetModules();
    const failedMocks = setupChromeMocks();
    failedMocks.fetchMock.mockRejectedValue(new Error('offline'));
    await import('./background');
    await flushAsyncTasks();
    expect(failedMocks.localSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
    });
  });

  it('contains initialization and lifecycle storage failures', async () => {
    const mocks = setupChromeMocks();
    mocks.localGet.mockRejectedValueOnce(new Error('restore failed'));
    await import('./background');
    await flushAsyncTasks();

    const installedListener = mocks.onInstalled.getListener();
    if (installedListener === undefined) {
      throw new Error('Expected onInstalled listener to be registered');
    }

    mocks.localRemove.mockRejectedValueOnce(new Error('remove failed'));
    await installedListener({ reason: 'update', previousVersion: '1.0.0' });

    mocks.localSet.mockRejectedValueOnce(new Error('seed failed'));
    await installedListener({ reason: 'install' });

    jest.resetModules();
    const permissionMocks = setupChromeMocks();
    permissionMocks.permissionGetAll.mockRejectedValueOnce(
      new Error('permissions unavailable'),
    );
    await import('./background');
    await flushAsyncTasks();
    expect(permissionMocks.onMessage.getListener()).toBeDefined();
  });

  it('treats non-OK exempt-domain responses as an empty list', async () => {
    const mocks = setupChromeMocks();
    mocks.fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await import('./background');
    await flushAsyncTasks();

    expect(mocks.localSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
    });
  });

  it.each([
    NULL_VALUE,
    {},
    { psps: [] },
    { psps: [NULL_VALUE] },
    {
      psps: [
        {
          name: ' ',
          image: '',
          url: 1,
          summary: NULL_VALUE,
          matchStrings: [''],
        },
      ],
    },
    {
      psps: [
        {
          name: 'Valid',
          image: 'valid',
          url: 'https://valid.example',
          summary: 'Valid',
        },
      ],
    },
    { ...createDefaultPSPConfig(), orchestrators: NULL_VALUE },
    { ...createDefaultPSPConfig(), orchestrators: { notice: 1, list: [] } },
    { ...createDefaultPSPConfig(), orchestrators: { notice: 'x' } },
    {
      ...createDefaultPSPConfig(),
      orchestrators: { notice: 'x', list: [NULL_VALUE] },
    },
    { ...createDefaultPSPConfig(), tsps: NULL_VALUE },
  ])('rejects malformed provider config %#', async (configData) => {
    const mocks = setupChromeMocks({ pspConfig: configData });
    if (configData === NULL_VALUE) {
      mocks.fetchMock.mockImplementation(async (resource: unknown) => {
        const url = String(resource);
        return createFetchResponse(
          url.includes('psps.json') ? NULL_VALUE : { exemptDomains: [] },
        );
      });
    }
    await import('./background');
    await flushAsyncTasks();

    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toBeUndefined();
  });

  it('handles PSP config HTTP, parsing, timeout, and storage failures', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    mocks.fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    });
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toBeUndefined();

    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toBeUndefined();

    const timeout = new Error('timed out');
    Object.defineProperty(timeout, 'name', { value: 'AbortError' });
    mocks.fetchMock.mockRejectedValueOnce(timeout);
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toBeUndefined();

    mocks.localSet.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG }),
    ).resolves.toEqual({ config: createDefaultPSPConfig() });
  });

  it('loads regex-only PSP, orchestrator, and TSP entries and records types', async () => {
    const config = {
      psps: [
        {
          name: 'Regex Pay',
          regex: 'regex-pay',
          image: 'regex-pay',
          summary: 'Regex Pay',
          url: 'https://regex-pay.example',
        },
      ],
      orchestrators: {
        notice: 'Orchestrators',
        list: [
          {
            name: 'Primer',
            matchStrings: ['api.primer.io'],
            image: 'primer',
            summary: 'Primer',
            url: 'https://primer.io',
          },
        ],
      },
      tsps: {
        notice: 'TSPs',
        list: [
          {
            name: 'TokenEx',
            matchStrings: ['api.tokenex.com'],
            image: 'tokenex',
            summary: 'TokenEx',
            url: 'https://tokenex.com',
          },
        ],
      },
    };
    const mocks = setupChromeMocks({ pspConfig: config });
    await import('./background');
    await flushAsyncTasks();
    await sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG });

    for (const [index, psp] of ['Regex Pay', 'Primer', 'TokenEx'].entries()) {
      await sendMessage(
        mocks,
        {
          action: MessageAction.DETECT_PSP,
          data: {
            psp,
            detectionInfo: {
              method: 'matchString',
              value: `${psp}.example`,
              sourceType: 'scriptSrc',
            },
          },
        },
        {
          tab: {
            id: 70 + index,
            url: `https://shop-${index}.example`,
          } as chrome.tabs.Tab,
        },
      );
    }

    const historyWrites = mocks.localSet.mock.calls
      .map((call) => call[0][STORAGE_KEYS.PSP_HISTORY])
      .filter((value) => Array.isArray(value)) as {
      psps: { type: string }[];
    }[][];
    expect(historyWrites.map((entries) => entries[0]?.psps[0]?.type)).toEqual([
      'PSP',
      'Orchestrator',
      'TSP',
    ]);
  });

  it('binds content-script detections to the sender tab but trusts extension pages', async () => {
    const mocks = setupChromeMocks({ sessionStore: {} });
    await import('./background');
    await flushAsyncTasks();

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: { psp: 'Stripe', tabId: 99 },
      },
      {
        tab: { id: 42, url: 'https://merchant.example' } as chrome.tabs.Tab,
      },
    );
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 42),
    ).toEqual([{ psp: 'Stripe' }]);
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 99),
    ).toEqual([]);

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: { psp: 'Primer', tabId: 99 },
      },
      { url: mocks.getURL('popup.html') },
    );
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 99),
    ).toEqual([{ psp: 'Primer' }]);

    await sendMessage(mocks, {
      action: MessageAction.DETECT_PSP,
      data: { psp: 'Stripe' },
    });
    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: { psp: ' '.repeat(3) },
      },
      { tab: { id: 50 } as chrome.tabs.Tab },
    );
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 50),
    ).toEqual([]);
  });

  it('upgrades detection evidence through every source priority', async () => {
    const mocks = setupChromeMocks({ sessionStore: {} });
    await import('./background');
    await flushAsyncTasks();

    const sourceTypes = [
      undefined,
      'networkRequest',
      'pageUrl',
      'linkHref',
      'formAction',
      'iframeSrc',
      'scriptSrc',
    ] as const;
    for (const sourceType of sourceTypes) {
      await sendMessage(
        mocks,
        {
          action: MessageAction.DETECT_PSP,
          data: {
            psp: 'Stripe',
            detectionInfo: {
              method: 'matchString',
              value: sourceType ?? 'unknown-source',
              ...(sourceType !== undefined && { sourceType }),
            },
          },
        },
        { tab: { id: 60, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
      );
    }

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: 'lower-priority',
            sourceType: 'unexpected-source',
          },
        },
      },
      { tab: { id: 60, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
    );

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: { psp: 'Stripe' },
      },
      { tab: { id: 60, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
    );

    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 60),
    ).toEqual([
      expect.objectContaining({
        detectionInfo: expect.objectContaining({ sourceType: 'scriptSrc' }),
      }),
    ]);
  });

  it('stores exempt detections without history and handles malformed origins', async () => {
    const mocks = setupChromeMocks({ sessionStore: {} });
    await import('./background');
    await flushAsyncTasks();

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: { psp: PSP_DETECTION_EXEMPT },
      },
      { tab: { id: 80, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
    );
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 80),
    ).toEqual([{ psp: PSP_DETECTION_EXEMPT }]);

    await sendMessage(
      mocks,
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: STRIPE_MATCH_STRING,
          },
          merchantOrigin: 'not a URL',
        },
      },
      { tab: { id: 81, url: 'not a URL' } as chrome.tabs.Tab },
    );
    expect(getLatestHistoryEntries(mocks.localSet)?.[0]).toEqual(
      expect.objectContaining({ domain: 'not a URL' }),
    );
    expect(getLatestHistoryEntries(mocks.localSet)?.[0]).not.toHaveProperty(
      'merchantOrigin',
    );
  });

  it('handles activation failures, extension pages, cached detections, and empty URLs', async () => {
    const mocks = setupChromeMocks({
      localStore: {
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: createDefaultPSPConfig(),
      },
      sessionStore: {
        [STORAGE_KEYS.TAB_PSPS]: {
          12: [
            {
              psp: 'Stripe',
              detectionInfo: {
                method: 'matchString',
                value: STRIPE_MATCH_STRING,
                sourceType: 'scriptSrc',
              },
            },
          ],
          13: [{ psp: PSP_DETECTION_EXEMPT }],
        },
      },
    });
    await import('./background');
    await flushAsyncTasks();
    const activated = mocks.onActivated.getListener();
    if (activated === undefined) {
      throw new Error('Expected onActivated listener to be registered');
    }

    mocks.tabsGet.mockRejectedValueOnce(new Error('closed'));
    activated({ tabId: 10 });
    await flushAsyncTasks();

    mocks.tabsGet.mockResolvedValueOnce({
      id: 11,
      url: mocks.getURL('options.html'),
    } as chrome.tabs.Tab);
    activated({ tabId: 11 });
    await flushAsyncTasks();

    activated({ tabId: 12 });
    await flushAsyncTasks();
    expect(mocks.actionSetIcon).toHaveBeenCalledWith({
      path: {
        48: 'images/stripe_48.png',
        128: 'images/stripe_128.png',
      },
    });

    activated({ tabId: 13 });
    await flushAsyncTasks();
    expect(mocks.actionSetBadgeText).toHaveBeenCalledWith({ text: '🚫' });

    mocks.tabsGet.mockResolvedValueOnce({ id: 14 } as chrome.tabs.Tab);
    activated({ tabId: 14 });
    await flushAsyncTasks();
    expect(mocks.executeScript).not.toHaveBeenCalledWith({
      target: { tabId: 14 },
      files: ['content.js'],
    });
  });

  it('handles loading, exempt, restricted, and regular completed tab updates', async () => {
    const mocks = setupChromeMocks({
      localStore: { [STORAGE_KEYS.CURRENT_TAB_ID]: 12 },
    });
    await import('./background');
    await flushAsyncTasks();
    const updated = mocks.onUpdated.getListener();
    if (updated === undefined) {
      throw new Error('Expected onUpdated listener to be registered');
    }

    updated(12, { status: 'loading' }, {
      id: 12,
      url: DEFAULT_ACTIVE_TAB_URL,
    } as chrome.tabs.Tab);
    await flushAsyncTasks();
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 12),
    ).toEqual([]);

    updated(12, { status: 'complete' }, {
      id: 12,
      url: 'chrome://settings',
    } as chrome.tabs.Tab);
    await flushAsyncTasks();
    expect(mocks.actionSetBadgeText).toHaveBeenCalledWith({ text: '🚫' });

    updated(22, { status: 'complete' }, {
      id: 22,
      url: DEFAULT_ACTIVE_TAB_URL,
    } as chrome.tabs.Tab);
    await flushAsyncTasks();
    expect(mocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 22 },
      files: ['content.js'],
    });

    const callsBeforeEmptyUpdate = mocks.executeScript.mock.calls.length;
    updated(23, { status: 'complete' }, { id: 23 } as chrome.tabs.Tab);
    await flushAsyncTasks();
    expect(mocks.executeScript).toHaveBeenCalledTimes(callsBeforeEmptyUpdate);
  });

  it('reports all re-detect selection failures', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    mocks.tabsQuery.mockResolvedValueOnce([]);
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: false, reason: 'No active tab' });

    mocks.tabsQuery.mockResolvedValueOnce([
      { id: -1, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab,
    ]);
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: false, reason: 'Invalid active tab id' });

    mocks.tabsQuery.mockRejectedValueOnce(new Error('tabs unavailable'));
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: false, reason: 'Re-detect failed' });
  });

  it('skips injection without permission and handles expected script errors', async () => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    mocks.permissionContains.mockResolvedValueOnce(false);
    await sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB });

    mocks.permissionContains.mockRejectedValueOnce(new Error('permission API'));
    await sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB });

    for (const message of [
      'Frame with ID 0 is showing error page',
      'Cannot access contents of the page',
      'The extensions gallery cannot be scripted',
      'unexpected injection failure',
    ]) {
      mocks.executeScript.mockRejectedValueOnce(new Error(message));
      await sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB });
    }

    expect(mocks.executeScript).toHaveBeenCalledTimes(4);
  });

  it('registers webRequest when permission is added and matches fallback patterns', async () => {
    const mocks = setupChromeMocks({
      pspConfig: {
        psps: [
          {
            name: 'Fallback Pay',
            matchStrings: ['foo(bar'],
            image: 'fallback-pay',
            summary: 'Fallback Pay',
            url: 'https://fallback.example',
          },
        ],
      },
      sessionStore: {},
    });
    await import('./background');
    await flushAsyncTasks();
    await sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG });

    mocks.onPermissionAdded.getListener()?.({ permissions: ['tabs'] });
    expect(mocks.webRequestAddListener).not.toHaveBeenCalled();
    mocks.onPermissionAdded.getListener()?.({ permissions: ['webRequest'] });
    mocks.onPermissionAdded.getListener()?.({ permissions: ['webRequest'] });
    expect(mocks.webRequestAddListener).toHaveBeenCalledTimes(1);

    const networkListener = getRegisteredWebRequestListener(mocks);
    networkListener({
      tabId: -1,
      url: 'https://merchant.example/foo(bar',
    } as chrome.webRequest.WebRequestDetails);
    networkListener({
      tabId: 33,
      url: 'not a URL',
    } as chrome.webRequest.WebRequestDetails);
    mocks.tabsGet.mockRejectedValueOnce(new Error('tab closed'));
    networkListener({
      tabId: 33,
      url: 'https://merchant.example/foo(bar',
    } as chrome.webRequest.WebRequestDetails);
    await flushAsyncTasks();

    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 33),
    ).toEqual([expect.objectContaining({ psp: 'Fallback Pay' })]);
  });

  it('retries failed tab-cache persistence on suspend', async () => {
    const mocks = setupChromeMocks({ sessionStore: {} });
    await import('./background');
    await flushAsyncTasks();
    mocks.sessionSet.mockRejectedValueOnce(new Error('session unavailable'));

    await sendMessage(
      mocks,
      { action: MessageAction.DETECT_PSP, data: { psp: 'Stripe' } },
      { tab: { id: 45, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
    );
    expect(mocks.sessionSet).toHaveBeenCalledTimes(1);

    mocks.onSuspend.getListener()?.();
    await flushAsyncTasks();
    expect(mocks.sessionSet).toHaveBeenCalledTimes(2);
    expect(mocks.sessionSet).toHaveBeenLastCalledWith({
      [STORAGE_KEYS.TAB_PSPS]: { 45: [{ psp: 'Stripe' }] },
    });
  });

  it('falls back to default icons when a provider icon fails', async () => {
    const mocks = setupChromeMocks({
      localStore: {
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: createDefaultPSPConfig(),
        [STORAGE_KEYS.CURRENT_TAB_ID]: 55,
      },
      sessionStore: {},
    });
    mocks.actionSetIcon.mockRejectedValueOnce(new Error('missing icon'));
    await import('./background');
    await flushAsyncTasks();

    await sendMessage(
      mocks,
      { action: MessageAction.DETECT_PSP, data: { psp: 'Stripe' } },
      { tab: { id: 55, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
    );
    await flushAsyncTasks();

    expect(mocks.actionSetIcon).toHaveBeenNthCalledWith(1, {
      path: {
        48: 'images/stripe_48.png',
        128: 'images/stripe_128.png',
      },
    });
    expect(mocks.actionSetIcon).toHaveBeenNthCalledWith(2, {
      path: {
        48: 'images/default_48.png',
        128: 'images/default_128.png',
      },
    });
  });

  it('uses current-tab state when active-tab and storage APIs fail', async () => {
    const mocks = setupChromeMocks({
      localStore: { [STORAGE_KEYS.CURRENT_TAB_ID]: 66 },
      sessionStore: {
        [STORAGE_KEYS.TAB_PSPS]: { 66: [{ psp: 'Stripe' }] },
      },
    });
    await import('./background');
    await flushAsyncTasks();

    mocks.tabsQuery.mockRejectedValueOnce(new Error('query failed'));
    await expect(
      sendMessage(mocks, { action: MessageAction.GET_PSP }),
    ).resolves.toEqual({ psps: [{ psp: 'Stripe' }] });

    mocks.localGet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.CHECK_TAB_STATE },
        { tab: { id: 67 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({ hasState: false });

    mocks.localSet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: true });
  });

  it('marks special activated tabs exempt and scans malformed web URLs', async () => {
    const mocks = setupChromeMocks({ sessionStore: {} });
    await import('./background');
    await flushAsyncTasks();
    const activated = mocks.onActivated.getListener();
    if (activated === undefined) {
      throw new Error('Expected onActivated listener to be registered');
    }

    mocks.tabsGet.mockResolvedValueOnce({
      id: 68,
      url: 'file:///tmp/checkout.html',
    } as chrome.tabs.Tab);
    activated({ tabId: 68 });
    await flushAsyncTasks();
    expect(mocks.actionSetBadgeText).toHaveBeenCalledWith({ text: '🚫' });

    mocks.tabsQuery.mockResolvedValueOnce([
      { id: 69, url: 'not a URL' } as chrome.tabs.Tab,
    ]);
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: true });
    expect(mocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 69 },
      files: ['content.js'],
    });

    mocks.tabsQuery.mockResolvedValueOnce([
      { id: 70, url: '' } as chrome.tabs.Tab,
    ]);
    await expect(
      sendMessage(mocks, { action: MessageAction.REDETECT_CURRENT_TAB }),
    ).resolves.toEqual({ success: true });
  });

  it('indexes hostless, single-label, and duplicate network match strings', async () => {
    const mocks = setupChromeMocks({
      hasWebRequestPermission: true,
      pspConfig: {
        psps: [
          {
            name: 'Hostless Pay',
            matchStrings: ['https://'],
            image: 'hostless',
            summary: 'Hostless Pay',
            url: 'https://hostless.example',
          },
          {
            name: 'Local Pay',
            matchStrings: ['localhost', 'localhost'],
            image: 'local',
            summary: 'Local Pay',
            url: 'https://local.example',
          },
        ],
      },
      sessionStore: {},
    });
    await import('./background');
    await flushAsyncTasks();
    await sendMessage(mocks, { action: MessageAction.GET_PSP_CONFIG });
    const networkListener = getRegisteredWebRequestListener(mocks);

    networkListener({
      tabId: 72,
      url: 'file:///tmp/checkout.html',
    } as chrome.webRequest.WebRequestDetails);

    networkListener({
      tabId: 70,
      url: 'https://localhost/checkout',
    } as chrome.webRequest.WebRequestDetails);
    await flushAsyncTasks();
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 70),
    ).toEqual([expect.objectContaining({ psp: 'Local Pay' })]);

    networkListener({
      tabId: 71,
      url: 'https://merchant.example/checkout',
    } as chrome.webRequest.WebRequestDetails);
    await flushAsyncTasks();
    expect(
      await getDetectedPspsForTab(getRegisteredMessageListener(mocks), 71),
    ).toEqual([expect.objectContaining({ psp: 'Hostless Pay' })]);
  });

  it('keeps configured providers ahead of unknown detections', async () => {
    const mocks = setupChromeMocks({
      localStore: {
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: createDefaultPSPConfig(),
        [STORAGE_KEYS.CURRENT_TAB_ID]: 73,
      },
      sessionStore: {},
    });
    await import('./background');
    await flushAsyncTasks();

    for (const psp of ['Mystery Pay', 'Stripe', 'Another Mystery']) {
      await sendMessage(
        mocks,
        { action: MessageAction.DETECT_PSP, data: { psp } },
        { tab: { id: 73, url: DEFAULT_ACTIVE_TAB_URL } as chrome.tabs.Tab },
      );
    }

    await expect(
      sendMessage(
        mocks,
        { action: MessageAction.GET_PSP },
        { tab: { id: 73 } as chrome.tabs.Tab },
      ),
    ).resolves.toEqual({
      psps: [
        { psp: 'Stripe' },
        { psp: 'Mystery Pay' },
        { psp: 'Another Mystery' },
      ],
    });
  });
});

describe('telemetry privacy boundary', () => {
  const GA_HOST = 'google-analytics.com';
  const MERCHANT_HOST = 'secret-merchant-shop.example';
  const MERCHANT_URL = `https://${MERCHANT_HOST}/checkout/pay?token=abc#frag`;

  interface GaEvent {
    name: string;
    params: Record<string, unknown>;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env['GA_MEASUREMENT_ID'] = 'G-PRIVACY';
    process.env['GA_API_SECRET'] = 'priv-secret';
  });

  afterEach(() => {
    delete process.env['GA_MEASUREMENT_ID'];
    delete process.env['GA_API_SECRET'];
  });

  function gaCalls(): { url: string; body: string }[] {
    const fetchMock = globalThis.fetch as unknown as jest.Mock;
    return fetchMock.mock.calls
      .filter((call) => {
        try {
          const url = new URL(String(call[0]));
          return (
            url.hostname === GA_HOST || url.hostname.endsWith(`.${GA_HOST}`)
          );
        } catch {
          return false;
        }
      })
      .map((call) => ({
        url: String(call[0]),
        // The telemetry client always sends a JSON string body.
        body: (call[1] as undefined | { body?: string })?.body ?? '',
      }));
  }

  function findGaEvent(eventName: string): GaEvent | undefined {
    for (const call of gaCalls()) {
      const payload = JSON.parse(call.body) as { events?: GaEvent[] };
      const event = payload.events?.find((item) => item.name === eventName);
      if (event !== undefined) {
        return event;
      }
    }

    return undefined;
  }

  it('psp_detected sends provider info and evidence hostname only', async () => {
    const mocks = setupChromeMocks({ activeTabUrl: MERCHANT_URL });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    // Load the provider config first so provider_slug/type come from psps.json.
    messageListener(
      { action: MessageAction.GET_PSP_CONFIG },
      { tab: { id: 12, url: MERCHANT_URL } as chrome.tabs.Tab },
      jest.fn(),
    );
    await flushAsyncTasks();
    await flushAsyncTasks();

    messageListener(
      {
        action: MessageAction.DETECT_PSP,
        data: {
          psp: 'Stripe',
          tabId: 12,
          detectionInfo: {
            method: 'matchString',
            value: STRIPE_MATCH_STRING,
            sourceType: 'scriptSrc',
          },
        },
      },
      { tab: { id: 12, url: MERCHANT_URL } as chrome.tabs.Tab },
      jest.fn(),
    );
    await flushAsyncTasks();

    const event = findGaEvent('psp_detected');
    expect(event).toBeDefined();
    expect(event?.params['provider_name']).toBe('Stripe');
    expect(event?.params['provider_slug']).toBe('stripe');
    expect(event?.params['provider_type']).toBe('PSP');
    expect(event?.params['evidence_domain']).toBe(STRIPE_MATCH_STRING);
    expect(event?.params['match_type']).toBe('matchString');

    for (const call of gaCalls()) {
      const raw = `${call.url} ${call.body}`;
      expect(raw).not.toContain(MERCHANT_HOST);
      expect(raw).not.toContain('/checkout');
    }
  });

  it('scan_skipped reports the reason but never the exempt domain', async () => {
    const mocks = setupChromeMocks({
      activeTabUrl: CHECKOUT_EXAMPLE_URL,
      exemptDomains: [EXAMPLE_DOMAIN],
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = getRegisteredMessageListener(mocks);
    messageListener(
      { action: MessageAction.REDETECT_CURRENT_TAB },
      {},
      jest.fn(),
    );
    await flushAsyncTasks();

    const event = findGaEvent('scan_skipped');
    expect(event).toBeDefined();
    expect(event?.params['skip_reason']).toBe('exempt_domain');
    expect(event?.params['entry_point']).toBe('redetect');

    for (const call of gaCalls()) {
      expect(`${call.url} ${call.body}`).not.toContain(EXAMPLE_DOMAIN);
    }
  });
});
