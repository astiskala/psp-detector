/**
 * Background service for PSP Detector Chrome Extension.
 * Handles messaging, tab events, icon updates, and content script injection.
 * Manifest V3 service worker implementation with proper lifecycle management.
 * @module background
 */
import {
  MessageAction,
  TypeConverters,
  PSPDetectionResult,
  PSP_DETECTION_EXEMPT,
  type PSP,
  type ChromeMessage,
  type PSPDetectionData,
  type PSPConfigResponse,
  type PSPConfig,
  type PSPResponse,
  type StoredTabPsp,
} from './types';
import { DEFAULT_ICONS } from './types/background';
import type { URL as BrandedURL } from './types/branded';
import { logger, getAllProviders } from './lib/utils';
import { STORAGE_KEYS } from './lib/storage-keys';
import { writeHistoryEntry } from './lib/history';
import type { HistoryEntry, ProviderType } from './types/history';

const BADGE_COLOR = '#6B7280';
const EXEMPT_DOMAIN_REASON = 'Domain is exempt from PSP detection';
const EXEMPT_DISABLED_REASON = 'PSP detection is disabled for this domain';

class BackgroundService {
  private isInitialized = false;
  private inMemoryPspConfig: PSPConfig | null = null;
  private inMemoryExemptDomains: string[] | null = null;

  public async initialize(): Promise<void> {
    await this.initializeServiceWorker();
  }

  /**
   * Initialize service worker with proper MV3 lifecycle management
   * @private
   */
  private async initializeServiceWorker(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.setupEventListeners();
      await this.restoreState();
      await this.loadExemptDomains();
      await this.preloadPspConfig();
      await this.setupOptionalNetworkScanning();
      this.isInitialized = true;
      logger.info('Service worker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize service worker:', error);
    }
  }

  /**
   * Set up all service worker event listeners
   * @private
   */
  private async setupEventListeners(): Promise<void> {
    // Handle extension startup
    chrome.runtime.onStartup.addListener(() => {
      logger.info('Extension startup detected');
      this.initializeServiceWorker().catch((error) => {
        logger.error('Failed to initialize service worker on startup:', error);
      });
    });

    // Handle extension installation/update
    chrome.runtime.onInstalled.addListener((details) => {
      logger.info('Extension installed/updated:', details.reason);
      if (details.reason === 'install') {
        this.handleFirstInstall();
      } else if (details.reason === 'update') {
        this.handleUpdate(details.previousVersion);
      }
    });

    // Handle service worker suspension/revival
    chrome.runtime.onSuspend.addListener(() => {
      logger.info('Service worker suspending');
      this.persistState();
    });

    // Message handling
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message as ChromeMessage, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Tab event listeners
    chrome.tabs.onActivated.addListener(async(activeInfo) => {
      await this.handleTabActivation(activeInfo);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Tab removal cleanup
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.cleanupTabData(tabId);
    });
  }

  /**
   * Handle first-time installation
   * @private
   */
  private async handleFirstInstall(): Promise<void> {
    logger.info('Performing first-time setup');

    // Initialize default storage values
    await chrome.storage.local.set({
      [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
    });

    await chrome.storage.session.set({ [STORAGE_KEYS.TAB_PSPS]: {} });

    await this.clearCachedConfig();
    await this.loadExemptDomains();
  }

  /**
   * Handle extension update
   * @private
   */
  private async handleUpdate(previousVersion?: string): Promise<void> {
    logger.info(`Updated from version ${previousVersion}`);

    // Perform any necessary migration logic here
    await this.migrateStorageIfNeeded();
    await this.clearCachedConfig();
    await this.loadExemptDomains();
  }

  /**
   * Migrate storage format if needed for version compatibility
   * @private
   */
  private async migrateStorageIfNeeded(): Promise<void> {
    // Future migration logic can be added here
    logger.info('Storage migration check completed');
  }

  private async clearCachedConfig(): Promise<void> {
    try {
      await chrome.storage.local.remove([
        STORAGE_KEYS.CACHED_PSP_CONFIG,
        STORAGE_KEYS.POPUP_PSP_CONFIG_CACHE,
      ]);

      this.inMemoryPspConfig = null;
    } catch (error) {
      logger.warn('Failed to clear cached PSP config:', error);
    }
  }

  /**
   * Restore service worker state from chrome.storage
   * @private
   */
  private async restoreState(): Promise<void> {
    try {
      // Get state from storage but we don't need to use it immediately
      await chrome.storage.local.get([
        STORAGE_KEYS.DETECTED_PSP,
        STORAGE_KEYS.CURRENT_TAB_ID,
        STORAGE_KEYS.CACHED_PSP_CONFIG,
      ]);

      await chrome.storage.session.get([STORAGE_KEYS.TAB_PSPS]);

      logger.info('State restored from storage');
    } catch (error) {
      logger.error('Failed to restore state:', error);
    }
  }

  /**
   * Persist current state to chrome.storage
   * @private
   */
  private async persistState(): Promise<void> {
    try {
      const currentTabId = await this.getCurrentTabId();
      const detectedPsp = await this.getDetectedPsp();

      await chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_TAB_ID]: currentTabId,
        [STORAGE_KEYS.DETECTED_PSP]: detectedPsp,
      });

      logger.info('State persisted to storage');
    } catch (error) {
      logger.error('Failed to persist state:', error);
    }
  }

  /**
   * Get current tab ID from storage
   * @private
   */
  private async getCurrentTabId(): Promise<number | null> {
    try {
      const result = await chrome.storage.local.get({
        [STORAGE_KEYS.CURRENT_TAB_ID]: null as number | null,
      });
      return result[STORAGE_KEYS.CURRENT_TAB_ID] as number | null;
    } catch (error) {
      logger.error('Failed to get current tab ID:', error);
      return null;
    }
  }

  /**
   * Set current tab ID in storage
   * @private
   */
  private async setCurrentTabId(tabId: number | null): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_TAB_ID]: tabId,
      });
    } catch (error) {
      logger.error('Failed to set current tab ID:', error);
    }
  }

  /**
   * Get detected PSP from storage
   * @private
   */
  private async getDetectedPsp(): Promise<PSPDetectionResult | null> {
    try {
      const result = await chrome.storage.local.get({
        [STORAGE_KEYS.DETECTED_PSP]: null as PSPDetectionResult | null,
      });
      return result[STORAGE_KEYS.DETECTED_PSP] as PSPDetectionResult | null;
    } catch (error) {
      logger.error('Failed to get detected PSP:', error);
      return null;
    }
  }

  /**
   * Set detected PSP in storage
   * @private
   */
  private async setDetectedPsp(psp: PSPDetectionResult | null): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.DETECTED_PSP]: psp,
      });
    } catch (error) {
      logger.error('Failed to set detected PSP:', error);
    }
  }

  /**
   * Get tab PSPs from storage
   * @private
   */
  private async getTabPsps(): Promise<Record<number, StoredTabPsp[]>> {
    try {
      const result = await chrome.storage.session.get({
        [STORAGE_KEYS.TAB_PSPS]: {} as Record<number, StoredTabPsp[]>,
      });
      const tabPsps = result[STORAGE_KEYS.TAB_PSPS] as Record<
        number,
        StoredTabPsp[]
      >;
      return tabPsps;
    } catch (error) {
      logger.error('Failed to get tab PSPs:', error);
      return {};
    }
  }

  /**
   * Set tab PSP data in storage
   * @private
   */
  private async setTabPsps(
    tabPsps: Record<number, StoredTabPsp[]>,
  ): Promise<void> {
    try {
      await chrome.storage.session.set({ [STORAGE_KEYS.TAB_PSPS]: tabPsps });
    } catch (error) {
      logger.error('Failed to set tab PSPs:', error);
    }
  }

  /**
   * Clean up data for a removed tab
   * @private
   */
  private async cleanupTabData(tabId: number): Promise<void> {
    try {
      const tabPsps = await this.getTabPsps();
      delete tabPsps[tabId];
      await this.setTabPsps(tabPsps);

      logger.debug(`Cleaned up data for tab ${tabId}`);
    } catch (error) {
      logger.error(`Failed to cleanup tab ${tabId}:`, error);
    }
  }

  /**
   * Get exempt domains from storage
   * @private
   */
  private async getExemptDomains(): Promise<string[]> {
    if (this.inMemoryExemptDomains) {
      return this.inMemoryExemptDomains;
    }

    try {
      const result = await chrome.storage.local.get({
        [STORAGE_KEYS.EXEMPT_DOMAINS]: [] as string[],
      });
      const storedDomains = result[STORAGE_KEYS.EXEMPT_DOMAINS] as string[];
      const normalized = this.normalizeExemptDomains(storedDomains);
      this.inMemoryExemptDomains = normalized;
      return normalized;
    } catch (error) {
      logger.error('Failed to get exempt domains:', error);
      return [];
    }
  }

  private normalizeExemptDomains(domains: string[]): string[] {
    const seen = new Set<string>();
    return (domains || [])
      .map((domain) => domain.trim().toLowerCase())
      .filter(
        (domain) => domain.length > 0 && !seen.has(domain) && seen.add(domain),
      );
  }

  /**
   * Load exempt domains configuration from extension resource with validation
   * @private
   */
  async loadExemptDomains(): Promise<void> {
    try {
      const response = await fetch(
        chrome.runtime.getURL('exempt-domains.json'),
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch exempt domains: ${response.status}`);
      }

      const data = (await response.json()) as { exemptDomains?: unknown };

      // Validate the structure and content
      if (data && Array.isArray(data.exemptDomains)) {
        const validDomains = this.normalizeExemptDomains(
          data.exemptDomains.filter(
            (domain): domain is string =>
              typeof domain === 'string' && domain.length > 0,
          ),
        );
        await chrome.storage.local.set({
          [STORAGE_KEYS.EXEMPT_DOMAINS]: validDomains,
        });

        this.inMemoryExemptDomains = validDomains;
      } else {
        logger.warn('Invalid exempt domains structure, using empty array');
        await chrome.storage.local.set({
          [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
        });

        this.inMemoryExemptDomains = [];
      }
    } catch (error) {
      logger.error('Failed to load exempt domains:', error);
      await chrome.storage.local.set({
        [STORAGE_KEYS.EXEMPT_DOMAINS]: [],
      });

      this.inMemoryExemptDomains = [];
    }
  }

  /**
   * Preload PSP configuration into memory for faster access
   * @private
   */
  private async preloadPspConfig(): Promise<void> {
    try {
      // Load cached config into memory for sync access
      await this.getCachedPspConfig();
      logger.debug('PSP config preloaded into memory');
    } catch (error) {
      logger.error('Failed to preload PSP config:', error);
    }
  }

  /**
   * Check if a URL is exempt from PSP detection
   * @private
   */
  private async isUrlExempt(url: string): Promise<boolean> {
    if (!url) {
      return false;
    }

    const exemptDomains = await this.getExemptDomains();
    if (exemptDomains.length === 0) {
      return false;
    }

    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return exemptDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if a URL is a special URL that doesn't support content scripts
   * @private
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
   * Create a standardized exempt PSP detection result
   * @private
   */
  private createExemptResult(
    reason: string,
    url?: string,
  ): PSPDetectionResult {
    return PSPDetectionResult.exempt(
      reason,
      (url || 'unknown') as BrandedURL,
    );
  }

  /**
   * Persist exempt PSP detection state for a tab
   * @private
   */
  private async setExemptTabState(
    tabId: number,
    url: string,
    reason: string,
  ): Promise<void> {
    const exemptResult = this.createExemptResult(reason, url);
    await this.setDetectedPsp(exemptResult);
    const tabPsps = await this.getTabPsps();
    tabPsps[tabId] = [{ psp: PSP_DETECTION_EXEMPT }];
    await this.setTabPsps(tabPsps);
    this.showExemptDomainIcon();
  }

  /**
   * Handle incoming extension messages with enhanced type safety
   * @private
   */
  async handleMessage(
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> {
    // Validate message structure
    if (!message || typeof message.action !== 'string') {
      logger.error('Invalid message format received:', message);
      sendResponse({ error: 'Invalid message format' });
      return;
    }

    try {
      switch (message.action) {
      case MessageAction.GET_PSP_CONFIG:
        await this.handleGetPspConfig(sendResponse);
        break;

      case MessageAction.DETECT_PSP:
        if (!this.isValidPspDetectionData(message.data)) {
          logger.error('Invalid PSP detection data:', message.data);
          sendResponse({ error: 'Invalid PSP detection data' });
          break;
        }

        {
          const detectionData = message.data;
          await this.handleDetectPsp(detectionData, sender);
          sendResponse(null);
        }

        break;

      case MessageAction.GET_PSP:
        await this.handleGetPsp(sender, sendResponse);
        break;

      case MessageAction.GET_TAB_ID:
        if (sender.tab?.id) {
          sendResponse({ tabId: sender.tab.id });
        } else {
          sendResponse({ error: 'No tab ID available' });
        }

        break;

      case MessageAction.GET_EXEMPT_DOMAINS:
        {
          const exemptDomains = await this.getExemptDomains();
          sendResponse({ exemptDomains });
        }

        break;

      case MessageAction.CHECK_TAB_STATE:
        await this.handleCheckTabState(sender, sendResponse);
        break;

      default:
        logger.warn('Unknown message action:', message.action);
        sendResponse({ error: 'Unknown message action' });
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      sendResponse({ error: 'Internal error processing message' });
    }
  }

  /**
   * Validate PSP detection data structure
   * @private
   */
  private isValidPspDetectionData(data: unknown): data is PSPDetectionData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const pspData = data as Partial<PSPDetectionData>;
    return (
      typeof pspData.psp === 'string' &&
      (pspData.tabId === undefined || typeof pspData.tabId === 'number') &&
      (pspData.url === undefined || typeof pspData.url === 'string') &&
      (pspData.detectionInfo === undefined ||
       typeof pspData.detectionInfo === 'object')
    );
  }

  /**
   * Handle PSP configuration request with enhanced error handling and timeout
   * @private
   */
  async handleGetPspConfig(
    sendResponse: (response?: PSPConfigResponse | null) => void,
  ): Promise<void> {
    // Check for cached config first
    const cachedConfig = await this.getCachedPspConfig();
    if (cachedConfig) {
      sendResponse({ config: cachedConfig });
      return;
    }

    try {
      // Add timeout for fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s

      const response: Response = await fetch(
        chrome.runtime.getURL('psps.json'),
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch PSP config: ${response.status} ` +
          `${response.statusText}`,
        );
      }

      let configData: unknown;
      try {
        configData = await response.json();
      } catch (parseError) {
        throw new Error('Failed to parse PSP config JSON', {
          cause: parseError,
        });
      }

      // Enhanced validation of the config structure
      if (!this.isValidPspConfig(configData)) {
        throw new Error('Invalid PSP configuration structure or content');
      }

      const validConfig = configData;

      // Cache the config
      await this.setCachedPspConfig(validConfig);
      sendResponse({ config: validConfig });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('PSP config fetch timed out');
      } else {
        logger.error('Failed to load PSP config:', error);
      }

      sendResponse(null);
    }
  }

  /**
   * Validate PSP configuration structure and content
   * @private
   */
  private isValidPspConfig(data: unknown): data is PSPConfig {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const config = data as Partial<PSPConfig>;

    // Check if psps array exists and is valid
    if (!Array.isArray(config.psps) || config.psps.length === 0) {
      return false;
    }

    // Validate each PSP entry
    const isValidPspArray = (psps: unknown[]): boolean => {
      return psps.every((psp: unknown) => {
        if (!psp || typeof psp !== 'object') {
          return false;
        }

        const pspEntry = psp as Partial<PSP>;
        const hasValidName = typeof pspEntry.name === 'string' &&
          pspEntry.name.trim().length > 0;
        const hasValidImage = typeof pspEntry.image === 'string' &&
          pspEntry.image.trim().length > 0;
        const hasValidUrl = typeof pspEntry.url === 'string' &&
          pspEntry.url.trim().length > 0;
        const hasValidSummary = typeof pspEntry.summary === 'string' &&
          pspEntry.summary.trim().length > 0;

        // Must have either matchStrings or regex
        const hasValidMatchStrings = Array.isArray(pspEntry.matchStrings) &&
          pspEntry.matchStrings.length > 0 &&
          pspEntry.matchStrings.every((str: unknown) =>
            typeof str === 'string' && str.trim().length > 0,
          );
        const hasValidRegex = typeof pspEntry.regex === 'string' &&
          pspEntry.regex.trim().length > 0;

        return hasValidName && hasValidImage && hasValidUrl &&
          hasValidSummary && (hasValidMatchStrings || hasValidRegex);
      });
    };

    // Validate main psps array
    if (!isValidPspArray(config.psps)) {
      return false;
    }

    // Validate orchestrators if present
    if (config.orchestrators) {
      if (typeof config.orchestrators !== 'object' ||
          typeof config.orchestrators.notice !== 'string' ||
          !Array.isArray(config.orchestrators.list)) {
        return false;
      }

      if (!isValidPspArray(config.orchestrators.list)) {
        return false;
      }
    }

    // Validate tsps if present
    if (config.tsps) {
      if (typeof config.tsps !== 'object' ||
          typeof config.tsps.notice !== 'string' ||
          !Array.isArray(config.tsps.list)) {
        return false;
      }

      if (!isValidPspArray(config.tsps.list)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get cached PSP config from storage
   * @private
   */
  private async getCachedPspConfig(): Promise<PSPConfig | null> {
    try {
      const result = await chrome.storage.local.get({
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: null as PSPConfig | null,
      });
      const candidate = result[STORAGE_KEYS.CACHED_PSP_CONFIG];

      if (!candidate || !this.isValidPspConfig(candidate)) {
        return null;
      }

      // Also update in-memory cache
      this.inMemoryPspConfig = candidate;
      return candidate;
    } catch (error) {
      logger.error('Failed to get cached PSP config:', error);
      return null;
    }
  }

  /**
   * Set cached PSP config in storage
   * @private
   */
  private async setCachedPspConfig(config: PSPConfig): Promise<void> {
    try {
      // Store in chrome.storage for persistence
      await chrome.storage.local.set({
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: config,
      });

      // Also store in memory for sync access
      this.inMemoryPspConfig = config;
    } catch (error) {
      logger.error('Failed to cache PSP config:', error);
    }
  }

  /**
   * Get cached PSP config synchronously for icon updates
   * @private
   */
  private getCachedPspConfigSync(): PSPConfig | null {
    // This is a synchronous version for use in sync methods like getPspInfo
    // We'll store the config in memory after initial load for quick access
    return this.inMemoryPspConfig || null;
  }

  /**
   * Handle PSP detection with improved error handling and validation
   * @private
   */
  async handleDetectPsp(
    data: PSPDetectionData,
    sender: chrome.runtime.MessageSender,
  ): Promise<void> {
    logger.debug('Background: Received PSP detection message:', data);

    try {
      const currentTabId = await this.getCurrentTabId();
      logger.debug('Background: Current tab ID:', currentTabId);

      const tabId = data.tabId ?? TypeConverters.toTabId(sender.tab?.id ?? -1);
      if (tabId === null || tabId === undefined || !data?.psp) {
        logger.warn('Background: Invalid PSP detection data received');
        return;
      }

      const pspName = data.psp;

      logger.debug(
        `Background: Processing PSP detection - PSP: ${pspName}, ` +
        `TabID: ${tabId}, CurrentTabID: ${currentTabId}`,
      );

      // Validate tab ID is valid number
      if (!Number.isInteger(tabId) || tabId < 0) {
        logger.warn(`Background: Invalid tab ID: ${tabId}`);
        return;
      }

      if (String(pspName) === PSP_DETECTION_EXEMPT) {
        const url = data.url ?? sender.tab?.url ?? 'unknown';
        await this.setExemptTabState(tabId, url, EXEMPT_DOMAIN_REASON);
        return;
      }

      const stored = await this.getTabPsps();
      const existing: StoredTabPsp[] = stored[tabId] ?? [];
      if (existing.some((p) => p.psp === data.psp)) {
        return;
      }

      const entry: StoredTabPsp = {
        psp: data.psp,
        ...(data.detectionInfo !== undefined && {
          detectionInfo: data.detectionInfo,
        }),
      };
      stored[tabId] = [...existing, entry];
      await this.setTabPsps(stored);

      // Update tab-specific data if this is for the current tab
      if (currentTabId !== null && tabId === currentTabId) {
        await this.setDetectedPsp(
          PSPDetectionResult.detected([
            data.detectionInfo
              ? {
                psp: data.psp,
                detectionInfo: data.detectionInfo,
              }
              : { psp: data.psp },
          ]),
        );

        this.updateIcon(String(pspName));
      } else {
        logger.debug(
          `Background: Detection recorded for tab ${tabId}; ` +
          `active tab is ${currentTabId}`,
        );
      }

      if (data.psp && data.detectionInfo && data.psp !== PSP_DETECTION_EXEMPT) {
        const now = Date.now();
        const historyEntry: HistoryEntry = {
          id: `${tabId}_${now}`,
          domain: this.getDomainFromSender(sender),
          url: sender.tab?.url ?? '',
          timestamp: now,
          psps: [{
            name: data.psp,
            type: this.getProviderType(data.psp),
            method: data.detectionInfo.method,
            value: data.detectionInfo.value,
            sourceType: data.detectionInfo.sourceType ?? 'pageUrl',
          }],
        };
        await writeHistoryEntry(historyEntry);
      }
    } catch (error) {
      logger.error('Background: Error processing PSP detection:', error);
      this.resetIcon();
    }
  }

  /**
   * Handle get PSP request
   * @private
   */
  async handleGetPsp(
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: PSPResponse) => void,
  ): Promise<void> {
    const tabPsps = await this.getTabPsps();
    const senderTabId = sender.tab?.id
      ? TypeConverters.toTabId(sender.tab.id)
      : null;
    const activeTabId = await this.getActiveTabIdForPopup();
    const currentTabId = await this.getCurrentTabId();

    const preferredTabIds = [
      senderTabId,
      activeTabId,
      currentTabId,
    ].filter((id): id is number => id !== null);

    let resolvedTabId: number | null = null;
    let psps: StoredTabPsp[] = [];
    for (const tabId of preferredTabIds) {
      const entries = tabPsps[tabId] ?? [];
      if (entries.length > 0) {
        resolvedTabId = tabId;
        psps = entries;
        break;
      }
    }

    if (resolvedTabId === null) {
      if (senderTabId !== null) {
        resolvedTabId = senderTabId;
      } else if (activeTabId !== null) {
        resolvedTabId = activeTabId;
      }
    }

    if (resolvedTabId !== null) {
      if (psps.length === 0) {
        psps = tabPsps[resolvedTabId] ?? [];
      }

      await this.setCurrentTabId(resolvedTabId);
    }

    sendResponse({ psps });
  }

  /**
   * Handle check tab state request - used to determine if background has
   * state for current tab
   * @private
   */
  async handleCheckTabState(
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: { hasState: boolean }) => void,
  ): Promise<void> {
    const tabId = sender.tab?.id ? TypeConverters.toTabId(sender.tab.id) : null;
    if (tabId === null) {
      sendResponse({ hasState: false });
      return;
    }

    const currentTabId = await this.getCurrentTabId();
    const tabPsps = await this.getTabPsps();

    const hasState = tabPsps[tabId] !== undefined || currentTabId === tabId;

    sendResponse({ hasState });
  }

  /**
   * Handle tab activation
   * @private
   */
  async handleTabActivation(activeInfo: { tabId: number }): Promise<void> {
    const tabId = TypeConverters.toTabId(activeInfo.tabId);
    if (tabId === null) return;

    logger.debug(`Background: Tab activated - ID: ${tabId}`);
    await this.setCurrentTabId(tabId);

    const tabPsps = await this.getTabPsps();
    const detectedPsp = this.toDetectionResult(tabPsps[tabId] ?? []);
    await this.setDetectedPsp(detectedPsp);

    logger.debug(
      `Background: Retrieved PSP for tab ${tabId}:`,
      detectedPsp,
    );

    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await this.handleActivatedTab(tabId, activeInfo.tabId, tab, detectedPsp);
    } catch (error) {
      logger.warn('Tab access error:', error);
      this.resetIcon();
    }
  }

  private async handleActivatedTab(
    tabId: NonNullable<ReturnType<typeof TypeConverters.toTabId>>,
    rawTabId: number,
    tab: chrome.tabs.Tab,
    detectedPsp: PSPDetectionResult | null,
  ): Promise<void> {
    if (detectedPsp) {
      if (detectedPsp.type === 'exempt') {
        this.showExemptDomainIcon();
        return;
      }

      if (detectedPsp.type === 'detected') {
        this.updateIcon(detectedPsp.psps[0]?.psp ?? '');
        return;
      }

      return;
    }

    this.resetIcon();
    if (!tab?.url) return;

    const isExempt = await this.isUrlExempt(tab.url);
    if (isExempt || this.isSpecialUrl(tab.url)) {
      await this.setExemptTabState(
        tabId,
        tab.url,
        EXEMPT_DISABLED_REASON,
      );

      return;
    }

    await this.injectContentScript(rawTabId);
  }

  private toDetectionResult(psps: StoredTabPsp[]): PSPDetectionResult | null {
    if (psps.length === 0) return null;
    if (psps.some((p) => p.psp === PSP_DETECTION_EXEMPT)) {
      return this.createExemptResult(EXEMPT_DISABLED_REASON);
    }

    return PSPDetectionResult.detected(
      psps.map((p) => {
        const psp = TypeConverters.toPSPName(p.psp)!;
        if (p.detectionInfo) {
          return { psp, detectionInfo: p.detectionInfo };
        }

        return { psp };
      }),
    );
  }

  private getDomainFromSender(sender: chrome.runtime.MessageSender): string {
    try {
      return new URL(sender.tab?.url ?? '').hostname;
    } catch {
      return sender.tab?.url ?? 'unknown';
    }
  }

  private async getActiveTabIdForPopup(): Promise<number | null> {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const activeTabId = tabs[0]?.id;
      return TypeConverters.toTabId(activeTabId ?? -1);
    } catch (error) {
      logger.warn('Failed to query active tab for popup response:', error);
      return this.getCurrentTabId();
    }
  }

  private getProviderType(pspName: string): ProviderType {
    const config = this.getCachedPspConfigSync();
    if (!config) {
      return 'PSP';
    }

    const normalizedName = pspName.toLowerCase();
    const isOrchestrator = config.orchestrators?.list.some(
      (provider) => provider.name.toLowerCase() === normalizedName,
    );
    if (isOrchestrator) {
      return 'Orchestrator';
    }

    const isTsp = config.tsps?.list.some(
      (provider) => provider.name.toLowerCase() === normalizedName,
    );
    if (isTsp) {
      return 'TSP';
    }

    return 'PSP';
  }

  private async setupOptionalNetworkScanning(): Promise<void> {
    const perms = await chrome.permissions.getAll();
    if (perms.permissions?.includes('webRequest')) {
      this.setupWebRequestListener();
    }

    chrome.permissions.onAdded?.addListener((permissions) => {
      if (permissions.permissions?.includes('webRequest')) {
        this.setupWebRequestListener();
      }
    });
  }

  private setupWebRequestListener(): void {
    if (!chrome.webRequest?.onBeforeRequest) return;

    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        this.handleNetworkRequest(
          details as chrome.webRequest.WebRequestDetails,
        ).catch((err) => {
          logger.warn('webRequest handler error:', err);
        });

        return undefined;
      },
      { urls: ['https://*/*'] },
    );

    logger.info('webRequest listener registered');
  }

  private async handleNetworkRequest(
    details: chrome.webRequest.WebRequestDetails,
  ): Promise<void> {
    const { tabId, url } = details;
    if (tabId < 0) return;

    const config = this.inMemoryPspConfig;
    if (!config) return;

    const allProviders = getAllProviders(config);
    for (const psp of allProviders) {
      if (!psp.matchStrings?.length) continue;
      for (const matchString of psp.matchStrings) {
        if (!url.includes(matchString)) continue;

        logger.info(`Network request matched ${psp.name}: ${url}`);
        const tabIdValue = TypeConverters.toTabId(tabId);
        if (!tabIdValue) return;
        await this.handleDetectPsp(
          {
            psp: psp.name,
            tabId: tabIdValue,
            detectionInfo: {
              method: 'matchString',
              value: matchString,
              sourceType: 'networkRequest',
            },
          },
          { tab: { id: tabId, url } as chrome.tabs.Tab },
        );

        return;
      }
    }
  }

  /**
   * Handle tab updates
   * @private
   */
  async handleTabUpdate(
    tabId: number,
    changeInfo: { status?: string },
    tab: chrome.tabs.Tab,
  ): Promise<void> {
    const brandedTabId = TypeConverters.toTabId(tabId);
    if (brandedTabId !== null && changeInfo.status === 'loading') {
      this.resetIcon();
      await this.cleanupTabData(brandedTabId);

      // Clear cached PSP result when page starts loading
      const currentTabId = await this.getCurrentTabId();
      if (brandedTabId === currentTabId) {
        await this.setDetectedPsp(null);
      }
    }

    if (changeInfo.status === 'complete' && tab.url) {
      const isExempt = await this.isUrlExempt(tab.url);
      if (isExempt || this.isSpecialUrl(tab.url)) {
        const currentTabId = await this.getCurrentTabId();
        if (brandedTabId !== null && brandedTabId === currentTabId) {
          await this.setExemptTabState(
            brandedTabId,
            tab.url,
            EXEMPT_DISABLED_REASON,
          );
        }
      } else {
        // For regular websites, inject content script for detection
        await this.injectContentScript(tabId);
      }
    }
  }

  /**
   * Update extension icon
   * @private
   */
  private setIconWithErrorHandling(
    path: chrome.action.TabIconDetails['path'],
    errorMessage: string,
    onError?: () => void,
  ): void {
    chrome.action.setIcon({ path }, () => {
      if (!chrome.runtime.lastError) {
        return;
      }

      logger.error(errorMessage, chrome.runtime.lastError.message);
      onError?.();
    });
  }

  /**
   * Update extension icon
   * @private
   */
  updateIcon(psp: string): void {
    logger.debug(`Background: Attempting to update icon for PSP: ${psp}`);
    const pspInfo = this.getPspInfo(psp);
    logger.debug('Background: PSP info lookup result:', pspInfo);

    if (pspInfo) {
      const iconPaths = {
        48: `images/${pspInfo.image}_48.png`,
        128: `images/${pspInfo.image}_128.png`,
      };
      logger.debug('Background: Setting icon paths:', iconPaths);

      this.setIconWithErrorHandling(
        iconPaths,
        `Background: Failed to set icon for ${psp}`,
        () => {
          this.setIconWithErrorHandling(
            DEFAULT_ICONS,
            'Background: Failed to set default icon fallback',
          );
        },
      );
    } else {
      logger.warn(`Background: No PSP info found for: ${psp}`);
      logger.debug('Background: PSP not found in cached config');
    }

    // Clear any badge when showing PSP icon
    chrome.action.setBadgeText({ text: '' });

    // Neutral grey
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }

  /**
   * Show exempt domain icon with warning badge
   * @private
   */
  showExemptDomainIcon(): void {
    // Set default icon
    this.setIconWithErrorHandling(
      DEFAULT_ICONS,
      'Background: Failed to set exempt icon',
    );

    // Add warning badge
    chrome.action.setBadgeText({ text: '🚫' });

    // Neutral grey
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    logger.debug('Showing exempt domain icon with warning badge');
  }

  /**
   * Reset extension icon to default
   * @private
   */
  resetIcon(): void {
    this.setIconWithErrorHandling(
      DEFAULT_ICONS,
      'Background: Failed to set default icon',
    );

    // Add searching badge
    chrome.action.setBadgeText({ text: '🔍' });

    // Neutral grey
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }

  /**
   * Get PSP information from config - simplified for sync usage
   * @private
   */
  getPspInfo(psp: string): PSP | null {
    logger.debug('Getting PSP info for:', psp);

    // Try to get cached config synchronously
    // Note: In MV3, we should have cached config available from initialization
    try {
      // We'll use a synchronous approach since this is called from sync methods
      // The config should be cached from initialization
      const cachedConfig = this.getCachedPspConfigSync();

      if (!cachedConfig) {
        logger.warn('Background: No PSP config available');
        return null;
      }

      // Use getAllProviders to search across PSPs, orchestrators, and TSPs
      const allProviders = getAllProviders(cachedConfig);
      const pspInfo = allProviders.find(
        (p: PSP) => p.name.toLowerCase() === psp.toLowerCase(),
      );

      if (pspInfo) {
        logger.debug('Background: Found PSP info:', pspInfo);
        return pspInfo;
      } else {
        logger.warn('Background: No PSP info found for:', psp);
        logger.debug('Background: PSP not found in cached config');
        return null;
      }
    } catch (error) {
      logger.error('Background: Error getting PSP info:', error);
      return null;
    }
  }

  /**
   * Inject content script into tab
   * @private
   */
  async injectContentScript(tabId: number): Promise<void> {
    // Check optional host permission before attempting injection.
    // Without it, executeScript will throw in service-worker context.
    const hasHostPermission = await chrome.permissions.contains({
      origins: ['https://*/*'],
    }).catch(() => {
      logger.debug(
        `Skipping content script injection for tab ${tabId}: ` +
        'could not check host permission',
      );

      return null;
    });

    if (!hasHostPermission) {
      logger.debug(
        `Skipping content script injection for tab ${tabId}: ` +
        'optional host permission not granted',
      );

      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch (error) {
      // Handle specific common error cases more gracefully
      if (error instanceof Error) {
        if (error.message.includes('error page') ||
            error.message.includes('Frame with ID 0 is showing error page')) {
          logger.debug(
            `Skipping content script injection for tab ${tabId}: ` +
            'Tab is showing an error page',
          );

          return;
        }

        if (error.message.includes('Cannot access contents of the page')) {
          logger.debug(
            `Skipping content script injection for tab ${tabId}: ` +
            'Cannot access page contents (likely a restricted page)',
          );

          return;
        }

        if (error.message.includes('The extensions gallery cannot be scripted')) {
          logger.debug(
            `Skipping content script injection for tab ${tabId}: ` +
            'Chrome Web Store page',
          );

          return;
        }
      }

      // Log other errors as warnings since they might be actionable
      logger.warn(`Failed to inject content script into tab ${tabId}:`, error);
    }
  }
}

// Initialize background service
const backgroundService = new BackgroundService();

backgroundService.initialize().catch((error) => { // NOSONAR
  logger.error('Failed to initialize background service:', error);
});
