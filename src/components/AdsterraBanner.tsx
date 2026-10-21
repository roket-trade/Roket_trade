import { useEffect, useRef } from "react";

// Adsterra 300x250 iframe banner.
// The network's loader expects the global `atOptions` to be set by an inline
// script immediately before the invoke script is appended, so both tags are
// created in order on every mount. Clearing innerHTML first keeps React
// strict-mode's double-invoked effects from injecting the ad twice.
const ADSTERRA_KEY = "6eb77e9fbeaacb703549a46c4e441ad3";
const ADSTERRA_SRC = "https://bauval.org/22/6eb77e9fbeaacb703549a46c4e441ad3";

const AT_OPTIONS_SCRIPT = `atOptions = {
  'key' : '${ADSTERRA_KEY}',
  'format' : 'iframe',
  'height' : 250,
  'width' : 300,
  'params' : {}
};`;

export function AdsterraBanner() {
  const adContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = adContainerRef.current;
    if (!container) return;

    // Drop any previously injected (or partially loaded) banner.
    container.innerHTML = "";

    const optionsScript = document.createElement("script");
    optionsScript.type = "text/javascript";
    optionsScript.text = AT_OPTIONS_SCRIPT;

    const invokeScript = document.createElement("script");
    invokeScript.type = "text/javascript";
    invokeScript.src = ADSTERRA_SRC;

    container.appendChild(optionsScript);
    container.appendChild(invokeScript);

    return () => {
      container.innerHTML = "";
    };
  }, []);

  return (
    <div
      ref={adContainerRef}
      className="flex justify-center items-center w-full h-[250px] overflow-hidden"
    />
  );
}
