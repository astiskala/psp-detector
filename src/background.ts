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
  type PSPMatch,
  type ChromeMessage,
  type PSPDetectionData,
  type PSPConfigResponse,
  type PSPConfig,
  type PSPResponse,
  type StoredTabPsp,
} from './types';
import { DEFAULT_ICONS } from './types/background';
import type { URL as BrandedURL } from './types/branded';
import {
  logger,
  getAllProviders,
  normalizeStringArray,
  fetchWithTimeout,
} from './lib/utils';
import { STORAGE_KEYS } from './lib/storage-keys';
import { writeHistoryEntry } from './lib/history';
import type { HistoryEntry, ProviderType } from './types/history';

const BADGE_COLOR = '#6B7280';
const TAB_STATE_PERSIST_DEBOUNCE_MS = 300;
const NETWORK_REQUEST_TYPES: `${chrome.webRequest.ResourceType}`[] = [
  'script',
  'xmlhttprequest',
  'sub_frame',
];

const sourcePriority = (sourceType?: string): number => {
  switch (sourceType) {
  case undefined:
    return -1;
  case 'networkRequest':
    return 0;
  case 'pageUrl':
    return 1;
  case 'linkHref':
    return 2;
  case 'formAction':
    return 3;
  case 'iframeSrc':
    return 4;
  case 'scriptSrc':
    return 5;
  default:
    return -1;
  }
};

interface NetworkMatcher {
  pspName: NonNullable<PSPDetectionData['psp']>;
  matchString: string;
}

class BackgroundService {
  private isInitialized = false;
  private inMemoryPspConfig: PSPConfig | null = null;
  private inMemoryExemptDomains: string[] | null = null;
  private webRequestListenerRegistered = false;
  private readonly tabPspCache = new Map<number, StoredTabPsp[]>();
  private tabPspPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private tabPspPersistDirty = false;
  private readonly networkMatchersByToken = new Map<string, NetworkMatcher[]>();
  private fallbackNetworkMatchers: NetworkMatcher[] = [];
  private readonly networkMatchedProvidersByTab =
    new Map<number, Set<string>>();

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
      this.persistState().catch((err) =>
        logger.error('Failed to persist state on suspend:', err),
      );

      this.flushTabPspCache().catch((err) =>
        logger.error('Failed to flush tab PSP cache on suspend:', err),
      );
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
    this.tabPspCache.clear();
    this.networkMatchedProvidersByTab.clear();
    this.tabPspPersistDirty = false;
    if (this.tabPspPersistTimer !== null) {
      clearTimeout(this.tabPspPersistTimer);
      this.tabPspPersistTimer = null;
    }

    await this.clearCachedConfig();
    await this.loadExemptDomains();
    await this.openOnboardingPage();
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
      this.rebuildNetworkMatcherIndex(null);
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
      const localResult = await chrome.storage.local.get({
        [STORAGE_KEYS.CACHED_PSP_CONFIG]: null as PSPConfig | null,
        [STORAGE_KEYS.EXEMPT_DOMAINS]: [] as string[],
      });
      const sessionResult = await chrome.storage.session.get({
        [STORAGE_KEYS.TAB_PSPS]: {} as Record<number, StoredTabPsp[]>,
      });
      const cachedConfig = localResult[STORAGE_KEYS.CACHED_PSP_CONFIG];
      if (cachedConfig !== null && this.isValidPspConfig(cachedConfig)) {
        this.inMemoryPspConfig = cachedConfig;
      } else {
        this.inMemoryPspConfig = null;
      }

      this.rebuildNetworkMatcherIndex(this.inMemoryPspConfig);

      this.inMemoryExemptDomains = normalizeStringArray(
        localResult[STORAGE_KEYS.EXEMPT_DOMAINS] as string[],
      );

      const tabPsps = sessionResult[STORAGE_KEYS.TAB_PSPS] as Record<
        number,
        StoredTabPsp[]
      >;
      this.hydrateTabPspCache(tabPsps);
      const tabStateCount = this.tabPspCache.size;
      logger.info(
        `State restored from storage (tabs: ${tabStateCount}, ` +
        `exemptDomains: ${this.inMemoryExemptDomains.length})`,
      );
    } catch (error) {
      logger.error('Failed to restore state:', error);
    }
  }

  private hydrateTabPspCache(tabPsps: Record<number, StoredTabPsp[]>): void {
    this.tabPspCache.clear();

    for (const [tabIdKey, entries] of Object.entries(tabPsps)) {
      const tabId = Number(tabIdKey);
      if (!Number.isInteger(tabId) || tabId < 0 || !Array.isArray(entries)) {
        continue;
      }

      this.tabPspCache.set(tabId, [...entries]);
    }
  }

  private cloneTabPspCache(): Record<number, StoredTabPsp[]> {
    const cloned: Record<number, StoredTabPsp[]> = {};
    for (const [tabId, entries] of this.tabPspCache.entries()) {
      cloned[tabId] = [...entries];
    }

    return cloned;
  }

  private markTabPspCacheDirty(): void {
    this.tabPspPersistDirty = true;
    if (this.tabPspPersistTimer !== null) {
      clearTimeout(this.tabPspPersistTimer);
    }

    this.tabPspPersistTimer = setTimeout(() => {
      this.flushTabPspCache().catch((err) =>
        logger.error('Failed to flush tab PSP cache:', err),
      );
    }, TAB_STATE_PERSIST_DEBOUNCE_MS);
  }

  private async flushTabPspCache(): Promise<void> {
    if (this.tabPspPersistTimer !== null) {
      clearTimeout(this.tabPspPersistTimer);
      this.tabPspPersistTimer = null;
    }

    if (!this.tabPspPersistDirty) {
      return;
    }

    try {
      await chrome.storage.session.set({
        [STORAGE_KEYS.TAB_PSPS]: this.cloneTabPspCache(),
      });

      this.tabPspPersistDirty = false;
    } catch (error) {
      logger.error('Failed to persist tab PSP cache:', error);
      this.markTabPspCacheDirty();
    }
  }

  /**
   * Read a value from chrome.storage.local with a fallback.
   * @private
   */
  private async getLocalStorage<T>(key: string, fallback: T): Promise<T> {
    try {
      const result = await chrome.storage.local.get({
        [key]: fallback,
      } as Record<string, T>);
      return (result[key] as T) ?? fallback;
    } catch (error) {
      logger.error(`Failed to get storage key ${key}:`, error);
      return fallback;
    }
  }

  /**
   * Persist current state to chrome.storage
   * @private
   */
  private async persistState(): Promise<void> {
    try {
      await this.flushTabPspCache();
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
    return this.getLocalStorage<number | null>(
      STORAGE_KEYS.CURRENT_TAB_ID,
      null,
    );
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
    return this.getLocalStorage<PSPDetectionResult | null>(
      STORAGE_KEYS.DETECTED_PSP,
      null,
    );
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
   * Clean up data for a removed tab
   * @private
   */
  private async cleanupTabData(tabId: number): Promise<void> {
    try {
      this.tabPspCache.delete(tabId);
      this.networkMatchedProvidersByTab.delete(tabId);
      this.markTabPspCacheDirty();

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
    if (this.inMemoryExemptDomains !== null) {
      return this.inMemoryExemptDomains;
    }

    const storedDomains = await this.getLocalStorage<string[]>(
      STORAGE_KEYS.EXEMPT_DOMAINS,
      [],
    );
    const normalizedDomains = normalizeStringArray(storedDomains);
    this.inMemoryExemptDomains = normalizedDomains;
    return normalizedDomains;
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
      if (Array.isArray(data.exemptDomains)) {
        const validDomains = normalizeStringArray(
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
      (url ?? 'unknown') as BrandedURL,
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
    this.tabPspCache.set(tabId, [{ psp: PSP_DETECTION_EXEMPT }]);
    this.networkMatchedProvidersByTab.set(
      tabId,
      new Set([PSP_DETECTION_EXEMPT]),
    );

    this.markTabPspCacheDirty();
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
    if (typeof message.action !== 'string') {
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
        if (typeof sender.tab?.id === 'number') {
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

      case MessageAction.REDETECT_CURRENT_TAB:
        await this.handleRedetectCurrentTab(sendResponse);
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
    if (typeof data !== 'object' || data === null) {
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
      const response = await fetchWithTimeout(
        chrome.runtime.getURL('psps.json'),
        5000,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

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
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const config = data as Partial<PSPConfig>;

    // Check if psps array exists and is valid
    if (!Array.isArray(config.psps) || config.psps.length === 0) {
      return false;
    }

    // Validate main psps array
    if (!this.isValidProviderArray(config.psps)) {
      return false;
    }

    // Validate orchestrators if present
    if (
      config.orchestrators !== undefined &&
      !this.isValidProviderGroup(config.orchestrators)
    ) {
      return false;
    }

    // Validate tsps if present
    if (config.tsps !== undefined && !this.isValidProviderGroup(config.tsps)) {
      return false;
    }

    return true;
  }

  private isValidProviderGroup(
    group: Partial<PSPConfig>['orchestrators'] | Partial<PSPConfig>['tsps'],
  ): boolean {
    if (
      typeof group !== 'object' ||
      group === null ||
      typeof group.notice !== 'string' ||
      !Array.isArray(group.list)
    ) {
      return false;
    }

    return this.isValidProviderArray(group.list);
  }

  private isValidProviderArray(psps: unknown[]): boolean {
    return psps.every((psp) => this.isValidProviderEntry(psp));
  }

  private isValidProviderEntry(psp: unknown): boolean {
    if (typeof psp !== 'object' || psp === null) {
      return false;
    }

    const pspEntry = psp as Partial<PSP>;
    const hasValidName =
      typeof pspEntry.name === 'string' && pspEntry.name.trim().length > 0;
    const hasValidImage =
      typeof pspEntry.image === 'string' && pspEntry.image.trim().length > 0;
    const hasValidUrl =
      typeof pspEntry.url === 'string' && pspEntry.url.trim().length > 0;
    const hasValidSummary =
      typeof pspEntry.summary === 'string' && pspEntry.summary.trim().length > 0;
    const hasValidMatchStrings =
      Array.isArray(pspEntry.matchStrings) &&
      pspEntry.matchStrings.length > 0 &&
      pspEntry.matchStrings.every(
        (value) => typeof value === 'string' && value.trim().length > 0,
      );
    const hasValidRegex =
      typeof pspEntry.regex === 'string' && pspEntry.regex.trim().length > 0;

    return (
      hasValidName &&
      hasValidImage &&
      hasValidUrl &&
      hasValidSummary &&
      (hasValidMatchStrings || hasValidRegex)
    );
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

      if (
        candidate === null ||
        candidate === undefined ||
        !this.isValidPspConfig(candidate)
      ) {
        return null;
      }

      // Also update in-memory cache
      this.inMemoryPspConfig = candidate;
      this.rebuildNetworkMatcherIndex(candidate);
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
      this.rebuildNetworkMatcherIndex(config);
    } catch (error) {
      logger.error('Failed to cache PSP config:', error);
    }
  }

  /**
   * Get cached PSP config synchronously for icon updates
   * @private
   */
  private getCachedPspConfigSync(): PSPConfig | null {
    return this.inMemoryPspConfig;
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
      const resolvedData = this.resolveDetectionPayload(data, sender);
      if (resolvedData === null) {
        return;
      }

      const { tabId, pspName, url } = resolvedData;
      logger.debug(
        `Background: Processing PSP detection - PSP: ${pspName}, ` +
        `TabID: ${tabId}, CurrentTabID: ${currentTabId}`,
      );

      if (pspName === PSP_DETECTION_EXEMPT) {
        await this.setExemptTabState(
          tabId,
          url,
          'Domain is exempt from PSP detection',
        );

        return;
      }

      const wasStored = await this.storeTabDetection(
        tabId,
        pspName,
        data.detectionInfo,
      );
      if (!wasStored) {
        return;
      }

      await this.syncCurrentTabDetection(
        tabId,
        currentTabId,
        pspName,
        data.detectionInfo,
      );

      await this.recordDetectionHistory(
        tabId,
        pspName,
        data.detectionInfo,
        sender,
      );
    } catch (error) {
      logger.error('Background: Error processing PSP detection:', error);
      this.resetIcon();
    }
  }

  private resolveDetectionPayload(
    data: PSPDetectionData,
    sender: chrome.runtime.MessageSender,
  ): {
    tabId: number;
    pspName: NonNullable<PSPDetectionData['psp']>;
    url: string;
  } | null {
    const tabId = data.tabId ?? TypeConverters.toTabId(sender.tab?.id ?? -1);
    if (tabId === null || tabId === undefined) {
      logger.warn('Background: Invalid tab ID in detection payload');
      return null;
    }

    const pspName = TypeConverters.toPSPName(data.psp ?? '');
    if (pspName === null) {
      logger.warn('Background: Invalid PSP detection data received');
      return null;
    }

    if (!Number.isInteger(tabId) || tabId < 0) {
      logger.warn(`Background: Invalid tab ID: ${tabId}`);
      return null;
    }

    const url = data.url ?? sender.tab?.url ?? 'unknown';
    return { tabId, pspName, url };
  }

  private async storeTabDetection(
    tabId: number,
    pspName: NonNullable<PSPDetectionData['psp']>,
    detectionInfo?: PSPDetectionData['detectionInfo'],
  ): Promise<boolean> {
    const existing = this.tabPspCache.get(tabId) ?? [];
    const existingIndex = existing.findIndex((entry) => entry.psp === pspName);
    if (existingIndex !== -1) {
      const existingEntry = existing[existingIndex];
      if (existingEntry === undefined) {
        return false;
      }

      const shouldUpgrade = this.shouldUpgradeDetectionInfo(
        existingEntry.detectionInfo,
        detectionInfo,
      );
      if (!shouldUpgrade) {
        return false;
      }

      const nextEntry: StoredTabPsp =
        detectionInfo === undefined
          ? { psp: pspName }
          : { psp: pspName, detectionInfo };
      const updatedEntries = [...existing];
      updatedEntries[existingIndex] = nextEntry;
      this.tabPspCache.set(tabId, updatedEntries);

      const matchedProviders =
        this.networkMatchedProvidersByTab.get(tabId) ?? new Set<string>();
      matchedProviders.add(pspName);
      this.networkMatchedProvidersByTab.set(tabId, matchedProviders);
      this.markTabPspCacheDirty();
      return true;
    }

    const nextEntry: StoredTabPsp =
      detectionInfo === undefined
        ? { psp: pspName }
        : { psp: pspName, detectionInfo };
    this.tabPspCache.set(tabId, [...existing, nextEntry]);
    const matchedProviders =
      this.networkMatchedProvidersByTab.get(tabId) ?? new Set<string>();
    matchedProviders.add(pspName);
    this.networkMatchedProvidersByTab.set(tabId, matchedProviders);
    this.markTabPspCacheDirty();
    return true;
  }

  private shouldUpgradeDetectionInfo(
    existingInfo: StoredTabPsp['detectionInfo'] | undefined,
    incomingInfo: PSPDetectionData['detectionInfo'] | undefined,
  ): boolean {
    if (incomingInfo === undefined) {
      return false;
    }

    if (existingInfo === undefined) {
      return true;
    }

    return sourcePriority(incomingInfo.sourceType) >
      sourcePriority(existingInfo.sourceType);
  }

  private buildDetectedResult(
    pspName: NonNullable<PSPDetectionData['psp']>,
    detectionInfo?: PSPDetectionData['detectionInfo'],
  ): PSPDetectionResult {
    const match: PSPMatch =
      detectionInfo === undefined
        ? { psp: pspName }
        : { psp: pspName, detectionInfo };
    return PSPDetectionResult.detected([match]);
  }

  private async syncCurrentTabDetection(
    tabId: number,
    currentTabId: number | null,
    pspName: NonNullable<PSPDetectionData['psp']>,
    detectionInfo?: PSPDetectionData['detectionInfo'],
  ): Promise<void> {
    if (currentTabId !== null && tabId === currentTabId) {
      await this.setDetectedPsp(
        this.buildDetectedResult(pspName, detectionInfo),
      );

      this.updateIcon(pspName);
      return;
    }

    logger.debug(
      `Background: Detection recorded for tab ${tabId}; ` +
      `active tab is ${currentTabId}`,
    );
  }

  private async recordDetectionHistory(
    tabId: number,
    pspName: NonNullable<PSPDetectionData['psp']>,
    detectionInfo: PSPDetectionData['detectionInfo'] | undefined,
    sender: chrome.runtime.MessageSender,
  ): Promise<void> {
    if (detectionInfo === undefined || pspName === PSP_DETECTION_EXEMPT) {
      return;
    }

    const now = Date.now();
    const historyEntry: HistoryEntry = {
      id: `${tabId}_${now}`,
      domain: this.getDomainFromSender(sender),
      url: sender.tab?.url ?? '',
      timestamp: now,
      psps: [{
        name: pspName,
        type: this.getProviderType(pspName),
        method: detectionInfo.method,
        value: detectionInfo.value,
        sourceType: detectionInfo.sourceType ?? 'pageUrl',
      }],
    };
    await writeHistoryEntry(historyEntry);
  }

  /**
   * Handle get PSP request
   * @private
   */
  async handleGetPsp(
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: PSPResponse) => void,
  ): Promise<void> {
    const senderTabId = typeof sender.tab?.id === 'number'
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
      const entries = this.tabPspCache.get(tabId) ?? [];
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

    if (resolvedTabId !== null && psps.length === 0) {
      psps = this.tabPspCache.get(resolvedTabId) ?? [];
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
    const tabId = typeof sender.tab?.id === 'number'
      ? TypeConverters.toTabId(sender.tab.id)
      : null;
    if (tabId === null) {
      sendResponse({ hasState: false });
      return;
    }

    const currentTabId = await this.getCurrentTabId();
    const hasState = this.tabPspCache.has(tabId) || currentTabId === tabId;

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

    const detectedPsp = this.toDetectionResult(
      this.tabPspCache.get(tabId) ?? [],
    );
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
    if (typeof tab.url !== 'string' || tab.url.length === 0) {
      return;
    }

    const isExempt = await this.isUrlExempt(tab.url);
    if (isExempt || this.isSpecialUrl(tab.url)) {
      await this.setExemptTabState(
        tabId,
        tab.url,
        'PSP detection is disabled for this domain',
      );

      return;
    }

    await this.injectContentScript(rawTabId);
  }

  private toDetectionResult(psps: StoredTabPsp[]): PSPDetectionResult | null {
    if (psps.length === 0) return null;
    if (psps.some((p) => p.psp === PSP_DETECTION_EXEMPT)) {
      return this.createExemptResult('PSP detection is disabled for this domain');
    }

    const matches: PSPMatch[] = [];
    for (const p of psps) {
      const psp = TypeConverters.toPSPName(p.psp);
      if (!psp) {
        logger.warn('Skipping stored entry with empty PSP name');
        continue;
      }

      if (p.detectionInfo) {
        matches.push({ psp, detectionInfo: p.detectionInfo });
      } else {
        matches.push({ psp });
      }
    }

    return PSPDetectionResult.detected(matches);
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

  /**
   * Open onboarding instructions page after installation.
   * @private
   */
  private async openOnboardingPage(): Promise<void> {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding.html'),
      });
    } catch (error) {
      logger.warn('Failed to open onboarding page:', error);
    }
  }

  /**
   * Force a re-detection attempt on the active tab.
   * @private
   */
  private async handleRedetectCurrentTab(
    sendResponse: (response?: { success: boolean; reason?: string }) => void,
  ): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const activeTab = tabs[0];

      if (typeof activeTab?.id !== 'number') {
        sendResponse({ success: false, reason: 'No active tab' });
        return;
      }

      const tabId = TypeConverters.toTabId(activeTab.id);
      if (tabId === null) {
        sendResponse({ success: false, reason: 'Invalid active tab id' });
        return;
      }

      const tabUrl = activeTab.url ?? '';
      if (tabUrl.length > 0) {
        const isExempt = await this.isUrlExempt(tabUrl);
        if (isExempt || this.isSpecialUrl(tabUrl)) {
          await this.setExemptTabState(
            tabId,
            tabUrl,
            'PSP detection is disabled for this domain',
          );

          sendResponse({ success: true, reason: 'Tab is exempt or restricted' });
          return;
        }
      }

      await this.cleanupTabData(tabId);
      await this.setCurrentTabId(tabId);
      await this.setDetectedPsp(null);
      await this.injectContentScript(activeTab.id);
      sendResponse({ success: true });
    } catch (error) {
      logger.warn('Failed to re-detect current tab:', error);
      sendResponse({ success: false, reason: 'Re-detect failed' });
    }
  }

  private getProviderType(pspName: string): ProviderType {
    const config = this.getCachedPspConfigSync();
    if (!config) {
      logger.debug(
        `getProviderType: config not loaded, defaulting to PSP for ${pspName}`,
      );

      return 'PSP';
    }

    const normalizedName = pspName.toLowerCase();
    const isOrchestrator = config.orchestrators?.list.some(
      (provider) => provider.name.toLowerCase() === normalizedName,
    );
    if (isOrchestrator === true) {
      return 'Orchestrator';
    }

    const isTsp = config.tsps?.list.some(
      (provider) => provider.name.toLowerCase() === normalizedName,
    );
    if (isTsp === true) {
      return 'TSP';
    }

    return 'PSP';
  }

  private rebuildNetworkMatcherIndex(config: PSPConfig | null): void {
    this.networkMatchersByToken.clear();
    this.fallbackNetworkMatchers = [];

    if (!config) {
      return;
    }

    for (const provider of getAllProviders(config)) {
      const matchStrings = provider.matchStrings;
      if (!Array.isArray(matchStrings) || matchStrings.length === 0) {
        continue;
      }

      for (const rawMatchString of matchStrings) {
        const matchString = rawMatchString.trim().toLowerCase();
        if (matchString.length === 0) {
          continue;
        }

        const matcher: NetworkMatcher = {
          pspName: provider.name,
          matchString,
        };
        const token = this.extractMatcherToken(matchString);
        if (token === null) {
          this.fallbackNetworkMatchers.push(matcher);
          continue;
        }

        const bucket = this.networkMatchersByToken.get(token);
        if (bucket !== undefined) {
          bucket.push(matcher);
          continue;
        }

        this.networkMatchersByToken.set(token, [matcher]);
      }
    }
  }

  private extractMatcherToken(matchString: string): string | null {
    const hostCandidate = matchString
      .replace(/^https?:\/\//u, '')
      .split('/')[0]
      ?.replace(/^\*\./u, '')
      .replaceAll(':', '').replaceAll('*', '')
      .toLowerCase();

    if (hostCandidate === undefined || hostCandidate.length === 0) {
      return null;
    }

    if (
      hostCandidate.includes('\\') ||
      hostCandidate.includes('[') ||
      hostCandidate.includes('(')
    ) {
      return null;
    }

    const hostParts = hostCandidate
      .split('.')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (hostParts.length >= 2) {
      return hostParts.slice(-2).join('.');
    }

    return hostParts[0] ?? null;
  }

  private extractRequestTokens(requestUrl: string): string[] {
    try {
      const host = new URL(requestUrl).hostname.toLowerCase();
      const hostParts = host.split('.').filter((part) => part.length > 0);
      if (hostParts.length === 0) {
        return [];
      }

      const tokens = new Set<string>([host]);
      for (let i = 1; i < hostParts.length; i++) {
        const suffix = hostParts.slice(i).join('.');
        if (suffix.length > 0) {
          tokens.add(suffix);
        }
      }

      return [...tokens];
    } catch {
      return [];
    }
  }

  private getCandidateNetworkMatchers(url: string): NetworkMatcher[] {
    const seen = new Set<string>();
    const candidates: NetworkMatcher[] = [];
    const requestTokens = this.extractRequestTokens(url);

    for (const token of requestTokens) {
      const bucket = this.networkMatchersByToken.get(token);
      if (bucket === undefined) {
        continue;
      }

      for (const matcher of bucket) {
        const key = `${matcher.pspName}|${matcher.matchString}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push(matcher);
      }
    }

    if (candidates.length > 0) {
      return candidates;
    }

    for (const matcher of this.fallbackNetworkMatchers) {
      const key = `${matcher.pspName}|${matcher.matchString}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(matcher);
    }

    return candidates;
  }

  private async setupOptionalNetworkScanning(): Promise<void> {
    const perms = await chrome.permissions.getAll();
    if (perms.permissions?.includes('webRequest') === true) {
      this.setupWebRequestListener();
    }

    chrome.permissions.onAdded?.addListener((permissions) => {
      if (permissions.permissions?.includes('webRequest') === true) {
        this.setupWebRequestListener();
      }
    });
  }

  private setupWebRequestListener(): void {
    if (this.webRequestListenerRegistered) return;
    const onBeforeRequest = chrome.webRequest?.onBeforeRequest;
    if (onBeforeRequest === undefined) return;

    this.webRequestListenerRegistered = true;
    onBeforeRequest.addListener(
      (details) => {
        this.handleNetworkRequest(
          details as chrome.webRequest.WebRequestDetails,
        ).catch((err) => {
          logger.warn('webRequest handler error:', err);
        });

        return undefined;
      },
      {
        urls: ['https://*/*'],
        types: [...NETWORK_REQUEST_TYPES],
      },
    );

    logger.info('webRequest listener registered');
  }

  private async handleNetworkRequest(
    details: chrome.webRequest.WebRequestDetails,
  ): Promise<void> {
    const { tabId, url } = details;
    if (tabId < 0) return;

    const tabIdValue = TypeConverters.toTabId(tabId);
    if (tabIdValue === null) return;

    const matchedProvidersForTab =
      this.networkMatchedProvidersByTab.get(tabId) ??
      new Set<string>();
    this.networkMatchedProvidersByTab.set(tabId, matchedProvidersForTab);

    const candidates = this.getCandidateNetworkMatchers(url);
    for (const matcher of candidates) {
      if (matchedProvidersForTab.has(matcher.pspName)) {
        continue;
      }

      if (!url.toLowerCase().includes(matcher.matchString)) {
        continue;
      }

      logger.info(`Network request matched ${matcher.pspName}: ${url}`);
      const tabUrl = await this.resolveTabUrlForNetworkDetection(tabId, url);
      await this.handleDetectPsp(
        {
          psp: matcher.pspName,
          tabId: tabIdValue,
          detectionInfo: {
            method: 'matchString',
            value: matcher.matchString,
            sourceType: 'networkRequest',
          },
        },
        { tab: { id: tabId, url: tabUrl } as chrome.tabs.Tab },
      );

      matchedProvidersForTab.add(matcher.pspName);
      return;
    }
  }

  private async resolveTabUrlForNetworkDetection(
    tabId: number,
    fallbackUrl: string,
  ): Promise<string> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (typeof tab.url === 'string' && tab.url.length > 0) {
        return tab.url;
      }
    } catch (error) {
      logger.debug(
        `Unable to resolve tab URL for network match on tab ${tabId}:`,
        error,
      );
    }

    return fallbackUrl;
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

    if (
      changeInfo.status === 'complete' &&
      typeof tab.url === 'string' &&
      tab.url.length > 0
    ) {
      const isExempt = await this.isUrlExempt(tab.url);
      if (isExempt || this.isSpecialUrl(tab.url)) {
        const currentTabId = await this.getCurrentTabId();
        if (brandedTabId !== null && brandedTabId === currentTabId) {
          await this.setExemptTabState(
            brandedTabId,
            tab.url,
            'PSP detection is disabled for this domain',
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

    if (hasHostPermission !== true) {
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
