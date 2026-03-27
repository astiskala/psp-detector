import type { PSP, PSPConfig, StoredTabPsp } from '../types';
import { createSafeUrl, logger } from '../lib/utils';

type UIState = 'error' | 'no-psp' | 'disabled' | 'success';

/**
 * Owns popup DOM updates so detection and rendering concerns stay separated.
 */
export class UIService {
  private elements: Record<string, HTMLElement>;

  constructor() {
    this.elements = {};
    this.initializeDOMElements();
  }

  /**
   * Resolves the popup elements once and fails fast when required markup is
   * missing.
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

    const subtitleElement = document.getElementById('psp-subtitle');
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

  public renderMultiplePSPs(psps: StoredTabPsp[], config: PSPConfig): void {
    this.transitionToContent();

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
      const { psp, notice } = this.findPspWithContext(storedPsp.psp, config);
      const card = this.buildPspCard(storedPsp, psp, notice);
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
  }

  /** Renders the empty-state copy shown when no provider evidence is found. */
  public showNoPSPDetected(): void {
    this.transitionToContent();
    this.setUIState('no-psp');
    this.showStatusIcon('🔍');

    this.updateTextContent('name', 'No PSP detected');
    this.updateTextContent('subtitle', 'No known payment signals found');
    this.updateTextContent(
      'description',
      "The Payment Service Provider could not be determined. Please ensure you have navigated to the website's checkout page.",
    );

    this.updateNoticeSection(
      'Detection relies on identifying PSP frontend components (such as JavaScript or iframes). Integrations that do not use such techniques cannot be detected by this extension.',
    );

    this.updateLearnMoreLink(
      'mailto:psp-detector@adamstiskala.com',
      'Suggest Improvement',
    );

    this.updateImage('default', 'No PSP detected');
  }

  /**
   * Renders the exempt-domain state when detection is intentionally disabled.
   */
  public showPSPDetectionDisabled(): void {
    this.transitionToContent();
    this.setUIState('disabled');
    this.showStatusIcon('🚫');

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

  /** Renders the fallback error state for popup initialization failures. */
  public showError(): void {
    this.transitionToContent();
    this.setUIState('error');
    this.showStatusIcon('⚠️');

    this.updateTextContent('name', 'Error');
    this.updateTextContent('subtitle', 'Unable to read detection state');
    this.updateTextContent(
      'description',
      'An error occurred while loading PSP information. Please try again later.',
    );

    this.updateNoticeSection('');
    this.updateImage('default', 'Error');
  }

  private updateTextContent(elementId: string, content: string): void {
    const element = this.elements[elementId];
    if (element) {
      element.textContent = content;
    } else {
      logger.warn(`Element ${elementId} not found for text update`);
    }
  }

  private updateNoticeSection(notice?: string): void {
    const noticeElement = this.elements['notice'];
    if (!noticeElement) {
      logger.warn('Notice element not found');
      return;
    }

    if (typeof notice === 'string' && notice.length > 0) {
      noticeElement.style.display = 'block';
      this.updateTextContent('notice', notice);
    } else {
      noticeElement.style.display = 'none';
      this.updateTextContent('notice', '');
    }
  }

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
   * Swaps the provider image while falling back to the bundled default art if
   * a logo asset is missing.
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

  private hideLoadingState(): void {
    if (this.elements['loadingState']) {
      this.elements['loadingState'].style.display = 'none';
    }
  }

  private showContentState(): void {
    if (this.elements['contentState']) {
      this.elements['contentState'].style.display = 'block';
    }
  }

  /** Switches the popup shell from its loading skeleton to rendered content. */
  private transitionToContent(): void {
    this.hideLoadingState();
    this.showContentState();
  }

  /** Applies state classes that drive popup styling for non-success flows. */
  private setUIState(state: UIState): void {
    if (!this.elements['container']) return;

    // Remove existing state classes
    this.elements['container'].classList.remove(
      'error-state',
      'no-psp-state',
      'disabled-state',
    );

    // Add new state class
    if (state !== 'success') {
      this.elements['container'].classList.add(`${state}-state`);
    }
  }

  private showStatusIcon(icon: string): void {
    if (this.elements['image']) {
      this.elements['image'].style.display = 'none';
    }

    if (this.elements['statusIcon']) {
      this.elements['statusIcon'].style.display = 'flex';
      this.elements['statusIcon'].textContent = icon;
    }
  }

  private showPSPImage(): void {
    if (this.elements['statusIcon']) {
      this.elements['statusIcon'].style.display = 'none';
    }

    if (this.elements['image']) {
      this.elements['image'].style.display = 'block';
    }
  }

  private findPspWithContext(
    pspName: string,
    config: PSPConfig,
  ): { psp: PSP | undefined; notice?: string | undefined } {
    // 1. Check direct PSPs
    const psp = config.psps.find((p) => p.name === pspName);
    if (psp) return { psp, notice: psp.notice };

    // 2. Check Orchestrators
    const orchestrators = config.orchestrators?.list ?? [];
    const orchestrator = orchestrators.find((p) => p.name === pspName);

    if (orchestrator) {
      return {
        psp: orchestrator,
        notice: orchestrator.notice ?? config.orchestrators?.notice,
      };
    }

    // 3. Check TSPs
    const tsps = config.tsps?.list ?? [];
    const tsp = tsps.find((p) => p.name === pspName);
    if (tsp) {
      return {
        psp: tsp,
        notice: tsp.notice ?? config.tsps?.notice,
      };
    }

    return { psp: undefined };
  }

  private buildPspCard(
    stored: StoredTabPsp,
    config: PSP | undefined,
    contextNotice?: string,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'psp-card';

    if (typeof config?.image === 'string' && config.image.length > 0) {
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

    if (typeof contextNotice === 'string' && contextNotice.length > 0) {
      const notice = document.createElement('div');
      notice.className = 'psp-card-notice';
      notice.textContent = contextNotice;
      card.appendChild(notice);
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
