/**
 * Popup manager for PSP Detector Chrome Extension.
 * Handles UI updates and communication with background script.
 * @module popup
 */
import { MessageAction } from "./types";
import { UIService } from "./services/ui";
import { logger } from "./lib/utils";

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
      const detectedPsp = await this.getDetectedPSP();
      if (!detectedPsp) {
        this.ui.showNoPSPDetected();
        return;
      }
      const pspConfig = await this.getPSPConfig();
      const psp = pspConfig.psps.find(
        (p: { name: string }) => p.name === detectedPsp,
      );
      if (psp) {
        this.ui.updatePSPDisplay(psp);
      } else {
        logger.error("PSP config not found for:", detectedPsp);
        this.ui.showNoPSPDetected();
      }
    } catch (error) {
      logger.error("Failed to initialize popup:", error);
      this.ui.showError();
    }
  }

  /**
   * Get the detected PSP from the background script
   * @private
   * @return {Promise<string|null>} PSP name or null
   */
  private async getDetectedPSP(): Promise<string | null> {
    try {
      const response = await this.sendMessage<{ psp: string | null }>({
        action: MessageAction.GET_PSP,
      });
      return response.psp;
    } catch (error) {
      logger.error("Failed to get detected PSP:", error);
      return null;
    }
  }

  /**
   * Get PSP configuration from extension resource
   * @private
   * @return {Promise<any>} PSP config object
   */
  private async getPSPConfig(): Promise<any> {
    const response = await fetch(chrome.runtime.getURL("psp-config.json"));
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
            resolve(response);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

// Initialize popup

document.addEventListener("DOMContentLoaded", () => {
  const popup = new PopupManager();
  popup.initialize().catch((error) => {
    logger.error("Popup initialization failed:", error);
  });
});
