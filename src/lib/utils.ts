/**
 * Debounce function to limit the rate at which a function can fire
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to wait
 */

export function debounce<T extends(...args: unknown[]) => unknown>(
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
 * Error with context information
 */
export interface ContextualError extends Error {
  context?: ErrorContext;
}

/**
 * Error context interface for debugging
 */
export interface ErrorContext {
  timestamp: number;
  url?: string;
  userAgent?: string;
  tabId?: number;
  pspName?: string;
  elementCount?: number;
  mutationCount?: number;
}

/**
 * Enhanced error interface with context
 */
export interface ContextualError extends Error {
  context?: ErrorContext;
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

  // Error logging with structured data
  console.error('[PSP Detector Error]', {
    message: error.message,
    stack: error.stack,
    context: errorContext,
  });

  // In development, also log to the logger
  if (process.env.NODE_ENV === 'development') {
    logger.error('Structured error report:', {
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
        console.error('Cleanup error:', cleanupError);
        reportError(
          createContextError('Cleanup function failed', {
            component: 'memoryUtils',
            action: 'cleanup',
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
