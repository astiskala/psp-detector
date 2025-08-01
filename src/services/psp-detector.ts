import type { PSP, PSPConfig, PSPName, URL } from '../types';
import { PSPDetectionResult, TypeConverters } from '../types';
import { safeCompileRegex, logger } from '../lib/utils';

/**
 * Service for detecting Payment Service Providers (PSPs) on a page.
 * @class
 */
export class PSPDetectorService {
  private pspConfig: PSPConfig | null = null;
  private exemptDomains: string[] = [];

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
   * Set the exempt domains list
   * @param {string[]} domains - Array of exempt domain strings
   * @return {void}
   */
  public setExemptDomains(domains: string[]): void {
    this.exemptDomains = domains || [];
  }

  /**
   * Detect PSP on the current page
   * @param {string} url - The URL to check
   * @param {string} content - The page content to scan
   * @return {PSPDetectionResult} Detection result with type safety
   */
  public detectPSP(url: string, content: string): PSPDetectionResult {
    if (!this.pspConfig) {
      logger.warn('PSP detector not properly initialized');
      return PSPDetectionResult.error(
        new Error('PSP detector not properly initialized'),
        'detectPSP',
      );
    }

    const brandedURL = TypeConverters.toURL(url);
    if (!brandedURL) {
      return PSPDetectionResult.error(
        new Error(`Invalid URL: ${url}`),
        'url_validation',
      );
    }

    logger.time('exemptDomainsCheck');

    // Check if the top-level window URL contains any exempt domains
    let urlToCheck = url;
    try {
      // In browser context, use window.top.location.href as specified in
      // requirements. But only if it's not localhost (test environment)
      if (typeof window !== 'undefined' && window.top && window.top.location) {
        const topUrl = window.top.location.href;
        if (!topUrl.includes('localhost')) {
          urlToCheck = topUrl;
        }
      }
    } catch {
      // window.top might not be accessible due to cross-origin restrictions
      // Fall back to using the provided URL
    }

    if (this.exemptDomains.some((domain) => urlToCheck.includes(domain))) {
      logger.timeEnd('exemptDomainsCheck');
      logger.debug('URL is exempt from PSP detection:', urlToCheck);
      return PSPDetectionResult.exempt(
        'URL contains exempt domain',
        brandedURL,
      );
    }

    logger.timeEnd('exemptDomainsCheck');

    logger.time('matchStringsScanning');
    let scannedPatterns = 0;
    const pageContent = `${url}\n\n${content}`;

    for (const psp of this.pspConfig.psps) {
      scannedPatterns++;

      if (psp.matchStrings && psp.matchStrings.length > 0) {
        for (const matchString of psp.matchStrings) {
          if (pageContent.includes(matchString)) {
            logger.timeEnd('matchStringsScanning');
            logger.info('PSP detected via matchStrings:', psp.name);
            return PSPDetectionResult.detected(psp.name);
          }
        }
      }
    }

    logger.timeEnd('matchStringsScanning');

    logger.time('regexScanning');
    for (const psp of this.pspConfig.psps) {
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        logger.timeEnd('regexScanning');
        logger.info('PSP detected via regex:', psp.name);
        return PSPDetectionResult.detected(psp.name);
      }
    }

    logger.timeEnd('regexScanning');

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
    return !!this.pspConfig && this.exemptDomains.length > 0;
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
   * Check if a URL matches exempt domains (type-safe version)
   * @param {URL} url - Branded URL to check
   * @return {boolean} True if URL is exempt, false otherwise
   */
  public isURLExempt(url: URL): boolean {
    try {
      const parsedUrl = new globalThis.URL(url);
      return this.exemptDomains.some((domain) =>
        parsedUrl.hostname.includes(domain),
      );
    } catch {
      return false;
    }
  }
}
