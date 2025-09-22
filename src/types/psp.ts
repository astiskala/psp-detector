/**
 * Core PSP types using branded types
 */
import type { PSPName, RegexPattern, URL } from './branded';

/**
 * Payment Service Provider interface
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
 * PSP configuration containing all PSPs
 */
export interface PSPConfig {
  psps: PSP[];
  orchestrators?: PSPGroup;
  tsps?: PSPGroup;
}

/**
 * JSON-friendly PSP types (unbranded) for tools/ingestion
 * These mirror the PSP types but use plain strings to match psps.json.
 */
export interface PSPJson {
  name: string;
  regex?: string;
  matchStrings?: string[];
  url?: string;
  image?: string;
  summary?: string;
  notice?: string;
}

export interface PSPJsonGroup {
  notice?: string;
  list: PSPJson[];
}

export interface PSPJsonConfig {
  psps: PSPJson[];
  orchestrators?: PSPJsonGroup;
  tsps?: PSPJsonGroup;
}
