
import type { PSP, PSPConfig } from '../types/psp';

/**
 * Create a safe URL by sanitizing the input
 */
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Create a safe URL by sanitizing the input.
 * @param url - The URL to sanitize.
 */
export function createSafeUrl(url: string): string {
  try {
    const parsed = new globalThis.URL(url);

    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      logger.warn('Blocked unsupported URL protocol:', parsed.protocol);
      return '#';
    }

    return parsed.toString();
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
 * Normalize, lowercase, and deduplicate a string array while preserving the
 * first occurrence order.
 * @param values - String values to normalize.
 */
export function normalizeStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => {
      if (value.length === 0 || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

/**
 * Fetch a resource with an abort timeout.
 * @param url - Resource URL.
 * @param timeoutMs - Timeout in milliseconds.
 * @param init - Optional fetch init options.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = init.signal;

  const onParentAbort = (): void => {
    controller.abort();
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Logger utility with different log levels
 */
const DEVELOPMENT_ENV = 'development';
const LOG_PREFIX = '[PSP Detector] ';
const RUNTIME_DEBUG_FLAG = '__PSP_DETECTOR_DEBUG__' as const;

interface RuntimeDebugWindow {
  __PSP_DETECTOR_DEBUG__?: boolean;
}

const isDebugLoggingEnabled = (): boolean => {
  if (process.env['NODE_ENV'] === DEVELOPMENT_ENV) {
    return true;
  }

  const win = globalThis as typeof globalThis & RuntimeDebugWindow;
  return win[RUNTIME_DEBUG_FLAG] === true;
};

export const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (isDebugLoggingEnabled()) {
      console.debug(LOG_PREFIX + message, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    if (isDebugLoggingEnabled()) {
      console.log(LOG_PREFIX + message, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(LOG_PREFIX + message, ...args);
  },
  error: (message: string, ...args: unknown[]): void => {
    console.error(LOG_PREFIX + message, ...args);
  },
  time: (label: string): void => {
    if (isDebugLoggingEnabled()) {
      console.time(LOG_PREFIX + label);
    }
  },
  timeEnd: (label: string): void => {
    if (isDebugLoggingEnabled()) {
      console.timeEnd(LOG_PREFIX + label);
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
 * Get all PSPs, orchestrators, and TSPs as a single array.
 * @param pspConfig - The PSP configuration object.
 * @returns Array of all providers.
 */
export function getAllProviders(pspConfig: PSPConfig): PSP[] {
  const psps = pspConfig.psps ?? [];
  const orchestrators = pspConfig.orchestrators?.list ?? [];
  const tsps = pspConfig.tsps?.list ?? [];
  return [...psps, ...orchestrators, ...tsps];
}

/**
 * Measure async execution time of a function
 */
export async function measureAsync<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  logger.time(label);
  try {
    return await fn();
  } finally {
    logger.timeEnd(label);
  }
}

/**
 * Error handling utilities
 */
export const errorUtils = {
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
      const attempts = Math.max(1, maxAttempts);
      let lastError = new Error('Retry attempts exhausted');

      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === attempts) {
            throw lastError;
          }

          logger.warn(
            `Attempt ${attempt} failed, retrying in ${delay}ms:`,
            error,
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    };
  },
};
