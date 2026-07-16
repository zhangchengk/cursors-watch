import type { SessionState } from "./types.js";

export type SessionsListener = (sessions: SessionState[]) => void;

export class SessionStore {
  private sessions: SessionState[] = [];
  private listeners = new Set<SessionsListener>();

  getSessions(): SessionState[] {
    return this.sessions;
  }

  replaceAll(sessions: SessionState[]): void {
    this.sessions = sessions;
    for (const l of this.listeners) l(this.sessions);
  }

  subscribe(fn: SessionsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
