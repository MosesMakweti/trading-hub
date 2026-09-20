import { beforeEach, describe, expect, it } from "vitest";

import type { StrategySummary } from "@shared/strategy";
import { installChromeMock } from "../../test/chrome-mock";
import { clearStored, getStored, setStored } from "./storage";

const STRATEGIES: StrategySummary[] = [{ id: "s1", name: "London Continuation", version: 1, status: "LIVE" }];

describe("storage", () => {
  beforeEach(() => {
    installChromeMock();
  });

  it("returns an empty shape when nothing is stored", async () => {
    expect(await getStored()).toEqual({ apiToken: null, cachedUser: null, cachedStrategies: null });
  });

  it("round-trips a patch through get/set", async () => {
    await setStored({ apiToken: "td_live_x" });
    await setStored({ cachedUser: { id: "u1", name: "Jane" }, cachedStrategies: STRATEGIES });

    expect(await getStored()).toEqual({
      apiToken: "td_live_x",
      cachedUser: { id: "u1", name: "Jane" },
      cachedStrategies: STRATEGIES,
    });
  });

  it("clearStored removes the token AND every cached value together", async () => {
    await setStored({ apiToken: "td_live_x", cachedUser: { id: "u1", name: "Jane" }, cachedStrategies: STRATEGIES });
    await clearStored();
    expect(await getStored()).toEqual({ apiToken: null, cachedUser: null, cachedStrategies: null });
  });
});
