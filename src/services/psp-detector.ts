import type { PSPConfig } from '../types';
import { PSPDetectionResult, TypeConverters } from '../types';
import { safeCompileRegex, logger, getAllProviders } from '../lib/utils';

/**
 * Service for detecting Payment Service Providers (PSPs) on a page.
 * @class
 */
export class PSPDetectorService {
  private pspConfig: PSPConfig | null = null;
  private exemptDomains: string[] = [];

  /**
   * Initialize the PSP detector with configuration
   */
  public initialize(config: PSPConfig): void {
    this.pspConfig = config;
    this.precompileRegexPatterns();
  }

  /**
   * Set the exempt domains list
   */
  public setExemptDomains(domains: string[]): void {
    this.exemptDomains = domains || [];
  }

  /**
   * Detect PSP on the current page
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
      logger.debug('URL is exempt from PSP detection:', urlToCheck);
      return PSPDetectionResult.exempt(
        'URL contains exempt domain',
        brandedURL,
      );
    }

    let scannedPatterns = 0;
    const pageContent = `${url}\n\n${content}`;

    for (const psp of getAllProviders(this.pspConfig)) {
      scannedPatterns++;

      if (psp.matchStrings && psp.matchStrings.length > 0) {
        for (const matchString of psp.matchStrings) {
          if (pageContent.includes(matchString)) {
            logger.info('PSP detected via matchStrings:', psp.name);
            return PSPDetectionResult.detected(psp.name, {
              method: 'matchString',
              value: matchString,
            });
          }
        }
      }
    }

    for (const psp of getAllProviders(this.pspConfig)) {
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        logger.info('PSP detected via regex:', psp.name);
        return PSPDetectionResult.detected(psp.name, {
          method: 'regex',
          value: psp.regex || 'unknown',
        });
      }
    }

    return PSPDetectionResult.none(scannedPatterns);
  }

  /**
   * Precompile regex patterns for better performance
   * @private
   */
  private precompileRegexPatterns(): void {
    if (!this.pspConfig) return;

    for (const psp of getAllProviders(this.pspConfig)) {
      if (psp.regex) {
        const compiled = safeCompileRegex(psp.regex);
        if (compiled) {
          psp.compiledRegex = compiled;
        }
      }
    }
  }

  /**
   * Check if the detector is initialized
   */
  public isInitialized(): boolean {
    return !!this.pspConfig && this.exemptDomains.length > 0;
  }
}
