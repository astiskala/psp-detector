/**
Compile-time brands used to distinguish semantically different primitives.
 */
export type PSPName = string & { readonly __brand: 'PSPName' };
export type TabId = number & { readonly __brand: 'TabId' };
export type URL = string & { readonly __brand: 'URL' };
export type RegexPattern = string & { readonly __brand: 'RegexPattern' };

/** Runtime validators for constructing branded values from untrusted inputs. */
export const TypeConverters = {
  /**
  Accepts only non-empty provider names so empty detection results never get
  branded as valid PSP identifiers.
   */
  toPSPName: (name: string): PSPName | undefined => {
    if (!name || name.trim().length === 0) {
      return undefined;
    }

    return name as PSPName;
  },

  /**
  Accepts only non-negative integer tab ids returned by the browser APIs.
   */
  toTabId: (id: number): TabId | undefined => {
    if (!Number.isSafeInteger(id) || id < 0) {
      return undefined;
    }

    return id as TabId;
  },

  /**
  Brands only syntactically valid absolute URLs.
   */
  toURL: (url: string): URL | undefined => {
    try {
      new globalThis.URL(url);
      return url as URL;
    } catch {
      return undefined;
    }
  },

  /**
  Brands only regex strings that the JS runtime can compile successfully.
   */
  toRegexPattern: (pattern: string): RegexPattern | undefined => {
    try {
      new RegExp(pattern);
      return pattern as RegexPattern;
    } catch {
      return undefined;
    }
  },
};
