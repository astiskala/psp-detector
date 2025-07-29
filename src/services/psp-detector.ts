import type { PSP, PSPConfig, PSPName, URL } from "../types";
import { PSP_DETECTION_EXEMPT, PSPDetectionResult } from "../types";
import { safeCompileRegex, logger, TypeConverters } from "../lib/utils";

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
   * Detect PSP on the current page (enhanced version)
   * @param {string} url - The URL to check
   * @param {string} content - The page content to scan
   * @return {PSPDetectionResult} Enhanced detection result with type safety
   */
  public detectPSPEnhanced(url: string, content: string): PSPDetectionResult {
    if (!this.pspConfig || !this.exemptDomainsRegex) {
      logger.warn("PSP detector not properly initialized");
      return PSPDetectionResult.error(
        new Error("PSP detector not properly initialized"),
        "detectPSPEnhanced",
      );
    }

    const brandedURL = TypeConverters.toURL(url);
    if (!brandedURL) {
      return PSPDetectionResult.error(
        new Error(`Invalid URL: ${url}`),
        "url_validation",
      );
    }

    if (!this.exemptDomainsRegex.test(url)) {
      logger.debug("URL is exempt from PSP detection:", url);
      return PSPDetectionResult.exempt(
        "URL matches exempt domains pattern",
        brandedURL,
      );
    }

    const pageContent = `${url}\n\n${content}`;
    let scannedPatterns = 0;

    for (const psp of this.pspConfig.psps) {
      scannedPatterns++;
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        logger.info("PSP detected:", psp.name);
        return PSPDetectionResult.detected(psp.name, 1.0);
      }
    }

    return PSPDetectionResult.none(scannedPatterns);
  }

  /**
   * Detect PSP on the current page (legacy version for compatibility)
   * @param {string} url - The URL to check
   * @param {string} content - The page content to scan
   * @return {string|null} PSP name, PSP_DETECTION_EXEMPT, or null
   */
  public detectPSP(url: string, content: string): string | null {
    const result = this.detectPSPEnhanced(url, content);

    if (PSPDetectionResult.isDetected(result)) {
      return result.psp as string; // Type assertion for legacy compatibility
    }

    if (PSPDetectionResult.isExempt(result)) {
      return PSP_DETECTION_EXEMPT;
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
   * Get PSP by name (legacy method for backward compatibility)
   * @param {string} name - PSP name
   * @return {PSP|null} PSP object or null
   */
  public getPSPByName(name: string): PSP | null {
    if (!this.pspConfig) {
      return null;
    }

    return this.pspConfig.psps.find((psp) => psp.name === name) || null;
  }

  /**
   * Get PSP by branded PSP name (enhanced type-safe method)
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
