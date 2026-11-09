import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { MAX_IMAGE_EDGE, prepareUpload, sniffMediaType, UploadRejectedError } from "@/lib/media-processing";
import { ACCEPTED_IMAGE_MIME } from "@/lib/media-constants";

const ACCEPT = new Set<string>(ACCEPTED_IMAGE_MIME);
const RASTER_ONLY = new Set<string>(["image/png", "image/jpeg", "image/webp"]);

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } } });

describe("sniffMediaType", () => {
  it("recognises formats by their bytes, not their name", async () => {
    expect(sniffMediaType(await solid(4, 4).png().toBuffer())).toBe("image/png");
    expect(sniffMediaType(await solid(4, 4).jpeg().toBuffer())).toBe("image/jpeg");
    expect(sniffMediaType(await solid(4, 4).webp().toBuffer())).toBe("image/webp");
    expect(sniffMediaType(await solid(4, 4).gif().toBuffer())).toBe("image/gif");
    expect(sniffMediaType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
    expect(sniffMediaType(Buffer.from("%PDF-1.7\n%...................."))).toBe("application/pdf");
  });

  it("returns null for anything else", () => {
    expect(sniffMediaType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffMediaType(Buffer.from("MZ\x90\x00 not an image at all"))).toBeNull();
    expect(sniffMediaType(Buffer.from("tiny"))).toBeNull();
  });
});

describe("prepareUpload", () => {
  it("rejects a file whose content isn't an accepted image, whatever it claims to be", async () => {
    await expect(prepareUpload(Buffer.from("<html>definitely not a png</html>"), "chart.png", ACCEPT)).rejects.toBeInstanceOf(UploadRejectedError);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(prepareUpload(svg, "chart.png", RASTER_ONLY)).rejects.toThrow(/Unsupported file type: image\/svg\+xml/);
  });

  it("re-encodes screenshots to WebP, renames them and caps the long edge", async () => {
    const big = await solid(3200, 1600).png().toBuffer();
    const out = await prepareUpload(big, "EURUSD 15m.png", ACCEPT);
    expect(out.mimeType).toBe("image/webp");
    expect(sniffMediaType(out.bytes)).toBe("image/webp");
    expect(out.fileName).toBe("EURUSD 15m.webp");
    expect(out).toMatchObject({ width: MAX_IMAGE_EDGE, height: 1280 });
    const small = await prepareUpload(await solid(800, 400).jpeg().toBuffer(), "x.jpg", ACCEPT);
    expect(small).toMatchObject({ width: 800, height: 400, mimeType: "image/webp" });
  });

  it("strips EXIF (e.g. GPS) and applies the orientation", async () => {
    const withExif = await solid(200, 100)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret", Artist: "me" } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await prepareUpload(withExif, "phone.jpg", ACCEPT);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    // orientation 6 = rotated 90°: the stored pixels are upright
    expect([meta.width, meta.height]).toEqual([100, 200]);
  });

  it("stores GIF, SVG and other non-screenshot formats as uploaded", async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    const out = await prepareUpload(gif, "anim.gif", ACCEPT);
    expect(out.bytes.equals(gif)).toBe(true);
    expect(out.mimeType).toBe("image/gif");
  });

  it("can validate without re-encoding (extension captures)", async () => {
    const png = await solid(50, 50).png().toBuffer();
    const out = await prepareUpload(png, "capture.png", ACCEPT, { optimize: false });
    expect(out.bytes.equals(png)).toBe(true);
    expect(out.mimeType).toBe("image/png");
  });

  it("rejects a truncated or corrupt image", async () => {
    const png = await solid(400, 400).png().toBuffer();
    await expect(prepareUpload(png.subarray(0, 200), "broken.png", ACCEPT)).rejects.toBeInstanceOf(UploadRejectedError);
  });
});
