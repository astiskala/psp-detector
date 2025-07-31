/**
 * Content script for PSP Detector Chrome Extension.
 * Handles DOM observation, PSP detection, and communication with
 * background script.
 * @module content
 */
import {PSPDetectorService} from './services/psp-detector';
import {DOMObserverService} from './services/dom-observer';
import {
  MessageAction,
  ChromeMessage,
  PSPConfigResponse,
  TypeConverters,
} from './types';
import {PSP_DETECTION_EXEMPT} from './types';
import {
  logger,
  reportError,
  createContextError,
  memoryUtils,
} from './lib/utils';

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
        logger.time('initializeExemptDomains');
        await this.initializeExemptDomains();
        logger.timeEnd('initializeExemptDomains');

        logger.time('initializePSPConfig');
        await this.initializePSPConfig();
        logger.timeEnd('initializePSPConfig');

        logger.time('setupDOMObserver');
        this.setupDOMObserver();
        logger.timeEnd('setupDOMObserver');

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
        const contextError = createContextError(
          'Failed to initialize content script',
          {
            component: 'ContentScript',
            action: 'initialize',
          },
        );
        reportError(contextError);
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
  } /**
   * Initialize exempt domains configuration
   * @private
   * @return {Promise<void>}
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
      reportError(
        createContextError('Failed to initialize exempt domains', {
          component: 'ContentScript',
          action: 'initializeExemptDomains',
        }),
      );
      logger.error('Failed to initialize exempt domains:', error);
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
        createContextError('Failed to initialize PSP config', {
          component: 'ContentScript',
          action: 'initializePSPConfig',
        }),
      );
      logger.error('Failed to initialize PSP config:', error);
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

    const url = TypeConverters.toURL(document.URL);
    if (!url) {
      logger.warn('Invalid URL for PSP detection:', document.URL);
      return;
    }

    // Collect relevant URLs to scan instead of full HTML
    const scriptSrcs = Array.from(document.scripts)
      .map((s) => s.src)
      .filter(Boolean);
    const iframeSrcs = Array.from(document.querySelectorAll('iframe'))
      .map((i) => (i as HTMLIFrameElement).src)
      .filter(Boolean);
    const formActions = Array.from(document.forms)
      .map((f) => (f as HTMLFormElement).action)
      .filter(Boolean);

    const scanContent = [
      document.URL,
      ...scriptSrcs,
      ...iframeSrcs,
      ...formActions,
    ].join('\n');

    const result = this.pspDetector.detectPSP(url, scanContent);

    switch (result.type) {
    case 'detected':
      await this.handlePSPDetection(result.psp);
      break;
    case 'exempt':
      await this.handlePSPDetection(PSP_DETECTION_EXEMPT);
      break;
    case 'none':
      // No PSP detected, continue monitoring
      break;
    case 'error':
      logger.error('PSP detection error:', result.error);
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
            data: {psp: pspName, tabId: tabId},
          });
        }
      }

      // Mark as detected for all PSPs, including exempt domains
      this.pspDetected = true;
      if (detectedPsp !== PSP_DETECTION_EXEMPT) {
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
          reject(new Error('Extension context invalidated'));
          return;
        }

        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            // Handle specific case of extension context invalidation
            if (
              chrome.runtime.lastError.message?.includes(
                'Extension context invalidated',
              )
            ) {
              logger.warn('Extension was reloaded, stopping content script');
              reject(new Error('Extension context invalidated'));
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
window.addEventListener('beforeunload', (): void => {
  contentScript.cleanup();
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
    reportError(
      createContextError('Content script initialization failed', {
        component: 'ContentScript',
        action: 'startup',
      }),
    );
    logger.error('Content script initialization failed:', error);
  }
});
