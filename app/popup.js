document.addEventListener('DOMContentLoaded', function () {
  chrome.runtime.sendMessage({ action: 'getPsp' }, function (response) {
    const detectedPsp = response.psp
    
    // Add error handling for config loading
    fetch(chrome.runtime.getURL('psp-config.json'))
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch PSP config');
        }
        return response.json();
      })
      .then(pspConfig => {
        if (detectedPsp) {
          const psp = pspConfig.psps.find(p => p.name === detectedPsp)
          
          // Safely handle potential undefined psp
          if (psp) {
            document.getElementById('psp-name').textContent = psp.name
            document.getElementById('psp-description').textContent = psp.summary
            document.getElementById('psp-url').innerHTML = `<a href="${psp.url}" target="_blank">Learn More</a>`
          } else {
            handleNoPspDetected();
          }
        } else {
          handleNoPspDetected();
        }
      })
      .catch(error => {
        console.error('Error loading the JSON config:', error)
        handleNoPspDetected();
      })
  })

  function handleNoPspDetected() {
    document.getElementById('psp-name').textContent = 'No PSP detected'
    document.getElementById('psp-description').textContent = 
      "The Payment Service Provider could not be determined. Please ensure you have navigated to the website's checkout page."
    document.getElementById('psp-url').innerHTML = '<a href="mailto:psp-detector@adamstiskala.com" target="_blank">Suggest Improvement</a>'
  }
})