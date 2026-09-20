import { describe, expect, it } from "vitest";

import { API_BASE_URL } from "./config";

describe("API_BASE_URL", () => {
  it("resolves from the build-time define (vitest.config.ts pins it to the dev URL for tests)", () => {
    expect(API_BASE_URL).toBe("http://localhost:3000");
  });
});
