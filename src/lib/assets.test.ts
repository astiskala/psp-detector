import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { PSPConfig } from '../types';
import { getAllProviders, safeCompileRegex } from './utilities';

const configPath = path.resolve(__dirname, '../../public/psps.json');
const sourceImagesDirectory = path.resolve(__dirname, '../../assets/images');
const distributionImagesDirectory = path.resolve(
  __dirname,
  '../../dist/images',
);

describe('Provider image assets', () => {
  let config: PSPConfig;
  beforeAll(() => {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  });

  it('should have unique provider names across all groups', () => {
    const names = new Set();
    for (const psp of getAllProviders(config)) {
      if (names.has(psp.name)) {
        throw new Error(`Duplicate provider name found: ${psp.name}`);
      }

      names.add(psp.name);
    }
  });

  it('should have unique PSP images', () => {
    const images = new Set();
    for (const psp of config.psps) {
      if (images.has(psp.image)) {
        throw new Error(`Duplicate PSP image found: ${psp.image}`);
      }

      images.add(psp.image);
    }
  });

  it('should have all required fields for each provider', () => {
    const requiredFields: (keyof PSPConfig['psps'][number])[] = [
      'name',
      'url',
      'image',
      'summary',
    ];
    for (const psp of getAllProviders(config)) {
      for (const field of requiredFields) {
        const value = psp[field];
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(
            `Missing required field '${field}' for provider: ${JSON.stringify(psp)}`,
          );
        }
      }

      const url = new URL(psp.url);
      expect(['https:', 'http:']).toContain(url.protocol);
      expect(psp.image).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it.each([
    ['source', sourceImagesDirectory, '.png'],
    ['48px distribution', distributionImagesDirectory, '_48.png'],
    ['128px distribution', distributionImagesDirectory, '_128.png'],
  ])(
    'should have a %s image for every provider',
    (_label, directory, suffix) => {
      const missing: string[] = [];
      for (const provider of getAllProviders(config)) {
        const imgPath = path.join(directory, `${provider.image}${suffix}`);
        if (!fs.existsSync(imgPath)) {
          missing.push(`${provider.name}: ${imgPath}`);
        }
      }

      expect(missing).toEqual([]);
    },
  );

  it.each([48, 128])(
    'should generate %ipx PNGs for every provider',
    async (size) => {
      for (const provider of getAllProviders(config)) {
        const imgPath = path.join(
          distributionImagesDirectory,
          `${provider.image}_${size}.png`,
        );
        const metadata = await sharp(imgPath).metadata();
        expect({
          image: imgPath,
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
        }).toEqual({
          image: imgPath,
          width: size,
          height: size,
          format: 'png',
        });
      }
    },
  );

  it('should have nonempty detection signals for every provider', () => {
    for (const provider of getAllProviders(config)) {
      expect({
        name: provider.name,
        hasSignal:
          Boolean(provider.regex) || Boolean(provider.matchStrings?.length),
      }).toEqual({ name: provider.name, hasSignal: true });
      if (!provider.matchStrings) continue;
      for (const matchString of provider.matchStrings) {
        expect(matchString.trim()).not.toBe('');
        expect(matchString).toBe(matchString.trim());
      }
    }
  });

  it('should have valid regex for every provider without matching unrelated pages', () => {
    for (const psp of getAllProviders(config)) {
      if (!psp.regex) {
        continue;
      }

      const regex = safeCompileRegex(psp.regex);
      if (!regex) {
        throw new Error(
          `Invalid regex for provider '${psp.name}': ${psp.regex}`,
        );
      }

      // Should not match a generic URL like google.com or example.com
      expect(regex.test('https://google.com')).toBe(false);
      expect(regex.test('https://example.com')).toBe(false);

      // Should not match empty string
      expect(regex.test('')).toBe(false);
    }
  });
});
