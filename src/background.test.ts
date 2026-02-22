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
  onMessage: EventMock<MessageListener>;
  tabsCreate: jest.Mock<Promise<unknown>, [chrome.tabs.CreateProperties]>;
  tabsQuery: jest.Mock<Promise<chrome.tabs.Tab[]>, [chrome.tabs.QueryInfo]>;
  executeScript: jest.Mock;
  permissionContains: jest.Mock<
    Promise<boolean>,
    [chrome.permissions.Permissions]
  >;
  localSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  localRemove: jest.Mock<Promise<void>, [string | string[]]>;
  sessionSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  getURL: jest.Mock<string, [string]>;
}

interface ChromeMockOptions {
  activeTabUrl?: string;
  exemptDomains?: string[];
  hasHostPermission?: boolean;
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

function createFetchResponse(exemptDomains: string[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async() => ({ exemptDomains }),
  } as Response;
}

function setupChromeMocks(options: ChromeMockOptions = {}): ChromeMockContext {
  const activeTabUrl = options.activeTabUrl ?? 'https://shop.example.com/cart';
  const exemptDomains = options.exemptDomains ?? [];
  const hasHostPermission = options.hasHostPermission ?? true;

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
  const executeScript = jest.fn().mockResolvedValue([]);
  const permissionContains = jest.fn().mockResolvedValue(hasHostPermission);
  const permissionRequest = jest.fn().mockResolvedValue(false);
  const permissionGetAll = jest.fn().mockResolvedValue({ permissions: [] });

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

  const fetchMock = jest
    .fn()
    .mockImplementation(async() => createFetchResponse(exemptDomains));

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
        addListener: jest.fn(),
      },
    },
  } as unknown as typeof chrome;

  return {
    onInstalled,
    onMessage,
    tabsCreate,
    tabsQuery,
    executeScript,
    permissionContains,
    localSet,
    localRemove,
    sessionSet,
    getURL,
  };
}

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
});
