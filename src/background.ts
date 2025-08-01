/**
 * Background service for PSP Detector Chrome Extension.
 * Handles messaging, tab events, icon updates, and content script injection.
 * @module background
 */
import {
  MessageAction,
  PSP,
  ChromeMessage,
  PSPDetectionData,
  PSPConfigResponse,
  PSPConfig,
  PSPResponse,
  TypeConverters,
  PSPDetectionResult,
} from './types';
import { PSP_DETECTION_EXEMPT } from './types';
import { DEFAULT_ICONS } from './types/background';
import { logger } from './lib/utils';

class BackgroundService {
  private config: {
    currentTabId: number | null;
    detectedPsp: PSPDetectionResult | null;
    tabPsps: Map<number, PSPDetectionResult>;
    exemptDomains: string[];
    cachedPspConfig: PSPConfig | null;
  };

  constructor() {
    this.config = {
      currentTabId: null,
      detectedPsp: null,
      tabPsps: new Map(),
      exemptDomains: [],
      cachedPspConfig: null,
    };

    this.initializeListeners();
    this.loadExemptDomains();
  }

  /**
   * Initialize all extension message and tab listeners
   * @private
   * @return {void}
   */
  initializeListeners(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message as ChromeMessage, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    chrome.tabs.onActivated.addListener(async(activeInfo) => {
      await this.handleTabActivation(activeInfo);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });
  }

  /**
   * Load exempt domains configuration from extension resource
   * @private
   * @return {Promise<void>}
   */
  async loadExemptDomains(): Promise<void> {
    try {
      const response = await fetch(
        chrome.runtime.getURL('exempt-domains.json'),
      );
      const data = (await response.json()) as { exemptDomains?: string[] };
      this.config.exemptDomains = Array.isArray(data.exemptDomains)
        ? data.exemptDomains
        : [];
    } catch (error) {
      logger.error('Failed to load exempt domains:', error);
      this.config.exemptDomains = [];
    }
  }

  /**
   * Check if a URL is exempt from PSP detection
   * @private
   * @param {string} url - URL to check
   * @return {boolean} True if URL is exempt
   */
  private isUrlExempt(url: string): boolean {
    if (!url || this.config.exemptDomains.length === 0) {
      return false;
    }

    return this.config.exemptDomains.some((domain) => url.includes(domain));
  }

  /**
   * Check if a URL is a special URL that doesn't support content scripts
   * @private
   * @param {string} url - URL to check
   * @return {boolean} True if URL is special (chrome://, chrome-extension://, etc.)
   */
  private isSpecialUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    const specialProtocols = [
      'chrome://',
      'chrome-extension://',
      'edge://',
      'about:',
      'moz-extension://',
      'safari-extension://',
      'file://',
    ];

    return specialProtocols.some((protocol) => url.startsWith(protocol));
  }

  /**
   * Handle incoming extension messages
   * @private
   * @param {object} message - Message object
   * @param {chrome.runtime.MessageSender} sender - Sender
   * @param {function} sendResponse - Response callback
   * @return {Promise<void>}
   */
  async handleMessage(
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> {
    try {
      switch (message.action) {
      case MessageAction.GET_PSP_CONFIG:
        await this.handleGetPspConfig(sendResponse);
        break;
      case MessageAction.DETECT_PSP:
        this.handleDetectPsp(message.data as PSPDetectionData, sendResponse);
        break;
      case MessageAction.GET_PSP:
        this.handleGetPsp(sendResponse);
        break;
      case MessageAction.GET_TAB_ID:
        if (sender.tab?.id) {
          sendResponse({ tabId: sender.tab.id });
        }

        break;
      case MessageAction.GET_EXEMPT_DOMAINS:
        sendResponse({ exemptDomains: this.config.exemptDomains });
        break;
      default:
        logger.warn('Unknown message action:', message.action);
        sendResponse(null);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      sendResponse(null);
    }
  }

  /**
   * Handle PSP configuration request
   * @private
   * @param {function} sendResponse - Response callback
   * @return {Promise<void>}
   */
  async handleGetPspConfig(
    sendResponse: (response?: PSPConfigResponse | null) => void,
  ): Promise<void> {
    if (this.config.cachedPspConfig) {
      sendResponse({ config: this.config.cachedPspConfig });
      return;
    }

    try {
      const response: Response = await fetch(
        chrome.runtime.getURL('psps.json'),
      );
      this.config.cachedPspConfig = (await response.json()) as PSPConfig;
      sendResponse({ config: this.config.cachedPspConfig });
    } catch (error) {
      logger.error('Failed to load PSP config:', error);
      sendResponse(null);
    }
  }

  /**
   * Handle PSP detection
   * @private
   * @param {object} data - Detection data
   * @param {function} sendResponse - Response callback
   * @return {void}
   */
  handleDetectPsp(
    data: PSPDetectionData,
    sendResponse: (response?: null) => void,
  ): void {
    if (data?.psp && this.config.currentTabId !== null) {
      const pspName = data.psp;
      const tabId = data.tabId;
      const detectionInfo = data.detectionInfo;
      const url = data.url;

      if (pspName && tabId) {
        // Create a detection result object
        let detectionResult: PSPDetectionResult;

        if (String(data.psp) === PSP_DETECTION_EXEMPT) {
          // Create exempt result for exempt domains
          detectionResult = PSPDetectionResult.exempt(
            'Domain is exempt from PSP detection',
            (url || 'unknown') as import('./types/branded').URL,
          );
        } else {
          // Create detected result for actual PSPs
          detectionResult = PSPDetectionResult.detected(
            pspName,
            detectionInfo,
          );
        }

        this.config.detectedPsp = detectionResult;
        if (tabId === this.config.currentTabId) {
          this.config.tabPsps.set(this.config.currentTabId, detectionResult);

          // Handle different PSP detection states
          if (String(data.psp) === PSP_DETECTION_EXEMPT) {
            this.showExemptDomainIcon();
          } else {
            this.updateIcon(String(data.psp));
          }
        }
      }
    } else {
      this.resetIcon();
    }

    sendResponse(null);
  }

  /**
   * Handle get PSP request
   * @private
   * @param {function} sendResponse - Response callback
   * @return {void}
   */
  handleGetPsp(sendResponse: (response?: PSPResponse) => void): void {
    const pspResult = this.config.currentTabId
      ? this.config.detectedPsp ||
        this.config.tabPsps.get(this.config.currentTabId) ||
        null
      : null;

    sendResponse({ psp: pspResult });
  }

  /**
   * Handle tab activation
   * @private
   * @param {{ tabId: number }} activeInfo - Tab activation info
   * @return {Promise<void>}
   */
  async handleTabActivation(activeInfo: { tabId: number }): Promise<void> {
    const tabId = TypeConverters.toTabId(activeInfo.tabId);
    if (tabId) {
      this.config.currentTabId = tabId;
      this.config.detectedPsp = this.config.tabPsps.get(tabId) || null;
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (this.config.detectedPsp) {

          // Handle different PSP detection states
          if (this.config.detectedPsp.type === 'exempt') {
            this.showExemptDomainIcon();
          } else if (this.config.detectedPsp.type === 'detected') {
            this.updateIcon(this.config.detectedPsp.psp);
          }
        } else {
          this.resetIcon();
          if (tab?.url) {
            if (this.isUrlExempt(tab.url) || this.isSpecialUrl(tab.url)) {
              // Create exempt result for exempt domains or special URLs
              const exemptResult = PSPDetectionResult.exempt(
                'PSP detection is disabled for this domain',
                (tab.url || 'unknown') as import('./types/branded').URL,
              );
              this.config.detectedPsp = exemptResult;
              this.config.tabPsps.set(tabId, exemptResult);
              this.showExemptDomainIcon();
            } else {
              await this.injectContentScript(activeInfo.tabId);
            }
          }
        }
      } catch (error) {
        logger.warn('Tab access error:', error);
        this.resetIcon();
      }
    }
  }

  /**
   * Handle tab updates
   * @private
   * @param {number} tabId - Tab ID
   * @param {{ status?: string }} changeInfo - Change info
   * @param {chrome.tabs.Tab} tab - Tab object
   * @return {void}
   */
  handleTabUpdate(
    tabId: number,
    changeInfo: { status?: string },
    tab: chrome.tabs.Tab,
  ): void {
    const brandedTabId = TypeConverters.toTabId(tabId);
    if (brandedTabId && changeInfo.status === 'loading') {
      this.resetIcon();
      this.config.tabPsps.delete(brandedTabId);

      // Clear cached PSP result when page starts loading
      if (brandedTabId === this.config.currentTabId) {
        this.config.detectedPsp = null;
      }
    }

    if (changeInfo.status === 'complete' && tab.url) {
      if (this.isUrlExempt(tab.url) || this.isSpecialUrl(tab.url)) {
        // Create exempt result for exempt domains or special URLs
        const exemptResult = PSPDetectionResult.exempt(
          'PSP detection is disabled for this domain',
          (tab.url || 'unknown') as import('./types/branded').URL,
        );
        if (brandedTabId && brandedTabId === this.config.currentTabId) {
          this.config.detectedPsp = exemptResult;
          this.config.tabPsps.set(brandedTabId, exemptResult);
          this.showExemptDomainIcon();
        }
      } else {
        // For regular websites, inject content script for detection
        this.injectContentScript(tabId);
      }
    }
  }

  /**
   * Update extension icon
   * @private
   * @param {string} psp - PSP name
   * @return {void}
   */
  updateIcon(psp: string): void {
    const pspInfo = this.getPspInfo(psp);
    if (pspInfo) {
      chrome.action.setIcon({
        path: {
          48: `images/${pspInfo.image}_48.png`,
          128: `images/${pspInfo.image}_128.png`,
        },
      });
    }

    // Clear any badge when showing PSP icon
    chrome.action.setBadgeText({ text: '' });
  }

  /**
   * Show exempt domain icon with warning badge
   * @private
   * @return {void}
   */
  showExemptDomainIcon(): void {
    // Set default icon
    chrome.action.setIcon({
      path: DEFAULT_ICONS,
    });

    // Add warning badge
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#d3d3d3' });
    logger.debug('Showing exempt domain icon with warning badge');
  }

  /**
   * Reset extension icon to default
   * @private
   * @return {void}
   */
  resetIcon(): void {
    chrome.action.setIcon({
      path: DEFAULT_ICONS,
    });

    // Clear any badge
    chrome.action.setBadgeText({ text: '' });
  }

  /**
   * Get PSP information from config
   * @private
   * @param {string} psp - PSP name
   * @return {PSP|null} PSP info or null
   */
  getPspInfo(psp: string): PSP | null {
    if (!this.config.cachedPspConfig?.psps) return null;
    return (
      this.config.cachedPspConfig.psps.find(
        (p: { name: string }) => p.name === psp,
      ) || null
    );
  }

  /**
   * Inject content script into tab
   * @private
   * @param {number} tabId - Tab ID
   * @return {Promise<void>}
   */
  async injectContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch (error) {
      logger.error(`Failed to inject content script into tab ${tabId}:`, error);
    }
  }
}

// Initialize background service
new BackgroundService();
