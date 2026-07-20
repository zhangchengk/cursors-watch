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

  upsert(session: SessionState): void {
    const i = this.sessions.findIndex((s) => s.id === session.id);
    if (i >= 0) {
      const next = this.sessions.slice();
      next[i] = session;
      this.sessions = next;
    } else {
      this.sessions = [...this.sessions, session];
    }
    for (const l of this.listeners) l(this.sessions);
  }

  remove(id: string): void {
    const next = this.sessions.filter((s) => s.id !== id);
    if (next.length === this.sessions.length) return;
    this.sessions = next;
    for (const l of this.listeners) l(this.sessions);
  }

  subscribe(fn: SessionsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
