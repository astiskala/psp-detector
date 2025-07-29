/**
 * Debounce function to limit the rate at which a function can fire
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to wait
 */
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
    return new URL(url).toString();
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
 * Create error with context for better debugging
 * @param message - Error message
 * @param context - Additional context for the error
 */
export function createContextError(
  message: string,
  context?: Record<string, unknown>,
): Error {
  const error = new Error(message);
  if (context) {
    Object.assign(error, { context });
  }
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
