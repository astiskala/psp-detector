/**
 * Popup manager for PSP Detector Chrome Extension.
 * Handles UI updates and communication with background script.
 * @module popup-manager
 */
import { MessageAction, PSP_DETECTION_EXEMPT } from '../types';
import type { PSPConfig, PSPResponse } from '../types';
import { UIService } from './ui';
import {
  logger,
  performanceUtils,
  errorUtils,
  fetchWithTimeout,
} from '../lib/utils';
import { STORAGE_KEYS } from '../lib/storage-keys';

/**
 * Popup orchestration service for permission checks, detection state, and
 * rendering.
 */
export class PopupManager {
  private readonly ui: UIService;
  private isInitialized = false;

  constructor() {
    this.ui = new UIService();
  }

  /**
   * Check whether the optional host permission is granted.
   * If not (or if the check itself fails), show the permission-request UI
   * and return false.
   * @private
   */
  private async checkHostPermission(): Promise<boolean> {
    try {
      const granted = await chrome.permissions.contains({
        origins: ['https://*/*'],
      });

      if (!granted) {
        this.showPermissionRequest();
      }

      return granted;
    } catch (error) {
      logger.error('Failed to check host permission:', error);
      this.showPermissionRequest();
      return false;
    }
  }

  /**
   * Show the permission-request panel and wire up the grant button.
   * @private
   */
  private showPermissionRequest(): void {
    this.setElementDisplay('loading-state', 'none');
    this.setElementDisplay('permission-state', 'block');

    const btn = document.getElementById('grant-permission-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      chrome.permissions.request({ origins: ['https://*/*'] })
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

  /**
   * Hide the permission-request panel and restore the loading state.
   * @private
   */
  private hidePermissionRequest(): void {
    this.setElementDisplay('permission-state', 'none');
    this.setElementDisplay('loading-state', 'block');
  }

  /**
   * Set display style for a DOM element by id.
   * @private
   */
  private setElementDisplay(id: string, display: string): void {
    document.getElementById(id)?.style.setProperty('display', display);
  }

  /**
   * Initialize the popup with performance monitoring and enhanced error
   * handling
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Popup already initialized');
      return;
    }

    const hasPermission = await this.checkHostPermission();
    if (!hasPermission) {
      return;
    }

    try {
      await performanceUtils.measureAsync(async() => {
        const detectedPsps = await this.getDetectedPSPsWithRetry();
        if (detectedPsps.some((entry) => entry.psp === PSP_DETECTION_EXEMPT)) {
          this.ui.showPSPDetectionDisabled();
          return;
        }

        if (detectedPsps.length === 0) {
          this.ui.showNoPSPDetected();
          return;
        }

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
   * Get the detected PSP from the background script with retry logic
   * @private
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

  /**
   * Request a re-detection attempt for the current active tab.
   * @private
   */
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
   * Get the detected PSP from the background script
   * @private
   */
  private async getDetectedPSPs(): Promise<PSPResponse['psps']> {
    const response = await this.sendMessage<unknown>({
      action: MessageAction.GET_PSP,
    });

    if (typeof response !== 'object' || response === null) {
      throw new Error('Invalid response from background script');
    }

    const typedResponse = response as Partial<PSPResponse>;
    if (!Array.isArray(typedResponse.psps)) {
      throw new Error('Invalid PSP response shape');
    }

    return typedResponse.psps;
  }

  /**
   * Get PSP configuration with caching and enhanced error handling
   * @private
   */
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
   * Get PSP configuration from extension resource
   * @private
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

  /**
   * Get data from chrome storage cache
   * @private
   */
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

  /**
   * Validate PSP config shape.
   * @private
   */
  private isPspConfig(value: unknown): value is PSPConfig {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    return Array.isArray((value as Partial<PSPConfig>).psps);
  }

  /**
   * Set data in chrome storage cache
   * @private
   */
  private async setCache(key: string, data: PSPConfig): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: data });
    } catch (error) {
      logger.warn('Failed to set cache:', error);
    }
  }

  /**
   * Send a message to the background script
   * @private
   * @template T
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

  /**
   * Clean up resources when popup is closed
   */
  public cleanup(): void {
    // Placeholder for teardown hooks if popup resources are added later.
    logger.debug('Popup manager cleaned up');
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
