let cachedPspConfig = null
let detectedPsp = null
let currentTabId = null
let tabPsps = {}

let eligibleUrls = /^https:\/\/(?!.*(google\.com|mozilla\.org|microsoft\.com|chatgpt\.com|linkedin\.com|zoom\.us|salesforce\.com|monday\.com|myworkday\.com))/
const defaultIcons = {
  16: 'images/default_16.png',
  48: 'images/default_48.png',
  128: 'images/default_128.png'
}

// Debounce function to prevent excessive calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPspConfig') {
    fetchAndCachePspConfig().then(({ config }) => {
      sendResponse({ config });
    });
    return true; // Keeps the message channel open for async response
  }

  if (message.action === 'detectPsp') {
    detectedPsp = message.data.psp
    if (detectedPsp) {
      if (message.data.tabId == currentTabId) {
        tabPsps[currentTabId] = detectedPsp
        debouncedSetPspIcon()
      }
    } else {
      chrome.action.setIcon({ path: defaultIcons })
    }
  }

  if (message.action === 'getPsp') {
    sendResponse({ psp: detectedPsp || tabPsps[currentTabId] })
  }

  if (message.action === 'getTabId') {
    sendResponse({ tabId: sender.tab.id })
  }
})

const debouncedSetPspIcon = debounce(setPspIcon, 200)

chrome.tabs.onActivated.addListener(tabInfo => {
  currentTabId = tabInfo.tabId

  // Reset to default more explicitly
  detectedPsp = null;
  chrome.action.setIcon({ path: defaultIcons })

  // Add a slight delay to ensure tab is fully loaded
  setTimeout(() => {
    chrome.tabs.get(currentTabId, function (tab) {
      // Run on any HTTPS website, excluding extension galleries
      if (tab && eligibleUrls.test(tab.url)) {
        // More robust PSP detection
        detectedPsp = tabPsps[currentTabId]
        
        if (!detectedPsp) {
          executeContentScript(currentTabId)
        }

        debouncedSetPspIcon()
      }
    })
  }, 100)
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

function executeContentScript(tabId) {
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      files: ['content.js']
    },
    (results) => {
      if (chrome.runtime.lastError) {
        console.error(
          `Detailed script injection error on tab ${tabId}:`, 
          chrome.runtime.lastError
        );
      }
    }
  )
}

const fetchAndCachePspConfig = async () => {
  if (cachedPspConfig) {
    return { config: cachedPspConfig };
  }

  try {
    const response = await fetch(chrome.runtime.getURL('psp-config.json'));
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    cachedPspConfig = await response.json();
    return { config: cachedPspConfig };
  } catch (error) {
    console.error('Detailed config loading error:', error);
    return { config: null };
  }
};

function setPspIcon() {
  if (!currentTabId) return;

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

function applyPspIcon(pspConfig) {
  const detectedPspName = detectedPsp || tabPsps[currentTabId]
  const psp = pspConfig.psps.find(p => p.name === detectedPspName)
  
  if (psp && psp.image) {
    const icons = {
      16: `images/${psp.image}_16.png`,
      48: `images/${psp.image}_48.png`,
      128: `images/${psp.image}_128.png`
    }

    chrome.action.setIcon({ path: icons })
  } else {
    chrome.action.setIcon({ path: defaultIcons })
  }
}

// Add a periodic check to ensure icon consistency
setInterval(() => {
  if (currentTabId) {
    chrome.tabs.get(currentTabId, tab => {
      if (tab && eligibleUrls.test(tab.url)) {
        // Re-run detection if no PSP is detected
        if (!tabPsps[currentTabId]) {
          executeContentScript(currentTabId)
        }
      }
    })
  }
}, 5000)