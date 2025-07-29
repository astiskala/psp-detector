/**
 * Content script for PSP Detector Chrome Extension.
 * Handles DOM observation, PSP detection, and communication with background script.
 * @module content
 */
import { PSPDetectorService } from "./services/psp-detector";
import { DOMObserverService } from "./services/dom-observer";
import { MessageAction, ChromeMessage, PSPConfigResponse } from "./types";
import { PSP_DETECTION_EXEMPT } from "./types";
import {
  logger,
  reportError,
  createContextError,
  memoryUtils,
  TypeConverters,
} from "./lib/utils";

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
      const contextError = createContextError(
        "Failed to initialize content script",
        {
          component: "ContentScript",
          action: "initialize",
        },
      );
      reportError(contextError);
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
      reportError(
        createContextError("Failed to initialize exempt domains", {
          component: "ContentScript",
          action: "initializeExemptDomains",
        }),
      );
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
      reportError(
        createContextError("Failed to initialize PSP config", {
          component: "ContentScript",
          action: "initializePSPConfig",
        }),
      );
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
   * Detect PSP on the current page (legacy method for backward compatibility)
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
      await this.handlePSPDetection(detectedPsp);
    }
  }

  /**
   * Enhanced PSP detection using type-safe PSPDetectionResult
   * @private
   * @return {Promise<void>}
   */
  private async detectPSPEnhanced(): Promise<void> {
    if (this.pspDetected || !this.pspDetector.isInitialized()) {
      return;
    }

    const url = TypeConverters.toURL(document.URL);
    if (!url) {
      logger.warn("Invalid URL for PSP detection:", document.URL);
      return;
    }

    const result = this.pspDetector.detectPSPEnhanced(
      url,
      document.documentElement.outerHTML,
    );

    switch (result.type) {
      case "detected":
        await this.handlePSPDetection(result.psp);
        break;
      case "exempt":
        await this.handlePSPDetection(PSP_DETECTION_EXEMPT);
        break;
      case "none":
        // No PSP detected, continue monitoring
        break;
      case "error":
        logger.error("PSP detection error:", result.error);
        break;
      default: {
        // Type safety: ensure all cases are handled
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _exhaustive: never = result;
        break;
      }
    }
  }

  /**
   * Handle PSP detection result (shared logic)
   * @private
   * @param {string} detectedPsp - The detected PSP name or exempt marker
   * @return {Promise<void>}
   */
  private async handlePSPDetection(detectedPsp: string): Promise<void> {
    try {
      const tabResponse = await this.sendMessage<{ tabId: number }>({
        action: MessageAction.GET_TAB_ID,
      });
      if (tabResponse?.tabId) {
        const tabId = TypeConverters.toTabId(tabResponse.tabId);
        const pspName =
          detectedPsp === PSP_DETECTION_EXEMPT
            ? detectedPsp
            : TypeConverters.toPSPName(detectedPsp);

        if (tabId && pspName) {
          await this.sendMessage({
            action: MessageAction.DETECT_PSP,
            data: { psp: pspName, tabId: tabId },
          });
        }
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
            resolve(response as T);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Clean up resources when the content script is unloaded
   * @return {void}
   */
  public cleanup(): void {
    const cleanupFunctions = [
      (): void => this.domObserver.cleanup(),
      (): void => {
        this.pspDetected = false;
      },
    ];

    memoryUtils.cleanup(cleanupFunctions);
  }
}

// Initialize content script
const contentScript = new ContentScript();

// Add cleanup on page unload
window.addEventListener("beforeunload", (): void => {
  contentScript.cleanup();
});

contentScript.initialize().catch((error): void => {
  // Don't log errors if extension context is invalidated (expected during reloads)
  if (
    error instanceof Error &&
    error.message.includes("Extension context invalidated")
  ) {
    console.warn("[PSP Detector] Extension context invalidated during startup");
  } else {
    reportError(
      createContextError("Content script initialization failed", {
        component: "ContentScript",
        action: "startup",
      }),
    );
    logger.error("Content script initialization failed:", error);
  }
});
