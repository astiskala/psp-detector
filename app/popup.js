document.addEventListener('DOMContentLoaded', function () {
  chrome.runtime.sendMessage({ action: 'getPsp' }, function (response) {
    const detectedPsp = response.psp;
    
    fetch(chrome.runtime.getURL('psp-config.json'))
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch PSP config');
        }
        return response.json();
      })
      .then(pspConfig => {
        if (detectedPsp) {
          const psp = pspConfig.psps.find(p => p.name === detectedPsp);
          
          if (psp) {
            document.getElementById('psp-name').textContent = psp.name;
            document.getElementById('psp-description').textContent = psp.summary;

            if (psp.notice) {
              document.getElementById('psp-notice').style.display = 'block';
              document.getElementById('psp-notice').textContent = psp.notice;
            } else {
              document.getElementById('psp-notice').style.display = 'none';
            }

            document.getElementById('psp-url').innerHTML = `<a href="${psp.url}" target="_blank">Learn More</a>`;
            
            const pspImage = document.getElementById('psp-image');
            pspImage.src = chrome.runtime.getURL(`images/${psp.image}_128.png`);
          } else {
            handleNoPspDetected();
          }
        } else {
          handleNoPspDetected();
        }
      })
      .catch(error => {
        console.error('Error loading the JSON config:', error);
        handleNoPspDetected();
      });
  });

  function handleNoPspDetected() {
    document.getElementById('psp-name').textContent = 'No PSP detected';
    document.getElementById('psp-description').textContent = 
      "The Payment Service Provider could not be determined. Please ensure you have navigated to the website's checkout page.";
    document.getElementById('psp-notice').style.display = 'none';
    document.getElementById('psp-notice').textContent = '';
    document.getElementById('psp-url').innerHTML = '<a href="mailto:psp-detector@adamstiskala.com" target="_blank">Suggest Improvement</a>';
    document.getElementById('psp-image').src = chrome.runtime.getURL(`images/default_128.png`);
  }
});
