import { UIService } from './ui';
import type { PSP } from '../types';
import { TypeConverters } from '../types';
import { setupChromeRuntimeMock, setupCleanDOM } from '../test-helpers/utilities';

// Mock chrome.runtime.getURL
setupChromeRuntimeMock();

describe('UIService', () => {
  let service: UIService;
  let elements: Record<string, HTMLElement>;

  beforeEach(() => {
    setupCleanDOM();
    document.body.innerHTML = `
      <div id="psp-name"></div>
      <div id="psp-description"></div>
      <div id="psp-notice"></div>
      <div id="psp-url"></div>
      <div id="psp-image"></div>
      <div id="loading-indicator"></div>
      <div id="no-psp-detected"></div>
      <div id="error-message"></div>
    `;

    service = new UIService();
    elements = {
      name: document.getElementById('psp-name')!,
      description: document.getElementById('psp-description')!,
      notice: document.getElementById('psp-notice')!,
      url: document.getElementById('psp-url')!,
      image: document.getElementById('psp-image')!,
      loading: document.getElementById('loading-indicator')!,
      noPsp: document.getElementById('no-psp-detected')!,
      error: document.getElementById('error-message')!,
    };
  });

  it('should update PSP display', () => {
    const psp: PSP = {
      name: TypeConverters.toPSPName('TestPSP')!,
      regex: TypeConverters.toRegexPattern('test')!,
      url: TypeConverters.toURL('https://test.com')!,
      image: 'test',
      summary: 'summary',
      notice: 'notice',
    };
    service.updatePSPDisplay(psp);
    expect(elements.name.textContent).toBe('TestPSP');
    expect(elements.description.textContent).toBe('summary');
    expect(elements.notice.textContent).toBe('notice');
    expect(elements.notice.style.display).toBe('block');
    expect(elements.url.querySelector('a')?.href).toBe('https://test.com/');
    expect((elements.image as HTMLImageElement).alt).toBe('TestPSP logo');
  });

  it('should show no PSP detected', () => {
    service.showNoPSPDetected();
    expect(elements.name.textContent).toBe('No PSP detected');
    expect(elements.notice.style.display).toBe('none');
  });

  it('should show error', () => {
    service.showError();
    expect(elements.name.textContent).toBe('Error');
    expect(elements.notice.style.display).toBe('none');
  });

  it('should show PSP detection disabled', () => {
    service.showPSPDetectionDisabled();
    expect(elements.name.textContent).toBe('PSP detection disabled');
    expect(elements.description.textContent).toBe(
      'PSP detection has been disabled on this website for performance or compatibility reasons.',
    );

    expect(elements.notice.style.display).toBe('none');
    expect(elements.url.querySelector('a')?.textContent).toBe(
      'Suggest Improvement',
    );

    expect(elements.url.querySelector('a')?.href).toBe(
      'mailto:psp-detector@adamstiskala.com',
    );

    expect((elements.image as HTMLImageElement).alt).toBe(
      'PSP detection disabled logo',
    );
  });

  it('should handle missing DOM elements gracefully', () => {
    // Remove all elements to simulate missing DOM
    document.body.innerHTML = '';

    expect(() => new UIService()).toThrow('Element psp-name not found');
  });
});
