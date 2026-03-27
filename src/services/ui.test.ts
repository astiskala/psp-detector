import { UIService } from './ui';
import { type PSPName, type URL, TypeConverters } from '../types';
import {
  setupChromeRuntimeMock,
  setupCleanDOM,
} from '../test-helpers/utilities';

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`${id} not found`);
  return el;
}

function requireQuery(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`${selector} not found`);
  return el;
}

function requirePSPName(name: string): PSPName {
  const result = TypeConverters.toPSPName(name);
  if (!result) throw new Error(`Invalid PSP name: ${name}`);
  return result;
}

function requireURL(url: string): URL {
  const result = TypeConverters.toURL(url);
  if (!result) throw new Error(`Invalid URL: ${url}`);
  return result;
}

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
            <p id="psp-subtitle">Analyzing current page</p>
          </div>
        </div>
        <div class="popup-body">
          <div class="loading-state" id="loading-state">
            <div class="loading-spinner"></div>
            <p>Analyzing payment providers...</p>
          </div>
          <div id="content-state" style="display: none;">
            <div id="psp-description">
              Please wait while we identify the Payment Service Provider.
            </div>
            <div id="psp-notice"></div>
            <div id="psp-url">
              <a href="#" target="_blank">Learn more</a>
            </div>
            <button id="history-link" type="button">View History</button>
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
      name: requireElement('psp-name'),
      description: requireElement('psp-description'),
      notice: requireElement('psp-notice'),
      url: requireElement('psp-url'),
      image: requireElement('psp-image'),
      container: requireQuery('.popup-container'),
      loadingState: requireElement('loading-state'),
      contentState: requireElement('content-state'),
      statusIcon: requireElement('status-icon'),
    };

    service = new UIService();
  });

  it('should show no PSP detected', () => {
    service.showNoPSPDetected();
    expect(elements['name']?.textContent).toBe('No PSP detected');
    expect(elements['notice']?.style.display).toBe('block');
  });

  it('should show error', () => {
    service.showError();
    expect(elements['name']?.textContent).toBe('Error');
    expect(elements['notice']?.style.display).toBe('none');
  });

  it('should show PSP detection disabled', () => {
    service.showPSPDetectionDisabled();
    expect(elements['name']?.textContent).toBe('PSP detection disabled');
    expect(elements['description']?.textContent).toBe(
      'PSP detection has been disabled on this website for performance or compatibility reasons.',
    );

    expect(elements['notice']?.style.display).toBe('none');
    expect(elements['url']?.querySelector('a')?.textContent).toBe(
      'Suggest Improvement',
    );

    expect(elements['url']?.querySelector('a')?.href).toBe(
      'mailto:psp-detector@adamstiskala.com',
    );

    expect((elements['image'] as HTMLImageElement)?.alt).toBe(
      'PSP detection disabled logo',
    );
  });

  it('should handle missing DOM elements gracefully', () => {
    // Remove all elements to simulate missing DOM
    document.body.innerHTML = '';

    expect(() => new UIService()).toThrow('Element psp-name not found');
  });

  it('renders multiple PSP cards with labeled source and signal evidence', () => {
    service.renderMultiplePSPs(
      [
        {
          psp: 'Stripe',
          detectionInfo: {
            method: 'matchString',
            value: 'js.stripe.com',
            sourceType: 'scriptSrc',
          },
        },
      ],
      {
        psps: [
          {
            name: requirePSPName('Stripe'),
            matchStrings: ['js.stripe.com'],
            url: requireURL('https://stripe.com'),
            image: 'stripe',
            summary: 'Stripe summary',
          },
        ],
      },
    );

    expect(elements['name']?.textContent).toBe('1 PSP detected');
    expect(document.querySelectorAll('.psp-card')).toHaveLength(1);
    expect(document.querySelectorAll('.evidence-label')[0]?.textContent).toBe(
      'Detection Source:',
    );

    expect(document.querySelectorAll('.evidence-label')[1]?.textContent).toBe(
      'Detection Signal:',
    );

    expect(document.querySelector('.source-pill')?.textContent).toBe(
      'scriptSrc',
    );
    expect(document.querySelector('.match-value')?.textContent).toBe(
      'js.stripe.com',
    );
  });

  it('renders a notice within the PSP card when present in config', () => {
    const noticeText = 'Shopify notice text';
    service.renderMultiplePSPs(
      [
        {
          psp: 'Shopify Payments',
          detectionInfo: {
            method: 'matchString',
            value: 'checkout.shopifycs.com',
            sourceType: 'scriptSrc',
          },
        },
      ],
      {
        psps: [
          {
            name: requirePSPName('Shopify Payments'),
            matchStrings: ['checkout.shopifycs.com'],
            url: requireURL('https://shopify.com'),
            image: 'shopify',
            summary: 'Shopify summary',
            notice: noticeText,
          },
        ],
      },
    );

    const cardNotice = document.querySelector('.psp-card-notice');
    expect(cardNotice).not.toBeNull();
    expect(cardNotice?.textContent).toBe(noticeText);
  });

  it('renders group notices for orchestrators', () => {
    const groupNoticeText = 'Orchestrator group notice';
    service.renderMultiplePSPs(
      [
        {
          psp: 'Primer',
          detectionInfo: {
            method: 'matchString',
            value: 'sdk.primer.io',
            sourceType: 'scriptSrc',
          },
        },
      ],
      {
        psps: [],
        orchestrators: {
          notice: groupNoticeText,
          list: [
            {
              name: requirePSPName('Primer'),
              matchStrings: ['sdk.primer.io'],
              url: requireURL('https://primer.io'),
              image: 'primer',
              summary: 'Primer summary',
            },
          ],
        },
      },
    );

    const cardNotice = document.querySelector('.psp-card-notice');
    expect(cardNotice).not.toBeNull();
    expect(cardNotice?.textContent).toBe(groupNoticeText);
  });

  it('does not crash when orchestrators or tsps are missing from config', () => {
    expect(() => {
      service.renderMultiplePSPs(
        [
          {
            psp: 'Unknown PSP',
            detectionInfo: {
              method: 'matchString',
              value: 'unknown',
              sourceType: 'scriptSrc',
            },
          },
        ],
        {
          psps: [],
          // orchestrators and tsps are missing
        },
      );
    }).not.toThrow();
  });

  it('renders group notices for TSPs', () => {
    const groupNoticeText = 'TSP group notice';
    service.renderMultiplePSPs(
      [
        {
          psp: 'Cloudbeds',
          detectionInfo: {
            method: 'matchString',
            value: 'hotels.cloudbeds.com',
            sourceType: 'scriptSrc',
          },
        },
      ],
      {
        psps: [],
        tsps: {
          notice: groupNoticeText,
          list: [
            {
              name: requirePSPName('Cloudbeds'),
              matchStrings: ['hotels.cloudbeds.com'],
              url: requireURL('https://cloudbeds.com'),
              image: 'cloudbeds',
              summary: 'Cloudbeds summary',
            },
          ],
        },
      },
    );

    const cardNotice = document.querySelector('.psp-card-notice');
    expect(cardNotice).not.toBeNull();
    expect(cardNotice?.textContent).toBe(groupNoticeText);
  });
});
