import type { PSP, PSPConfig } from '../types';
import { safeCompileRegex, logger } from '../lib/utils';

export class PSPDetectorService {
    private pspConfig: PSPConfig | null = null;
    private exemptDomainsRegex: RegExp | null = null;

    /**
     * Initialize the PSP detector with configuration
     * @param config - PSP configuration
     */
    public initialize(config: PSPConfig): void {
        this.pspConfig = config;
        this.precompileRegexPatterns();
    }

    /**
     * Set the exempt domains regex pattern
     * @param pattern - Regex pattern for exempt domains
     */
    public setExemptDomainsPattern(pattern: string): void {
        try {
            this.exemptDomainsRegex = new RegExp(pattern);
        } catch (error) {
            logger.error('Invalid exempt domains pattern:', error);
            this.exemptDomainsRegex = null;
        }
    }

    /**
     * Detect PSP on the current page
     * @param url - The URL to check
     * @param content - The page content to scan
     */
    public detectPSP(url: string, content: string): string | null {
        if (!this.pspConfig || !this.exemptDomainsRegex) {
            logger.warn('PSP detector not properly initialized');
            return null;
        }

        if (!this.exemptDomainsRegex.test(url)) {
            logger.debug('URL is exempt from PSP detection:', url);
            return null;
        }

        const pageContent = `${url}\n\n${content}`;

        for (const psp of this.pspConfig.psps) {
            if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
                logger.info('PSP detected:', psp.name);
                return psp.name;
            }
        }

        return null;
    }

    /**
     * Precompile regex patterns for better performance
     */
    private precompileRegexPatterns(): void {
        if (!this.pspConfig) {
            return;
        }

        this.pspConfig.psps.forEach((psp: PSP) => {
            if (!psp.compiledRegex) {
                const compiled = safeCompileRegex(psp.regex);
                psp.compiledRegex = compiled === null ? undefined : compiled;
            }
        });
    }

    /**
     * Get PSP configuration by name
     * @param name - Name of the PSP
     */
    public getPSPByName(name: string): PSP | null {
        if (!this.pspConfig) {
            return null;
        }

        return this.pspConfig.psps.find((psp: PSP) => psp.name === name) || null;
    }

    /**
     * Check if detector is properly initialized
     */
    public isInitialized(): boolean {
        return this.pspConfig !== null && this.exemptDomainsRegex !== null;
    }
}
