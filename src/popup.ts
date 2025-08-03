/**
 * Popup manager for PSP Detector Chrome Extension.
 * Handles UI updates and communication with background script.
 * @module popup
 */
import { MessageAction, PSPConfig, PSPResponse, PSPDetectionResult } from './types';
import { UIService } from './services/ui';
import { logger, reportError, createContextError, getAllProviders } from './lib/utils';

class PopupManager {
  private ui: UIService;

  constructor() {
    this.ui = new UIService();
  }

  /**
   * Initialize the popup
   * @return {Promise<void>}
   */
  public async initialize(): Promise<void> {
    try {
      const detectedPspResult = await this.getDetectedPSP();

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

      const pspConfig = await this.getPSPConfig();

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
          notice: groupNotice || psp.notice,
        };
        this.ui.updatePSPDisplay(
          displayPsp,
          detectedPspResult.detectionInfo,
        );
      } else {
        reportError(
          createContextError('PSP config not found', {
            component: 'PopupManager',
            action: 'initialize',
          }),
        );

        logger.error('PSP config not found for:', detectedPspResult.psp);
        this.ui.showNoPSPDetected();
      }
    } catch (error) {
      reportError(
        createContextError('Failed to initialize popup', {
          component: 'PopupManager',
          action: 'initialize',
        }),
      );

      logger.error('Failed to initialize popup:', error);
      this.ui.showError();
    }
  }

  /**
   * Get the detected PSP from the background script
   * @private
   * @return {Promise<PSPDetectionResult|null>} PSP detection result or null
   */
  private async getDetectedPSP(): Promise<PSPDetectionResult | null> {
    try {
      const response = await this.sendMessage<PSPResponse>({
        action: MessageAction.GET_PSP,
      });
      return response.psp;
    } catch (error) {
      logger.error('Failed to get detected PSP:', error);
      return null;
    }
  }

  /**
   * Get PSP configuration from extension resource
   * @private
   * @return {Promise<PSPConfig>} PSP config object
   */
  private async getPSPConfig(): Promise<PSPConfig> {
    const response = await fetch(chrome.runtime.getURL('psps.json'));
    if (!response.ok) {
      throw new Error(`Failed to fetch PSP config: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Send a message to the background script
   * @private
   * @template T
   * @param {object} message - Message to send
   * @return {Promise<T>} Response from background
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
   * @return {void}
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
    reportError(
      createContextError('Popup initialization failed', {
        component: 'PopupManager',
        action: 'documentReady',
      }),
    );

    logger.error('Popup initialization failed:', error);
  });
});
