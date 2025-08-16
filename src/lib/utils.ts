
/**
 * Create a safe URL by sanitizing the input
 * @param url - The URL to sanitize
 */
export function createSafeUrl(url: string): string {
  try {
    return new globalThis.URL(url).toString();
  } catch (e) {
    logger.error('Invalid URL:', e);
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
    logger.error(`Invalid regex pattern: ${pattern}`, error);
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
 * Memory management utilities for cleanup and performance monitoring
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

  /**
   * Monitor memory usage and warn if high
   * @param context - Context for logging
   */
  checkMemoryUsage: (context: string): void => {
    if (typeof window !== 'undefined' && 'performance' in window &&
        'memory' in window.performance) {
      const memory = (window.performance as unknown as {
        memory: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }).memory;

      const usagePercent =
        (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

      if (usagePercent > 80) {
        logger.warn(
          `High memory usage in ${context}: ${usagePercent.toFixed(1)}%`,
        );
      }
    }
  },

  /**
   * Create a resource cleanup manager
   */
  createCleanupManager: (): {
    add: (cleanup: () => void) => void;
    cleanup: () => void;
  } => {
    const resources: (() => void)[] = [];

    return {
      add: (cleanup: () => void): void => {
        resources.push(cleanup);
      },
      cleanup: (): void => {
        resources.forEach((fn) => {
          try {
            fn();
          } catch (error) {
            logger.error('Resource cleanup failed:', error);
          }
        });

        resources.length = 0;
      },
    };
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

/**
 * Performance monitoring utilities
 */
export const performanceUtils = {
  /**
   * Measure execution time of a function
   * @param fn - Function to measure
   * @param label - Label for the measurement
   */
  measureAsync: async <T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> => {
    logger.time(label);
    try {
      const result = await fn();
      return result;
    } finally {
      logger.timeEnd(label);
    }
  },

  /**
   * Measure execution time of a synchronous function
   * @param fn - Function to measure
   * @param label - Label for the measurement
   */
  measure: <T>(fn: () => T, label: string): T => {
    logger.time(label);
    try {
      return fn();
    } finally {
      logger.timeEnd(label);
    }
  },

  /**
   * Throttle function execution
   * @param fn - Function to throttle
   * @param limit - Time limit in milliseconds
   */
  throttle: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    limit: number,
  ): ((...args: Parameters<T>) => void) => {
    let inThrottle = false;

    return (...args: Parameters<T>): void => {
      if (!inThrottle) {
        fn(...args);
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
    };
  },
};

/**
 * Error handling utilities
 */
export const errorUtils = {
  /**
   * Safely execute a function with error handling
   * @param fn - Function to execute
   * @param context - Context for error logging
   * @param fallback - Fallback value on error
   */
  safeExecute: <T>(
    fn: () => T,
    context: string,
    fallback: T,
  ): T => {
    try {
      return fn();
    } catch (error) {
      logger.error(`Error in ${context}:`, error);
      return fallback;
    }
  },

  /**
   * Safely execute an async function with error handling
   * @param fn - Async function to execute
   * @param context - Context for error logging
   * @param fallback - Fallback value on error
   */
  safeExecuteAsync: async <T>(
    fn: () => Promise<T>,
    context: string,
    fallback: T,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      logger.error(`Error in ${context}:`, error);
      return fallback;
    }
  },

  /**
   * Create a retry wrapper for functions
   * @param fn - Function to retry
   * @param maxAttempts - Maximum retry attempts
   * @param delay - Delay between retries in milliseconds
   */
  withRetry: <T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    delay = 1000,
  ): (() => Promise<T>) => {
    return async(): Promise<T> => {
      let lastError: Error;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === maxAttempts) {
            throw lastError;
          }

          logger.warn(
            `Attempt ${attempt} failed, retrying in ${delay}ms:`,
            error,
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      throw lastError!;
    };
  },
};
