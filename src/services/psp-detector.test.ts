import { PSPDetectorService } from "./psp-detector";
import type { PSPConfig } from "../types";
import { TypeConverters, PSPDetectionResult } from "../types";

describe("PSPDetectorService", () => {
  const config: PSPConfig = {
    psps: [
      {
        name: TypeConverters.toPSPName("Stripe")!,
        regex: TypeConverters.toRegexPattern("stripe\\.com")!,
        url: TypeConverters.toURL("https://stripe.com")!,
        image: "stripe",
        summary: "Stripe summary",
      },
      {
        name: TypeConverters.toPSPName("PayPal")!,
        regex: TypeConverters.toRegexPattern("paypal\\.com")!,
        url: TypeConverters.toURL("https://paypal.com")!,
        image: "paypal",
        summary: "PayPal summary",
      },
      {
        name: TypeConverters.toPSPName("Adyen")!,
        regex: TypeConverters.toRegexPattern("adyen\\.com")!,
        url: TypeConverters.toURL("https://adyen.com")!,
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
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isDetected(result)).toBe(true);
    if (PSPDetectionResult.isDetected(result)) {
      expect(result.psp).toBe("Stripe");
    }
  });

  it("should detect PayPal PSP", () => {
    const url = "https://www.paypal.com/checkout";
    const content = '<script src="https://www.paypal.com/sdk/js"></script>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isDetected(result)).toBe(true);
    if (PSPDetectionResult.isDetected(result)) {
      expect(result.psp).toBe("PayPal");
    }
  });

  it("should return none result if no PSP matches", () => {
    const url = "https://unknown.com";
    const content = "<div>No PSP here</div>";
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isNone(result)).toBe(true);
  });

  it("should return error result if not initialized", () => {
    const uninit = new PSPDetectorService();
    const result = uninit.detectPSP("https://stripe.com", "stripe");
    expect(PSPDetectionResult.isError(result)).toBe(true);
  });

  it("should get PSP by PSPName", () => {
    expect(
      service.getPSPByPSPName(TypeConverters.toPSPName("Stripe")!),
    ).toMatchObject({
      name: "Stripe",
      regex: "stripe\\.com",
    });
    expect(
      service.getPSPByPSPName(TypeConverters.toPSPName("Unknown")!),
    ).toBeNull();
  });

  it("should return exempt result for exempt domains", () => {
    const url = "https://example.com/checkout";
    const content = '<script src="https://js.stripe.com/v3/"></script>';
    const result = service.detectPSP(url, content);
    expect(PSPDetectionResult.isExempt(result)).toBe(true);
  });
});
