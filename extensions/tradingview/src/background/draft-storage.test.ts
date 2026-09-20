import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_DRAFT, type TradeDraftContext } from "@shared/draft";
import { installChromeMock } from "../../test/chrome-mock";
import { clearDraft, getDraft, setDraft } from "./draft-storage";

describe("draft-storage (Step 6)", () => {
  beforeEach(() => {
    installChromeMock();
  });

  it("returns EMPTY_DRAFT when nothing has been stored yet", async () => {
    expect(await getDraft()).toEqual(EMPTY_DRAFT);
  });

  it("round-trips a draft through set/get", async () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG", selectedConfluenceIds: ["c1"], updatedAt: 42 };
    await setDraft(draft);
    expect(await getDraft()).toEqual(draft);
  });

  it("clearDraft removes it, reverting to EMPTY_DRAFT", async () => {
    await setDraft({ ...EMPTY_DRAFT, strategyId: "s1" });
    await clearDraft();
    expect(await getDraft()).toEqual(EMPTY_DRAFT);
  });

  it("uses chrome.storage.session, never chrome.storage.local — the draft is not meant to survive a browser restart", async () => {
    const { chromeMock } = installChromeMock();
    await setDraft({ ...EMPTY_DRAFT, strategyId: "s1" });
    expect(chromeMock.storage.session.set).toHaveBeenCalled();
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
});
