import { describe, expect, it } from "vitest";

import { NullRecognitionProvider } from "@/domain/trade-plan/recognition-types";

describe("NullRecognitionProvider", () => {
  it("is always available (no config/credentials required)", () => {
    expect(new NullRecognitionProvider().isAvailable()).toBe(true);
  });

  it("resolves to RECOGNITION_FAILED with a trader-facing message, never throwing", async () => {
    const provider = new NullRecognitionProvider();
    const outcome = await provider.recognize({ imageBuffer: Buffer.from(""), mimeType: "image/png" });
    expect(outcome.status).toBe("RECOGNITION_FAILED");
    expect(outcome.status === "RECOGNITION_FAILED" && outcome.error).toBeTruthy();
  });
});
