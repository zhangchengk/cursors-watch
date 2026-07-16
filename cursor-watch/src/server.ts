import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
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
