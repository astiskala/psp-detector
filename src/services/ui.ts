import type { PSP, PSPConfig, StoredTabPsp } from '../types';
import { createSafeUrl, logger } from '../lib/utils';

/**
 * UI service for updating the popup with PSP information.
 * @class
 */
export class UIService {
  private elements: Record<string, HTMLElement>;

  constructor() {
    this.elements = {};
    this.initializeDOMElements();
  }

  /**
   * Initialize DOM element references
   * @private
   */
  private initializeDOMElements(): void {
    const elementIds = ['name', 'description', 'notice', 'url', 'image'];
    elementIds.forEach((id) => {
      const element = document.getElementById(`psp-${id}`);
      if (!element) {
        throw new Error(`Element psp-${id} not found`);
      }

      this.elements[id] = element;
    });

    // Detection details elements (optional)
    const detectionElement = document.getElementById('psp-detected-domain');
    const detectionDetailsElement = document.getElementById('psp-detection-details');
    const subtitleElement = document.getElementById('psp-subtitle');
    if (detectionElement && detectionDetailsElement) {
      this.elements['detectedDomain'] = detectionElement;
      this.elements['detectionDetails'] = detectionDetailsElement;
    }

    if (subtitleElement) {
      this.elements['subtitle'] = subtitleElement;
    }

    // Required UI elements
    const uiElements = {
      container: '.popup-container',
      loadingState: '#loading-state',
      contentState: '#content-state',
      statusIcon: '#status-icon',
    } as const satisfies Record<string, string>;

    for (const [id, selector] of Object.entries(uiElements)) {
      const element = document.querySelector(selector);
      if (element) {
        this.elements[id] = element as HTMLElement;
      } else {
        logger.warn(`Optional UI element not found: ${selector}`);
      }
    }
  }

  /**
   * Update UI with PSP information
   */
  public updatePSPDisplay(
    psp: PSP,
    detectionInfo?: { method: string; value: string },
  ): void {
    try {
      this.hideLoadingState();
      this.showContentState();
      this.setUIState('success');

      this.updateTextContent('name', psp.name);
      this.updateTextContent('subtitle', 'Detected on current tab');
      this.updateTextContent('description', psp.summary);
      this.updateNoticeSection(psp.notice);
      this.updateLearnMoreLink(psp.url, `Learn more about ${psp.name}`);
      this.updateImage(psp.image, psp.name);
      this.showPSPImage();

      // Update detection details if provided
      if (detectionInfo) {
        this.updateDetectionDetails(detectionInfo);
      } else {
        this.hideDetectionDetails();
      }
    } catch (error) {
      logger.error('Failed to update PSP display:', error);
      this.showError();
    }
  }

  public renderMultiplePSPs(
    psps: StoredTabPsp[],
    config: PSPConfig,
  ): void {
    this.hideLoadingState();
    this.showContentState();

    const description = this.elements['description'];
    if (!description) {
      return;
    }

    description.replaceChildren();

    if (psps.length === 0) {
      this.showNoPSPDetected();
      return;
    }

    const list = document.createElement('div');
    list.className = 'psp-list';

    for (const storedPsp of psps) {
      const pspConfig = this.findPspConfig(storedPsp.psp, config);
      const card = this.buildPspCard(storedPsp, pspConfig);
      list.appendChild(card);
    }

    description.appendChild(list);
    const noun = psps.length === 1 ? 'PSP' : 'PSPs';
    this.updateTextContent('name', `${psps.length} ${noun} detected`);
    this.updateTextContent('subtitle', 'Detected on current tab');
    this.updateNoticeSection('');
    this.updateLearnMoreLink(
      'mailto:psp-detector@adamstiskala.com',
      'Suggest Improvement',
    );

    this.updateImage('default', 'PSP detection');
    this.showPSPImage();
    this.hideDetectionDetails();
  }

  /**
   * Show no PSP detected state
   */
  public showNoPSPDetected(): void {
    this.hideLoadingState();
    this.showContentState();
    this.setUIState('no-psp');
    this.showStatusIcon('🔍');
    this.hideDetectionDetails();

    this.updateTextContent('name', 'No PSP detected');
    this.updateTextContent('subtitle', 'No known payment signals found');
    this.updateTextContent(
      'description',
      'The Payment Service Provider could not be determined. Please ensure you have navigated to the website\'s checkout page.',
    );

    this.updateNoticeSection('Detection relies on identifying PSP frontend components (such as JavaScript or iframes). Integrations that do not use such techniques cannot be detected by this extension.');

    this.updateLearnMoreLink(
      'mailto:psp-detector@adamstiskala.com',
      'Suggest Improvement',
    );

    this.updateImage('default', 'No PSP detected');
  }

  /**
   * Show PSP detection disabled state for exempt domains
   *
   */
  public showPSPDetectionDisabled(): void {
    this.hideLoadingState();
    this.showContentState();
    this.setUIState('disabled');
    this.showStatusIcon('🚫');
    this.hideDetectionDetails();

    this.updateTextContent('name', 'PSP detection disabled');
    this.updateTextContent('subtitle', 'Domain is marked as exempt');
    this.updateTextContent(
      'description',
      'PSP detection has been disabled on this website for performance or compatibility reasons.',
    );

    this.updateNoticeSection('');
    this.updateLearnMoreLink(
      'mailto:psp-detector@adamstiskala.com',
      'Suggest Improvement',
    );

    this.updateImage('default', 'PSP detection disabled');
  }

  /**
   * Show error state
   *
   */
  public showError(): void {
    this.hideLoadingState();
    this.showContentState();
    this.setUIState('error');
    this.showStatusIcon('⚠️');
    this.hideDetectionDetails();

    this.updateTextContent('name', 'Error');
    this.updateTextContent('subtitle', 'Unable to read detection state');
    this.updateTextContent(
      'description',
      'An error occurred while loading PSP information. Please try again later.',
    );

    this.updateNoticeSection('');
    this.updateImage('default', 'Error');
  }

  /**
   * Update text content of an element safely
   * @private
   */
  private updateTextContent(elementId: string, content: string): void {
    const element = this.elements[elementId];
    if (element) {
      element.textContent = content;
    } else {
      logger.warn(`Element ${elementId} not found for text update`);
    }
  }

  /**
   * Update notice section visibility and content safely
   * @private
   */
  private updateNoticeSection(notice?: string): void {
    const noticeElement = this.elements['notice'];
    if (!noticeElement) {
      logger.warn('Notice element not found');
      return;
    }

    if (notice) {
      noticeElement.style.display = 'block';
      noticeElement.classList.add('show');
      this.updateTextContent('notice', notice);
    } else {
      noticeElement.style.display = 'none';
      noticeElement.classList.remove('show');
      this.updateTextContent('notice', '');
    }
  }

  /**
   * Update learn more link safely
   * @private
   */
  private updateLearnMoreLink(url: string, text = 'Learn More'): void {
    const linkElement = this.elements['url'];
    if (!linkElement) {
      logger.warn('URL element not found');
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = createSafeUrl(url);
    anchor.textContent = text;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    linkElement.replaceChildren(anchor);
  }

  /**
   * Update PSP image safely
   * @private
   */
  private updateImage(image: string, alt: string): void {
    const imgElement = this.elements['image'];
    if (imgElement && imgElement instanceof HTMLImageElement) {
      const fallbackImageSrc = chrome.runtime.getURL('images/default_128.png');
      imgElement.onerror = (): void => {
        if (imgElement.src !== fallbackImageSrc) {
          imgElement.src = fallbackImageSrc;
          return;
        }

        this.showStatusIcon('🏦');
      };

      imgElement.src = chrome.runtime.getURL(`images/${image}_128.png`);
      imgElement.alt = `${alt} logo`;
    } else {
      logger.warn('Image element not found or not an img element');
    }
  }

  /**
   * Hide loading state and show content
   * @private
   *
   */
  private hideLoadingState(): void {
    if (this.elements['loadingState']) {
      this.elements['loadingState'].style.display = 'none';
    }
  }

  /**
   * Show content state
   * @private
   *
   */
  private showContentState(): void {
    if (this.elements['contentState']) {
      this.elements['contentState'].style.display = 'block';
    }
  }

  /**
   * Set UI state by adding appropriate CSS class
   * @private
   *
   */
  private setUIState(state: string): void {
    if (!this.elements['container']) return;

    // Remove existing state classes
    this.elements['container'].classList.remove('error-state', 'no-psp-state', 'disabled-state');

    // Add new state class
    if (state !== 'success') {
      this.elements['container'].classList.add(`${state}-state`);
    }
  }

  /**
   * Show status icon instead of PSP image
   * @private
   *
   */
  private showStatusIcon(icon: string): void {
    if (this.elements['image']) {
      this.elements['image'].style.display = 'none';
    }

    if (this.elements['statusIcon']) {
      this.elements['statusIcon'].style.display = 'flex';
      this.elements['statusIcon'].textContent = icon;
    }
  }

  /**
   * Show PSP image and hide status icon
   * @private
   *
   */
  private showPSPImage(): void {
    if (this.elements['statusIcon']) {
      this.elements['statusIcon'].style.display = 'none';
    }

    if (this.elements['image']) {
      this.elements['image'].style.display = 'block';
    }
  }

  /**
   * Update detection details section
   * @private
   *
   */
  private updateDetectionDetails(detectionInfo: {
    method: string;
    value: string;
  }): void {
    if (!this.elements['detectedDomain'] || !this.elements['detectionDetails']) {
      return;
    }

    const methodLabel = detectionInfo.method === 'matchString'
      ? 'Match String'
      : 'Regex Pattern';

    this.elements['detectionDetails'].textContent =
      `Detection Signal: ${detectionInfo.value}`;

    this.elements['detectedDomain'].style.display = 'block';

    // Update the header if needed
    const header = this.elements['detectedDomain'].querySelector('h3');
    if (header) {
      header.textContent = `Detection Source: ${methodLabel}`;
    }
  }

  /**
   * Hide detection details section
   * @private
   *
   */
  private hideDetectionDetails(): void {
    if (this.elements['detectedDomain']) {
      this.elements['detectedDomain'].style.display = 'none';
    }
  }

  private findPspConfig(pspName: string, config: PSPConfig): PSP | undefined {
    const providers: PSP[] = [
      ...config.psps,
      ...(config.orchestrators?.list ?? []),
      ...(config.tsps?.list ?? []),
    ];
    return providers.find((provider) => provider.name === pspName);
  }

  private buildPspCard(
    stored: StoredTabPsp,
    config: PSP | undefined,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'psp-card';

    if (config?.image) {
      const img = document.createElement('img');
      const fallbackImageSrc = chrome.runtime.getURL('images/default_48.png');
      img.onerror = (): void => {
        if (img.src !== fallbackImageSrc) {
          img.src = fallbackImageSrc;
          return;
        }

        img.remove();
      };

      img.src = chrome.runtime.getURL(`images/${config.image}_48.png`);
      img.alt = stored.psp;
      img.className = 'psp-card-logo';
      card.appendChild(img);
    }

    const name = document.createElement('p');
    name.className = 'psp-card-name';
    name.textContent = stored.psp;
    card.appendChild(name);

    if (stored.detectionInfo) {
      const evidence = document.createElement('div');
      evidence.className = 'detection-evidence';
      const { value, sourceType } = stored.detectionInfo;
      const sourceRow = this.buildEvidenceRow(
        'Detection Source',
        sourceType ?? 'unknown',
        'source-pill',
      );
      const signalRow = this.buildEvidenceRow(
        'Detection Signal',
        value,
        'match-value',
      );
      evidence.appendChild(sourceRow);
      evidence.appendChild(signalRow);
      card.appendChild(evidence);
    }

    return card;
  }

  private buildEvidenceRow(
    labelText: string,
    valueText: string,
    valueClassName: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'evidence-row';

    const label = document.createElement('span');
    label.className = 'evidence-label';
    label.textContent = `${labelText}:`;

    const value = document.createElement('code');
    value.className = valueClassName;
    value.textContent = valueText;
    value.title = valueText;

    row.appendChild(label);
    row.appendChild(value);
    return row;
  }
}
