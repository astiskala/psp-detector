/**
 * Chrome Extension API type definitions
 * These supplement the @types/chrome package with additional type safety
 */

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: chrome.tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      origin?: string;
    }

    interface OnMessageEvent {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    }

    interface LastError {
      message?: string;
    }

    const onMessage: OnMessageEvent;
    const lastError: LastError | undefined;
    const id: string | undefined;

    function getURL(path: string): string;
    function sendMessage(
      message: unknown,
      responseCallback?: (response: unknown) => void,
    ): void;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
      windowId?: number;
    }

    interface TabActiveInfo {
      tabId: number;
      windowId: number;
    }

    interface TabChangeInfo {
      status?: string;
      url?: string;
      title?: string;
    }

    interface OnActivatedEvent {
      addListener(callback: (activeInfo: TabActiveInfo) => void): void;
    }

    interface OnUpdatedEvent {
      addListener(
        callback: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void,
      ): void;
    }

    const onActivated: OnActivatedEvent;
    const onUpdated: OnUpdatedEvent;

    function get(tabId: number): Promise<Tab>;
  }

  namespace action {
    interface TabIconDetails {
      tabId?: number;
      path?: string | { [size: string]: string };
    }

    function setIcon(details: TabIconDetails): Promise<void>;
  }

  namespace scripting {
    interface ScriptInjection {
      target: { tabId: number };
      files?: string[];
      func?: () => void;
    }

    function executeScript(injection: ScriptInjection): Promise<unknown>;
  }
}
