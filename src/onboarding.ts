import { MessageAction } from './types';
import { logger } from './lib/utils';

interface DetectionPermissionState {
  hasHostPermission: boolean;
  hasWebRequestPermission: boolean;
}

function getElementByIdOrThrow<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element #${id} not found`);
  }

  return element as T;
}

async function getDetectionPermissionState(): Promise<DetectionPermissionState> {
  const [hasHostPermission, hasWebRequestPermission] = await Promise.all([
    chrome.permissions.contains({
      origins: ['https://*/*'],
    }),
    chrome.permissions.contains({
      permissions: ['webRequest'],
    }),
  ]);

  return { hasHostPermission, hasWebRequestPermission };
}

async function updatePermissionStatus(
  statusElement: HTMLElement,
  grantButton: HTMLButtonElement,
): Promise<void> {
  try {
    const permissionState = await getDetectionPermissionState();
    const hasDetectionPermissions =
      permissionState.hasHostPermission &&
      permissionState.hasWebRequestPermission;
    if (hasDetectionPermissions) {
      statusElement.textContent =
        'Required permissions are enabled. PSP detection is ready.';

      statusElement.classList.add('ready');
      grantButton.disabled = true;
      grantButton.textContent = 'Permissions granted';
    } else {
      statusElement.textContent = 'Required permissions are not enabled yet.';
      statusElement.classList.remove('ready');
      grantButton.disabled = false;
      grantButton.textContent = 'Grant required permissions';
    }
  } catch (error) {
    logger.warn('Failed to check onboarding optional permission state:', error);

    statusElement.textContent = 'Unable to verify permission status.';
    statusElement.classList.remove('ready');
    grantButton.disabled = false;
    grantButton.textContent = 'Grant required permissions';
  }
}

async function requestPermissionFromOnboarding(
  statusElement: HTMLElement,
  grantButton: HTMLButtonElement,
): Promise<void> {
  try {
    const granted = await chrome.permissions.request({
      origins: ['https://*/*'],
      permissions: ['webRequest'],
    });
    if (!granted) {
      statusElement.textContent =
        'Permission was not granted. You can try again any time.';

      statusElement.classList.remove('ready');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        action: MessageAction.REDETECT_CURRENT_TAB,
      });
    } catch (error) {
      logger.debug('Redetect trigger from onboarding skipped:', error);
    }

    await updatePermissionStatus(statusElement, grantButton);
  } catch (error) {
    logger.error(
      'Failed to request optional permissions from onboarding:',
      error,
    );

    statusElement.textContent = 'Permission request failed. Please try again.';
    statusElement.classList.remove('ready');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const grantButton =
    getElementByIdOrThrow<HTMLButtonElement>('grant-host-access');
  const statusElement = getElementByIdOrThrow<HTMLElement>('permission-status');

  updatePermissionStatus(statusElement, grantButton).catch((error) => {
    logger.error('Onboarding status initialization failed:', error);
  });

  grantButton.addEventListener('click', () => {
    requestPermissionFromOnboarding(statusElement, grantButton).catch(
      (error) => {
        logger.error('Onboarding permission request failed:', error);
      },
    );
  });
});
