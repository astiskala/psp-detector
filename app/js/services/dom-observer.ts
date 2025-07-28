import { debounce, logger } from '../lib/utils';

export class DOMObserverService {
    private observer: MutationObserver | null = null;
    private onMutationCallback: (() => void) | null = null;
    private isObserving = false;

    /**
     * Initialize the observer with a callback
     * @param callback - Function to call when mutations are observed
     * @param debounceMs - Debounce time in milliseconds
     */
    public initialize(callback: () => void, debounceMs = 2000): void {
        this.onMutationCallback = debounce(callback, debounceMs);

        this.observer = new MutationObserver(mutations => {
            if (!this.isObserving || !this.onMutationCallback) {
                return;
            }

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    this.onMutationCallback();
                    break;
                }
            }
        });
    }

    /**
     * Start observing DOM mutations
     */
    public startObserving(): void {
        if (!this.observer || this.isObserving) {
            return;
        }

        const start = () => {
            if (!document.body) {
                document.addEventListener('DOMContentLoaded', start, { once: true });
                return;
            }
            try {
                this.observer!.observe(document.body, {
                    childList: true,
                    subtree: true
                });
                this.isObserving = true;
                logger.debug('DOM observer started');
            } catch (error) {
                logger.error('Failed to start DOM observer:', error);
            }
        };
        start();
    }

    /**
     * Stop observing DOM mutations
     */
    public stopObserving(): void {
        if (!this.observer || !this.isObserving) {
            return;
        }

        try {
            this.observer.disconnect();
            this.isObserving = false;
            logger.debug('DOM observer stopped');
        } catch (error) {
            logger.error('Failed to stop DOM observer:', error);
        }
    }

    /**
     * Clean up the observer
     */
    public cleanup(): void {
        this.stopObserving();
        this.observer = null;
        this.onMutationCallback = null;
    }

    /**
     * Check if the observer is currently active
     */
    public isActive(): boolean {
        return this.isObserving;
    }
}
