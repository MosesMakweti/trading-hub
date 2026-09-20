/**
 * Traditorium TradingView Extension — Step 4. A minimal, hand-rolled mock
 * of the slice of `chrome.*` this extension actually uses — deliberately
 * not a full fake-chrome dependency, since the surface area needed
 * (storage.local get/set/remove, tabs.query, runtime.sendMessage) is small
 * and a real dependency would hide exactly the behavior these tests exist
 * to pin down.
 */
import { vi } from "vitest";

export function installChromeMock() {
  const store = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
        remove: vi.fn(async (key: string) => {
          store.delete(key);
        }),
      },
      // Step 6 — the trade draft's storage area (draft-storage.ts). A
      // separate in-memory Map from `local`'s, mirroring the two areas
      // being genuinely independent in real Chrome.
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStore.get(key) })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
        }),
        remove: vi.fn(async (key: string) => {
          sessionStore.delete(key);
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => [] as chrome.tabs.Tab[]),
      // Step 8 — chrome.tabs.captureVisibleTab; default resolves to a tiny
      // fake PNG data URL so a test doesn't need to stub this every time.
      captureVisibleTab: vi.fn(async () => "data:image/png;base64,ZmFrZS1wbmc="),
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
    },
  };

  // @ts-expect-error — deliberately partial; only what this extension uses.
  globalThis.chrome = chromeMock;
  return { chromeMock, store, sessionStore };
}
