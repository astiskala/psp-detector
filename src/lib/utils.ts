import type { PSP, PSPConfig } from '../types/psp';

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Normalizes a user-facing URL for DOM usage and blocks protocols that would
 * be unsafe in popup links.
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
 * Compiles a case-insensitive regex and converts invalid patterns into a
 * logged `null` result so bad data never breaks detection startup.
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
 * Wraps `fetch` with a local timeout while still honoring an optional caller
 * abort signal.
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
 * Debounces noisy mutation-driven callbacks while optionally allowing a
 * leading-edge invocation.
 */
export function debouncedMutation<T extends (...args: unknown[]) => unknown>(
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
 * Flattens the configured PSP, orchestrator, and TSP groups into a single
 * precedence-ordered provider list.
 */
export function getAllProviders(pspConfig: PSPConfig): PSP[] {
  const psps = pspConfig.psps ?? [];
  const orchestrators = pspConfig.orchestrators?.list ?? [];
  const tsps = pspConfig.tsps?.list ?? [];
  return [...psps, ...orchestrators, ...tsps];
}

/**
 * Times an async operation using the shared logger so slow extension flows can
 * be profiled in debug mode without affecting production logs.
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

export const errorUtils = {
  /**
   * Executes an async operation and returns a caller-provided fallback after
   * logging the failure context.
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
   * Wraps an async operation with bounded retries for transient extension or
   * network failures.
   */
  withRetry: <T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    delay = 1000,
  ): (() => Promise<T>) => {
    return async (): Promise<T> => {
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

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    };
  },
};
