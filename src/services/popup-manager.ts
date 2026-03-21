/**
 * Coordinates popup startup: permission checks, cached config loading, and UI
 * rendering from background-service state.
 */
import { MessageAction, PSP_DETECTION_EXEMPT } from '../types';
import type { PSPConfig, PSPResponse } from '../types';
import { UIService } from './ui';
import {
  logger,
  measureAsync,
  errorUtils,
  fetchWithTimeout,
} from '../lib/utils';
import { STORAGE_KEYS } from '../lib/storage-keys';

/**
 *
 */
export class PopupManager {
  private readonly ui: UIService;
  private isInitialized = false;
  private permissionButtonBound = false;

  constructor() {
    this.ui = new UIService();
  }

  /**
   * Checks the optional host and `webRequest` permissions that unlock fuller
   * detection coverage.
   */
  private async checkDetectionPermissions(): Promise<{
    hasHostPermission: boolean;
    hasWebRequestPermission: boolean;
  }> {
    try {
      const [hasHostPermission, hasWebRequestPermission] = await Promise.all([
        chrome.permissions.contains({
          origins: ['https://*/*'],
        }),
        chrome.permissions.contains({
          permissions: ['webRequest'],
        }),
      ]);

      if (!hasHostPermission || !hasWebRequestPermission) {
        this.showPermissionRequest();
      }

      return { hasHostPermission, hasWebRequestPermission };
    } catch (error) {
      logger.error('Failed to check optional permissions:', error);
      this.showPermissionRequest();
      return {
        hasHostPermission: false,
        hasWebRequestPermission: false,
      };
    }
  }

  /** Shows the permission CTA and binds the grant flow once. */
  private showPermissionRequest(): void {
    this.setElementDisplay('loading-state', 'none');
    this.setElementDisplay('permission-state', 'block');

    const btn = document.getElementById('grant-permission-btn');
    if (!btn || this.permissionButtonBound) return;
    this.permissionButtonBound = true;

    btn.addEventListener('click', () => {
      chrome.permissions.request({
        origins: ['https://*/*'],
        permissions: ['webRequest'],
      })
        .then(async(granted) => {
          if (granted) {
            this.hidePermissionRequest();
            await this.requestCurrentTabRedetect();
            await this.initialize();
          }
        })
        .catch((error) => {
          logger.error('Permission request failed:', error);
        });
    });
  }

  private hidePermissionRequest(): void {
    this.setElementDisplay('permission-state', 'none');
    this.setElementDisplay('loading-state', 'block');
  }

  private hidePermissionPanel(): void {
    this.setElementDisplay('permission-state', 'none');
  }

  private setElementDisplay(id: string, display: string): void {
    document.getElementById(id)?.style.setProperty('display', display);
  }

  /**
   * Boots the popup, rendering exempt, empty, or detected states from the
   * background service.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Popup already initialized');
      return;
    }

    const permissionState = await this.checkDetectionPermissions();
    const hasPermission = permissionState.hasHostPermission &&
      permissionState.hasWebRequestPermission;

    try {
      await measureAsync(async() => {
        const detectedPsps = await this.getDetectedPSPsWithRetry();
        if (detectedPsps.some((entry) => entry.psp === PSP_DETECTION_EXEMPT)) {
          this.hidePermissionPanel();
          this.ui.showPSPDetectionDisabled();
          return;
        }

        if (detectedPsps.length === 0) {
          this.ui.showNoPSPDetected();
          if (hasPermission) {
            this.hidePermissionPanel();
          }

          return;
        }

        this.hidePermissionPanel();
        const pspConfig = await this.getPSPConfigWithCache();
        this.ui.renderMultiplePSPs(detectedPsps, pspConfig);

        this.isInitialized = true;
      }, 'Popup initialization');
    } catch (error) {
      logger.error('Failed to initialize popup:', error);
      this.ui.showError();
    }
  }

  /**
   * Retries transient background failures before falling back to an empty list.
   */
  private async getDetectedPSPsWithRetry(): Promise<PSPResponse['psps']> {
    const retryFn = errorUtils.withRetry(
      () => this.getDetectedPSPs(),
      2, // 2 retry attempts
      500, // 500ms delay
    );

    return errorUtils.safeExecuteAsync(
      retryFn,
      'get detected PSP with retry',
      [],
    );
  }

  private async requestCurrentTabRedetect(): Promise<void> {
    try {
      await this.sendMessage<{ success: boolean }>({
        action: MessageAction.REDETECT_CURRENT_TAB,
      });
    } catch (error) {
      logger.warn('Failed to trigger current-tab re-detection:', error);
    }
  }

  /**
   * Reads the current tab's detected-provider list from the background page.
   */
  private async getDetectedPSPs(): Promise<PSPResponse['psps']> {
    const response = await this.sendMessage<unknown>({
      action: MessageAction.GET_PSP,
    });

    if (typeof response !== 'object' || response === null) {
      throw new TypeError('Invalid response from background script');
    }

    const typedResponse = response as Partial<PSPResponse>;
    if (!Array.isArray(typedResponse.psps)) {
      throw new TypeError('Invalid PSP response shape');
    }

    return typedResponse.psps;
  }

  /** Uses local storage as a popup-local cache before fetching `psps.json`. */
  private async getPSPConfigWithCache(): Promise<PSPConfig> {
    // Try to get from extension storage cache first
    const cacheKey = STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE;
    const cachedConfig = await this.getFromCache(cacheKey);

    if (cachedConfig !== null) {
      logger.debug('Using cached PSP config');
      return cachedConfig;
    }

    // Fallback to fetching from extension resource
    const config = await this.getPSPConfig();

    // Cache for next time
    await this.setCache(cacheKey, config);

    return config;
  }

  /**
   * Fetches and validates the bundled provider dataset from extension assets.
   */
  private async getPSPConfig(): Promise<PSPConfig> {
    try {
      const response = await fetchWithTimeout(
        chrome.runtime.getURL('psps.json'),
        3000,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch PSP config: ${response.status} ` +
          `${response.statusText}`,
        );
      }

      const config = await response.json();

      // Validate config structure
      if (!this.isPspConfig(config)) {
        throw new Error('Invalid PSP config structure');
      }

      return config;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('PSP config fetch timed out', { cause: error });
      }

      throw error;
    }
  }

  private async getFromCache(key: string): Promise<PSPConfig | null> {
    try {
      const result = await chrome.storage.local.get(key);
      const cachedValue = (result as Record<string, unknown>)[key];

      if (cachedValue === undefined || cachedValue === null) {
        return null;
      }

      if (!this.isPspConfig(cachedValue)) {
        logger.warn('Invalid cached PSP config. Clearing popup cache entry.');
        await chrome.storage.local.remove(key);
        return null;
      }

      return cachedValue;
    } catch (error) {
      logger.warn('Failed to get from cache:', error);
      return null;
    }
  }

  /** Performs a lightweight shape check before trusting cached popup config. */
  private isPspConfig(value: unknown): value is PSPConfig {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    return Array.isArray((value as Partial<PSPConfig>).psps);
  }

  private async setCache(key: string, data: PSPConfig): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: data });
    } catch (error) {
      logger.warn('Failed to set cache:', error);
    }
  }

  /**
   * Wraps `chrome.runtime.sendMessage` in a typed promise for popup callers.
   */
  private sendMessage<T>(message: { action: MessageAction }): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(chrome.runtime.lastError.message ?? 'Unknown error'),
            );
          } else if (response === undefined) {
            reject(new Error('No response from background script'));
          } else {
            resolve(response as T);
          }
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public bindHistoryAction(): void {
    const historyButton = document.getElementById('history-link');
    if (!historyButton) {
      return;
    }

    historyButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage().catch((error) => {
        logger.error('Failed to open history page:', error);
      });
    });
  }
}
