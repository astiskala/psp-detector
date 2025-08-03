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
      <div class="popup-container">
        <div class="popup-header">
          <img id="psp-image" alt="PSP logo" style="display: none;" />
          <div class="status-icon" id="status-icon" style="display: none;">
            📊
          </div>
          <div class="header-content">
            <h1 id="psp-name">Detecting PSP...</h1>
          </div>
        </div>
        <div class="popup-body">
          <div class="loading-state" id="loading-state">
            <div class="loading-spinner"></div>
            <p>Analyzing payment providers...</p>
          </div>
          <div id="content-state" style="display: none;">
            <div id="psp-detected-domain" style="display: none;">
              <h3>Detected domain</h3>
              <div id="psp-detection-details"></div>
            </div>
            <div id="psp-description">
              Please wait while we identify the Payment Service Provider.
            </div>
            <div id="psp-notice"></div>
            <div id="psp-url">
              <a href="#" target="_blank">Learn more</a>
            </div>
          </div>
        </div>
      </div>
    `;

    const requiredElementIds = [
      'psp-name',
      'psp-description',
      'psp-notice',
      'psp-url',
      'psp-image',
      'loading-state',
      'content-state',
      'status-icon',
    ];

    requiredElementIds.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error(`Element ${id} not found`);
      }
    });

    // Check for popup-container by class
    const popupContainer = document.querySelector('.popup-container');
    if (!popupContainer) {
      throw new Error('Element popup-container not found');
    }

    elements = {
      name: document.getElementById('psp-name')!,
      description: document.getElementById('psp-description')!,
      notice: document.getElementById('psp-notice')!,
      url: document.getElementById('psp-url')!,
      image: document.getElementById('psp-image')!,
      container: document.querySelector('.popup-container')!,
      loadingState: document.getElementById('loading-state')!,
      contentState: document.getElementById('content-state')!,
      statusIcon: document.getElementById('status-icon')!,
    };

    service = new UIService();
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
    expect(elements.name?.textContent).toBe('TestPSP');
    expect(elements.description?.textContent).toBe('summary');
    expect(elements.notice?.textContent).toBe('notice');
    expect(elements.notice?.style.display).toBe('block');
    expect(elements.url?.querySelector('a')?.href).toBe('https://test.com/');
    expect((elements.image as HTMLImageElement)?.alt).toBe('TestPSP logo');
  });

  it('should show no PSP detected', () => {
    service.showNoPSPDetected();
    expect(elements.name?.textContent).toBe('No PSP detected');
    expect(elements.notice?.style.display).toBe('none');
  });

  it('should show error', () => {
    service.showError();
    expect(elements.name?.textContent).toBe('Error');
    expect(elements.notice?.style.display).toBe('none');
  });

  it('should show PSP detection disabled', () => {
    service.showPSPDetectionDisabled();
    expect(elements.name?.textContent).toBe('PSP detection disabled');
    expect(elements.description?.textContent).toBe(
      'PSP detection has been disabled on this website for performance or compatibility reasons.',
    );

    expect(elements.notice?.style.display).toBe('none');
    expect(elements.url?.querySelector('a')?.textContent).toBe(
      'Suggest Improvement',
    );

    expect(elements.url?.querySelector('a')?.href).toBe(
      'mailto:psp-detector@adamstiskala.com',
    );

    expect((elements.image as HTMLImageElement)?.alt).toBe(
      'PSP detection disabled logo',
    );
  });

  it('should handle missing DOM elements gracefully', () => {
    // Remove all elements to simulate missing DOM
    document.body.innerHTML = '';

    expect(() => new UIService()).toThrow('Element psp-name not found');
  });

  it('should update PSP display with detection details', () => {
    const psp: PSP = {
      name: TypeConverters.toPSPName('TestPSP')!,
      regex: TypeConverters.toRegexPattern('test')!,
      url: TypeConverters.toURL('https://test.com')!,
      image: 'test',
      summary: 'Test payment processor',
      notice: 'Test notice',
    };
    const detectionInfo = {
      method: 'matchString',
      value: 'stripe.com',
    };

    service.updatePSPDisplay(psp, detectionInfo);

    expect(elements.name?.textContent).toBe('TestPSP');
    expect(elements.description?.textContent).toBe('Test payment processor');

    // Check detection details
    const detectedDomain = document.getElementById('psp-detected-domain');
    const detectionDetails = document.getElementById('psp-detection-details');

    expect(detectedDomain?.style.display).toBe('block');
    expect(detectionDetails?.textContent).toBe('stripe.com');

    const header = detectedDomain?.querySelector('h3');
    expect(header?.textContent).toBe('Detected via Match String');
  });

  it('should update PSP display with regex detection details', () => {
    const psp: PSP = {
      name: TypeConverters.toPSPName('TestPSP')!,
      regex: TypeConverters.toRegexPattern('test')!,
      url: TypeConverters.toURL('https://test.com')!,
      image: 'test',
      summary: 'Test payment processor',
      notice: 'Test notice',
    };
    const detectionInfo = {
      method: 'regex',
      value: '/stripe[.-]?(js|checkout)/i',
    };

    service.updatePSPDisplay(psp, detectionInfo);

    // Check detection details
    const detectedDomain = document.getElementById('psp-detected-domain');
    const detectionDetails = document.getElementById('psp-detection-details');

    expect(detectedDomain?.style.display).toBe('block');
    expect(detectionDetails?.textContent).toBe('/stripe[.-]?(js|checkout)/i');

    const header = detectedDomain?.querySelector('h3');
    expect(header?.textContent).toBe('Detected via Regex Pattern');
  });

  it('should hide detection details when no detection info provided', () => {
    const psp: PSP = {
      name: TypeConverters.toPSPName('TestPSP')!,
      regex: TypeConverters.toRegexPattern('test')!,
      url: TypeConverters.toURL('https://test.com')!,
      image: 'test',
      summary: 'Test payment processor',
      notice: 'Test notice',
    };

    service.updatePSPDisplay(psp);

    const detectedDomain = document.getElementById('psp-detected-domain');
    expect(detectedDomain?.style.display).toBe('none');
  });
});
