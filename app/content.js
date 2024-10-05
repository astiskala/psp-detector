;(() => {
  let cachedPspConfig = null
  let compiledPspRegexes = null
  const mutationDebounceDelay = 1000 // Delay for MutationObserver debounce

  // Load PSP configuration and cache it
  const loadPspConfig = async () => {
    if (cachedPspConfig) {
      return cachedPspConfig
    }
    try {
      const response = await fetch(chrome.runtime.getURL('./psp-config.json'))
      cachedPspConfig = await response.json()

      // Compile regex patterns for performance
      compiledPspRegexes = cachedPspConfig.psps.map(psp => ({
        name: psp.name,
        regex: new RegExp(psp.regex, 'i') // Pre-compile the regex pattern
      }))

      return cachedPspConfig
    } catch (error) {
      console.error('Error loading the JSON config', error)
      throw error
    }
  }

  // Detect PSP on the page by matching content against regexes
  const detectPsp = () => {
    const pageContent = `${document.URL}\n\n${document.documentElement.outerHTML}`

    let detectedPsp = null
    for (let { name, regex } of compiledPspRegexes) {
      if (regex.test(pageContent)) {
        detectedPsp = name
        break
      }
    }

    if (detectedPsp) {
      chrome.runtime.sendMessage({ action: 'getTabId' }, response => {
        const pspData = { psp: detectedPsp, tabId: response.tabId }
        chrome.runtime.sendMessage({ action: 'detectPsp', data: pspData })
      })
    }
  }

  // Initialize MutationObserver with debounce
  const initMutationObserver = () => {
    let debounceTimeout
    const observer = new MutationObserver(mutationsList => {
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
    try {
      await loadPspConfig() // Load and cache PSP config
      detectPsp() // Initial PSP detection
      initMutationObserver() // Set up DOM change observer
    } catch (error) {
      console.error('Error initializing PSP detection', error)
    }
  }

  // Run the main function
  main()
})()
