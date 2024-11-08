let cachedPspConfig = null
let detectedPsp = null
let currentTabId = null
let tabPsps = {}

let eligibleUrls =
  /^https:\/\/(?!.*(google\.com|mozilla\.org|microsoft\.com|linkedin\.com|zoom\.us|salesforce\.com|monday\.com|myworkday\.com))/
const defaultIcons = {
  16: 'images/default_16.png',
  48: 'images/default_48.png',
  128: 'images/default_128.png'
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detectPsp') {
    detectedPsp = message.data.psp
    if (detectedPsp) {
      if (message.data.tabId == currentTabId) {
        tabPsps[currentTabId] = detectedPsp
        setPspIcon()
      }
    } else {
      chrome.action.setIcon({ path: defaultIcons })
    }
  }

  if (message.action === 'getPsp') {
    sendResponse({ psp: detectedPsp })
  }

  if (message.action === 'getTabId') {
    sendResponse({ tabId: sender.tab.id })
  }
})

chrome.tabs.onActivated.addListener(tabInfo => {
  currentTabId = tabInfo.tabId

  // Reset to default
  detectedPsp = null;
  chrome.action.setIcon({ path: defaultIcons })

  chrome.tabs.get(currentTabId, function (tab) {
    // Run on any HTTPS website, excluding extension galleries
    if (tab && eligibleUrls.test(tab.url)) {
      detectedPsp = tabPsps[currentTabId]
      if (!detectedPsp) {
        executeContentScript(currentTabId)
      }

      setPspIcon()
    }
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setIcon({ path: defaultIcons })
    tabPsps[tabId] = null
  }

  if (changeInfo.status === 'complete' && tab && tab.url) {
    // Run on any HTTPS website, excluding extension galleries
    if (eligibleUrls.test(tab.url)) {
      executeContentScript(tabId)
    } else {
      chrome.action.setIcon({ path: defaultIcons })
    }
  }
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  delete tabPsps[tabId]
})

function executeContentScript (tabId) {
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      files: ['content.js']
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          `Failed to inject content script on tab ${tabId}`,
          chrome.runtime.lastError.message
        )
      }
    }
  )
}

function setPspIcon () {
  if (cachedPspConfig) {
    applyPspIcon(cachedPspConfig)
  } else {
    fetch(chrome.runtime.getURL('psp-config.json'))
      .then(response => response.json())
      .then(pspConfig => {
        cachedPspConfig = pspConfig
        applyPspIcon(pspConfig)
      })
      .catch(error => {
        console.error('Error loading the JSON config', error)
      })
  }
}

function applyPspIcon (pspConfig) {
  const psp = pspConfig.psps.find(p => p.name === detectedPsp)
  if (psp && psp.image) {
    const icons = {
      16: `images/${psp.image}_16.png`,
      48: `images/${psp.image}_48.png`,
      128: `images/${psp.image}_128.png`
    }

    chrome.action.setIcon({ path: icons })
  }
}
