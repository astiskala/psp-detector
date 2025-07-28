import fs from 'fs';
import path from 'path';

const configPath = path.resolve(__dirname, '../../psp-config.json');
const imagesDir = path.resolve(__dirname, '../../images');

describe('PSP image assets', () => {
    let config: any;
    beforeAll(() => {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    });

    it('should have images for every PSP in config', () => {
        for (const psp of config.psps) {
            for (const size of [16, 48, 128]) {
                const imgPath = path.join(imagesDir, `${psp.image}_${size}.png`);
                expect(fs.existsSync(imgPath)).toBe(true);
            }
        }
    });

    it('should have valid regex for every PSP and not match every website', () => {
        for (const psp of config.psps) {
            let regex: RegExp | null = null;
            try {
                regex = new RegExp(psp.regex, 'i');
            } catch (e) {
                throw new Error(`Invalid regex for PSP '${psp.name}': ${psp.regex}`);
            }
            // Should not match a generic URL like google.com or example.com
            expect(regex.test('https://google.com')).toBe(false);
            expect(regex.test('https://example.com')).toBe(false);
            // Should not match empty string
            expect(regex.test('')).toBe(false);
        }
    });
});
