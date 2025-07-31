/**
 * Core PSP types using branded types
 */
import type {PSPName, RegexPattern, URL} from './branded';

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

/**
 * PSP configuration containing all PSPs
 */
export interface PSPConfig {
  psps: PSP[];
}
