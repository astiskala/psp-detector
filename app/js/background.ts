/**
 * Background service for PSP Detector Chrome Extension.
 * Handles messaging, tab events, icon updates, and content script injection.
 * @module background
 */
import { MessageAction } from './types';
import { logger } from './lib/utils';
import type { BackgroundConfig } from './types/background';

class BackgroundService {
    /**
     * Extension state/configuration
     * @type {BackgroundConfig}
     */
    config: {
        cachedPspConfig: any;
        exemptDomainsRegex: RegExp | null;
        tabPsps: Map<any, any>;
        detectedPsp: any;
        currentTabId: number | null;
    } = {
            cachedPspConfig: null,
            exemptDomainsRegex: null,
            tabPsps: new Map(),
            detectedPsp: null,
            currentTabId: null
        };

    /**
     * Default icon paths
     */
    defaultIcons = {
        16: 'images/default_16.png',
        48: 'images/default_48.png',
        128: 'images/default_128.png'
    };

    constructor() {
        this.initializeListeners();
        this.loadExemptDomains();
    }

    /**
     * Initialize all extension message and tab listeners
     * @private
     * @return {void}
     */
    initializeListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        chrome.tabs.onActivated.addListener(async (activeInfo) => {
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
    async loadExemptDomains() {
        try {
            const response = await fetch(chrome.runtime.getURL('exempt-domains.json'));
            const data = await response.json();
            const domainPattern = Array.isArray(data.exemptDomains) ? data.exemptDomains.join('|') : '';
            this.config.exemptDomainsRegex = new RegExp(`^https://(?!.*(${domainPattern}))`);
        } catch (error) {
            logger.error('Failed to load exempt domains:', error);
            this.config.exemptDomainsRegex = null;
        }
    }

    /**
     * Handle incoming extension messages
     * @private
     * @param {object} message - Message object
     * @param {chrome.runtime.MessageSender} sender - Sender
     * @param {function} sendResponse - Response callback
     * @return {Promise<void>}
     */
    async handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
        try {
            switch (message.action) {
                case MessageAction.GET_PSP_CONFIG:
                    await this.handleGetPspConfig(sendResponse);
                    break;
                case MessageAction.DETECT_PSP:
                    this.handleDetectPsp(message.data, sendResponse);
                    break;
                case MessageAction.GET_PSP:
                    this.handleGetPsp(sendResponse);
                    break;
                case MessageAction.GET_TAB_ID:
                    if (sender.tab?.id) {
                        sendResponse({ tabId: sender.tab.id });
                    }
                    break;
                case MessageAction.GET_EXEMPT_DOMAINS_REGEX:
                    sendResponse({ regex: this.config.exemptDomainsRegex?.source });
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
    async handleGetPspConfig(sendResponse: (response?: { config: any } | null) => void): Promise<void> {
        if (this.config.cachedPspConfig) {
            sendResponse({ config: this.config.cachedPspConfig });
            return;
        }
        try {
            const response: Response = await fetch(chrome.runtime.getURL('psp-config.json'));
            this.config.cachedPspConfig = await response.json();
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
    handleDetectPsp(data: { psp?: string; tabId?: number }, sendResponse: (response?: any) => void) {
        if (data?.psp && this.config.currentTabId !== null) {
            this.config.detectedPsp = data.psp;
            if (data.tabId === this.config.currentTabId) {
                this.config.tabPsps.set(this.config.currentTabId, data.psp);
                this.updateIcon(data.psp);
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
    handleGetPsp(sendResponse: (response?: any) => void) {
        const psp = this.config.currentTabId ?
            (this.config.detectedPsp || this.config.tabPsps.get(this.config.currentTabId)) :
            null;
        sendResponse({ psp });
    }

    /**
     * Handle tab activation
     * @private
     * @param {chrome.tabs.TabActiveInfo} activeInfo - Tab activation info
     * @return {Promise<void>}
     */
    async handleTabActivation(activeInfo: chrome.tabs.TabActiveInfo) {
        this.config.currentTabId = activeInfo.tabId;
        this.config.detectedPsp = this.config.tabPsps.get(activeInfo.tabId) || null;
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (this.config.detectedPsp) {
                this.updateIcon(this.config.detectedPsp);
            } else {
                this.resetIcon();
                if (tab?.url && this.config.exemptDomainsRegex?.test(tab.url)) {
                    await this.injectContentScript(activeInfo.tabId);
                }
            }
        } catch (error) {
            logger.warn('Tab access error:', error);
            this.resetIcon();
        }
    }

    /**
     * Handle tab updates
     * @private
     * @param {number} tabId - Tab ID
     * @param {chrome.tabs.TabChangeInfo} changeInfo - Change info
     * @param {chrome.tabs.Tab} tab - Tab object
     * @return {void}
     */
    handleTabUpdate(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
        if (changeInfo.status === 'loading') {
            this.resetIcon();
            this.config.tabPsps.delete(tabId);
        }
        if (changeInfo.status === 'complete' && tab.url && this.config.exemptDomainsRegex?.test(tab.url)) {
            this.injectContentScript(tabId);
        }
    }

    /**
     * Update extension icon
     * @private
     * @param {string} psp - PSP name
     * @return {void}
     */
    updateIcon(psp: string) {
        const pspInfo = this.getPspInfo(psp);
        if (pspInfo) {
            chrome.action.setIcon({
                path: {
                    16: `images/${pspInfo.image}_16.png`,
                    48: `images/${pspInfo.image}_48.png`,
                    128: `images/${pspInfo.image}_128.png`
                }
            });
        }
    }

    /**
     * Reset extension icon to default
     * @private
     * @return {void}
     */
    resetIcon() {
        chrome.action.setIcon({
            path: this.defaultIcons
        });
    }

    /**
     * Get PSP information from config
     * @private
     * @param {string} psp - PSP name
     * @return {object|null} PSP info or null
     */
    getPspInfo(psp: string) {
        if (!this.config.cachedPspConfig?.psps) return null;
        return this.config.cachedPspConfig.psps.find((p: { name: string; }) => p.name === psp) || null;
    }

    /**
     * Inject content script into tab
     * @private
     * @param {number} tabId - Tab ID
     * @return {Promise<void>}
     */
    async injectContentScript(tabId: number) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
        } catch (error) {
            logger.error(`Failed to inject content script into tab ${tabId}:`, error);
        }
    }
}

// Initialize background service
new BackgroundService();
