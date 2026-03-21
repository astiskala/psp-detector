/**
 * Compile-time brands used to distinguish semantically different primitives.
 */
export type PSPName = string & { readonly __brand: 'PSPName' };
export type TabId = number & { readonly __brand: 'TabId' };
export type URL = string & { readonly __brand: 'URL' };
export type RegexPattern = string & { readonly __brand: 'RegexPattern' };

/** Runtime validators for constructing branded values from untrusted inputs. */
export const TypeConverters = {
  /**
   * Accepts only non-empty provider names so empty detection results never get
   * branded as valid PSP identifiers.
   */
  toPSPName: (name: string): PSPName | null => {
    if (!name || name.trim().length === 0) {
      return null;
    }

    return name as PSPName;
  },

  /**
   * Accepts only non-negative integer tab ids returned by the browser APIs.
   */
  toTabId: (id: number): TabId | null => {
    if (!Number.isInteger(id) || id < 0) {
      return null;
    }

    return id as TabId;
  },

  /**
   * Brands only syntactically valid absolute URLs.
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
   * Brands only regex strings that the JS runtime can compile successfully.
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
