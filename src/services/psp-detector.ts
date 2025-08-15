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
   * Detect PSP on the current page with enhanced error handling and validation
   */
  public detectPSP(url: string, content: string): PSPDetectionResult {
    if (!this.pspConfig) {
      logger.warn('PSP detector not properly initialized');
      return PSPDetectionResult.error(
        new Error('PSP detector not properly initialized'),
        'detectPSP',
      );
    }

    // Validate inputs
    if (typeof url !== 'string' || url.trim().length === 0) {
      return PSPDetectionResult.error(
        new Error('Invalid URL provided'),
        'url_validation',
      );
    }

    if (typeof content !== 'string') {
      return PSPDetectionResult.error(
        new Error('Invalid content provided'),
        'content_validation',
      );
    }

    const brandedURL = TypeConverters.toURL(url);
    if (!brandedURL) {
      return PSPDetectionResult.error(
        new Error(`Invalid URL format: ${url}`),
        'url_validation',
      );
    }

    // Check if the top-level window URL contains any exempt domains
    let urlToCheck = url;
    try {
      // In browser context, use window.top.location.href as specified in
      // requirements. But only if it's not localhost (test environment)
      if (typeof window !== 'undefined' && window.top?.location?.href) {
        const topUrl = window.top.location.href;
        if (!topUrl.includes('localhost')) {
          urlToCheck = topUrl;
        }
      }
    } catch {
      // window.top might not be accessible due to cross-origin restrictions
      // Fall back to using the provided URL
    }

    if (this.exemptDomains.length > 0 &&
        this.exemptDomains.some((domain) => urlToCheck.includes(domain))) {
      logger.debug('URL is exempt from PSP detection:', urlToCheck);
      return PSPDetectionResult.exempt(
        'URL contains exempt domain',
        brandedURL,
      );
    }

    try {
      const pageContent = `${url}\n\n${content}`;
      const providers = getAllProviders(this.pspConfig);

      if (providers.length === 0) {
        logger.warn('No PSP providers available for detection');
        return PSPDetectionResult.error(
          new Error('No PSP providers configured'),
          'config_validation',
        );
      }

      // Performance optimization: limit content size to prevent excessive
      // processing
      const maxContentSize = 1024 * 1024; // 1MB limit
      const truncatedContent = pageContent.length > maxContentSize
        ? pageContent.substring(0, maxContentSize)
        : pageContent;

      if (pageContent.length > maxContentSize) {
        logger.debug(
          `Content truncated from ${pageContent.length} to ` +
          `${maxContentSize} characters`,
        );
      }

      // First pass: Match strings (faster)
      for (const psp of providers) {
        if (psp.matchStrings?.length) {
          for (const matchString of psp.matchStrings) {
            if (truncatedContent.includes(matchString)) {
              logger.info('PSP detected via matchStrings:', psp.name);
              return PSPDetectionResult.detected(psp.name, {
                method: 'matchString',
                value: matchString,
              });
            }
          }
        }
      }

      // Second pass: Regex patterns (slower)
      for (const psp of providers) {
        try {
          if (psp.compiledRegex?.test(truncatedContent)) {
            logger.info('PSP detected via regex:', psp.name);
            return PSPDetectionResult.detected(psp.name, {
              method: 'regex',
              value: psp.regex || 'unknown',
            });
          }
        } catch (regexError) {
          logger.warn(`Regex test failed for PSP ${psp.name}:`, regexError);

          // Continue with other PSPs instead of failing completely
        }
      }

      return PSPDetectionResult.none(providers.length);
    } catch (error) {
      logger.error('Error during PSP detection:', error);
      return PSPDetectionResult.error(
        error instanceof Error ? error : new Error('Unknown detection error'),
        'detection_process',
      );
    }
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
    return !!this.pspConfig;
  }
}
