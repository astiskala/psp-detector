/**
 * Content script for PSP Detector Chrome Extension.
 * Handles DOM observation, PSP detection, and communication with background script.
 * @module content
 */
import { PSPDetectorService } from './services/psp-detector';
import { DOMObserverService } from './services/dom-observer';
import { MessageAction, ChromeMessage } from './types';
import { logger } from './lib/utils';

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
        try {
            await this.initializeExemptDomains();
            await this.initializePSPConfig();
            this.setupDOMObserver();
            this.detectPSP();
        } catch (error) {
            logger.error('Failed to initialize content script:', error);
        }
    }

    /**
     * Initialize exempt domains configuration
     * @private
     * @return {Promise<void>}
     */
    private async initializeExemptDomains(): Promise<void> {
        try {
            const response = await this.sendMessage<{ regex: string }>({
                action: MessageAction.GET_EXEMPT_DOMAINS_REGEX
            });
            if (response?.regex) {
                this.pspDetector.setExemptDomainsPattern(response.regex);
            }
        } catch (error) {
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
            const response = await this.sendMessage<{ config: any }>({
                action: MessageAction.GET_PSP_CONFIG
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
            document.documentElement.outerHTML
        );
        if (detectedPsp) {
            try {
                const tabResponse = await this.sendMessage<{ tabId: number }>({
                    action: MessageAction.GET_TAB_ID
                });
                if (tabResponse?.tabId) {
                    await this.sendMessage({
                        action: MessageAction.DETECT_PSP,
                        data: { psp: detectedPsp, tabId: tabResponse.tabId }
                    });
                }
                this.pspDetected = true;
                this.domObserver.stopObserving();
            } catch (error) {
                logger.error('Failed to report detected PSP:', error);
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
    private sendMessage<T = any>(message: ChromeMessage): Promise<T> {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, response => {
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

// Initialize content script
const contentScript = new ContentScript();
contentScript.initialize().catch(error => {
    logger.error('Content script initialization failed:', error);
});
