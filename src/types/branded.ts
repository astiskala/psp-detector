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
 * Branded type creation and validation helpers
 */
export const PSPNameHelpers = {
  create: (name: string): PSPName => {
    if (!name || name.trim().length === 0) {
      throw new Error('PSP name cannot be empty');
    }

    return name as PSPName;
  },
  isValid: (name: string): name is PSPName => {
    return Boolean(name && name.trim().length > 0);
  },
};

export const TabIdHelpers = {
  create: (id: number): TabId => {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error('Tab ID must be a non-negative integer');
    }

    return id as TabId;
  },
  isValid: (id: number): id is TabId => {
    return Number.isInteger(id) && id >= 0;
  },
};

export const URLHelpers = {
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

export const RegexPatternHelpers = {
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
 * Type conversion utilities for safe branded type creation
 */
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
  toURL: (url: string): URL | null => {
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
};
