;(() => {
  let cachedPspConfig = null
  let pspDetected = false
  let exemptDomains = []  // To store exempted domains

  // Function to load exempt domains from the JSON file
  const loadExemptDomains = async () => {
    try {
      const response = await fetch(chrome.runtime.getURL('exempt-domains.json'));
      const data = await response.json();
      exemptDomains = data.exemptDomains;
    } catch (error) {
      console.error('Failed to load exempt domains:', error);
    }
  };

  // Update eligibleUrls regex dynamically based on exemptDomains
  const getEligibleUrls = () => {
    const domainPattern = exemptDomains.join('|');
    return new RegExp(`^https://(?!.*(${domainPattern}))`);
  };

  // Detect PSP on the page by matching content against regexes
  const detectPsp = () => {
    if (pspDetected) return;
    const eligibleUrls = getEligibleUrls();
    if (!eligibleUrls.test(document.URL)) return;

    const pageContent = `${document.URL}\n\n${document.documentElement.outerHTML}`
    let detectedPsp = null

    for (let psp of cachedPspConfig.psps) {
      try {
        const regex = new RegExp(psp.regex, 'i');
        if (regex.test(pageContent)) {
          detectedPsp = psp.name
          break
        }
      } catch (error) {
        console.error(`Invalid regex pattern for PSP "${psp.name}":`, error);
      }
    }

    if (detectedPsp) {
      chrome.runtime.sendMessage({ action: 'getTabId' }, response => {
        const pspData = { psp: detectedPsp, tabId: response.tabId }
        chrome.runtime.sendMessage({ action: 'detectPsp', data: pspData })
      });

      pspDetected = true;

      if (observer) {
        observer.disconnect();
      }
    }
  }

  // Initialize MutationObserver with debounce
  let observer;
  const initMutationObserver = () => {
    let debounceTimeout
    observer = new MutationObserver(mutationsList => {
      clearTimeout(debounceTimeout)
      debounceTimeout = setTimeout(() => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            detectPsp() // Re-run PSP detection on DOM changes
            break
          }
        }
      }, 3000)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const main = async () => {
    await loadExemptDomains();  // Load exempt domains before running any other logic
    chrome.runtime.sendMessage({ action: 'getPspConfig' }, response => {
      if (response && response.config) {
        cachedPspConfig = response.config;
        detectPsp();
        initMutationObserver();
      } else {
        console.error('Failed to load PSP config');
      }
    });
  }

  main()
})();