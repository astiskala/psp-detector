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
  onSuspend: EventMock<SuspendListener>;
  onMessage: EventMock<MessageListener>;
  onRemoved: EventMock<TabRemovedListener>;
  tabsCreate: jest.Mock<Promise<unknown>, [chrome.tabs.CreateProperties]>;
  tabsQuery: jest.Mock<Promise<chrome.tabs.Tab[]>, [chrome.tabs.QueryInfo]>;
  tabsGet: jest.Mock<Promise<chrome.tabs.Tab>, [number]>;
  executeScript: jest.Mock;
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

function createEventMock<
  T extends(...args: never[]) => unknown,
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
    json: async() => payload,
  } as Response;
}

function setupChromeMocks(options: ChromeMockOptions = {}): ChromeMockContext {
  const activeTabUrl = options.activeTabUrl ?? 'https://shop.example.com/cart';
  const exemptDomains = options.exemptDomains ?? [];
  const hasHostPermission = options.hasHostPermission ?? true;
  const hasWebRequestPermission = options.hasWebRequestPermission ?? false;
  const pspConfig = options.pspConfig ?? {
    psps: [{
      name: 'Stripe',
      matchStrings: ['js.stripe.com'],
      image: 'stripe',
      summary: 'Stripe',
      url: 'https://stripe.com',
    }],
  };

  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {
    [STORAGE_KEYS.TAB_PSPS]: {
      12: [{ psp: 'Stripe' }],
    } as Record<number, { psp: string }[]>,
  };

  const onInstalled = createEventMock<InstalledListener>();
  const onStartup = createEventMock<StartupListener>();
  const onSuspend = createEventMock<SuspendListener>();
  const onMessage = createEventMock<MessageListener>();
  const onActivated = createEventMock<TabActivatedListener>();
  const onUpdated = createEventMock<TabUpdatedListener>();
  const onRemoved = createEventMock<TabRemovedListener>();
  const onPermissionAdded = createEventMock<PermissionAddedListener>();

  const getURL = jest.fn((assetPath: string) => `chrome-extension://test/${assetPath}`);
  const tabsCreate = jest.fn().mockResolvedValue({ id: 999 });
  const tabsQuery = jest.fn().mockResolvedValue([
    { id: 12, url: activeTabUrl } as chrome.tabs.Tab,
  ]);
  const tabsGet = jest
    .fn()
    .mockImplementation(async(tabId: number): Promise<chrome.tabs.Tab> => {
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
    .mockImplementation(
      async(query: StorageQuery) => readStorage(localStore, query),
    );
  const localSet = jest
    .fn()
    .mockImplementation(async(items: Record<string, unknown>) => {
      Object.assign(localStore, items);
    });
  const localRemove = jest
    .fn()
    .mockImplementation(async(keys: string | string[]) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      for (const key of normalizedKeys) {
        delete localStore[key];
      }
    });

  const sessionGet = jest
    .fn()
    .mockImplementation(
      async(query: StorageQuery) => readStorage(sessionStore, query),
    );
  const sessionSet = jest
    .fn()
    .mockImplementation(async(items: Record<string, unknown>) => {
      Object.assign(sessionStore, items);
    });

  const fetchMock = jest.fn().mockImplementation(async(resource: unknown) => {
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
      setIcon: jest.fn(),
      setTitle: jest.fn(),
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
    },
    webRequest: {
      onBeforeRequest: {
        addListener: webRequestAddListener,
      },
    },
  } as unknown as typeof chrome;

  return {
    onInstalled,
    onSuspend,
    onMessage,
    onRemoved,
    tabsCreate,
    tabsQuery,
    tabsGet,
    executeScript,
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

describe('background service onboarding and re-detect flow', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('opens onboarding instructions when extension is installed', async() => {
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

  it('re-detects PSP on the current tab when requested', async() => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error('Expected onMessage listener to be registered');
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

  it('skips re-detection and returns exempt reason for exempt domain tabs', async() => {
    const mocks = setupChromeMocks({
      activeTabUrl: 'https://checkout.example.com',
      exemptDomains: ['example.com'],
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error('Expected onMessage listener to be registered');
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

    expect(mocks.localSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.DETECTED_PSP]: expect.objectContaining({
        type: 'exempt',
      }) as unknown,
    });
  });

  it('keeps tab PSP state in memory instead of re-reading session storage', async() => {
    const mocks = setupChromeMocks();
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error('Expected onMessage listener to be registered');
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

  it('flushes debounced tab PSP persistence on suspend', async() => {
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

  it('registers webRequest listener with narrowed request types', async() => {
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

  it('deduplicates repeated network matches per tab', async() => {
    const mocks = setupChromeMocks({
      hasWebRequestPermission: true,
      pspConfig: {
        psps: [{
          name: 'Stripe',
          matchStrings: ['js.stripe.com'],
          image: 'stripe',
          summary: 'Stripe',
          url: 'https://stripe.com',
        }],
      },
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error('Expected onMessage listener to be registered');
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
      throw new Error('Expected webRequest listener to be registered');
    }

    networkListener({
      tabId: 91,
      url: 'https://js.stripe.com/v3/elements.js',
      type: 'script',
    } as chrome.webRequest.WebRequestDetails);

    await flushAsyncTasks();

    const sendResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 91 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await flushAsyncTasks();
    expect(sendResponse).toHaveBeenLastCalledWith({
      psps: [expect.objectContaining({ psp: 'Stripe' })],
    });

    networkListener({
      tabId: 91,
      url: 'https://js.stripe.com/v3/elements.js',
      type: 'script',
    } as chrome.webRequest.WebRequestDetails);

    await flushAsyncTasks();

    const secondResponse = jest.fn();
    messageListener(
      { action: MessageAction.GET_PSP },
      { tab: { id: 91 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
      secondResponse,
    );

    await flushAsyncTasks();
    expect(secondResponse).toHaveBeenLastCalledWith({
      psps: [expect.objectContaining({ psp: 'Stripe' })],
    });

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

  it('upgrades network match to higher-priority DOM source for the same PSP', async() => {
    const mocks = setupChromeMocks({
      hasWebRequestPermission: true,
      activeTabUrl: 'https://checkout.example.com',
      pspConfig: {
        psps: [{
          name: 'Stripe',
          matchStrings: ['js.stripe.com'],
          image: 'stripe',
          summary: 'Stripe',
          url: 'https://stripe.com',
        }],
      },
    });
    await import('./background');
    await flushAsyncTasks();

    const messageListener = mocks.onMessage.getListener();
    if (messageListener === null) {
      throw new Error('Expected onMessage listener to be registered');
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
      throw new Error('Expected webRequest listener to be registered');
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
            value: 'js.stripe.com',
            sourceType: 'scriptSrc',
          },
        },
      },
      {
        tab: {
          id: 91,
          url: 'https://checkout.example.com',
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
});
