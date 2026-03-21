import type { PSPName, RegexPattern, URL } from './branded';

/**
 * Canonical provider record loaded from `psps.json`. The same shape is used
 * for PSPs, orchestrators, and TSPs.
 */
export interface PSP {
  name: PSPName;
  regex?: RegexPattern;
  matchStrings?: string[];
  url: URL;
  image: string;
  summary: string;
  notice?: string;
  compiledRegex?: RegExp;
}

export interface PSPGroup {
  notice: string;
  list: PSP[];
}

/**
 * Full provider dataset consumed by the detector and popup UI.
 */
export interface PSPConfig {
  psps: PSP[];
  orchestrators?: PSPGroup;
  tsps?: PSPGroup;
}
