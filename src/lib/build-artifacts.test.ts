import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('build artifacts', () => {
  it('options.js is emitted as classic script (no ESM export tokens)', () => {
    const optionsBundle = path.join(__dirname, '..', '..', 'dist', 'options.js');
    expect(fs.existsSync(optionsBundle)).toBe(true);

    const code = fs.readFileSync(optionsBundle, 'utf8');
    expect(code.includes('export {')).toBe(false);
    expect(code.includes('export default')).toBe(false);
  });

  it('popup.js is emitted as classic script (no ESM import/export syntax)', () => {
    const popupBundle = path.join(__dirname, '..', '..', 'dist', 'popup.js');
    expect(fs.existsSync(popupBundle)).toBe(true);

    const code = fs.readFileSync(popupBundle, 'utf8');
    expect(code.includes('export {')).toBe(false);
    expect(code.includes('export default')).toBe(false);
    expect(code.includes('import ')).toBe(false);
    expect(() => {
      new vm.Script(code);
    }).not.toThrow();
  });

  it('onboarding.js is emitted as classic script (no ESM import/export syntax)', () => {
    const onboardingBundle = path.join(
      __dirname,
      '..',
      '..',
      'dist',
      'onboarding.js',
    );
    expect(fs.existsSync(onboardingBundle)).toBe(true);

    const code = fs.readFileSync(onboardingBundle, 'utf8');
    expect(code.includes('export {')).toBe(false);
    expect(code.includes('export default')).toBe(false);
    expect(code.includes('import ')).toBe(false);
    expect(() => {
      new vm.Script(code);
    }).not.toThrow();
  });

  it('popup includes a history-link action', () => {
    const popupHtml = path.join(__dirname, '..', '..', 'public', 'popup.html');
    const html = fs.readFileSync(popupHtml, 'utf8');
    expect(html.includes('id="history-link"')).toBe(true);
  });

  it('onboarding page includes host-access instructions', () => {
    const onboardingHtml = path.join(
      __dirname,
      '..',
      '..',
      'public',
      'onboarding.html',
    );
    const html = fs.readFileSync(onboardingHtml, 'utf8');
    expect(html.includes('id="grant-host-access"')).toBe(true);
    expect(html.includes('Grant site access')).toBe(true);
  });

  it('extension pages reference the shared stylesheet', () => {
    const pages = ['popup.html', 'options.html', 'onboarding.html'];

    for (const page of pages) {
      const htmlPath = path.join(__dirname, '..', '..', 'public', page);
      const html = fs.readFileSync(htmlPath, 'utf8');
      expect(html.includes('href="common.css"')).toBe(true);
    }
  });
});
