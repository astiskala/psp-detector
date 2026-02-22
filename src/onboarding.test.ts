import { MessageAction } from './types';

interface OnboardingChromeMocks {
  contains: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  request: jest.Mock<Promise<boolean>, [chrome.permissions.Permissions]>;
  sendMessage: jest.Mock;
}

function setupOnboardingDOM(): void {
  document.body.innerHTML = `
    <button id="grant-host-access" type="button">Grant site access</button>
    <div id="permission-status"></div>
  `;
}

function setupChromeMocks(
  initiallyGranted: boolean,
  requestGrantResult: boolean,
): OnboardingChromeMocks {
  let grantedState = initiallyGranted;
  const contains = jest
    .fn()
    .mockImplementation(async() => {
      return grantedState;
    });
  const request = jest
    .fn()
    .mockImplementation(async() => {
      if (requestGrantResult) {
        grantedState = true;
      }

      return requestGrantResult;
    });
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

  it('shows not-enabled status when permission is missing', async() => {
    setupChromeMocks(false, false);
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const status = document.getElementById('permission-status');
    const button = document.getElementById(
      'grant-host-access',
    ) as HTMLButtonElement | null;

    expect(status?.textContent).toContain('not enabled');
    expect(button?.disabled).toBe(false);
  });

  it('requests permission and triggers re-detection from onboarding', async() => {
    const chromeMocks = setupChromeMocks(false, true);
    await import('./onboarding');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsyncTasks();

    const grantButton = document.getElementById(
      'grant-host-access',
    ) as HTMLButtonElement | null;
    if (grantButton === null) {
      throw new Error('Expected grant-host-access button');
    }

    expect(grantButton.disabled).toBe(false);
    grantButton.click();
    await flushAsyncTasks();

    const status = document.getElementById('permission-status');
    const button = document.getElementById(
      'grant-host-access',
    ) as HTMLButtonElement | null;

    expect(chromeMocks.request).toHaveBeenCalledWith({
      origins: ['https://*/*'],
    });

    expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
      action: MessageAction.REDETECT_CURRENT_TAB,
    });

    expect(status?.textContent).toContain('enabled');
    expect(button?.disabled).toBe(true);
  });
});
