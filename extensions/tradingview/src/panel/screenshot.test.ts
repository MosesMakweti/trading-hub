import { describe, expect, it, vi } from "vitest";

import { createScreenshotController, type ScreenshotState } from "./screenshot";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createScreenshotController — capture (§13/§19)", () => {
  it("idle -> capturing -> captured, in order", async () => {
    const states: ScreenshotState[] = [];
    const controller = createScreenshotController(
      { capture: async () => ({ ok: true, dataUrl: "data:image/png;base64,abc" }), upload: vi.fn() },
      (s) => states.push(s),
    );
    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    expect(states.map((s) => s.status)).toEqual(["capturing", "captured"]);
  });

  it("a capture failure produces capture_error with the message, never a fabricated image", async () => {
    const states: ScreenshotState[] = [];
    const controller = createScreenshotController(
      { capture: async () => ({ ok: false, message: "Could not capture the chart." }), upload: vi.fn() },
      (s) => states.push(s),
    );
    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("capture_error"));
    expect(states.at(-1)).toEqual({ status: "capture_error", message: "Could not capture the chart." });
  });

  it("§19 — a second capture click while one is already in flight is ignored, never firing twice", async () => {
    const d = deferred<{ ok: true; dataUrl: string }>();
    const capture = vi.fn(() => d.promise);
    const controller = createScreenshotController({ capture, upload: vi.fn() }, () => {});

    controller.capture();
    controller.capture(); // fires while the first is still pending
    d.resolve({ ok: true, dataUrl: "data:image/png;base64,abc" });
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  });

  it("Retake behaves exactly like capture — replaces whatever was there", async () => {
    const states: ScreenshotState[] = [];
    let call = 0;
    const capture = vi.fn(async () => ({ ok: true as const, dataUrl: `data:image/png;base64,img${++call}` }));
    const controller = createScreenshotController({ capture, upload: vi.fn() }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.retake();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(states.at(-1)).toEqual({ status: "captured", dataUrl: "data:image/png;base64,img2" });
  });
});

describe("createScreenshotController — upload (§17/§18/§26)", () => {
  function captured(dataUrl = "data:image/png;base64,abc") {
    return { capture: async () => ({ ok: true as const, dataUrl }), upload: vi.fn() };
  }

  it("captured -> uploading -> uploaded, with the real mediaAssetId", async () => {
    const states: ScreenshotState[] = [];
    const upload = vi.fn(async () => ({ ok: true as const, mediaAssetId: "media_1" }));
    const controller = createScreenshotController({ ...captured(), upload }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploaded"));

    expect(states.map((s) => s.status)).toEqual(["capturing", "captured", "uploading", "uploaded"]);
    expect(states.at(-1)).toEqual({ status: "uploaded", dataUrl: "data:image/png;base64,abc", mediaAssetId: "media_1" });
  });

  it("upload() is a no-op with nothing captured yet — never calls the upload function", async () => {
    const upload = vi.fn();
    const controller = createScreenshotController({ capture: vi.fn(), upload }, () => {});
    controller.upload();
    expect(upload).not.toHaveBeenCalled();
  });

  it("§18 — a local screenshot is never treated as uploaded until the API confirms it (a pending upload stays 'uploading', not 'uploaded')", async () => {
    const states: ScreenshotState[] = [];
    const d = deferred<{ ok: true; mediaAssetId: string }>();
    const controller = createScreenshotController({ ...captured(), upload: () => d.promise }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploading"));
    expect(states.some((s) => s.status === "uploaded")).toBe(false);
  });

  it("a failed upload produces upload_error while KEEPING the local dataUrl, so the trader can retry without re-capturing", async () => {
    const states: ScreenshotState[] = [];
    const upload = vi.fn(async () => ({ ok: false as const, message: "Could not reach Traditorium." }));
    const controller = createScreenshotController({ ...captured(), upload }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("upload_error"));
    expect(states.at(-1)).toEqual({ status: "upload_error", dataUrl: "data:image/png;base64,abc", message: "Could not reach Traditorium." });
  });

  it("§26 — a second upload click while one is already in flight is ignored, never firing twice", async () => {
    const d = deferred<{ ok: true; mediaAssetId: string }>();
    const upload = vi.fn(() => d.promise);
    const controller = createScreenshotController({ ...captured(), upload }, () => {});

    controller.capture();
    await vi.waitFor(() => expect(upload).not.toBeUndefined());
    controller.upload();
    controller.upload(); // double-click
    d.resolve({ ok: true, mediaAssetId: "media_1" });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });

  it("retrying upload_error resumes from the SAME local image, not a fresh capture", async () => {
    const states: ScreenshotState[] = [];
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "Could not reach Traditorium." })
      .mockResolvedValueOnce({ ok: true, mediaAssetId: "media_1" });
    const controller = createScreenshotController({ ...captured(), upload }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("upload_error"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploaded"));

    expect(upload).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ status: "uploaded", dataUrl: "data:image/png;base64,abc", mediaAssetId: "media_1" });
  });

  it("§19 race: retaking WHILE an upload of the OLD image is in flight discards that upload's eventual result", async () => {
    const states: ScreenshotState[] = [];
    const d = deferred<{ ok: true; mediaAssetId: string }>();
    let captureCall = 0;
    const capture = vi.fn(async () => ({ ok: true as const, dataUrl: `data:image/png;base64,img${++captureCall}` }));
    const controller = createScreenshotController({ capture, upload: () => d.promise }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploading"));

    controller.retake(); // supersedes the in-flight upload of img1
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    expect(states.at(-1)).toEqual({ status: "captured", dataUrl: "data:image/png;base64,img2" });

    d.resolve({ ok: true, mediaAssetId: "media_1" }); // the OLD upload finally resolves
    await new Promise((r) => setTimeout(r, 0));

    expect(states.some((s) => s.status === "uploaded")).toBe(false); // never overwrote img2's state
    expect(states.at(-1)).toEqual({ status: "captured", dataUrl: "data:image/png;base64,img2" });
  });

  it("§20 race: removing WHILE an upload is in flight discards that upload's eventual result, staying idle", async () => {
    const states: ScreenshotState[] = [];
    const d = deferred<{ ok: true; mediaAssetId: string }>();
    const controller = createScreenshotController({ ...captured(), upload: () => d.promise }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploading"));

    controller.remove();
    expect(states.at(-1)).toEqual({ status: "idle" });

    d.resolve({ ok: true, mediaAssetId: "media_1" });
    await new Promise((r) => setTimeout(r, 0));

    expect(states.some((s) => s.status === "uploaded")).toBe(false);
    expect(states.at(-1)).toEqual({ status: "idle" });
  });
});

describe("createScreenshotController — remove (§20)", () => {
  it("before upload: clears back to idle with no server call", async () => {
    const states: ScreenshotState[] = [];
    const upload = vi.fn();
    const controller = createScreenshotController({ capture: async () => ({ ok: true, dataUrl: "data:image/png;base64,abc" }), upload }, (s) => states.push(s));

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.remove();

    expect(states.at(-1)).toEqual({ status: "idle" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("after upload: clears the LOCAL reference back to idle (the server-side asset is left alone — no deletion call exists)", async () => {
    const states: ScreenshotState[] = [];
    const controller = createScreenshotController(
      { capture: async () => ({ ok: true, dataUrl: "data:image/png;base64,abc" }), upload: async () => ({ ok: true, mediaAssetId: "media_1" }) },
      (s) => states.push(s),
    );

    controller.capture();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("captured"));
    controller.upload();
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("uploaded"));
    controller.remove();

    expect(states.at(-1)).toEqual({ status: "idle" });
  });
});
