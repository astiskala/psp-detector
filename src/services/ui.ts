import type { PSP } from "../types";
import { createSafeUrl, logger } from "../lib/utils";

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
   * @return {void}
   */
  private initializeDOMElements(): void {
    const elementIds = ["name", "description", "notice", "url", "image"];
    elementIds.forEach((id) => {
      const element = document.getElementById(`psp-${id}`);
      if (!element) {
        throw new Error(`Element psp-${id} not found`);
      }
      this.elements[id] = element;
    });
  }

  /**
   * Update UI with PSP information
   * @param {PSP} psp - PSP configuration object
   * @return {void}
   */
  public updatePSPDisplay(psp: PSP): void {
    try {
      this.updateTextContent("name", psp.name);
      this.updateTextContent("description", psp.summary);
      this.updateNoticeSection(psp.notice);
      this.updateLearnMoreLink(psp.url);
      this.updateImage(psp.image, psp.name);
    } catch (error) {
      logger.error("Failed to update PSP display:", error);
      this.showError();
    }
  }

  /**
   * Show no PSP detected state
   * @return {void}
   */
  public showNoPSPDetected(): void {
    this.updateTextContent("name", "No PSP detected");
    this.updateTextContent(
      "description",
      "The Payment Service Provider could not be determined. Please ensure you have navigated to the website's checkout page.",
    );
    this.elements.notice.style.display = "none";
    this.updateTextContent("notice", "");
    this.updateLearnMoreLink(
      "mailto:psp-detector@adamstiskala.com",
      "Suggest Improvement",
    );
    this.updateImage("default", "No PSP detected");
  }

  /**
   * Show PSP detection disabled state for exempt domains
   * @return {void}
   */
  public showPSPDetectionDisabled(): void {
    this.updateTextContent("name", "PSP detection disabled");
    this.updateTextContent(
      "description",
      "PSP detection has been disabled on this website for performance or compatibility reasons.",
    );
    this.elements.notice.style.display = "none";
    this.updateTextContent("notice", "");
    this.updateLearnMoreLink(
      "mailto:psp-detector@adamstiskala.com",
      "Suggest Improvement",
    );
    this.updateImage("default", "PSP detection disabled");
  }

  /**
   * Show error state
   * @return {void}
   */
  public showError(): void {
    this.updateTextContent("name", "Error");
    this.updateTextContent(
      "description",
      "An error occurred while loading PSP information. Please try again later.",
    );
    this.elements.notice.style.display = "none";
    this.updateImage("default", "Error");
  }

  /**
   * Update text content of an element
   * @private
   * @param {string} elementId - Element ID
   * @param {string} content - Text content
   * @return {void}
   */
  private updateTextContent(elementId: string, content: string): void {
    if (this.elements[elementId]) {
      this.elements[elementId].textContent = content;
    }
  }

  /**
   * Update notice section visibility and content
   * @private
   * @param {string} [notice] - Notice text
   * @return {void}
   */
  private updateNoticeSection(notice?: string): void {
    if (notice) {
      this.elements.notice.style.display = "block";
      this.updateTextContent("notice", notice);
    } else {
      this.elements.notice.style.display = "none";
      this.updateTextContent("notice", "");
    }
  }

  /**
   * Update learn more link
   * @private
   * @param {string} url - URL for the link
   * @param {string} [text='Learn More'] - Link text
   * @return {void}
   */
  private updateLearnMoreLink(url: string, text = "Learn More"): void {
    const anchor = document.createElement("a");
    anchor.href = createSafeUrl(url);
    anchor.textContent = text;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    this.elements.url.replaceChildren(anchor);
  }

  /**
   * Update PSP image
   * @private
   * @param {string} image - Image name
   * @param {string} alt - Alt text
   * @return {void}
   */
  private updateImage(image: string, alt: string): void {
    const imgElement = this.elements.image as HTMLImageElement;
    imgElement.src = chrome.runtime.getURL(`images/${image}_128.png`);
    imgElement.alt = `${alt} logo`;
  }
}
