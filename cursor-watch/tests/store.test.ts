import { describe, expect, it, vi } from "vitest";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";

describe("SessionStore", () => {
  it("notifies subscribers on replaceAll", () => {
    const store = new SessionStore();
    const spy = vi.fn();
    store.subscribe(spy);
    const rows = [{ id: "a" } as SessionState];
    store.replaceAll(rows);
    expect(store.getSessions()).toEqual(rows);
    expect(spy).toHaveBeenCalledWith(rows);
  });
});
