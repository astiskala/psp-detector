let cachedPspConfig = null;
let detectedPsp = null;
let currentTabId = null;
let tabPsps = {};
let exemptDomainsRegex = null;  // Cache the compiled regex

const defaultIcons = {
  16: 'images/default_16.png',
  48: 'images/default_48.png',
  128: 'images/default_128.png'
};

// Function to load exempt domains from the JSON file
const loadExemptDomains = async () => {
  try {
    const response = await fetch(chrome.runtime.getURL('exempt-domains.json'));
    const data = await response.json();
    const domainPattern = data.exemptDomains.join('|');
    exemptDomainsRegex = new RegExp(`^https://(?!.*(${domainPattern}))`);
    return true;
  } catch (error) {
    console.error('Failed to load exempt domains:', error.message);
    return false;
  }
};

// Initialize exempt domains on extension load
loadExemptDomains();

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

// Get the cached regex
const getEligibleUrls = () => exemptDomainsRegex;

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

  if (message.action === 'getExemptDomainsRegex') {
    if (!exemptDomainsRegex) {
      loadExemptDomains().then(() => {
        sendResponse({ regex: exemptDomainsRegex ? exemptDomainsRegex.source : null });
      });
      return true; // Will respond asynchronously
    }
    sendResponse({ regex: exemptDomainsRegex.source });
  }
});

const debouncedSetPspIcon = debounce(setPspIcon, 200);

chrome.tabs.onActivated.addListener(async (tabInfo) => {
  currentTabId = tabInfo.tabId;
  detectedPsp = tabPsps[currentTabId] || null;
  
  try {
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(currentTabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tab);
        }
      });
    });

    if (detectedPsp) {
      debouncedSetPspIcon();
    } else {
      chrome.action.setIcon({ path: defaultIcons });
      
      if (tab && tab.url && exemptDomainsRegex && exemptDomainsRegex.test(tab.url)) {
        executeContentScript(currentTabId);
      }
    }
  } catch (error) {
    console.warn('Tab access error:', error.message);
    chrome.action.setIcon({ path: defaultIcons });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setIcon({ path: defaultIcons });
    tabPsps[tabId] = null;
  }
  if (changeInfo.status === 'complete' && tab && tab.url && exemptDomainsRegex) {
    if (exemptDomainsRegex.test(tab.url)) {
      executeContentScript(tabId);
    } else {
      chrome.action.setIcon({ path: defaultIcons });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  delete tabPsps[tabId];
});

// Function to check if tab exists
const checkTabExists = async (tabId) => {
  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tab);
        }
      });
    });
    return true;
  } catch (error) {
    console.warn(`Tab ${tabId} does not exist:`, error.message);
    return false;
  }
};

function executeContentScript(tabId) {
  checkTabExists(tabId).then(exists => {
    if (!exists) {
      delete tabPsps[tabId];
      return;
    }
    
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn(`No tab with id ${tabId}:`, chrome.runtime.lastError.message);
        delete tabPsps[tabId];
        return;
      }
      
      if (!tab || !tab.url) {
        console.warn(`Tab ${tabId} is invalid or has no URL.`);
        delete tabPsps[tabId];
        return;
      }

      if (exemptDomainsRegex && exemptDomainsRegex.test(tab.url)) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabId },
            files: ['content.js']
          },
          (results) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message;
              
              // Log but don't retry if frame was removed or tab no longer exists
              if (errMsg && (errMsg.includes("Frame with ID") || errMsg.includes("No tab with id"))) {
                console.warn(`Script injection skipped: ${errMsg}`);
                return;
              }

              // Only retry for other types of errors
              console.error(`Script injection error on tab ${tabId}:`, errMsg);
              setTimeout(() => {
                checkTabExists(tabId).then(stillExists => {
                  if (stillExists) {
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
                  }
                });
              }, 2000);
            }
          }
        );
      }
    });
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
      if (tab && exemptDomainsRegex && exemptDomainsRegex.test(tab.url)) {
        if (!tabPsps[currentTabId]) {
          executeContentScript(currentTabId);
        }
      }
    });
  }
}, 5000);
