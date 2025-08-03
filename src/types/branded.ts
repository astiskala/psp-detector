/**
 * Branded types
 * These provide compile-time type safety while being runtime primitives
 */

/**
 * Branded type definitions
 */
export type PSPName = string & { readonly __brand: 'PSPName' };
export type TabId = number & { readonly __brand: 'TabId' };
export type URL = string & { readonly __brand: 'URL' };
export type RegexPattern = string & { readonly __brand: 'RegexPattern' };

/**
 * Type conversion utilities for safe branded type creation
 */
export const TypeConverters = {
  /**
   * Safely convert string to PSPName
   */
  toPSPName: (name: string): PSPName | null => {
    if (!name || name.trim().length === 0) {
      return null;
    }

    return name as PSPName;
  },

  /**
   * Safely convert number to TabId
   */
  toTabId: (id: number): TabId | null => {
    if (!Number.isInteger(id) || id < 0) {
      return null;
    }

    return id as TabId;
  },

  /**
   * Safely convert string to URL
   */
  toURL: (url: string): URL | null => {
    try {
      new globalThis.URL(url);
      return url as URL;
    } catch {
      return null;
    }
  },

  /**
   * Safely convert string to RegexPattern
   */
  toRegexPattern: (pattern: string): RegexPattern | null => {
    try {
      new RegExp(pattern);
      return pattern as RegexPattern;
    } catch {
      return null;
    }
  },
};
