import type { PSP } from '../types';
import { createSafeUrl, logger } from '../lib/utils';

export class UIService {
    private elements: Record<string, HTMLElement>;

    constructor() {
        this.elements = {};
        this.initializeDOMElements();
    }

    /**
     * Initialize DOM element references
     */
    private initializeDOMElements(): void {
        const elementIds = ['name', 'description', 'notice', 'url', 'image'];
        elementIds.forEach(id => {
            const element = document.getElementById(`psp-${id}`);
            if (!element) {
                throw new Error(`Element psp-${id} not found`);
            }
            this.elements[id] = element;
        });
    }

    /**
     * Update UI with PSP information
     * @param psp - PSP configuration object
     */
    public updatePSPDisplay(psp: PSP): void {
        try {
            this.updateTextContent('name', psp.name);
            this.updateTextContent('description', psp.summary);

            // Handle notice section
            this.updateNoticeSection(psp.notice);

            // Update learn more link
            this.updateLearnMoreLink(psp.url);

            // Update image
            this.updateImage(psp.image, psp.name);
        } catch (error) {
            logger.error('Failed to update PSP display:', error);
            this.showError();
        }
    }

    /**
     * Show no PSP detected state
     */
    public showNoPSPDetected(): void {
        this.updateTextContent('name', 'No PSP detected');
        this.updateTextContent(
            'description',
            "The Payment Service Provider could not be determined. Please ensure you have navigated to the website's checkout page."
        );

        this.elements.notice.style.display = 'none';
        this.updateTextContent('notice', '');

        this.updateLearnMoreLink(
            'mailto:psp-detector@adamstiskala.com',
            'Suggest Improvement'
        );

        this.updateImage('default', 'No PSP detected');
    }

    /**
     * Show error state
     */
    public showError(): void {
        this.updateTextContent('name', 'Error');
        this.updateTextContent(
            'description',
            'An error occurred while loading PSP information. Please try again later.'
        );
        this.elements.notice.style.display = 'none';
        this.updateImage('default', 'Error');
    }

    /**
     * Update text content of an element
     */
    private updateTextContent(elementId: string, content: string): void {
        if (this.elements[elementId]) {
            this.elements[elementId].textContent = content;
        }
    }

    /**
     * Update notice section visibility and content
     */
    private updateNoticeSection(notice?: string): void {
        if (notice) {
            this.elements.notice.style.display = 'block';
            this.updateTextContent('notice', notice);
        } else {
            this.elements.notice.style.display = 'none';
            this.updateTextContent('notice', '');
        }
    }

    /**
     * Update learn more link
     */
    private updateLearnMoreLink(url: string, text = 'Learn More'): void {
        const anchor = document.createElement('a');
        anchor.href = createSafeUrl(url);
        anchor.textContent = text;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';

        this.elements.url.replaceChildren(anchor);
    }

    /**
     * Update PSP image
     */
    private updateImage(image: string, alt: string): void {
        const imgElement = this.elements.image as HTMLImageElement;
        imgElement.src = chrome.runtime.getURL(`images/${image}_128.png`);
        imgElement.alt = `${alt} logo`;
    }
}
