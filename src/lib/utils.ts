
/**
 * Create a safe URL by sanitizing the input
 * @param url - The URL to sanitize
 */
export function createSafeUrl(url: string): string {
  try {
    return new globalThis.URL(url).toString();
  } catch (e) {
    console.error('Invalid URL:', e);
    return '#';
  }
}

/**
 * Safely compile a regex pattern
 * @param pattern - The regex pattern to compile
 */
export function safeCompileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    console.error(`Invalid regex pattern: ${pattern}`, error);
    return null;
  }
}

/**
 * Logger utility with different log levels
 */
export const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[PSP Detector] ' + message, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    console.log('[PSP Detector] ' + message, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn('[PSP Detector] ' + message, ...args);
  },
  error: (message: string, ...args: unknown[]): void => {
    console.error('[PSP Detector] ' + message, ...args);
  },
  time: (label: string): void => {
    if (process.env.NODE_ENV === 'development') {
      console.time('[PSP Detector] ' + label);
    }
  },
  timeEnd: (label: string): void => {
    if (process.env.NODE_ENV === 'development') {
      console.timeEnd('[PSP Detector] ' + label);
    }
  },
};

/**
 * Create a debounced function that delays invoking func until after wait
 * milliseconds have elapsed since the last time the debounced function was
 * invoked
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param immediate - If true, trigger function on leading edge instead of
 * trailing
 */
export function debouncedMutation<T extends(...args: unknown[]) => unknown>(
  func: T,
  wait = 100,
  immediate = false,
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
        logger.error('Cleanup function failed:', cleanupError);
      }
    });
  },

};

/**
 * Get all PSPs, orchestrators, and TSPs as a single array
 * @param pspConfig - The PSP configuration object
 * @returns Array of all providers
 */
import type { PSPConfig, PSP } from '../types/psp';
export function getAllProviders(pspConfig: PSPConfig): PSP[] {
  if (!pspConfig) return [];
  const psps = pspConfig.psps || [];
  const orchestrators = pspConfig.orchestrators?.list || [];
  const tsps = pspConfig.tsps?.list || [];
  return [...psps, ...orchestrators, ...tsps];
}
