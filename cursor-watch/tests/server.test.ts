import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { SessionStore } from "../src/store.js";
import { buildServer } from "../src/server.js";
import type { SessionState } from "../src/types.js";

describe("buildServer", () => {
  const store = new SessionStore();
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    store.replaceAll([
      {
        id: "x",
        projectKey: "p",
        workspacePath: "",
        workspaceLabel: "idea/Demo",
        status: "waiting",
        summary: "hi",
        currentAction: "等待你回复",
        lastActivityAt: Date.now(),
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      } satisfies SessionState,
    ]);
    app = await buildServer(store);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/sessions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("x");
  });

  it("GET / serves index", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/态势面板|Cursor Agent/);
  });
});
