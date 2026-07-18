import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { openWorkspaceInCursor } from "./open-workspace.js";
import type { SessionStore } from "./store.js";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

export async function buildServer(store: SessionStore) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/sessions", async () => store.getSessions());

  app.post<{ Body: { path?: string } }>("/api/open-workspace", async (req, reply) => {
    const workspacePath = typeof req.body?.path === "string" ? req.body.path : "";
    const result = await openWorkspaceInCursor({
      workspacePath,
      sessions: store.getSessions(),
    });
    if (!result.ok) {
      return reply.code(result.statusCode ?? 400).send({ ok: false, error: result.error });
    }
    return { ok: true };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const send = () => {
      socket.send(
        JSON.stringify({ type: "sessions", payload: store.getSessions() }),
      );
    };
    send();
    const unsub = store.subscribe(() => send());
    socket.on("close", () => unsub());
  });

  return app;
}
