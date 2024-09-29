document.addEventListener('DOMContentLoaded', function () {
  chrome.runtime.sendMessage({ action: 'getPSP' }, function (response) {
    const detectedPSP = response.psp
    fetch(chrome.runtime.getURL('psp-config.json'))
      .then(response => response.json())
      .then(pspConfig => {
        if (detectedPSP) {
          const psp = pspConfig.psps.find(p => p.name === detectedPSP)
          document.getElementById('psp-name').innerHTML = psp.name
          document.getElementById('psp-description').innerHTML = psp.summary
          document.getElementById(
            'psp-url'
          ).innerHTML = `<a href="${psp.url}" target="_blank">Learn More</a>`
        } else {
          document.getElementById('psp-name').innerHTML = 'No PSP detected'
          document.getElementById('psp-description').innerHTML =
            "The Payment Service Provider could be determined based on the contents of the current page. Please ensure you have navigated to website's checkout page."
          document.getElementById('psp-url').innerHTML = ''
        }
      })
      .catch(error => {
        console.error('Error loading the JSON config:', error)
      })
  })
})
