/**
 * Debounce function to limit the rate at which a function can fire
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to wait
 */
import type { PSP } from "../types";

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>): void => {
    const later = (): void => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a safe URL by sanitizing the input
 * @param url - The URL to sanitize
 */
export function createSafeUrl(url: string): string {
  try {
    return new globalThis.URL(url).toString();
  } catch (e) {
    console.error("Invalid URL:", e);
    return "#";
  }
}

/**
 * Safely compile a regex pattern
 * @param pattern - The regex pattern to compile
 */
export function safeCompileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    console.error(`Invalid regex pattern: ${pattern}`, error);
    return null;
  }
}

/**
 * Error context for structured error reporting
 */
export interface ErrorContext {
  url?: string;
  userAgent?: string;
  timestamp: number;
  extensionVersion?: string;
  component?: string;
  action?: string;
}

/**
 * Enhanced error with context information
 */
export interface ContextualError extends Error {
  context?: ErrorContext;
}

/**
 * Check if a URL should be excluded from PSP detection
 * @param url - The URL to check
 * @param exemptPattern - The pattern of exempt domains
 */
export function isUrlExempt(url: string, exemptPattern: RegExp): boolean {
  try {
    return !exemptPattern.test(url);
  } catch (error) {
    console.error("Error checking URL exemption:", error);
    return true;
  }
}

/**
 * Report structured error for debugging and monitoring
 * @param error - Error to report
 * @param context - Additional context
 */
export function reportError(
  error: Error,
  context?: Partial<ErrorContext>,
): void {
  const errorContext: ErrorContext = {
    timestamp: Date.now(),
    url: window?.location?.href,
    userAgent: navigator?.userAgent,
    ...(error as ContextualError).context,
    ...context,
  };

  // Enhanced error logging with structured data
  console.error("[PSP Detector Error]", {
    message: error.message,
    stack: error.stack,
    context: errorContext,
  });

  // In development, also log to the logger
  if (process.env.NODE_ENV === "development") {
    logger.error("Structured error report:", {
      error: error.message,
      context: errorContext,
    });
  }
}

/**
 * Create error with context for better debugging
 * @param message - Error message
 * @param context - Additional context for the error
 */
export function createContextError(
  message: string,
  context?: Partial<ErrorContext>,
): ContextualError {
  const error = new Error(message) as ContextualError;

  // Build comprehensive error context
  const errorContext: ErrorContext = {
    timestamp: Date.now(),
    url: window?.location?.href,
    userAgent: navigator?.userAgent,
    ...context,
  };

  error.context = errorContext;
  return error;
}

/**
 * Logger utility with different log levels
 */
export const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.NODE_ENV === "development") {
      console.debug(message, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    console.log(message, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(message, ...args);
  },
  error: (message: string, ...args: unknown[]): void => {
    console.error(message, ...args);
  },
};

/**
 * Create a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param immediate - If true, trigger function on leading edge instead of trailing
 */
export function debouncedMutation<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number = 100,
  immediate: boolean = false,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>): void => {
    const later = (): void => {
      timeout = null;
      if (!immediate) func(...args);
    };

    const callNow = immediate && !timeout;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func(...args);
  };
}

/**
 * Memory management utilities for cleanup
 */
export const memoryUtils = {
  /**
   * Clean up event listeners and observers
   * @param cleanupFns - Array of cleanup functions
   */
  cleanup: (cleanupFns: (() => void)[]): void => {
    cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
        reportError(
          createContextError("Cleanup function failed", {
            component: "memoryUtils",
            action: "cleanup",
          }),
        );
      }
    });
  },

  /**
   * Create a cleanup function that removes event listeners
   * @param element - Element to remove listeners from
   * @param eventMap - Map of event types to listeners
   */
  createEventCleanup: (
    element: Element,
    eventMap: Map<string, EventListener>,
  ): (() => void) => {
    return (): void => {
      eventMap.forEach((listener, event) => {
        element.removeEventListener(event, listener);
      });
      eventMap.clear();
    };
  },

  /**
   * Throttle function calls to improve performance
   * @param func - Function to throttle
   * @param limit - Time limit in milliseconds
   */
  throttle: <T extends (...args: unknown[]) => unknown>(
    func: T,
    limit: number,
  ): ((...args: Parameters<T>) => void) => {
    let inThrottle: boolean;
    return (...args: Parameters<T>): void => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },
};

/**
 * Type conversion utilities for working with branded types
 */
import type { PSPName, TabId, URL as BrandedURL, RegexPattern } from "../types";
import {
  PSPName as PSPNameHelpers,
  TabId as TabIdHelpers,
  URL as URLHelpers,
  RegexPattern as RegexPatternHelpers,
} from "../types";

export const TypeConverters = {
  /**
   * Safely convert string to PSPName
   */
  toPSPName: (name: string): PSPName | null => {
    try {
      return PSPNameHelpers.create(name);
    } catch {
      return null;
    }
  },

  /**
   * Safely convert number to TabId
   */
  toTabId: (id: number): TabId | null => {
    try {
      return TabIdHelpers.create(id);
    } catch {
      return null;
    }
  },

  /**
   * Safely convert string to URL
   */
  toURL: (url: string): BrandedURL | null => {
    try {
      return URLHelpers.create(url);
    } catch {
      return null;
    }
  },

  /**
   * Safely convert string to RegexPattern
   */
  toRegexPattern: (pattern: string): RegexPattern | null => {
    try {
      return RegexPatternHelpers.create(pattern);
    } catch {
      return null;
    }
  },

  /**
   * Convert legacy PSP data to new typed format
   */
  migratePSPData: (legacyPSP: {
    name: string;
    regex: string;
    url: string;
    image: string;
    summary: string;
    notice?: string;
    compiledRegex?: RegExp;
  }): PSP => {
    const name = TypeConverters.toPSPName(legacyPSP.name);
    const regex = TypeConverters.toRegexPattern(legacyPSP.regex);
    const url = TypeConverters.toURL(legacyPSP.url);

    if (!name || !regex || !url) {
      throw new Error(`Invalid PSP data: ${JSON.stringify(legacyPSP)}`);
    }

    return {
      name,
      regex,
      url,
      image: legacyPSP.image,
      summary: legacyPSP.summary,
      notice: legacyPSP.notice,
      compiledRegex: legacyPSP.compiledRegex,
    };
  },
};
