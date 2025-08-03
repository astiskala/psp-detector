import {
  logger,
  debouncedMutation,
  memoryUtils,
} from '../lib/utils';

/**
 * Service for observing DOM mutations and triggering callbacks.
 * @class
 */
export class DOMObserverService {
  private observer: MutationObserver | null = null;
  private onMutationCallback: (() => void) | null = null;
  private isObserving = false;

  /**
   * Initialize the observer with a callback
   */
  public initialize(callback: () => void, debounceMs = 2000): void {
    try {
      this.onMutationCallback = debouncedMutation(callback, debounceMs);
      this.observer = new MutationObserver((mutations) => {
        if (!this.isObserving || !this.onMutationCallback) return;

        try {
          for (const mutation of mutations) {
            if (
              mutation.type === 'childList' &&
              mutation.addedNodes.length > 0
            ) {
              this.onMutationCallback();
              break;
            }
          }
        } catch (mutationError) {
          logger.error('DOM mutation processing failed', mutationError);
        }
      });
    } catch (initError) {
      logger.error('DOM observer initialization failed', initError);
    }
  }

  /**
   * Start observing DOM mutations
   */
  public startObserving(): void {
    if (!this.observer || this.isObserving) return;
    const start = (): void => {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        return;
      }

      try {
        this.observer!.observe(document.body, {
          childList: true,
          subtree: true,
        });

        this.isObserving = true;
        logger.debug('DOM observer started');
      } catch (startError) {
        logger.error('Failed to start DOM observer', startError);
      }
    };

    start();
  }

  /**
   * Stop observing DOM mutations
   */
  public stopObserving(): void {
    if (!this.observer || !this.isObserving) return;
    try {
      this.observer.disconnect();
      this.isObserving = false;
      logger.debug('DOM observer stopped');
    } catch (stopError) {
      logger.error('Failed to stop DOM observer', stopError);
    }
  }

  /**
   * Clean up the observer
   */
  public cleanup(): void {
    const cleanupFunctions = [
      (): void => this.stopObserving(),
      (): void => {
        this.observer = null;
      },
      (): void => {
        this.onMutationCallback = null;
      },
    ];

    memoryUtils.cleanup(cleanupFunctions);
  }

  /**
   * Check if the observer is currently active
   */
  public isActive(): boolean {
    return this.isObserving;
  }
}
