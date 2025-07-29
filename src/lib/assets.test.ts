import fs from "fs";
import path from "path";

const configPath = path.resolve(__dirname, "../../public/psp-config.json");
const srcImagesDir = path.resolve(__dirname, "../../assets/images");
const distImagesDir = path.resolve(__dirname, "../../dist/images");

describe("PSP image assets", () => {
  let config: any;
  beforeAll(() => {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  });

  it("should have an image (pspname.png) for every PSP in source", () => {
    const missing = [];
    for (const psp of config.psps) {
      const imgPath = path.join(srcImagesDir, `${psp.image}.png`);
      if (!fs.existsSync(imgPath)) {
        missing.push(`Missing source image for PSP: ${psp.name} (${imgPath})`);
      }
    }
    if (missing.length) {
      console.error("\n" + missing.join("\n"));
    }
    expect(missing.length).toBe(0);
  });

  it("should have 16, 48, and 128px images for every PSP in dist after build", () => {
    const missing = [];
    for (const psp of config.psps) {
      for (const size of [16, 48, 128]) {
        const imgPath = path.join(distImagesDir, `${psp.image}_${size}.png`);
        if (!fs.existsSync(imgPath)) {
          missing.push(`Missing dist image for PSP: ${psp.name} (${imgPath})`);
        }
      }
    }
    if (missing.length) {
      console.error("\n" + missing.join("\n"));
    }
    expect(missing.length).toBe(0);
  });

  it("should have valid regex for every PSP and not match every website", () => {
    for (const psp of config.psps) {
      let regex: RegExp | null = null;
      try {
        regex = new RegExp(psp.regex, "i");
      } catch (e) {
        throw new Error(`Invalid regex for PSP '${psp.name}': ${psp.regex}`);
      }
      // Should not match a generic URL like google.com or example.com
      expect(regex.test("https://google.com")).toBe(false);
      expect(regex.test("https://example.com")).toBe(false);
      // Should not match empty string
      expect(regex.test("")).toBe(false);
    }
  });
});
