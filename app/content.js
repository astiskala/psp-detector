;(() => {
  fetch(chrome.runtime.getURL('./psp-config.json'))
    .then(response => response.json())
    .then(pspConfig => {
      const detectPSP = () => {
        const pageContent = document.URL + '\n\n' + document.body.innerHTML

        let detectedPSP = null
        for (let psp of pspConfig.psps) {
          const regex = new RegExp(psp.regex, 'i') // Create a regex object
          if (regex.test(pageContent)) {
            detectedPSP = psp.name
            break
          }
        }

        if (detectedPSP) {
          chrome.runtime.sendMessage({ action: 'getTabId' }, response => {
            let data = { psp: detectedPSP, tabId: response.tabId }
            chrome.runtime.sendMessage({ action: 'detectPSP', data })
          })
        }
      }

      detectPSP()

      // Set up MutationObserver to listen for added elements
      const observer = new MutationObserver(mutationsList => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList') {
            if (mutation.addedNodes.length > 0) {
              detectPSP()
            }
          }
        }
      })

      const config = { childList: true, subtree: true }
      observer.observe(document.body, config)
    })
    .catch(error => {
      console.error('Error loading the JSON config:', error)
    })
})()
