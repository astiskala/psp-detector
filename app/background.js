let detectedPSP = null
let currentTabId = null
let tabPsps = {}

const eligibleUrls =
  /^https:\/\/(?!chrome\.google\.com\/webstore|addons\.mozilla\.org|microsoftedge\.microsoft\.com\/addons)/
const defaultIcons = {
  16: 'images/default_16.png',
  48: 'images/default_48.png',
  128: 'images/default_128.png'
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detectPSP') {
    detectedPSP = message.data.psp
    if (detectedPSP) {
      if (message.data.tabId == currentTabId) {
        tabPsps[currentTabId] = detectedPSP
        setPspIcon()
      }
    } else {
      chrome.action.setIcon({ path: defaultIcons })
    }
  }

  if (message.action === 'getPSP') {
    sendResponse({ psp: detectedPSP })
  }

  if (message.action === 'getTabId') {
    sendResponse({ tabId: sender.tab.id })
  }
})

chrome.tabs.onActivated.addListener(tabInfo => {
  currentTabId = tabInfo.tabId
  chrome.action.setIcon({ path: defaultIcons })
  chrome.tabs.get(currentTabId, function (tab) {
    // Run on any HTTPS website, excluding extension galleries
    if (tab && eligibleUrls.test(tab.url)) {
      detectedPSP = tabPsps[currentTabId]
      setPspIcon()
    }
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setIcon({ path: defaultIcons })
    tabPsps[detectedPSP] = null
  }

  if (changeInfo.status === 'complete' && tab && tab.url) {
    // Run on any HTTPS website, excluding extension galleries
    if (eligibleUrls.test(tab.url)) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      })
    } else {
      chrome.action.setIcon({ path: defaultIcons })
    }
  }
})

function setPspIcon () {
  fetch(chrome.runtime.getURL('psp-config.json'))
    .then(response => response.json())
    .then(pspConfig => {
      const psp = pspConfig.psps.find(p => p.name === detectedPSP)
      if (psp && psp.image) {
        const icons = {
          16: `images/${psp.image}_16.png`,
          48: `images/${psp.image}_48.png`,
          128: `images/${psp.image}_128.png`
        }

        chrome.action.setIcon({ path: icons })
      }
    })
    .catch(error => {
      console.error('Error loading the JSON config:', error)
    })
}
