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
  TypeConverters,
  type PSPDetectionResult,
  PSP_DETECTION_EXEMPT,
  type ChromeMessage,
  type PSPConfigResponse,
  type PSPMatch,
  type SourceType,
} from './types';
import {
  logger,
  memoryUtils,
} from './lib/utils';

const EXTENSION_CONTEXT_INVALIDATED_MESSAGE = 'Extension context invalidated';
const SERVICE_WORKER_RESTART_ERRORS = [
  EXTENSION_CONTEXT_INVALIDATED_MESSAGE,
  'receiving end does not exist',
  'service worker was stopped',
];

const isExtensionContextInvalidated = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes(EXTENSION_CONTEXT_INVALIDATED_MESSAGE);

const isServiceWorkerRestartError = (message: string): boolean =>
  SERVICE_WORKER_RESTART_ERRORS.some((fragment) => message.includes(fragment));

type IdleCallback = (callback: () => void) => void;

const scheduleIdle = (callback: () => void): void => {
  const requestIdleCallback = (globalThis as unknown as {
    requestIdleCallback?: IdleCallback;
  }).requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback);
  } else {
    setTimeout(callback, 0);
  }
};

interface ScanSources {
  scriptSrcs: string[];
  iframeSrcs: string[];
  formActions: string[];
  linkHrefs: string[];
}

class ContentScript {
  private readonly pspDetector: PSPDetectorService;
  private readonly domObserver: DOMObserverService;
  private pspDetected = false;
  private readonly reportedPSPs = new Set<string>();
  private readonly processedIframes = new Set<string>();
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
        scheduleIdle(() => {
          this.detectPSP().catch((error) => {
            logger.error('Initial PSP detection failed:', error);
          });
        });

        logger.info('Content script initialized successfully');
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          logger.warn('Extension context invalidated during initialization');
          return;
        }

        logger.error('Failed to initialize content script:', error);
      }
    };

    scheduleIdle(() => {
      setup().catch((error) => {
        logger.error('Content script setup failed:', error);
      });
    });
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
      ...scanSources.scriptSrcs,
      ...scanSources.iframeSrcs,
      ...scanSources.formActions,
      ...scanSources.linkHrefs,
      ...iframeContent,
    ].join('\n');

    const result = this.pspDetector.detectPSP(url, scanContent);

    switch (result.type) {
    case 'detected':
      for (const match of result.psps) {
        const sourceType = match.detectionInfo
          ? this.determineSourceType(match.detectionInfo.value, scanSources)
          : 'pageUrl';

        const taggedMatch: PSPMatch = match.detectionInfo
          ? {
            ...match,
            detectionInfo: { ...match.detectionInfo, sourceType },
          }
          : { ...match };
        await this.handlePSPMatch(taggedMatch);
      }

      break;
    case 'exempt':
      await this.handlePSPDetection(result);
      break;
    case 'none':
      // No PSP detected, continue monitoring
      break;
    case 'error':
      logger.error('PSP detection error:', result.error);
      break;
    }
  }

  /**
   * Collect scan sources optimized for performance
   * @private
   */
  private collectScanSources(): ScanSources {
    const scriptSrcs: string[] = [];
    const iframeSrcs: string[] = [];
    const formActions: string[] = [];
    const linkHrefs: string[] = [];

    document.querySelectorAll(
      'script[src], iframe[src], form[action], link[href]',
    ).forEach((element) => {
      switch (element.tagName) {
      case 'SCRIPT': {
        const src = (element as HTMLScriptElement).src;
        if (src) scriptSrcs.push(src);
        break;
      }

      case 'IFRAME': {
        const src = (element as HTMLIFrameElement).src;
        if (src) iframeSrcs.push(src);
        break;
      }

      case 'FORM': {
        const action = (element as HTMLFormElement).action;
        if (action) formActions.push(action);
        break;
      }

      case 'LINK': {
        const href = (element as HTMLLinkElement).href;
        if (href) linkHrefs.push(href);
        break;
      }

      default:
        break;
      }
    });

    return { scriptSrcs, iframeSrcs, formActions, linkHrefs };
  }

  private determineSourceType(
    value: string,
    sources: ScanSources,
  ): SourceType {
    if (sources.scriptSrcs.some((s) => s.includes(value))) return 'scriptSrc';
    if (sources.iframeSrcs.some((s) => s.includes(value))) return 'iframeSrc';
    if (sources.formActions.some((s) => s.includes(value))) return 'formAction';
    if (sources.linkHrefs.some((s) => s.includes(value))) return 'linkHref';
    return 'pageUrl';
  }

  /**
   * Handle PSP detection result (shared logic)
   * @private
   */
  private async handlePSPDetection(result: PSPDetectionResult): Promise<void> {
    try {
      const tabId = await this.getActiveTabId();
      if (tabId && result.type === 'exempt') {
        await this.reportDetectionToBackground(tabId, PSP_DETECTION_EXEMPT, {
          psp: TypeConverters.toPSPName(PSP_DETECTION_EXEMPT)!,
        });
      }

      // Mark as detected for all PSPs, including exempt domains
      this.pspDetected = true;
      if (result.type === 'detected' || result.type === 'exempt') {
        this.domObserver.stopObserving();
      }
    } catch (error) {
      // Handle extension context invalidation gracefully
      if (isExtensionContextInvalidated(error)) {
        logger.warn('Extension context invalidated, stopping content script');
        this.domObserver.stopObserving();
        return;
      }

      logger.error('Failed to report detected PSP:', error);
    }
  }

  private async handlePSPMatch(match: PSPMatch): Promise<void> {
    if (this.reportedPSPs.has(match.psp)) {
      logger.debug(`PSP ${match.psp} already reported, skipping`);
      return;
    }

    this.reportedPSPs.add(match.psp);
    const tabId = await this.getActiveTabId();

    if (tabId) {
      await this.reportDetectionToBackground(tabId, match.psp, match);
    }

    this.pspDetected = true;
    this.domObserver.stopObserving();
  }

  private async getActiveTabId(): Promise<
    ReturnType<typeof TypeConverters.toTabId> | null
    > {
    const tabResponse = await this.sendMessage<{ tabId: number }>({
      action: MessageAction.GET_TAB_ID,
    });

    if (!tabResponse?.tabId) return null;
    return TypeConverters.toTabId(tabResponse.tabId);
  }

  private async reportDetectionToBackground(
    tabId: ReturnType<typeof TypeConverters.toTabId>,
    pspName: string,
    match: PSPMatch,
  ): Promise<void> {
    logger.debug(
      'Content: Sending PSP detection to background - ' +
      `PSP: ${pspName}, TabID: ${tabId}`,
    );

    const messageData = {
      action: MessageAction.DETECT_PSP,
      data: {
        psp: TypeConverters.toPSPName(pspName),
        tabId,
        detectionInfo: match.detectionInfo,
      },
    };

    logger.debug('Content: Message data:', messageData);
    await this.sendMessage(messageData);
    logger.debug('Content: Successfully sent PSP detection message to background');
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
        return await this.sendMessageOnce(message);
      } catch (error) {
        const isLastAttempt = attempt === retries;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Handle service worker restart scenarios
        if (isServiceWorkerRestartError(errorMessage)) {
          if (isLastAttempt) {
            logger.warn('Failed to communicate with service worker after retries');
            throw new Error('Service worker communication failed', {
              cause: error,
            });
          }

          // Wait briefly before retry to allow service worker to restart
          await new Promise(waitResolve =>
            setTimeout(waitResolve, 100 * attempt),
          );

          continue;
        }

        // For other errors, don't retry
        throw error;
      }
    }

    throw new Error('Max retries exceeded');
  }

  private async sendMessageOnce<T>(message: ChromeMessage): Promise<T> {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      throw new Error(EXTENSION_CONTEXT_INVALIDATED_MESSAGE);
    }

    return await new Promise<T>((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'));
          return;
        }

        resolve(response as T);
      });
    });
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
        } catch (error) {
          logger.debug('Skipping iframe content due to access error', error);
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
      return srcOrigin === globalThis.location.origin;
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
const windowExt = globalThis as unknown as WindowWithPSPDetector;

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
  } catch (error) {
    logger.debug('Background state check failed', error);

    // Background script not responding or extension context invalid
    return false;
  }
};

const registerContentScriptCleanup = (
  contentScript: ContentScript,
  url: string,
): void => {
  globalThis.addEventListener('beforeunload', (): void => {
    contentScript.cleanup();
    if (windowExt.pspDetectorContentScript?.url === url) {
      windowExt.pspDetectorContentScript = undefined;
    }
  });
};

const startContentScript = async(options: {
  resetState: boolean;
  resetForNewPage: boolean;
  logMessage?: string;
}): Promise<void> => {
  if (options.logMessage) {
    logger.debug(options.logMessage);
  }

  if (options.resetState) {
    windowExt.pspDetectorContentScript = undefined;
  }

  const contentScript = new ContentScript();

  if (options.resetForNewPage) {
    contentScript.resetForNewPage();
  }

  windowExt.pspDetectorContentScript = {
    initialized: true,
    url: currentUrl,
  };

  registerContentScriptCleanup(contentScript, currentUrl);

  try {
    await contentScript.initialize();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      logger.warn('Extension context invalidated during startup');
    } else {
      logger.error('Content script initialization failed:', error);
    }
  }
};

// Allow re-initialization if URL has changed (new page navigation)
// OR if background script has lost state (extension context restored)
const bootstrap = async(): Promise<void> => {
  if (existingScript?.initialized && existingScript.url === currentUrl) {
    try {
      const hasBackgroundState = await checkBackgroundState();
      if (hasBackgroundState) {
        logger.debug('Content script already initialized for this page, skipping');
        return;
      }

      await startContentScript({
        resetState: true,
        resetForNewPage: true,
        logMessage: 'Background script lost state, forcing re-initialization',
      });

      return;
    } catch {
      await startContentScript({
        resetState: true,
        resetForNewPage: true,
        logMessage: 'Failed to check background state, assuming re-initialization needed',
      });

      return;
    }
  }

  const logMessage = existingScript?.initialized
    ? `Content script URL changed from ${existingScript.url} to ` +
      `${currentUrl}, re-initializing`
    : `Content script initializing for new page: ${currentUrl}`;

  await startContentScript({
    resetState: false,
    resetForNewPage: !!existingScript?.initialized,
    logMessage,
  });
};

bootstrap().catch((error) => { // NOSONAR
  if (isExtensionContextInvalidated(error)) {
    logger.warn('Extension context invalidated during bootstrap');
  } else {
    logger.error('Content script bootstrap failed:', error);
  }
});
