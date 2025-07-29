import type { PSP, PSPConfig } from "../types";
import { safeCompileRegex, logger } from "../lib/utils";

/**
 * Service for detecting Payment Service Providers (PSPs) on a page.
 * @class
 */
export class PSPDetectorService {
  private pspConfig: PSPConfig | null = null;
  private exemptDomainsRegex: RegExp | null = null;

  /**
   * Initialize the PSP detector with configuration
   * @param {PSPConfig} config - PSP configuration
   * @return {void}
   */
  public initialize(config: PSPConfig): void {
    this.pspConfig = config;
    this.precompileRegexPatterns();
  }

  /**
   * Set the exempt domains regex pattern
   * @param {string} pattern - Regex pattern for exempt domains
   * @return {void}
   */
  public setExemptDomainsPattern(pattern: string): void {
    try {
      this.exemptDomainsRegex = new RegExp(pattern);
    } catch (error) {
      logger.error("Invalid exempt domains pattern:", error);
      this.exemptDomainsRegex = null;
    }
  }

  /**
   * Detect PSP on the current page
   * @param {string} url - The URL to check
   * @param {string} content - The page content to scan
   * @return {string|null} PSP name or null
   */
  public detectPSP(url: string, content: string): string | null {
    if (!this.pspConfig || !this.exemptDomainsRegex) {
      logger.warn("PSP detector not properly initialized");
      return null;
    }

    if (!this.exemptDomainsRegex.test(url)) {
      logger.debug("URL is exempt from PSP detection:", url);
      return null;
    }

    const pageContent = `${url}\n\n${content}`;

    for (const psp of this.pspConfig.psps) {
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        logger.info("PSP detected:", psp.name);
        return psp.name;
      }
    }

    return null;
  }

  /**
   * Precompile regex patterns for better performance
   * @private
   * @return {void}
   */
  private precompileRegexPatterns(): void {
    if (!this.pspConfig) return;

    for (const psp of this.pspConfig.psps) {
      const compiled = safeCompileRegex(psp.regex);
      psp.compiledRegex = compiled === null ? undefined : compiled;
    }
  }

  /**
   * Check if the detector is initialized
   * @return {boolean} True if initialized, false otherwise
   */
  public isInitialized(): boolean {
    return !!this.pspConfig && !!this.exemptDomainsRegex;
  }

  /**
   * Get PSP by name
   * @param {string} name - PSP name
   * @return {PSP|null} PSP object or null
   */
  public getPSPByName(name: string): PSP | null {
    if (!this.pspConfig) {
      return null;
    }

    return this.pspConfig.psps.find((psp) => psp.name === name) || null;
  }
}
