import { debounce, logger } from "../lib/utils";

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
    this.onMutationCallback = debounce(callback, debounceMs);
    this.observer = new MutationObserver((mutations) => {
      if (!this.isObserving || !this.onMutationCallback) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          this.onMutationCallback();
          break;
        }
      }
    });
  }

  /**
   * Start observing DOM mutations
   * @return {void}
   */
  public startObserving(): void {
    if (!this.observer || this.isObserving) return;
    const start = () => {
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", start, { once: true });
        return;
      }
      try {
        this.observer!.observe(document.body, {
          childList: true,
          subtree: true,
        });
        this.isObserving = true;
        logger.debug("DOM observer started");
      } catch (error) {
        logger.error("Failed to start DOM observer:", error);
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
      logger.debug("DOM observer stopped");
    } catch (error) {
      logger.error("Failed to stop DOM observer:", error);
    }
  }

  /**
   * Clean up the observer
   * @return {void}
   */
  public cleanup(): void {
    this.stopObserving();
    this.observer = null;
    this.onMutationCallback = null;
  }

  /**
   * Check if the observer is currently active
   * @return {boolean} True if observing, false otherwise
   */
  public isActive(): boolean {
    return this.isObserving;
  }
}
