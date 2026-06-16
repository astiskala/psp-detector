import { MessageAction } from './types';

interface OnboardingChromeMocks {
  contains: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  request: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  sendMessage: jest.Mock;
}

interface PermissionState {
  host: boolean;
  webRequest: boolean;
}

const GRANT_HOST_ACCESS_BUTTON_ID = 'grant-host-access';
const PERMISSION_STATUS_ID = 'permission-status';
const NOT_ENABLED_TEXT = 'not enabled';

function setupOnboardingDOM(): void {
  document.body.innerHTML = `
    <button id="${GRANT_HOST_ACCESS_BUTTON_ID}" type="button">
      Grant required permissions
    </button>
    <div id="${PERMISSION_STATUS_ID}"></div>
  `;
}

function setupChromeMocks(
  initialPermissionState: PermissionState,
  requestGrantResult: boolean,
): OnboardingChromeMocks {
  const permissionState = { ...initialPermissionState };
  const contains = jest
    .fn()
    .mockImplementation(
      async (permissionRequest: chrome.permissions.Permissions) => {
        if (permissionRequest.permissions?.includes('webRequest') === true) {
          return permissionState.webRequest;
        }

        if (permissionRequest.origins?.includes('https://*/*') === true) {
          return permissionState.host;
        }

        return false;
      },
    );
  const request = jest
    .fn()
    .mockImplementation(
      async (permissionRequest: chrome.permissions.Permissions) => {
        if (requestGrantResult) {
          if (permissionRequest.origins?.includes('https://*/*') === true) {
            permissionState.host = true;
          }

          if (permissionRequest.permissions?.includes('webRequest') === true) {
            permissionState.webRequest = true;
          }
        }

        return requestGrantResult;
      },
    );
  const sendMessage = jest.fn(
    (
      _message: { action: string },
      callback?: (response: unknown) => void,
    ): Promise<unknown> | void => {
      if (typeof callback === 'function') {
        callback({ success: true });
        return;
      }

      return Promise.resolve({ success: true });
    },
  );

  globalThis.chrome = {
    permissions: {
      contains,
      request,
    },
    runtime: {
      sendMessage,
    },
  } as unknown as typeof chrome;

  return { contains, request, sendMessage };
}

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('onboarding page', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setupOnboardingDOM();
  });

  it('shows not-enabled status when permission is missing', async () => {
    setupChromeMocks({ host: false, webRequest: false }, false);
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const status = document.querySelector(`#${PERMISSION_STATUS_ID}`);
    const button = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );

    expect(status?.textContent).toContain(NOT_ENABLED_TEXT);
    expect(button?.disabled).toBe(false);
  });

  it('shows not-enabled status when webRequest permission is missing', async () => {
    setupChromeMocks({ host: true, webRequest: false }, false);
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const status = document.querySelector(`#${PERMISSION_STATUS_ID}`);
    const button = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );

    expect(status?.textContent).toContain(NOT_ENABLED_TEXT);
    expect(button?.disabled).toBe(false);
  });

  it('requests permission and triggers re-detection from onboarding', async () => {
    const chromeMocks = setupChromeMocks(
      { host: false, webRequest: false },
      true,
    );
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const grantButton = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );
    if (grantButton === null) {
      throw new Error(`Expected ${GRANT_HOST_ACCESS_BUTTON_ID} button`);
    }

    expect(grantButton.disabled).toBe(false);
    grantButton.click();
    await flushAsyncTasks();

    const status = document.querySelector(`#${PERMISSION_STATUS_ID}`);
    const button = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );

    expect(chromeMocks.request).toHaveBeenCalledWith({
      origins: ['https://*/*'],
      permissions: ['webRequest'],
    });

    expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
      action: MessageAction.REDETECT_CURRENT_TAB,
    });

    expect(status?.textContent).toContain('enabled');
    expect(button?.disabled).toBe(true);
  });

  it('re-enables the grant button when permission is denied', async () => {
    setupChromeMocks({ host: false, webRequest: false }, false);
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const grantButton = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );
    if (grantButton === null) {
      throw new Error(`Expected ${GRANT_HOST_ACCESS_BUTTON_ID} button`);
    }

    grantButton.click();
    await flushAsyncTasks();

    const status = document.querySelector(`#${PERMISSION_STATUS_ID}`);
    expect(status?.textContent).toContain('not granted');
    expect(grantButton.disabled).toBe(false);
  });

  it('re-enables the grant button when the permission request rejects', async () => {
    const mocks = setupChromeMocks({ host: false, webRequest: false }, false);
    // Replace the default implementation entirely so subsequent calls also
    // reject — that way no fallthrough behavior can rewrite the status text
    // after the catch handler runs.
    mocks.request.mockImplementation(async () => {
      throw new Error('permission API failure');
    });

    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const grantButton = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );
    if (grantButton === null) {
      throw new Error(`Expected ${GRANT_HOST_ACCESS_BUTTON_ID} button`);
    }

    grantButton.click();
    await flushAsyncTasks();

    const status = document.querySelector(`#${PERMISSION_STATUS_ID}`);
    expect(status?.textContent).toContain('failed');
    expect(grantButton.disabled).toBe(false);
  });

  it('disables the grant button while a permission request is in flight', async () => {
    const mocks = setupChromeMocks({ host: false, webRequest: false }, false);
    // Hold the permission promise open so we can observe the intermediate
    // disabled state before it resolves. Use mockImplementation (not -Once)
    // so the held-promise behavior wins over the default impl regardless of
    // call ordering.
    let resolvePermission!: (granted: boolean) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePermission = resolve;
        }),
    );

    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const grantButton = document.querySelector<HTMLButtonElement>(
      `#${GRANT_HOST_ACCESS_BUTTON_ID}`,
    );
    if (grantButton === null) {
      throw new Error(`Expected ${GRANT_HOST_ACCESS_BUTTON_ID} button`);
    }

    expect(grantButton.disabled).toBe(false);
    grantButton.click();
    await Promise.resolve();
    expect(grantButton.disabled).toBe(true);

    resolvePermission(false);
    await flushAsyncTasks();
    // After the request resolves (denied), the button must be re-enabled so
    // the user can try again without reloading the page.
    expect(grantButton.disabled).toBe(false);
  });
});
