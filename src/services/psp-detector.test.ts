import { PSPDetectorService } from "./psp-detector";
import type { PSPConfig } from "../types";
import { PSP_DETECTION_EXEMPT } from "../types";

describe("PSPDetectorService", () => {
  const config: PSPConfig = {
    psps: [
      {
        name: "Stripe",
        regex: "stripe\\.com",
        url: "https://stripe.com",
        image: "stripe",
        summary: "Stripe summary",
      },
      {
        name: "PayPal",
        regex: "paypal\\.com",
        url: "https://paypal.com",
        image: "paypal",
        summary: "PayPal summary",
      },
      {
        name: "Adyen",
        regex: "adyen\\.com",
        url: "https://adyen.com",
        image: "adyen",
        summary: "Adyen summary",
      },
    ],
  };

  let service: PSPDetectorService;

  beforeEach(() => {
    service = new PSPDetectorService();
    service.initialize(config);
    service.setExemptDomainsPattern("^https://(?!.*(example.com))");
  });

  it("should initialize with config", () => {
    expect(service.isInitialized()).toBe(true);
  });

  it("should detect Stripe PSP", () => {
    const url = "https://checkout.stripe.com";
    const content = '<script src="https://js.stripe.com/v3/"></script>';
    expect(service.detectPSP(url, content)).toBe("Stripe");
  });

  it("should detect PayPal PSP", () => {
    const url = "https://www.paypal.com/checkout";
    const content = '<script src="https://www.paypal.com/sdk/js"></script>';
    expect(service.detectPSP(url, content)).toBe("PayPal");
  });

  it("should return null if no PSP matches", () => {
    const url = "https://unknown.com";
    const content = "<div>No PSP here</div>";
    expect(service.detectPSP(url, content)).toBeNull();
  });

  it("should return null if not initialized", () => {
    const uninit = new PSPDetectorService();
    expect(uninit.detectPSP("https://stripe.com", "stripe")).toBeNull();
  });

  it("should get PSP by name", () => {
    expect(service.getPSPByName("Stripe")).toMatchObject({
      name: "Stripe",
      regex: "stripe\\.com",
    });
    expect(service.getPSPByName("Unknown")).toBeNull();
  });

  it("should return PSP_DETECTION_EXEMPT for exempt domains", () => {
    const url = "https://example.com/checkout";
    const content = '<script src="https://js.stripe.com/v3/"></script>';
    expect(service.detectPSP(url, content)).toBe(PSP_DETECTION_EXEMPT);
  });
});
