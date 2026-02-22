import fs from 'node:fs';
import path from 'node:path';

describe('build artifacts', () => {
  it('options.js is emitted as classic script (no ESM export tokens)', () => {
    const optionsBundle = path.join(__dirname, '..', '..', 'dist', 'options.js');
    expect(fs.existsSync(optionsBundle)).toBe(true);

    const code = fs.readFileSync(optionsBundle, 'utf8');
    expect(code.includes('export {')).toBe(false);
    expect(code.includes('export default')).toBe(false);
  });

  it('popup includes a history-link action', () => {
    const popupHtml = path.join(__dirname, '..', '..', 'public', 'popup.html');
    const html = fs.readFileSync(popupHtml, 'utf8');
    expect(html.includes('id="history-link"')).toBe(true);
  });
});
