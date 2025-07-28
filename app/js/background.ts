import { MessageAction } from './types';
import { logger } from './lib/utils';
import type { BackgroundConfig } from './types/background';

class BackgroundService {
    private readonly config: BackgroundConfig = {
        cachedPspConfig: null,
        exemptDomainsRegex: null,
        tabPsps: new Map<number, string>(),
        detectedPsp: null,
        currentTabId: null
    };

    private readonly defaultIcons = {
        16: 'images/default_16.png',
        48: 'images/default_48.png',
        128: 'images/default_128.png'
    } as const;

    constructor() {
        this.initializeListeners();
        this.loadExemptDomains();
    }

    /**
     * Initialize all extension message and tab listeners
     */
    private initializeListeners(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            this.handleTabActivation(activeInfo);
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });
    }

    /**
     * Load exempt domains configuration
     */
    private async loadExemptDomains(): Promise<void> {
        try {
            const response = await fetch(chrome.runtime.getURL('exempt-domains.json'));
            const data = await response.json();
            const domainPattern = data.exemptDomains.join('|');
            this.config.exemptDomainsRegex = new RegExp(`^https://(?!.*(${domainPattern}))`);
        } catch (error) {
            logger.error('Failed to load exempt domains:', error);
        }
    }

    /**
     * Handle incoming extension messages
     */
    private async handleMessage(
        message: { action: MessageAction; data?: any },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void
    ): Promise<void> {
        switch (message.action) {
            case MessageAction.GET_PSP_CONFIG:
                this.handleGetPspConfig(sendResponse);
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
    }

    /**
     * Handle PSP configuration request
     */
    private async handleGetPspConfig(sendResponse: (response: any) => void): Promise<void> {
        if (this.config.cachedPspConfig) {
            sendResponse({ config: this.config.cachedPspConfig });
            return;
        }

        try {
            const response = await fetch(chrome.runtime.getURL('psp-config.json'));
            this.config.cachedPspConfig = await response.json();
            sendResponse({ config: this.config.cachedPspConfig });
        } catch (error) {
            logger.error('Failed to load PSP config:', error);
            sendResponse(null);
        }
    }

    /**
     * Handle PSP detection
     */
    private handleDetectPsp(data: any, sendResponse: (response: any) => void): void {
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
     */
    private handleGetPsp(sendResponse: (response: any) => void): void {
        const psp = this.config.currentTabId ?
            (this.config.detectedPsp || this.config.tabPsps.get(this.config.currentTabId)) :
            null;
        sendResponse({ psp });
    }

    /**
     * Handle tab activation
     */
    private async handleTabActivation(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
        this.config.currentTabId = activeInfo.tabId;
        this.config.detectedPsp = this.config.tabPsps.get(activeInfo.tabId) || null;

        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (this.config.detectedPsp) {
                this.updateIcon(this.config.detectedPsp);
            } else {
                this.resetIcon();
                if (tab?.url && this.config.exemptDomainsRegex?.test(tab.url)) {
                    this.injectContentScript(activeInfo.tabId);
                }
            }
        } catch (error) {
            logger.warn('Tab access error:', error);
            this.resetIcon();
        }
    }

    /**
     * Handle tab updates
     */
    private handleTabUpdate(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void {
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
     */
    private updateIcon(psp: string): void {
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
     */
    private resetIcon(): void {
        chrome.action.setIcon({
            path: this.defaultIcons
        });
    }

    /**
     * Get PSP information from config
     */
    private getPspInfo(psp: string): any {
        if (!this.config.cachedPspConfig?.psps) return null;
        return this.config.cachedPspConfig.psps.find(p => p.name === psp);
    }

    /**
     * Inject content script into tab
     */
    private async injectContentScript(tabId: number): Promise<void> {
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
