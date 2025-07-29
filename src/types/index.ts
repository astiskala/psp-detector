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
  data?: any;
}
