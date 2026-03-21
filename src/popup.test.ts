import { PopupManager } from './services/popup-manager';
import {
  MessageAction,
  PSP_DETECTION_EXEMPT,
  TypeConverters,
  type PSPConfig,
} from './types';
import { STORAGE_KEYS } from './lib/storage-keys';
import * as utils from './lib/utils';

interface ChromeMocks {
  contains: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  request: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  sendMessage: jest.Mock;
  openOptionsPage: jest.Mock<Promise<void>, []>;
  getURL: jest.Mock<string, [string]>;
  localGet: jest.Mock<Promise<Record<string, unknown>>, [string]>;
  localSet: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  localRemove: jest.Mock<Promise<void>, [string]>;
}

function setupPopupDOM(): void {
  document.body.innerHTML = `
    <div class="popup-container">
      <div class="popup-header">
        <img id="psp-image" alt="PSP logo" style="display: none;" />
        <div class="status-icon" id="status-icon" style="display: none;">📊</div>
        <div class="header-content">
          <h1 id="psp-name">Detecting PSP...</h1>
          <p id="psp-subtitle">Analyzing current page</p>
        </div>
      </div>
      <div class="popup-body">
        <div id="permission-state" style="display: none;">
          <button id="grant-permission-btn" type="button">Grant</button>
        </div>
        <div id="loading-state" style="display: block;"></div>
        <div id="content-state" style="display: none;">
          <div id="psp-description"></div>
          <div id="psp-notice"></div>
          <div id="psp-url"></div>
          <button id="history-link" type="button">View history</button>
        </div>
      </div>
    </div>
  `;
}

function setupChromeMock(): ChromeMocks {
  const contains = jest.fn().mockResolvedValue(true);
  const request = jest.fn().mockResolvedValue(false);
  const sendMessage = jest.fn();
  const openOptionsPage = jest.fn().mockResolvedValue(undefined);
  const getURL = jest.fn(
    (path: string) => `chrome-extension://test-extension/${path}`,
  );
  const localGet = jest
    .fn()
    .mockResolvedValue({ [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: null });
  const localSet = jest.fn().mockResolvedValue(undefined);
  const localRemove = jest.fn().mockResolvedValue(undefined);
  const runtime = {
    getURL,
    sendMessage,
    openOptionsPage,
    lastError: undefined as chrome.runtime.LastError | undefined,
  };

  globalThis.chrome = {
    permissions: {
      contains,
      request,
    },
    runtime,
    storage: {
      local: {
        get: localGet,
        set: localSet,
        remove: localRemove,
      },
    },
  } as unknown as typeof chrome;

  return {
    contains,
    request,
    sendMessage,
    openOptionsPage,
    getURL,
    localGet,
    localSet,
    localRemove,
  };
}

interface OptionalPermissionState {
  host: boolean;
  webRequest: boolean;
}

function bindPermissionState(
  chromeMocks: ChromeMocks,
  state: OptionalPermissionState,
): void {
  chromeMocks.contains.mockImplementation(async(permissionRequest) => {
    if (
      permissionRequest.permissions?.includes('webRequest') === true
    ) {
      return state.webRequest;
    }

    if (
      permissionRequest.origins?.includes('https://*/*') === true
    ) {
      return state.host;
    }

    return false;
  });
}

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mockSendMessageResponses(
  sendMessage: ChromeMocks['sendMessage'],
  responses: unknown[],
): void {
  let cursor = 0;
  sendMessage.mockImplementation(
    (_message: { action: string }, callback: (response: unknown) => void) => {
      const fallback = responses[responses.length - 1];
      const next = cursor < responses.length ? responses[cursor] : fallback;
      callback(next);
      cursor += 1;
    },
  );
}

function createStripeConfig(): PSPConfig {
  return {
    psps: [{
      name: TypeConverters.toPSPName('Stripe')!,
      matchStrings: ['js.stripe.com'],
      url: TypeConverters.toURL('https://stripe.com')!,
      image: 'stripe',
      summary: 'Stripe summary',
    }],
  };
}

describe('PopupManager', () => {
  let chromeMocks: ChromeMocks;

  beforeEach(() => {
    setupPopupDOM();
    chromeMocks = setupChromeMock();
    jest.restoreAllMocks();
  });

  it('shows permission request state when host permission is missing', async() => {
    chromeMocks.contains.mockResolvedValue(false);
    mockSendMessageResponses(chromeMocks.sendMessage, [{ psps: [] }]);
    const popup = new PopupManager();

    await popup.initialize();

    expect(document.getElementById('permission-state')?.style.display).toBe(
      'block',
    );

    expect(document.getElementById('loading-state')?.style.display).toBe(
      'none',
    );

    expect(chromeMocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(chromeMocks.sendMessage.mock.calls[0]?.[0]).toEqual({
      action: MessageAction.GET_PSP,
    });
  });

  it('shows permission request state when webRequest permission is missing',
    async() => {
      bindPermissionState(chromeMocks, {
        host: true,
        webRequest: false,
      });

      mockSendMessageResponses(chromeMocks.sendMessage, [{ psps: [] }]);
      const popup = new PopupManager();

      await popup.initialize();

      expect(document.getElementById('permission-state')?.style.display).toBe(
        'block',
      );

      expect(document.getElementById('loading-state')?.style.display).toBe(
        'none',
      );

      expect(chromeMocks.sendMessage).toHaveBeenCalledTimes(1);
      expect(chromeMocks.sendMessage.mock.calls[0]?.[0]).toEqual({
        action: MessageAction.GET_PSP,
      });
    });

  it('requests permission from button and re-initializes on grant', async() => {
    const permissionState: OptionalPermissionState = {
      host: false,
      webRequest: false,
    };
    bindPermissionState(chromeMocks, permissionState);

    chromeMocks.request.mockImplementation(async() => {
      permissionState.host = true;
      permissionState.webRequest = true;
      return true;
    });

    mockSendMessageResponses(chromeMocks.sendMessage, [
      { psps: [] },
      { success: true },
      { psps: [] },
    ]);

    const popup = new PopupManager();

    await popup.initialize();
    (document.getElementById('grant-permission-btn') as HTMLButtonElement).click();
    await flushAsyncTasks();
    await flushAsyncTasks();

    expect(chromeMocks.request).toHaveBeenCalledWith({
      origins: ['https://*/*'],
      permissions: ['webRequest'],
    });

    expect(document.getElementById('permission-state')?.style.display).toBe(
      'none',
    );

    expect(chromeMocks.contains.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(chromeMocks.sendMessage).toHaveBeenCalledTimes(3);
    expect(chromeMocks.sendMessage.mock.calls[0]?.[0]).toEqual({
      action: MessageAction.GET_PSP,
    });

    expect(chromeMocks.sendMessage.mock.calls[1]?.[0]).toEqual({
      action: MessageAction.REDETECT_CURRENT_TAB,
    });

    expect(chromeMocks.sendMessage.mock.calls[2]?.[0]).toEqual({
      action: MessageAction.GET_PSP,
    });
  });

  it('renders disabled state when exempt tab marker is detected', async() => {
    mockSendMessageResponses(chromeMocks.sendMessage, [{
      psps: [{ psp: PSP_DETECTION_EXEMPT }],
    }]);

    const popup = new PopupManager();

    await popup.initialize();

    expect(document.getElementById('psp-name')?.textContent).toBe(
      'PSP detection disabled',
    );
  });

  it('renders no-PSP state when no detections are returned', async() => {
    mockSendMessageResponses(chromeMocks.sendMessage, [{ psps: [] }]);
    const popup = new PopupManager();

    await popup.initialize();

    expect(document.getElementById('psp-name')?.textContent).toBe(
      'No PSP detected',
    );
  });

  it('renders detected PSP cards from cached configuration and becomes idempotent',
    async() => {
      const cachedConfig = createStripeConfig();
      chromeMocks.localGet.mockResolvedValue({
        [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: cachedConfig,
      });

      mockSendMessageResponses(chromeMocks.sendMessage, [{
        psps: [{
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'scriptSrc',
          },
        }],
      }]);

      const popup = new PopupManager();

      await popup.initialize();
      await popup.initialize();

      expect(document.querySelectorAll('.psp-card')).toHaveLength(1);
      expect(chromeMocks.localSet).not.toHaveBeenCalled();
      expect(chromeMocks.sendMessage).toHaveBeenCalledTimes(1);
    });

  it('fetches and caches PSP config when cache is empty', async() => {
    const config = createStripeConfig();
    chromeMocks.localGet.mockResolvedValue({
      [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: null,
    });

    mockSendMessageResponses(chromeMocks.sendMessage, [{
      psps: [{ psp: 'Stripe' }],
    }]);

    const fetchSpy = jest
      .spyOn(utils, 'fetchWithTimeout')
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async() => config,
      } as unknown as Response);
    const popup = new PopupManager();

    await popup.initialize();

    expect(fetchSpy).toHaveBeenCalledWith(
      'chrome-extension://test-extension/psps.json',
      3000,
    );

    expect(chromeMocks.localSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: config,
    });
  });

  it('shows error state when fetched config is invalid', async() => {
    chromeMocks.localGet.mockResolvedValue({
      [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: null,
    });

    mockSendMessageResponses(chromeMocks.sendMessage, [{
      psps: [{ psp: 'Stripe' }],
    }]);

    jest.spyOn(utils, 'fetchWithTimeout').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async() => ({ invalid: true }),
    } as unknown as Response);

    const popup = new PopupManager();

    await popup.initialize();

    expect(document.getElementById('psp-name')?.textContent).toBe('Error');
  });

  it('falls back to no-PSP state when background response is malformed',
    async() => {
      jest
        .spyOn(utils.errorUtils, 'withRetry')
        .mockImplementation(
          <T>(fn: () => Promise<T>): (() => Promise<T>) => fn,
        );

      mockSendMessageResponses(chromeMocks.sendMessage, [{ malformed: true }]);
      const popup = new PopupManager();

      await popup.initialize();

      expect(document.getElementById('psp-name')?.textContent).toBe(
        'No PSP detected',
      );
    });

  it('clears invalid cached config and refetches psps.json', async() => {
    chromeMocks.localGet.mockResolvedValue({
      [STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE]: { invalid: true },
    });

    mockSendMessageResponses(chromeMocks.sendMessage, [{
      psps: [{ psp: 'Stripe' }],
    }]);

    const config = createStripeConfig();
    const fetchSpy = jest
      .spyOn(utils, 'fetchWithTimeout')
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async() => config,
      } as unknown as Response);

    const popup = new PopupManager();
    await popup.initialize();

    expect(chromeMocks.localRemove).toHaveBeenCalledWith(
      STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'chrome-extension://test-extension/psps.json',
      3000,
    );
  });

  it('bindHistoryAction opens the extension options page', async() => {
    const popup = new PopupManager();
    popup.bindHistoryAction();

    (document.getElementById('history-link') as HTMLButtonElement).click();
    await flushAsyncTasks();

    expect(chromeMocks.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('DOMContentLoaded bootstrap initializes popup and beforeunload cleanup runs',
    async() => {
      chromeMocks.contains.mockResolvedValue(false);
      mockSendMessageResponses(chromeMocks.sendMessage, [{ psps: [] }]);

      await import('./popup');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flushAsyncTasks();
      globalThis.dispatchEvent(new Event('beforeunload'));

      expect(document.getElementById('permission-state')?.style.display).toBe(
        'block',
      );
    });
});
