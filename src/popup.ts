/**
 * Popup manager for PSP Detector Chrome Extension.
 * Handles UI updates and communication with background script.
 * @module popup
 */
import { MessageAction, PSP_DETECTION_EXEMPT } from './types';
import type { PSPConfig, PSPResponse } from './types';
import { UIService } from './services/ui';
import {
  logger,
  performanceUtils,
  errorUtils,
} from './lib/utils';
import { STORAGE_KEYS } from './lib/storage-keys';

class PopupManager {
  private readonly ui: UIService;
  private isInitialized = false;

  constructor() {
    this.ui = new UIService();
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

    this.bindHistoryAction();

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
   * Get the detected PSP from the background script
   * @private
   */
  private async getDetectedPSPs(): Promise<PSPResponse['psps']> {
    const response = await this.sendMessage<PSPResponse>({
      action: MessageAction.GET_PSP,
    });

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from background script');
    }

    return response.psps;
  }

  /**
   * Get PSP configuration with caching and enhanced error handling
   * @private
   */
  private async getPSPConfigWithCache(): Promise<PSPConfig> {
    // Try to get from extension storage cache first
    const cacheKey = STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE;
    const cachedConfig = await this.getFromCache(cacheKey);

    if (cachedConfig) {
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    try {
      const response = await fetch(chrome.runtime.getURL('psps.json'), {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch PSP config: ${response.status} ` +
          `${response.statusText}`,
        );
      }

      const config = await response.json();

      // Validate config structure
      if (!config || !Array.isArray(config.psps)) {
        throw new Error('Invalid PSP config structure');
      }

      return config;
    } catch (error) {
      clearTimeout(timeoutId);

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
      return (result as Record<string, unknown>)[key] as PSPConfig | null;
    } catch (error) {
      logger.warn('Failed to get from cache:', error);
      return null;
    }
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
            reject(new Error(chrome.runtime.lastError.message || 'Unknown error'));
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
    // Popup cleanup - currently just logging
    logger.debug('Popup manager cleaned up');
  }

  private bindHistoryAction(): void {
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

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  const popup = new PopupManager();

  // Add cleanup on window unload
  window.addEventListener('beforeunload', () => {
    popup.cleanup();
  });

  popup.initialize().catch((error) => {
    logger.error('Popup initialization failed:', error);
  });
});
