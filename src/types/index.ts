/**
 * Represents a Payment Service Provider configuration
 */
export interface PSP {
  name: string;
  regex: string;
  url: string;
  image: string;
  summary: string;
  notice?: string;
  compiledRegex?: RegExp;
}

/**
 * Configuration for PSP detection
 */
export interface PSPConfig {
  psps: PSP[];
}

/**
 * Background service configuration
 */
export interface BackgroundConfig {
  cachedPspConfig: PSPConfig | null;
  exemptDomainsRegex: RegExp | null;
  tabPsps: Map<number, string>;
  detectedPsp: string | null;
  currentTabId: number | null;
}

/**
 * Special return values for PSP detection
 */
export const PSP_DETECTION_EXEMPT = "__PSP_DETECTION_EXEMPT__";

/**
 * Message actions for communication between extension components
 */
export enum MessageAction {
  GET_PSP_CONFIG = "getPspConfig",
  DETECT_PSP = "detectPsp",
  GET_PSP = "getPsp",
  GET_TAB_ID = "getTabId",
  GET_EXEMPT_DOMAINS_REGEX = "getExemptDomainsRegex",
}

/**
 * Response structure for PSP detection
 */
export interface PSPDetectionResponse {
  psp: string | null;
  tabId?: number;
}

/**
 * Chrome runtime message structure
 */
export interface ChromeMessage {
  action: MessageAction;
  data?: unknown;
}

/**
 * PSP detection message data
 */
export interface PSPDetectionData {
  psp?: string;
  tabId?: number;
}

/**
 * PSP config response
 */
export interface PSPConfigResponse {
  config: PSPConfig;
}

/**
 * PSP response
 */
export interface PSPResponse {
  psp: string | null;
}
