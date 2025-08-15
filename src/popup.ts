/**
 * Popup manager for PSP Detector Chrome Extension.
 * Handles UI updates and communication with background script.
 * @module popup
 */
import { MessageAction, PSPConfig, PSPResponse, PSPDetectionResult } from './types';
import { UIService } from './services/ui';
import {
  logger,
  getAllProviders,
  performanceUtils,
  errorUtils,
} from './lib/utils';

class PopupManager {
  private ui: UIService;
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

    try {
      await performanceUtils.measureAsync(async() => {
        const detectedPspResult = await this.getDetectedPSPWithRetry();

        // Handle exempt domain case
        if (detectedPspResult?.type === 'exempt') {
          this.ui.showPSPDetectionDisabled();
          return;
        }

        if (!detectedPspResult || detectedPspResult.type !== 'detected') {
          // No PSP detection result - PSP detection ran but found nothing
          this.ui.showNoPSPDetected();
          return;
        }

        const pspConfig = await this.getPSPConfigWithCache();

        // Use shared utility to get all providers
        const allProviders = getAllProviders(pspConfig);
        const psp = allProviders.find(
          (p: { name: string }) => p.name === detectedPspResult.psp,
        );

        // Determine group-level notice if provider is in orchestrators or tsps
        let groupNotice: string | undefined;
        if (pspConfig.orchestrators?.list.some((o) => o.name === psp?.name)) {
          groupNotice = pspConfig.orchestrators.notice;
        } else if (pspConfig.tsps?.list.some((t) => t.name === psp?.name)) {
          groupNotice = pspConfig.tsps.notice;
        }

        if (psp) {
          // Prefer group-level notice if present
          const displayPsp = {
            ...psp,
            notice: groupNotice ?? psp.notice ?? '',
          };
          this.ui.updatePSPDisplay(
            displayPsp,
            detectedPspResult.detectionInfo,
          );
        } else {
          logger.error('PSP config not found for:', detectedPspResult.psp);
          this.ui.showNoPSPDetected();
        }

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
  private async getDetectedPSPWithRetry(): Promise<PSPDetectionResult | null> {
    const retryFn = errorUtils.withRetry(
      () => this.getDetectedPSP(),
      2, // 2 retry attempts
      500, // 500ms delay
    );

    return errorUtils.safeExecuteAsync(
      retryFn,
      'get detected PSP with retry',
      null,
    );
  }

  /**
   * Get the detected PSP from the background script
   * @private
   */
  private async getDetectedPSP(): Promise<PSPDetectionResult | null> {
    const response = await this.sendMessage<PSPResponse>({
      action: MessageAction.GET_PSP,
    });

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from background script');
    }

    return response.psp;
  }

  /**
   * Get PSP configuration with caching and enhanced error handling
   * @private
   */
  private async getPSPConfigWithCache(): Promise<PSPConfig> {
    // Try to get from extension storage cache first
    const cacheKey = 'popup_psp_config_cache';
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
        throw new Error('PSP config fetch timed out');
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
      return result[key] || null;
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
            reject(chrome.runtime.lastError);
          } else {
            resolve(response as T);
          }
        });
      } catch (error) {
        reject(error);
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
