import type { PSP, PSPConfig, PSPName, URL } from "../types";
import { PSPDetectionResult, TypeConverters } from "../types";
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
   * @return {PSPDetectionResult} Detection result with type safety
   */
  public detectPSP(url: string, content: string): PSPDetectionResult {
    if (!this.pspConfig || !this.exemptDomainsRegex) {
      logger.warn("PSP detector not properly initialized");
      return PSPDetectionResult.error(
        new Error("PSP detector not properly initialized"),
        "detectPSP",
      );
    }

    const brandedURL = TypeConverters.toURL(url);
    if (!brandedURL) {
      return PSPDetectionResult.error(
        new Error(`Invalid URL: ${url}`),
        "url_validation",
      );
    }

    logger.time("exemptDomainsCheck");
    if (!this.exemptDomainsRegex.test(url)) {
      logger.timeEnd("exemptDomainsCheck");
      logger.debug("URL is exempt from PSP detection:", url);
      return PSPDetectionResult.exempt(
        "URL matches exempt domains pattern",
        brandedURL,
      );
    }
    logger.timeEnd("exemptDomainsCheck");

    logger.time("hostnameScanning");
    let scannedPatterns = 0;
    const pageContent = `${url}\n\n${content}`;

    // First, check hostname arrays (much faster)
    for (const psp of this.pspConfig.psps) {
      scannedPatterns++;

      if (psp.hostnames && psp.hostnames.length > 0) {
        for (const hostname of psp.hostnames) {
          if (pageContent.includes(hostname)) {
            logger.timeEnd("hostnameScanning");
            logger.info("PSP detected via hostname:", psp.name);
            return PSPDetectionResult.detected(psp.name);
          }
        }
      }
    }
    logger.timeEnd("hostnameScanning");

    logger.time("regexScanning");

    // Then, check regex patterns for PSPs that still use them
    for (const psp of this.pspConfig.psps) {
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        logger.timeEnd("regexScanning");
        logger.info("PSP detected via regex:", psp.name);
        return PSPDetectionResult.detected(psp.name);
      }
    }
    logger.timeEnd("regexScanning");

    return PSPDetectionResult.none(scannedPatterns);
  }

  /**
   * Precompile regex patterns for better performance
   * @private
   * @return {void}
   */
  private precompileRegexPatterns(): void {
    if (!this.pspConfig) return;

    for (const psp of this.pspConfig.psps) {
      if (psp.regex) {
        const compiled = safeCompileRegex(psp.regex);
        psp.compiledRegex = compiled === null ? undefined : compiled;
      }
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
   * Get PSP by branded PSP name
   * @param {PSPName} pspName - Branded PSP name
   * @return {PSP|null} PSP object or null
   */
  public getPSPByPSPName(pspName: PSPName): PSP | null {
    if (!this.pspConfig) {
      return null;
    }

    return this.pspConfig.psps.find((psp) => psp.name === pspName) || null;
  }

  /**
   * Check if a URL matches exempt domains pattern (type-safe version)
   * @param {URL} url - Branded URL to check
   * @return {boolean} True if URL is exempt, false otherwise
   */
  public isURLExempt(url: URL): boolean {
    if (!this.exemptDomainsRegex) {
      return false;
    }

    try {
      const parsedUrl = new globalThis.URL(url);
      return this.exemptDomainsRegex.test(parsedUrl.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Validate and convert a string to PSPName
   * @param {string} name - String to validate
   * @return {PSPName|null} Branded PSPName or null if invalid
   */
  public validatePSPName(name: string): PSPName | null {
    if (!this.pspConfig) {
      return null;
    }

    const psp = this.pspConfig.psps.find((p) => p.name === name);
    return psp ? TypeConverters.toPSPName(name) : null;
  }
}
