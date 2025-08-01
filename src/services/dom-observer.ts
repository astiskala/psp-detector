import {
  logger,
  reportError,
  createContextError,
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
   * @param {() => void} callback - Function to call when mutations are observed
   * @param {number} [debounceMs=2000] - Debounce time in milliseconds
   * @return {void}
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
          console.error('DOM mutation error:', mutationError);
          reportError(
            createContextError('DOM mutation processing failed', {
              component: 'DOMObserverService',
              action: 'processMutations',
            }),
          );
        }
      });
    } catch (initError) {
      console.error('DOM observer init error:', initError);
      reportError(
        createContextError('DOM observer initialization failed', {
          component: 'DOMObserverService',
          action: 'initialize',
        }),
      );
    }
  }

  /**
   * Start observing DOM mutations
   * @return {void}
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
        console.error('DOM observer start error:', startError);
        reportError(
          createContextError('Failed to start DOM observer', {
            component: 'DOMObserverService',
            action: 'startObserving',
          }),
        );
      }
    };

    start();
  }

  /**
   * Stop observing DOM mutations
   * @return {void}
   */
  public stopObserving(): void {
    if (!this.observer || !this.isObserving) return;
    try {
      this.observer.disconnect();
      this.isObserving = false;
      logger.debug('DOM observer stopped');
    } catch (stopError) {
      console.error('DOM observer stop error:', stopError);
      reportError(
        createContextError('Failed to stop DOM observer', {
          component: 'DOMObserverService',
          action: 'stopObserving',
        }),
      );
    }
  }

  /**
   * Clean up the observer
   * @return {void}
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
   * @return {boolean} True if observing, false otherwise
   */
  public isActive(): boolean {
    return this.isObserving;
  }
}
