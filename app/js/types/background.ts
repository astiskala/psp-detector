import type { PSPConfig } from './index';

/**
 * Background service configuration and types
 */
export interface BackgroundConfig {
    cachedPspConfig: PSPConfig | null;
    exemptDomainsRegex: RegExp | null;
    tabPsps: Map<number, string>;
    detectedPsp: string | null;
    currentTabId: number | null;
}

/**
 * Response from message handlers
 */
export interface MessageResponse {
    config?: PSPConfig;
    psp?: string | null;
    tabId?: number;
    regex?: string;
}

/**
 * Default icons configuration
 */
const DEFAULT_ICONS = {
    16: 'images/default_16.png',
    48: 'images/default_48.png',
    128: 'images/default_128.png'
} as const;
