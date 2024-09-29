(() => {
    fetch(chrome.runtime.getURL('psp-config.json'))
        .then(response => response.json())
        .then(pspConfig => {
            const detectPSP = () => {
                const pageContent = document.body.innerHTML;

                let detectedPSP = null;
                for (let psp of pspConfig.psps) {
                    const regex = new RegExp(psp.regex, 'i'); // Create a regex object
                    if (regex.test(pageContent)) {
                        detectedPSP = psp.name;
                        break;
                    }
                }

                chrome.runtime.sendMessage({ action: "detectPSP", psp: detectedPSP });
            };

            detectPSP();
        })
        .catch(error => {
            console.error("Error loading the JSON config:", error);
        });
})();