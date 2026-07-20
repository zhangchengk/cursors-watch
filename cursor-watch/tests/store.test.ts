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

  it("upsert inserts and replaces by id and notifies", () => {
    const store = new SessionStore();
    const spy = vi.fn();
    store.subscribe(spy);
    const a = { id: "a", summary: "1" } as SessionState;
    store.upsert(a);
    expect(store.getSessions()).toEqual([a]);
    expect(spy).toHaveBeenLastCalledWith([a]);
    const a2 = { id: "a", summary: "2" } as SessionState;
    store.upsert(a2);
    expect(store.getSessions()).toEqual([a2]);
    const b = { id: "b", summary: "b" } as SessionState;
    store.upsert(b);
    expect(store.getSessions().map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("remove deletes by id and notifies", () => {
    const store = new SessionStore();
    const spy = vi.fn();
    store.replaceAll([{ id: "a" } as SessionState, { id: "b" } as SessionState]);
    store.subscribe(spy);
    store.remove("a");
    expect(store.getSessions().map((s) => s.id)).toEqual(["b"]);
    expect(spy).toHaveBeenCalled();
  });
});
