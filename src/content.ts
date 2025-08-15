/**
 * Content script for PSP Detector Chrome Extension.
 * Handles DOM observation, PSP detection, and communication with
 * background script.
 * @module content
 */
import { PSPDetectorService } from './services/psp-detector';
import { DOMObserverService } from './services/dom-observer';
import {
  MessageAction,
  ChromeMessage,
  PSPConfigResponse,
  TypeConverters,
  PSPDetectionResult,
} from './types';
import { PSP_DETECTION_EXEMPT } from './types';
import {
  logger,
  memoryUtils,
} from './lib/utils';

class ContentScript {
  private pspDetector: PSPDetectorService;
  private domObserver: DOMObserverService;
  private pspDetected = false;
  private reportedPSPs = new Set<string>();
  private processedIframes = new Set<string>();
  private lastDetectionTime = 0;
  private readonly detectionCooldown = 500; // 500ms cooldown between detections
  private readonly maxIframeProcessing = 10; // Limit iframe processing

  constructor() {
    this.pspDetector = new PSPDetectorService();
    this.domObserver = new DOMObserverService();
  }

  /**
   * Reset detection state for new page navigation
   */
  public resetForNewPage(): void {
    this.pspDetected = false;
    this.reportedPSPs.clear();
    this.processedIframes.clear();
    this.lastDetectionTime = 0;
    logger.debug('Content script state reset for new page');
  }

  /**
   * Initialize the content script
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing content script');

    // Check if extension context is still valid before proceeding
    if (!chrome.runtime?.id) {
      logger.warn('Extension context invalidated, skipping initialization');
      return;
    }

    if (this.pspDetected) {
      logger.info('PSP already detected, skipping initialization');
      return;
    }

    // Defer configuration and observer setup to idle time
    const setup = async(): Promise<void> => {
      try {
        await this.initializeExemptDomains();
        await this.initializePSPConfig();
        this.setupDOMObserver();

        // Schedule initial detection
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback((): void => {
            void this.detectPSP();
          });
        } else {
          setTimeout((): void => {
            void this.detectPSP();
          }, 0);
        }

        logger.info('Content script initialized successfully');
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Extension context invalidated')
        ) {
          logger.warn('Extension context invalidated during initialization');
          return;
        }

        logger.error('Failed to initialize content script:', error);
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback((): void => {
        void setup();
      });
    } else {
      setTimeout((): void => {
        void setup();
      }, 0);
    }
  }

  /**
   * Initialize exempt domains configuration
   * @private
   */
  private async initializeExemptDomains(): Promise<void> {
    try {
      const response = await this.sendMessage<{ exemptDomains: string[] }>({
        action: MessageAction.GET_EXEMPT_DOMAINS,
      });
      if (response?.exemptDomains) {
        this.pspDetector.setExemptDomains(response.exemptDomains);
      }
    } catch (error) {
      logger.error('Failed to initialize exempt domains:', error);
    }
  }

  /**
   * Initialize PSP configuration
   * @private
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
      logger.error('Failed to initialize PSP config:', error);
    }
  }

  /**
   * Set up DOM observer
   * @private
   */
  private setupDOMObserver(): void {
    this.domObserver.initialize(() => this.detectPSP(), 3000);
    this.domObserver.startObserving();
  }

  /**
   * Detect PSP on the current page
   * @private
   */
  private async detectPSP(): Promise<void> {
    const now = Date.now();

    // Implement cooldown to prevent excessive detection calls
    if (now - this.lastDetectionTime < this.detectionCooldown) {
      logger.debug('Detection skipped - cooldown active');
      return;
    }

    this.lastDetectionTime = now;

    if (this.pspDetected || !this.pspDetector.isInitialized()) {
      return;
    }

    const url = TypeConverters.toURL(document.URL);
    if (!url) {
      logger.warn('Invalid URL for PSP detection:', document.URL);
      return;
    }

    // Collect relevant URLs to scan instead of full HTML - optimize performance
    const scanSources = this.collectScanSources();
    const iframeContent = await this.getIframeContent();

    const scanContent = [
      document.URL,
      ...scanSources,
      ...iframeContent,
    ].join('\n');

    const result = this.pspDetector.detectPSP(url, scanContent);

    switch (result.type) {
    case 'detected':
      await this.handlePSPDetection(result);
      break;
    case 'exempt':
      await this.handlePSPDetection({ type: 'exempt', reason: result.reason, url: result.url });
      break;
    case 'none':
      // No PSP detected, continue monitoring
      break;
    case 'error':
      logger.error('PSP detection error:', result.error);
      break;
    default: {
      // Type safety: ensure all cases are handled
      // Exhaustive check for switch statement
      void result;
      break;
    }
    }
  }

  /**
   * Collect scan sources optimized for performance
   * @private
   */
  private collectScanSources(): string[] {
    const sources: string[] = [];

    // Use more efficient collection methods
    document.querySelectorAll('script[src]').forEach((script) => {
      const src = (script as HTMLScriptElement).src;
      if (src) sources.push(src);
    });

    document.querySelectorAll('iframe[src]').forEach((iframe) => {
      const src = (iframe as HTMLIFrameElement).src;
      if (src) sources.push(src);
    });

    document.querySelectorAll('form[action]').forEach((form) => {
      const action = (form as HTMLFormElement).action;
      if (action) sources.push(action);
    });

    return sources;
  }

  /**
   * Handle PSP detection result (shared logic)
   * @private
   */
  private async handlePSPDetection(result: PSPDetectionResult): Promise<void> {
    try {
      // Early duplicate detection check
      let pspName: string | null = null;
      if (result.type === 'detected') {
        pspName = result.psp;
      } else if (result.type === 'exempt') {
        pspName = PSP_DETECTION_EXEMPT;
      }

      // Check for duplicate detection
      if (pspName && this.reportedPSPs.has(pspName)) {
        logger.debug(`PSP ${pspName} already reported, skipping duplicate`);
        return;
      }

      // Mark as reported
      if (pspName) {
        this.reportedPSPs.add(pspName);
      }

      const tabResponse = await this.sendMessage<{ tabId: number }>({
        action: MessageAction.GET_TAB_ID,
      });

      if (tabResponse?.tabId) {
        const tabId = TypeConverters.toTabId(tabResponse.tabId);

        let detectionInfo: { method: 'matchString' | 'regex'; value: string } | undefined;
        let url: string | undefined;

        if (result.type === 'detected') {
          detectionInfo = result.detectionInfo;
        } else if (result.type === 'exempt') {
          url = result.url;
        }

        if (tabId && pspName) {
          logger.debug(
            'Content: Sending PSP detection to background - ' +
            `PSP: ${pspName}, TabID: ${tabId}`,
          );

          const messageData = {
            action: MessageAction.DETECT_PSP,
            data: {
              psp: TypeConverters.toPSPName(pspName),
              tabId: tabId,
              detectionInfo,
              url,
            },
          };

          logger.debug('Content: Message data:', messageData);

          try {
            await this.sendMessage(messageData);
            logger.debug('Content: Successfully sent PSP detection message to background');
          } catch (error) {
            logger.error('Content: Failed to send PSP detection message:', error);
            throw error; // Re-throw to be caught by outer try-catch
          }
        } else {
          logger.warn(
            `Content: Invalid tabId (${tabId}) or pspName (${pspName}), ` +
            'cannot send message',
          );
        }
      }

      // Mark as detected for all PSPs, including exempt domains
      this.pspDetected = true;
      if (result.type === 'detected' || result.type === 'exempt') {
        this.domObserver.stopObserving();
      }
    } catch (error) {
      // Handle extension context invalidation gracefully
      if (
        error instanceof Error &&
        error.message.includes('Extension context invalidated')
      ) {
        logger.warn('Extension context invalidated, stopping content script');
        this.domObserver.stopObserving();
        return;
      }

      logger.error('Failed to report detected PSP:', error);
    }
  }

  /**
   * Send a message to the background script with MV3 service worker handling
   * @private
   * @template T
   */
  private async sendMessage<T>(
    message: ChromeMessage,
    retries = 3,
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
          throw new Error('Extension context invalidated');
        }

        const response = await new Promise<T>((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || 'Unknown error'));
            } else {
              resolve(response as T);
            }
          });
        });

        return response;
      } catch (error) {
        const isLastAttempt = attempt === retries;
        const errorMessage = error instanceof Error ?
          error.message : String(error);

        // Handle service worker restart scenarios
        if (errorMessage.includes('Extension context invalidated') ||
            errorMessage.includes('receiving end does not exist') ||
            errorMessage.includes('service worker was stopped')) {
          if (isLastAttempt) {
            logger.warn('Failed to communicate with service worker after retries');
            throw new Error('Service worker communication failed');
          } else {
            // Wait briefly before retry to allow service worker to restart
            await new Promise(waitResolve =>
              setTimeout(waitResolve, 100 * attempt),
            );

            continue;
          }
        }

        // For other errors, don't retry
        throw error;
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Clean up resources when the content script is unloaded
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

  /**
   * Get iframe content for PSP detection (optimized with caching and security)
   * @private
   */
  private async getIframeContent(): Promise<string[]> {
    const iframeContent: string[] = [];
    const iframes = document.querySelectorAll('iframe[src]');
    let processedCount = 0;

    for (const iframe of iframes) {
      // Limit iframe processing for performance
      if (processedCount >= this.maxIframeProcessing) {
        logger.debug(
          `Iframe processing limit reached (${this.maxIframeProcessing})`,
        );

        break;
      }

      const htmlIframe = iframe as HTMLIFrameElement;
      const src = htmlIframe.src;

      // Skip if already processed or invalid
      if (!src || this.processedIframes.has(src)) {
        continue;
      }

      // Only scan iframes we can access (same-origin or allowed domains)
      if (this.canAccessIframe(src)) {
        this.processedIframes.add(src);
        processedCount++;

        try {
          // Reduce wait time for better performance
          await new Promise(resolve => setTimeout(resolve, 200));

          const iframeDoc = htmlIframe.contentDocument ||
                           htmlIframe.contentWindow?.document;
          if (iframeDoc) {
            // Get nested sources more efficiently
            this.extractNestedSources(iframeDoc, iframeContent);
          }
        } catch {
          // Silently handle cross-origin errors
        }
      }
    }

    return iframeContent;
  }

  /**
   * Extract sources from nested iframe documents
   * @private
   */
  private extractNestedSources(doc: Document, content: string[]): void {
    // Get nested iframe sources
    doc.querySelectorAll('iframe[src]').forEach(nestedIframe => {
      const nestedSrc = (nestedIframe as HTMLIFrameElement).src;
      if (nestedSrc && !this.processedIframes.has(nestedSrc)) {
        content.push(nestedSrc);
        this.processedIframes.add(nestedSrc);
      }
    });

    // Get script sources from iframe
    doc.querySelectorAll('script[src]').forEach(script => {
      const scriptSrc = (script as HTMLScriptElement).src;
      if (scriptSrc) {
        content.push(scriptSrc);
      }
    });

    // Get form actions from iframe
    doc.querySelectorAll('form[action]').forEach(form => {
      const action = (form as HTMLFormElement).action;
      if (action) {
        content.push(action);
      }
    });
  }

  /**
   * Check if we can access iframe content based on same-origin policy
   * @private
   */
  private canAccessIframe(src: string): boolean {
    try {
      const srcOrigin = new URL(src, document.baseURI).origin;
      return srcOrigin === window.location.origin;
    } catch {
      return false;
    }
  }
}

// Prevent multiple content script instances on the same page
interface WindowWithPSPDetector {
  pspDetectorContentScript?: {
    initialized: boolean;
    url: string;
  } | undefined;
}
const windowExt = window as WindowWithPSPDetector;

const currentUrl = document.URL;
const existingScript = windowExt.pspDetectorContentScript;

// Function to check if background script has state for this tab
const checkBackgroundState = async(): Promise<boolean> => {
  try {
    if (!chrome.runtime?.id) {
      return false;
    }

    // Try to ping the background script to see if it has detection state
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.CHECK_TAB_STATE,
    });
    return response?.hasState === true;
  } catch {
    // Background script not responding or extension context invalid
    return false;
  }
};

// Allow re-initialization if URL has changed (new page navigation)
// OR if background script has lost state (extension context restored)
if (existingScript?.initialized && existingScript.url === currentUrl) {
  // Check if background script still has state for this tab
  checkBackgroundState().then((hasBackgroundState) => {
    if (!hasBackgroundState) {
      logger.debug('Background script lost state, forcing re-initialization');

      // Clear the window state to force re-initialization
      windowExt.pspDetectorContentScript = undefined;

      // Re-run initialization logic
      const contentScript = new ContentScript();
      contentScript.resetForNewPage();

      windowExt.pspDetectorContentScript = {
        initialized: true,
        url: currentUrl,
      };

      // Add cleanup on page unload
      window.addEventListener('beforeunload', (): void => {
        contentScript.cleanup();
        if (windowExt.pspDetectorContentScript?.url === currentUrl) {
          windowExt.pspDetectorContentScript = undefined;
        }
      });

      contentScript.initialize().catch((error): void => {
        if (
          error instanceof Error &&
          error.message.includes('Extension context invalidated')
        ) {
          logger.warn('Extension context invalidated during startup');
        } else {
          logger.error('Content script initialization failed:', error);
        }
      });
    } else {
      logger.debug('Content script already initialized for this page, skipping');
    }
  }).catch(() => {
    logger.debug('Failed to check background state, assuming re-initialization needed');

    // If we can't check background state, assume we need to re-initialize
    windowExt.pspDetectorContentScript = undefined;

    const contentScript = new ContentScript();
    contentScript.resetForNewPage();

    windowExt.pspDetectorContentScript = {
      initialized: true,
      url: currentUrl,
    };

    window.addEventListener('beforeunload', (): void => {
      contentScript.cleanup();
      if (windowExt.pspDetectorContentScript?.url === currentUrl) {
        windowExt.pspDetectorContentScript = undefined;
      }
    });

    contentScript.initialize().catch((error): void => {
      if (
        error instanceof Error &&
        error.message.includes('Extension context invalidated')
      ) {
        logger.warn('Extension context invalidated during startup');
      } else {
        logger.error('Content script initialization failed:', error);
      }
    });
  });
} else {
  if (existingScript?.initialized) {
    logger.debug(
      `Content script URL changed from ${existingScript.url} to ` +
      `${currentUrl}, re-initializing`,
    );
  } else {
    logger.debug(`Content script initializing for new page: ${currentUrl}`);
  }

  // Mark as initialized for this specific URL
  windowExt.pspDetectorContentScript = {
    initialized: true,
    url: currentUrl,
  };

  // Initialize content script
  const contentScript = new ContentScript();

  // Reset state if this is a URL change (re-initialization)
  if (existingScript?.initialized) {
    contentScript.resetForNewPage();
  }

  // Add cleanup on page unload
  window.addEventListener('beforeunload', (): void => {
    contentScript.cleanup();
    if (windowExt.pspDetectorContentScript?.url === currentUrl) {
      windowExt.pspDetectorContentScript = undefined;
    }
  });

  contentScript.initialize().catch((error): void => {
    // Don't log errors if extension context is invalidated
    // (expected during reloads)
    if (
      error instanceof Error &&
      error.message.includes('Extension context invalidated')
    ) {
      logger.warn('Extension context invalidated during startup');
    } else {
      logger.error('Content script initialization failed:', error);
    }
  });
}
