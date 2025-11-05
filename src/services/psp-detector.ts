import type { PSPConfig, PSP } from '../types';
import { PSPDetectionResult, TypeConverters } from '../types';
import { safeCompileRegex, logger, getAllProviders } from '../lib/utils';

/**
 * Service for detecting Payment Service Providers (PSPs) on a page.
 * @class
 */
export class PSPDetectorService {
  private pspConfig: PSPConfig | null = null;
  private exemptDomains: string[] = [];

  /** Cache of flattened providers for faster lookups (populated at init) */
  private providerCache: ReturnType<typeof getAllProviders> | null = null;

  /**
   * Initialize the PSP detector with configuration
   */
  public initialize(config: PSPConfig): void {
    this.pspConfig = config;

    /* Flatten providers once and reuse – order preserved */
    this.providerCache = getAllProviders(config);
    this.precompileRegexPatterns();
  }

  /**
   * Set the exempt domains list
   */
  public setExemptDomains(domains: string[]): void {
    // Normalize & dedupe while preserving original order of first occurrence
    const seen = new Set<string>();
    this.exemptDomains = (domains || [])
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0 && !seen.has(d) && seen.add(d));
  }

  /**
   * Detect PSP on the current page with enhanced error handling and validation
   */
  public detectPSP(url: string, content: string): PSPDetectionResult {
    // Validate initialization and inputs
    const validationResult = this.validateDetectionInputs(url, content);
    if (validationResult) {
      return validationResult;
    }

    const brandedURL = TypeConverters.toURL(url)!;

    // Check for exempt domains
    const exemptResult = this.checkExemptDomains(url, brandedURL);
    if (exemptResult) {
      return exemptResult;
    }

    // Perform detection
    return this.performDetection(url, content);
  }

  /**
   * Validate detection inputs
   * @private
   */
  private validateDetectionInputs(
    url: string,
    content: string,
  ): PSPDetectionResult | null {
    if (!this.pspConfig) {
      logger.warn('PSP detector not properly initialized');
      return PSPDetectionResult.error(
        new Error('PSP detector not properly initialized'),
        'detectPSP',
      );
    }

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

    return null;
  }

  /**
   * Check if URL is in exempt domains
   * @private
   */
  private checkExemptDomains(
    url: string,
    brandedURL: string & { readonly __brand: 'URL' },
  ): PSPDetectionResult | null {
    if (this.exemptDomains.length === 0) {
      return null;
    }

    // Get the URL to check (prefer top-level window URL)
    const urlToCheck = this.getTopLevelUrl(url);

    try {
      const host = new globalThis.URL(urlToCheck).hostname.toLowerCase();
      if (this.isHostExempt(host)) {
        logger.debug('URL is exempt from PSP detection:', urlToCheck);
        return PSPDetectionResult.exempt(
          'URL contains exempt domain',
          brandedURL,
        );
      }
    } catch {
      // Fallback to legacy substring logic if URL parsing fails
      if (this.exemptDomains.some(domain => urlToCheck.includes(domain))) {
        logger.debug(
          'URL is exempt from PSP detection (fallback):',
          urlToCheck,
        );

        return PSPDetectionResult.exempt(
          'URL contains exempt domain',
          brandedURL,
        );
      }
    }

    return null;
  }

  /**
   * Get the top-level URL to check (prefer window.top if available)
   * @private
   */
  private getTopLevelUrl(url: string): string {
    try {
      const topUrl = globalThis.window?.top?.location?.href;
      if (topUrl && !topUrl.includes('localhost')) {
        return topUrl;
      }
    } catch {
      // window.top might not be accessible due to cross-origin restrictions
    }

    return url;
  }

  /**
   * Perform the actual PSP detection
   * @private
   */
  private performDetection(
    url: string,
    content: string,
  ): PSPDetectionResult {
    try {
      const pageContent = `${url}\n\n${content}`;

      /* Use cached providers if available */
      const providers = this.providerCache ||
        getAllProviders(this.pspConfig!);

      if (providers.length === 0) {
        logger.warn('No PSP providers available for detection');
        return PSPDetectionResult.error(
          new Error('No PSP providers configured'),
          'config_validation',
        );
      }

      // Truncate content if needed
      const truncatedContent = this.truncateContent(pageContent);

      // First pass: Match strings (faster)
      const matchStringResult = this.detectByMatchStrings(
        providers,
        truncatedContent,
      );
      if (matchStringResult) {
        return matchStringResult;
      }

      // Second pass: Regex patterns (slower)
      const regexResult = this.detectByRegex(providers, truncatedContent);
      if (regexResult) {
        return regexResult;
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
   * Truncate content if it exceeds max size
   * @private
   */
  private truncateContent(content: string): string {
    const maxContentSize = 1024 * 1024; // 1MB limit
    if (content.length > maxContentSize) {
      logger.debug(
        `Content truncated from ${content.length} to ` +
        `${maxContentSize} characters`,
      );

      return content.substring(0, maxContentSize);
    }

    return content;
  }

  /**
   * Detect PSP by match strings
   * @private
   */
  private detectByMatchStrings(
    providers: PSP[],
    content: string,
  ): PSPDetectionResult | null {
    for (const psp of providers) {
      if (psp.matchStrings?.length) {
        for (const matchString of psp.matchStrings) {
          if (content.includes(matchString)) {
            logger.info('PSP detected via matchStrings:', psp.name);
            return PSPDetectionResult.detected(psp.name, {
              method: 'matchString',
              value: matchString,
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Detect PSP by regex patterns
   * @private
   */
  private detectByRegex(
    providers: PSP[],
    content: string,
  ): PSPDetectionResult | null {
    for (const psp of providers) {
      try {
        if (psp.compiledRegex?.test(content)) {
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

    return null;
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

  /**
   * Determine if a hostname matches an exempt domain. Matches if:
   *  - host === domain OR host endsWith(`.${domain}`)
   */
  private isHostExempt(host: string): boolean {
    return this.exemptDomains.some((domain) =>
      host === domain || host.endsWith(`.${domain}`),
    );
  }
}
