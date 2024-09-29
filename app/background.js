let detectedPSP = null;

const defaultIcons = {
  "16": "images/default_16.png",
  "48": "images/default_48.png",
  "128": "images/default_128.png"
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "detectPSP") {
    detectedPSP = message.psp;

    if (detectedPSP) {
      fetch(chrome.runtime.getURL('psp-config.json'))
        .then(response => response.json())
        .then(pspConfig => {
          const psp = pspConfig.psps.find(p => p.name === detectedPSP);
          const icons = {
            "16": `images/${psp.image}_16.png`,
            "48": `images/${psp.image}_48.png`,
            "128": `images/${psp.image}_128.png`
          };

          chrome.action.setIcon({ path: icons });
        })
        .catch(error => {
          console.error("Error loading the JSON config:", error);
        });
    } else {
      chrome.action.setIcon({ path: defaultIcons });
    }

  }

  // When popup requests PSP data
  if (message.action === "getPSP") {
    sendResponse({ psp: detectedPSP });
  }
});

function detectPSPOnActiveTab(tab) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
}

chrome.tabs.onActivated.addListener((tabInfo) => {
  chrome.tabs.get(tabInfo.tabId, function (tab) {
    if (/^https:\/\//.test(tab.url)) {
      detectPSPOnActiveTab(tab);
    } else {
      chrome.action.setIcon({ path: defaultIcons });
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    chrome.tabs.get(tabId, function (tab) {
      if (/^https:\/\//.test(tab.url)) {
        detectPSPOnActiveTab(tab);
      } else {
        chrome.action.setIcon({ path: defaultIcons });
      }
    });
  }
});