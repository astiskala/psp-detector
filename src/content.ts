/**
 * Content script for PSP Detector Chrome Extension.
 * Handles DOM observation, PSP detection, and communication with background script.
 * @module content
 */
import { PSPDetectorService } from "./services/psp-detector";
import { DOMObserverService } from "./services/dom-observer";
import { MessageAction, ChromeMessage, PSPConfigResponse } from "./types";
import { PSP_DETECTION_EXEMPT } from "./types";
import { logger } from "./lib/utils";

class ContentScript {
  private pspDetector: PSPDetectorService;
  private domObserver: DOMObserverService;
  private pspDetected = false;

  constructor() {
    this.pspDetector = new PSPDetectorService();
    this.domObserver = new DOMObserverService();
  }

  /**
   * Initialize the content script
   * @return {Promise<void>}
   */
  public async initialize(): Promise<void> {
    console.log("[PSP Detector] Initializing content script");

    // Check if extension context is still valid before proceeding
    if (!chrome.runtime?.id) {
      console.warn(
        "[PSP Detector] Extension context invalidated, skipping initialization",
      );
      return;
    }

    try {
      await this.initializeExemptDomains();
      await this.initializePSPConfig();
      this.setupDOMObserver();
      this.detectPSP();
      console.log("[PSP Detector] Content script initialized successfully");
    } catch (error) {
      // Handle extension context invalidation during initialization
      if (
        error instanceof Error &&
        error.message.includes("Extension context invalidated")
      ) {
        console.warn(
          "[PSP Detector] Extension context invalidated during initialization",
        );
        return;
      }
      console.error(
        "[PSP Detector] Failed to initialize content script:",
        error,
      );
      logger.error("Failed to initialize content script:", error);
    }
  } /**
   * Initialize exempt domains configuration
   * @private
   * @return {Promise<void>}
   */
  private async initializeExemptDomains(): Promise<void> {
    try {
      const response = await this.sendMessage<{ regex: string }>({
        action: MessageAction.GET_EXEMPT_DOMAINS_REGEX,
      });
      if (response?.regex) {
        this.pspDetector.setExemptDomainsPattern(response.regex);
      }
    } catch (error) {
      logger.error("Failed to initialize exempt domains:", error);
    }
  }

  /**
   * Initialize PSP configuration
   * @private
   * @return {Promise<void>}
   */
  private async initializePSPConfig(): Promise<void> {
    try {
      const response = await this.sendMessage<PSPConfigResponse>({
        action: MessageAction.GET_PSP_CONFIG,
      });
      if (response?.config) {
        this.pspDetector.initialize(response.config);
      }
    } catch (error) {
      logger.error("Failed to initialize PSP config:", error);
    }
  }

  /**
   * Set up DOM observer
   * @private
   * @return {void}
   */
  private setupDOMObserver(): void {
    this.domObserver.initialize(() => this.detectPSP());
    this.domObserver.startObserving();
  }

  /**
   * Detect PSP on the current page
   * @private
   * @return {Promise<void>}
   */
  private async detectPSP(): Promise<void> {
    if (this.pspDetected || !this.pspDetector.isInitialized()) {
      return;
    }
    const detectedPsp = this.pspDetector.detectPSP(
      document.URL,
      document.documentElement.outerHTML,
    );
    if (detectedPsp) {
      try {
        const tabResponse = await this.sendMessage<{ tabId: number }>({
          action: MessageAction.GET_TAB_ID,
        });
        if (tabResponse?.tabId) {
          await this.sendMessage({
            action: MessageAction.DETECT_PSP,
            data: { psp: detectedPsp, tabId: tabResponse.tabId },
          });
        }
        // Only mark as detected and stop observing for actual PSPs, not exempt domains
        if (detectedPsp !== PSP_DETECTION_EXEMPT) {
          this.pspDetected = true;
          this.domObserver.stopObserving();
        }
      } catch (error) {
        // Handle extension context invalidation gracefully
        if (
          error instanceof Error &&
          error.message.includes("Extension context invalidated")
        ) {
          console.warn(
            "[PSP Detector] Extension context invalidated, stopping content script",
          );
          this.domObserver.stopObserving();
          return;
        }
        logger.error("Failed to report detected PSP:", error);
      }
    }
  }

  /**
   * Send a message to the background script
   * @private
   * @template T
   * @param {ChromeMessage} message - Message to send
   * @return {Promise<T>} Response from background
   */
  private sendMessage<T>(message: ChromeMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
          reject(new Error("Extension context invalidated"));
          return;
        }

        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            // Handle specific case of extension context invalidation
            if (
              chrome.runtime.lastError.message?.includes(
                "Extension context invalidated",
              )
            ) {
              console.warn(
                "[PSP Detector] Extension was reloaded, stopping content script",
              );
              reject(new Error("Extension context invalidated"));
            } else {
              reject(chrome.runtime.lastError);
            }
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

// Initialize content script
const contentScript = new ContentScript();
contentScript.initialize().catch((error) => {
  // Don't log errors if extension context is invalidated (expected during reloads)
  if (
    error instanceof Error &&
    error.message.includes("Extension context invalidated")
  ) {
    console.warn("[PSP Detector] Extension context invalidated during startup");
  } else {
    logger.error("Content script initialization failed:", error);
  }
});
