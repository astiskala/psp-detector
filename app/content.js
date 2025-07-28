(() => {
  let cachedPspConfig = null;
  let pspDetected = false;
  let eligibleUrlsRegex = null;

  // Get the exempt domains regex from the background script
  const getExemptDomainsRegex = () => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { action: 'getExemptDomainsRegex' },
        response => {
          if (response && response.regex) {
            eligibleUrlsRegex = new RegExp(response.regex);
          }
          resolve();
        }
      );
    });
  };

  // Debounce utility for consistency
  function debounce (func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  // Cache regex compilation results
  const precompileRegex = config => {
    config.psps.forEach(psp => {
      if (!psp.compiledRegex) {
        try {
          psp.compiledRegex = new RegExp(psp.regex, 'i');
        } catch (error) {
          console.error(`Invalid regex pattern for PSP "${psp.name}":`, error);
          psp.compiledRegex = null;
        }
      }
    });
  };

  // Detect PSP on the page using precompiled regexes
  const detectPsp = () => {
    if (pspDetected || !eligibleUrlsRegex) return;
    if (!eligibleUrlsRegex.test(document.URL)) return;

    const pageContent = `${document.URL}\n\n${document.documentElement.outerHTML}`;
    let detectedPsp = null;

    for (let psp of cachedPspConfig.psps) {
      if (psp.compiledRegex && psp.compiledRegex.test(pageContent)) {
        detectedPsp = psp.name;
        break;
      }
    }

    if (detectedPsp) {
      chrome.runtime.sendMessage({ action: 'getTabId' }, response => {
        const pspData = { psp: detectedPsp, tabId: response.tabId };
        chrome.runtime.sendMessage({ action: 'detectPsp', data: pspData });
      });

      pspDetected = true;

      if (observer) {
        observer.disconnect();
      }
    }
  };

  // Initialize MutationObserver with debounce
  let observer;
  const initMutationObserver = () => {
    let debounceTimeout;
    observer = new MutationObserver(mutationsList => {
      if (pspDetected) {
        observer.disconnect();
        return;
      }
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            detectPsp();
            break;
          }
        }
      }, 2000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const main = async () => {
    await getExemptDomainsRegex();

    chrome.runtime.sendMessage({ action: 'getPspConfig' }, response => {
      if (response && response.config) {
        cachedPspConfig = response.config;
        precompileRegex(cachedPspConfig);
        detectPsp();
        initMutationObserver();
      } else {
        console.error('Failed to load PSP config');
      }
    });
  };

  main();
})();
