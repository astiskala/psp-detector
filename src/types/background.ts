import type { PSPConfig } from "./psp";
import type { PSPName, TabId } from "./branded";

/**
 * Background service configuration and types
 */
export interface BackgroundConfig {
  cachedPspConfig: PSPConfig | null;
  exemptDomains: string[];
  tabPsps: Map<TabId, PSPName>;
  detectedPsp: PSPName | null;
  currentTabId: TabId | null;
}

/**
 * Response from message handlers
 */
export interface MessageResponse {
  config?: PSPConfig;
  psp?: PSPName | null;
  tabId?: TabId;
  exemptDomains?: string[];
}

/**
 * Default icons configuration
 */
export const DEFAULT_ICONS = {
  48: "images/default_48.png",
  128: "images/default_128.png",
} as const;
