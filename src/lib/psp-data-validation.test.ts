import fs from 'node:fs';
import path from 'node:path';
import type { PSPConfig, PSP } from '../types/psp';

describe('PSP Data Validation', () => {
  let pspConfig: PSPConfig;

  const expectNonEmptyString = (value: unknown): void => {
    expect(value).toBeDefined();
    expect(typeof value).toBe('string');
    expect((value as string).trim()).not.toBe('');
  };

  const getAllProviders = (config: PSPConfig): (PSP & { type: string })[] => {
    const psps = config.psps || [];
    const orchestrators = config.orchestrators?.list || [];
    const tsps = config.tsps?.list || [];
    return [
      ...psps.map(p => ({ ...p, type: 'psp' })),
      ...orchestrators.map(p => ({ ...p, type: 'orchestrator' })),
      ...tsps.map(p => ({ ...p, type: 'tsp' })),
    ];
  };

  beforeAll(() => {
    const pspFile = path.join(__dirname, '../../public/psps.json');
    expect(fs.existsSync(pspFile)).toBe(true);

    const rawData = fs.readFileSync(pspFile, 'utf8');
    pspConfig = JSON.parse(rawData);
  });

  describe('JSON structure', () => {
    it('should have valid JSON structure', () => {
      expect(pspConfig).toBeDefined();
      expect(typeof pspConfig).toBe('object');
    });

    it('should have required top-level properties', () => {
      expect(Array.isArray(pspConfig.psps)).toBe(true);
      expect(pspConfig.orchestrators).toBeDefined();
      expect(pspConfig.tsps).toBeDefined();
    });
  });

  describe('PSP entries validation', () => {
    it('should have required fields for all providers', () => {
      const allProviders = getAllProviders(pspConfig);
      const requiredFields: (keyof PSP)[] = ['name', 'url', 'image', 'summary'];

      for (const provider of allProviders) {
        for (const field of requiredFields) {
          expectNonEmptyString(provider[field]);
        }
      }
    });

    it('should have unique provider names across all groups', () => {
      const allProviders = getAllProviders(pspConfig);
      const names = allProviders.map(p => p.name);
      const uniqueNames = new Set(names);

      if (uniqueNames.size !== names.length) {
        const duplicates: string[] = [];
        const seen = new Set<string>();

        names.forEach(name => {
          if (seen.has(name) && !duplicates.includes(name)) {
            duplicates.push(name);
          } else {
            seen.add(name);
          }
        });

        console.log('Duplicate provider names found:', duplicates);
      }

      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have valid regex patterns when provided', () => {
      const allProviders = getAllProviders(pspConfig);

      for (const provider of allProviders) {
        if (provider.regex && typeof provider.regex === 'string') {
          const compiled = new RegExp(provider.regex, 'i');
          expect(compiled).toBeInstanceOf(RegExp);
        }
      }
    });

    it('should have unique match strings within each provider', () => {
      const allProviders = getAllProviders(pspConfig);

      for (const provider of allProviders) {
        if (!Array.isArray(provider.matchStrings)) continue;

        const matchStrings = provider.matchStrings;
        const uniqueStrings = new Set(matchStrings);
        expect(uniqueStrings.size).toBe(matchStrings.length);

        for (const matchString of matchStrings) {
          expectNonEmptyString(matchString);
        }
      }
    });

    it('should have valid image references', () => {
      const allProviders = getAllProviders(pspConfig);

      allProviders.forEach(provider => {
        expect(provider.image).toBeDefined();
        expect(typeof provider.image).toBe('string');
        expect(provider.image.trim()).not.toBe('');

        // Image should be a filename without extension
        expect(provider.image).not.toContain('/');
        expect(provider.image).not.toContain('\\');
      });
    });

    it('should have valid URLs', () => {
      const allProviders = getAllProviders(pspConfig);

      for (const provider of allProviders) {
        const parsed = new URL(provider.url);
        expect(parsed.hostname).not.toBe('');
      }
    });
  });

  describe('Data integrity', () => {
    it('should have reasonable number of providers', () => {
      const allProviders = getAllProviders(pspConfig);
      expect(allProviders.length).toBeGreaterThan(0);
      expect(allProviders.length).toBeLessThan(1000); // Sanity check
    });

    it('should have PSPs as the main group', () => {
      expect(pspConfig.psps.length).toBeGreaterThan(0);
    });

    it('should have orchestrators if defined', () => {
      if (pspConfig.orchestrators?.list) {
        expect(pspConfig.orchestrators.list.length).toBeGreaterThan(0);
      }
    });

    it('should have TSPs if defined', () => {
      if (pspConfig.tsps?.list) {
        expect(pspConfig.tsps.list.length).toBeGreaterThan(0);
      }
    });
  });
});
