// Mock chrome.runtime.getURL for Jest
global.chrome = {
  runtime: {
    getURL: (path: string) => path,
  },
} as unknown as typeof chrome;

import { UIService } from "./ui";
import type { PSP } from "../types";
import { TypeConverters } from "../lib/utils";

describe("UIService", () => {
  let service: UIService;
  let elements: Record<string, HTMLElement>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="psp-name"></div>
      <div id="psp-description"></div>
      <div id="psp-notice"></div>
      <div id="psp-url"></div>
      <img id="psp-image" />
    `;
    service = new UIService();
    elements = {
      name: document.getElementById("psp-name")!,
      description: document.getElementById("psp-description")!,
      notice: document.getElementById("psp-notice")!,
      url: document.getElementById("psp-url")!,
      image: document.getElementById("psp-image")!,
    };
  });

  it("should update PSP display", () => {
    const psp: PSP = {
      name: TypeConverters.toPSPName("TestPSP")!,
      regex: TypeConverters.toRegexPattern("test")!,
      url: TypeConverters.toURL("https://test.com")!,
      image: "test",
      summary: "summary",
      notice: "notice",
    };
    service.updatePSPDisplay(psp);
    expect(elements.name.textContent).toBe("TestPSP");
    expect(elements.description.textContent).toBe("summary");
    expect(elements.notice.textContent).toBe("notice");
    expect(elements.notice.style.display).toBe("block");
    expect(elements.url.querySelector("a")?.href).toBe("https://test.com/");
    expect((elements.image as HTMLImageElement).alt).toBe("TestPSP logo");
  });

  it("should show no PSP detected", () => {
    service.showNoPSPDetected();
    expect(elements.name.textContent).toBe("No PSP detected");
    expect(elements.notice.style.display).toBe("none");
  });

  it("should show error", () => {
    service.showError();
    expect(elements.name.textContent).toBe("Error");
    expect(elements.notice.style.display).toBe("none");
  });
});
