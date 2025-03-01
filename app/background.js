let cachedPspConfig = null;
let detectedPsp = null;
let currentTabId = null;
let tabPsps = {};

const defaultIcons = {
  16: 'images/default_16.png',
  48: 'images/default_48.png',
  128: 'images/default_128.png'
};

let exemptDomains = [];  // To store exempted domains

// Function to load exempt domains from the JSON file
const loadExemptDomains = async () => {
  try {
    const response = await fetch(chrome.runtime.getURL('exempt-domains.json'));
    const data = await response.json();
    exemptDomains = data.exemptDomains;
  } catch (error) {
    console.error('Failed to load exempt domains:', error.message);
  }
};

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

// Update the eligibleUrls regex dynamically based on exemptDomains
const getEligibleUrls = () => {
  const domainPattern = exemptDomains.join('|');
  return new RegExp(`^https://(?!.*(${domainPattern}))`);
};

// Load exempt domains on startup
loadExemptDomains();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPspConfig') {
    if (cachedPspConfig) {
      sendResponse({ config: cachedPspConfig });
    } else {
      fetchAndCachePspConfig().then(({ config }) => {
        sendResponse({ config });
      });
    }
    return true; // Keeps the message channel open for async response
  }

  if (message.action === 'detectPsp') {
    detectedPsp = message.data.psp;
    if (detectedPsp) {
      if (message.data.tabId == currentTabId) {
        tabPsps[currentTabId] = detectedPsp;
        debouncedSetPspIcon();
      }
    } else {
      chrome.action.setIcon({ path: defaultIcons });
    }
  }

  if (message.action === 'getPsp') {
    sendResponse({ psp: detectedPsp || tabPsps[currentTabId] });
  }

  if (message.action === 'getTabId') {
    sendResponse({ tabId: sender.tab.id });
  }
});

const debouncedSetPspIcon = debounce(setPspIcon, 200);

chrome.tabs.onActivated.addListener(tabInfo => {
  currentTabId = tabInfo.tabId;
  detectedPsp = null;
  chrome.action.setIcon({ path: defaultIcons });

  setTimeout(() => {
    chrome.tabs.get(currentTabId, function (tab) {
      const eligibleUrls = getEligibleUrls();
      if (tab && eligibleUrls.test(tab.url)) {
        detectedPsp = tabPsps[currentTabId];
        if (!detectedPsp) {
          executeContentScript(currentTabId);
        }
        debouncedSetPspIcon();
      }
    });
  }, 100);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setIcon({ path: defaultIcons });
    tabPsps[tabId] = null;
  }

  if (changeInfo.status === 'complete' && tab && tab.url) {
    const eligibleUrls = getEligibleUrls();
    if (eligibleUrls.test(tab.url)) {
      executeContentScript(tabId);
    } else {
      chrome.action.setIcon({ path: defaultIcons });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  delete tabPsps[tabId];
});

function executeContentScript(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.warn(`No tab with id ${tabId}:`, chrome.runtime.lastError.message);
      return;
    }
    if (!tab) {
      console.warn(`Tab ${tabId} does not exist.`);
      return;
    }
    const eligibleUrls = getEligibleUrls();
    if (tab && eligibleUrls.test(tab.url)) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          files: ['content.js']
        },
        (results) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message;
            console.error(`Detailed script injection error on tab ${tabId}:`, errMsg);
            // Skip retry if frame removed; otherwise, attempt retry.
            if (errMsg && errMsg.includes("Frame with ID")) {
              console.warn(`Injection aborted: Frame removed on tab ${tabId}.`);
              return;
            }
            setTimeout(() => {
              chrome.scripting.executeScript(
                {
                  target: { tabId: tabId },
                  files: ['content.js']
                },
                (retryResults) => {
                  if (chrome.runtime.lastError) {
                    console.error(`Retry injection failed for tab ${tabId}:`, chrome.runtime.lastError.message);
                  }
                }
              );
            }, 2000);
          }
        }
      );
    }
  });
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
    console.error('Detailed config loading error:', error.message);
    return { config: null };
  }
};

function setPspIcon() {
  if (!currentTabId) return;

  if (cachedPspConfig) {
    applyPspIcon(cachedPspConfig);
  } else {
    fetch(chrome.runtime.getURL('psp-config.json'))
      .then(response => response.json())
      .then(pspConfig => {
        cachedPspConfig = pspConfig;
        applyPspIcon(pspConfig);
      })
      .catch(error => {
        console.error('Error loading the JSON config', error.message);
      });
  }
}

function applyPspIcon(pspConfig) {
  const detectedPspName = detectedPsp || tabPsps[currentTabId];
  const psp = pspConfig.psps.find(p => p.name === detectedPspName);

  if (psp && psp.image) {
    const icons = {
      16: `images/${psp.image}_16.png`,
      48: `images/${psp.image}_48.png`,
      128: `images/${psp.image}_128.png`
    };

    chrome.action.setIcon({ path: icons });
  } else {
    chrome.action.setIcon({ path: defaultIcons });
  }
}

// Periodically check to ensure icon consistency
setInterval(() => {
  if (currentTabId) {
    chrome.tabs.get(currentTabId, tab => {
      const eligibleUrls = getEligibleUrls();
      if (tab && eligibleUrls.test(tab.url)) {
        if (!tabPsps[currentTabId]) {
          executeContentScript(currentTabId);
        }
      }
    });
  }
}, 5000);
