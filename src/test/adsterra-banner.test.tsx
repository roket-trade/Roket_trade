import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdsterraBanner } from "@/components/AdsterraBanner";

const AD_KEY = "6eb77e9fbeaacb703549a46c4e441ad3";
const AD_SRC = `https://bauval.org/22/${AD_KEY}`;

afterEach(cleanup);

function adSlot(container: HTMLElement): HTMLElement {
  const slot = container.querySelector("div");
  if (!slot) throw new Error("AdsterraBanner did not render its container div");
  return slot as HTMLElement;
}

describe("AdsterraBanner", () => {
  it("renders a reserved 300x250 slot so the layout cannot shift while the ad loads", () => {
    const { container } = render(<AdsterraBanner />);
    const slot = adSlot(container);

    expect(slot.className).toContain("justify-center");
    expect(slot.className).toContain("items-center");
    expect(slot.className).toContain("w-full");
    expect(slot.className).toContain("h-[250px]");
    expect(slot.className).toContain("overflow-hidden");
  });

  it("injects the atOptions config first, then the Adsterra loader", () => {
    const { container } = render(<AdsterraBanner />);
    const scripts = Array.from(adSlot(container).querySelectorAll("script"));

    expect(scripts).toHaveLength(2);

    const [optionsScript, loaderScript] = scripts;
    expect(optionsScript?.textContent).toContain(`'key' : '${AD_KEY}'`);
    expect(optionsScript?.textContent).toContain("'format' : 'iframe'");
    expect(optionsScript?.textContent).toContain("'height' : 250");
    expect(optionsScript?.textContent).toContain("'width' : 300");
    expect(optionsScript?.textContent).toContain("'params' : {}");
    expect(optionsScript?.getAttribute("src")).toBeNull();

    expect(loaderScript?.getAttribute("src")).toBe(AD_SRC);
  });

  it("injects exactly one banner under React strict mode's double effect run", () => {
    const { container } = render(
      <StrictMode>
        <AdsterraBanner />
      </StrictMode>,
    );

    expect(adSlot(container).querySelectorAll(`script[src="${AD_SRC}"]`)).toHaveLength(1);
    expect(adSlot(container).querySelectorAll("script")).toHaveLength(2);
  });

  it("clears the injected markup on unmount", () => {
    const { container, unmount } = render(<AdsterraBanner />);
    const slot = adSlot(container);
    expect(slot.querySelectorAll("script")).toHaveLength(2);

    unmount();
    expect(slot.querySelectorAll("script")).toHaveLength(0);
  });
});
