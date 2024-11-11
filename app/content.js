;(() => {
  let cachedPspConfig = null
  let pspDetected = false  // Flag to track if PSP has already been detected
  const mutationDebounceDelay = 3000 // Delay for MutationObserver debounce

  // Detect PSP on the page by matching content against regexes
  const detectPsp = () => {
    if (pspDetected) return;  // Skip if PSP is already detected

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

      // Mark PSP as detected to stop further checks
      pspDetected = true;

      // Stop observing mutations since PSP is already detected
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
      }, mutationDebounceDelay)
    })

    // Observe the entire document for DOM changes
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // Main logic
  const main = async () => {
    chrome.runtime.sendMessage({ action: 'getPspConfig' }, response => {
      if (response && response.config) {
        cachedPspConfig = response.config;
        detectPsp();  // Run the initial PSP detection
        initMutationObserver();  // Start observing DOM mutations
      } else {
        console.error('Failed to load PSP config');
      }
    });
  }

  // Run the main function
  main()
})();
