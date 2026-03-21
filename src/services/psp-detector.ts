import type { PSPConfig, PSPMatch } from '../types';
import { PSPDetectionResult, TypeConverters } from '../types';
import {
  safeCompileRegex,
  logger,
  getAllProviders,
  normalizeStringArray,
} from '../lib/utils';

/**
 * Runs the two-phase provider scan against the current page URL and collected
 * payment-related signals. Provider ordering is preserved so `psps.json`
 * precedence stays deterministic.
 */
export class PSPDetectorService {
  private pspConfig: PSPConfig | null = null;
  private exemptDomains: string[] = [];

  /**
   * Flattened provider list cached once so every detection uses the same order.
   */
  private providerCache: ReturnType<typeof getAllProviders> | null = null;

  private readonly maxContentSize = 1024 * 1024; // 1MB limit

  /**
   * Loads provider configuration and precompiles regex matchers ahead of the
   * first detection pass.
   */
  public initialize(config: PSPConfig): void {
    this.pspConfig = config;

    /* Flatten providers once and reuse – order preserved */
    this.providerCache = getAllProviders(config);
    this.precompileRegexPatterns();
  }

  /**
   * Replaces the exempt-domain list after normalizing case, whitespace, and
   * duplicates so host comparisons stay consistent.
   */
  public setExemptDomains(domains: string[]): void {
    this.exemptDomains = normalizeStringArray(domains);
  }

  /**
   * Returns a structured detection result for the current page. Normal
   * detection failures are reported via `PSPDetectionResult` rather than
   * throwing.
   */
  public detectPSP(url: string, content: string): PSPDetectionResult {
    const initializedError = this.ensureInitialized();
    if (initializedError) return initializedError;

    const inputError = this.validateInputs(url);
    if (inputError) return inputError;

    const brandedURL = TypeConverters.toURL(url);
    if (!brandedURL) {
      return PSPDetectionResult.error(
        new Error(`Invalid URL format: ${url}`),
        'url_validation',
      );
    }

    const urlToCheck = this.getUrlToCheck(url);
    const exemptResult = this.checkExempt(urlToCheck, brandedURL);
    if (exemptResult) return exemptResult;

    try {
      const truncatedContent = this.buildTruncatedContent(url, content);

      const providers = this.providerCache;
      if (providers === null) {
        logger.warn('PSP detector provider cache unavailable');
        return PSPDetectionResult.error(
          new Error('PSP providers are not initialized'),
          'config_validation',
        );
      }

      if (providers.length === 0) {
        logger.warn('No PSP providers available for detection');
        return PSPDetectionResult.error(
          new Error('No PSP providers configured'),
          'config_validation',
        );
      }

      const matches = this.collectAllMatches(providers, truncatedContent);
      if (matches.length === 0) {
        return PSPDetectionResult.none(providers.length);
      }

      logger.info(
        `Detected ${matches.length} PSP(s):`,
        matches.map((m) => m.psp),
      );

      return PSPDetectionResult.detected(matches);
    } catch (error) {
      logger.error('Error during PSP detection:', error);
      return PSPDetectionResult.error(
        error instanceof Error ? error : new Error('Unknown detection error'),
        'detection_process',
      );
    }
  }

  private ensureInitialized(): PSPDetectionResult | null {
    if (this.pspConfig) return null;

    logger.warn('PSP detector not properly initialized');
    return PSPDetectionResult.error(
      new Error('PSP detector not properly initialized'),
      'detectPSP',
    );
  }

  private validateInputs(
    url: string,
  ): PSPDetectionResult | null {
    if (url.trim().length === 0) {
      return PSPDetectionResult.error(
        new Error('Invalid URL provided'),
        'url_validation',
      );
    }

    return null;
  }

  private getUrlToCheck(fallbackUrl: string): string {
    let urlToCheck = fallbackUrl;

    try {
      const win = (globalThis as unknown as { window?: Window }).window;
      const topHref = win?.top?.location?.href;

      // In browser context, use window.top.location.href as specified in
      // requirements. But only if it's not localhost (test environment)
      if (
        typeof topHref === 'string' &&
        topHref.length > 0 &&
        !topHref.includes('localhost')
      ) {
        urlToCheck = topHref;
      }
    } catch (error) {
      logger.debug(
        'Unable to access window.top location, using provided URL',
        error,
      );
    }

    return urlToCheck;
  }

  private checkExempt(
    urlToCheck: string,
    brandedURL: ReturnType<typeof TypeConverters.toURL>,
  ): PSPDetectionResult | null {
    if (!brandedURL) return null;
    if (this.exemptDomains.length === 0) return null;

    try {
      const host = new globalThis.URL(urlToCheck).hostname.toLowerCase();
      if (this.isHostExempt(host)) {
        logger.debug('URL is exempt from PSP detection:', urlToCheck);
        return PSPDetectionResult.exempt(
          'URL contains exempt domain',
          brandedURL,
        );
      }
    } catch (error) {
      logger.debug(
        'Failed to parse URL for exempt check, using substring match',
        error,
      );

      if (this.exemptDomains.some(domain => urlToCheck.includes(domain))) {
        logger.debug('URL is exempt from PSP detection (fallback):', urlToCheck);
        return PSPDetectionResult.exempt(
          'URL contains exempt domain',
          brandedURL,
        );
      }
    }

    return null;
  }

  private buildTruncatedContent(url: string, content: string): string {
    const pageContent = `${url}\n\n${content}`;
    if (pageContent.length <= this.maxContentSize) return pageContent;

    logger.debug(
      `Content truncated from ${pageContent.length} to ` +
      `${this.maxContentSize} characters`,
    );

    return pageContent.substring(0, this.maxContentSize);
  }

  private collectAllMatches(
    providers: ReturnType<typeof getAllProviders>,
    content: string,
  ): PSPMatch[] {
    const matched = new Set<string>();
    const results: PSPMatch[] = [];

    // Phase 1: matchStrings (provider order preserved)
    for (const psp of providers) {
      const matchStrings = psp.matchStrings;
      if (
        matched.has(psp.name) ||
        matchStrings === undefined ||
        matchStrings.length === 0
      ) {
        continue;
      }

      for (const matchString of matchStrings) {
        if (content.includes(matchString)) {
          results.push({
            psp: psp.name,
            detectionInfo: {
              method: 'matchString',
              value: matchString,
            },
          });

          matched.add(psp.name);
          break;
        }
      }
    }

    // Phase 2: regex (only PSPs not already matched)
    for (const psp of providers) {
      if (matched.has(psp.name)) continue;

      try {
        if (psp.compiledRegex?.test(content) === true) {
          results.push({
            psp: psp.name,
            detectionInfo: {
              method: 'regex',
              value: psp.regex ?? 'unknown',
            },
          });

          matched.add(psp.name);
        }
      } catch (regexError) {
        logger.warn(`Regex test failed for PSP ${psp.name}:`, regexError);
      }
    }

    return results;
  }

  /**
   * Compiles provider regexes once during initialization so runtime detection
   * only executes prevalidated patterns.
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
   * Indicates whether provider configuration has been loaded and is ready for
   * detection.
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
