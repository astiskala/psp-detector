import { logger } from '../lib/utils';

/**
 * Watches for payment-relevant DOM changes and batches them before triggering
 * a new detection pass.
 */
export class DOMObserverService {
  private observer: MutationObserver | null = null;
  private isObserving = false;
  private pendingMutations: MutationRecord[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceCallback: ((mutations: MutationRecord[]) => void) | null =
    null;

  /**
   * Creates the underlying `MutationObserver` and debounces callback delivery
   * so dynamic checkout pages do not trigger detection on every small change.
   * All relevant mutations accumulated during the debounce window are passed
   * together so no individual mutation is silently dropped.
   */
  public initialize(
    callback: (mutations?: MutationRecord[]) => void,
    debounceMs = 2000,
  ): void {
    if (this.observer) {
      this.cleanup();
    }

    try {
      this.debounceCallback = (mutations: MutationRecord[]): void =>
        callback(mutations);

      this.observer = new MutationObserver((mutations): void => {
        if (!this.isObserving || !this.debounceCallback) return;

        try {
          const relevantMutations = mutations.filter(
            (mutation) =>
              (mutation.type === 'childList' &&
                mutation.addedNodes.length > 0 &&
                this.isRelevantNode(mutation.addedNodes)) ||
              (mutation.type === 'attributes' &&
                this.isRelevantAttributeMutation(mutation)),
          );

          if (relevantMutations.length === 0) return;

          this.pendingMutations.push(...relevantMutations);

          if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const accumulated = this.pendingMutations;
            this.pendingMutations = [];
            this.debounceCallback?.(accumulated);
          }, debounceMs);
        } catch (mutationError) {
          logger.error('DOM mutation processing failed', mutationError);
        }
      });
    } catch (initError) {
      logger.error('DOM observer initialization failed', initError);
    }
  }

  /**
   * Filters new nodes down to elements that can carry provider-identifying
   * URLs such as scripts, iframes, forms, and relevant resource hints.
   */
  private isRelevantNode(nodeList: NodeList): boolean {
    for (const node of nodeList) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const isRelevantLink =
          element.tagName === 'LINK' &&
          this.isRelevantLinkElement(element as HTMLLinkElement);

        // Check for payment-related elements
        if (
          element.tagName === 'SCRIPT' ||
          element.tagName === 'IFRAME' ||
          element.tagName === 'FORM' ||
          isRelevantLink ||
          element.querySelector?.(
            'script, iframe, form, link[rel="preconnect"], ' +
              'link[rel="dns-prefetch"], link[rel="preload"], ' +
              'link[rel="modulepreload"]',
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private isRelevantLinkElement(link: HTMLLinkElement): boolean {
    const relTokens = link.rel
      .toLowerCase()
      .split(/\s+/u)
      .filter((token) => token.length > 0);
    if (relTokens.length === 0) {
      return false;
    }

    const rel = new Set(relTokens);
    if (rel.has('preconnect') || rel.has('dns-prefetch')) {
      return true;
    }

    if (
      (rel.has('preload') || rel.has('modulepreload')) &&
      link.as === 'script'
    ) {
      return true;
    }

    return false;
  }

  private isRelevantAttributeMutation(mutation: MutationRecord): boolean {
    const target = mutation.target;
    if (!(target instanceof Element)) {
      return false;
    }

    const attributeName = mutation.attributeName ?? '';
    if (attributeName.length === 0) {
      return false;
    }

    switch (target.tagName) {
      case 'SCRIPT':
      case 'IFRAME':
        return attributeName === 'src';
      case 'FORM':
        return attributeName === 'action';
      case 'LINK':
        if (
          attributeName !== 'href' &&
          attributeName !== 'rel' &&
          attributeName !== 'as'
        ) {
          return false;
        }

        return this.isRelevantLinkElement(target as HTMLLinkElement);
      default:
        return false;
    }
  }

  /** Starts observing once `document.body` exists. */
  public startObserving(): void {
    if (!this.observer || this.isObserving) return;
    const start = (): void => {
      if (document.body === null) {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        return;
      }

      try {
        const observer = this.observer;
        if (observer === null) {
          return;
        }

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'href', 'action', 'rel', 'as'],
        });

        this.isObserving = true;
        logger.debug('DOM observer started');
      } catch (startError) {
        logger.error('Failed to start DOM observer', startError);
      }
    };

    start();
  }

  /** Stops mutation delivery without destroying the observer instance. */
  public stopObserving(): void {
    if (!this.observer || !this.isObserving) return;
    try {
      this.observer.disconnect();
      this.isObserving = false;
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      this.pendingMutations = [];
      logger.debug('DOM observer stopped');
    } catch (stopError) {
      logger.error('Failed to stop DOM observer', stopError);
    }
  }

  /** Fully releases the observer and its callback references. */
  public cleanup(): void {
    this.stopObserving();
    this.observer = null;
    this.debounceCallback = null;
  }
}
