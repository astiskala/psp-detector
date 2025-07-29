/**
 * Branded types for enhanced type safety
 */
export type PSPName = string & { readonly __brand: "PSPName" };
export type TabId = number & { readonly __brand: "TabId" };
export type URL = string & { readonly __brand: "URL" };
export type RegexPattern = string & { readonly __brand: "RegexPattern" };

/**
 * Brand type helpers
 */
export const PSPName = {
  create: (name: string): PSPName => {
    if (!name || name.trim().length === 0) {
      throw new Error("PSP name cannot be empty");
    }
    return name as PSPName;
  },
  isValid: (name: string): name is PSPName => {
    return Boolean(name && name.trim().length > 0);
  },
};

export const TabId = {
  create: (id: number): TabId => {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error("Tab ID must be a non-negative integer");
    }
    return id as TabId;
  },
  isValid: (id: number): id is TabId => {
    return Number.isInteger(id) && id >= 0;
  },
};

export const URL = {
  create: (url: string): URL => {
    try {
      new globalThis.URL(url);
      return url as URL;
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
  },
  isValid: (url: string): url is URL => {
    try {
      new globalThis.URL(url);
      return true;
    } catch {
      return false;
    }
  },
};

export const RegexPattern = {
  create: (pattern: string): RegexPattern => {
    try {
      new RegExp(pattern);
      return pattern as RegexPattern;
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }
  },
  isValid: (pattern: string): pattern is RegexPattern => {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Union types for PSP detection results
 */
export type PSPDetectionResult =
  | {
      readonly type: "detected";
      readonly psp: PSPName;
      readonly confidence: number;
    }
  | { readonly type: "exempt"; readonly reason: string; readonly url: URL }
  | { readonly type: "none"; readonly scannedPatterns: number }
  | {
      readonly type: "error";
      readonly error: Error;
      readonly context?: string;
    };

/**
 * Detection result helpers
 */
export const PSPDetectionResult = {
  detected: (psp: PSPName, confidence: number = 1.0): PSPDetectionResult => ({
    type: "detected",
    psp,
    confidence: Math.max(0, Math.min(1, confidence)),
  }),

  exempt: (reason: string, url: URL): PSPDetectionResult => ({
    type: "exempt",
    reason,
    url,
  }),

  none: (scannedPatterns: number): PSPDetectionResult => ({
    type: "none",
    scannedPatterns,
  }),

  error: (error: Error, context?: string): PSPDetectionResult => ({
    type: "error",
    error,
    context,
  }),

  isDetected: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "detected" }> => {
    return result.type === "detected";
  },

  isExempt: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "exempt" }> => {
    return result.type === "exempt";
  },

  isNone: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "none" }> => {
    return result.type === "none";
  },

  isError: (
    result: PSPDetectionResult,
  ): result is Extract<PSPDetectionResult, { type: "error" }> => {
    return result.type === "error";
  },
};

/**
 * Represents a Payment Service Provider configuration
 */
export interface PSP {
  name: PSPName;
  regex: RegexPattern;
  url: URL;
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
  tabPsps: Map<TabId, PSPName>;
  detectedPsp: PSPName | null;
  currentTabId: TabId | null;
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
  psp: PSPName | null;
  tabId?: TabId;
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
  psp?: PSPName;
  tabId?: TabId;
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
  psp: PSPName | null;
}
