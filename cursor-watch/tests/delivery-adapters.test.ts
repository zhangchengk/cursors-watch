import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDeliveryIntent,
  deliverReminder,
  hudDeliveryAdapter,
  notifyReminder,
  shellDeliveryAdapter,
  shellNotifyDir,
  type ReminderDeliveryAdapter,
  type ReminderDeliveryIntent,
} from "../src/reminders/notify.js";
import type { ReminderRecord } from "../src/reminders/types.js";

function record(over: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    conversationId: "conv-42",
    chatName: "My Chat",
    turnedEndedAt: 1_700_000_000_000,
    summary: "turn ended",
    status: "pending",
    notifyId: "cursor-watch-reminder-conv-42",
    ...over,
  };
}

describe("buildDeliveryIntent", () => {
  it("carries conversation notifyId title deep link and body", () => {
    const intent = buildDeliveryIntent({
      record: record(),
      sound: true,
      panelUrl: "http://127.0.0.1:7423/",
    });
    expect(intent.conversationId).toBe("conv-42");
    expect(intent.notifyId).toBe("cursor-watch-reminder-conv-42");
    expect(intent.title).toBe("Cursors Watch");
    expect(intent.subtitle).toBe("My Chat");
    expect(intent.message).toContain("turn ended");
    expect(intent.openUrl).toContain("conversationId=conv-42");
    expect(intent.sound).toBe(true);
  });
});

describe("deliverReminder adapters", () => {
  it("prefers first successful adapter (shell over hud)", () => {
    const shellCalls: ReminderDeliveryIntent[] = [];
    const hud = vi.fn(() => ({ ok: true as const, channel: "hud" as const }));
    const shell: ReminderDeliveryAdapter = {
      name: "shell",
      deliver(intent) {
        shellCalls.push(intent);
        return { ok: true, channel: "shell" };
      },
    };
    const result = deliverReminder({
      intent: buildDeliveryIntent({
        record: record(),
        sound: false,
        panelUrl: "http://127.0.0.1:7423/",
      }),
      adapters: [shell, { name: "hud", deliver: hud }],
    });
    expect(result).toEqual({ ok: true, channel: "shell" });
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0]!.notifyId).toBe("cursor-watch-reminder-conv-42");
    expect(hud).not.toHaveBeenCalled();
  });

  it("falls back to hud when shell reports unavailable", () => {
    const run = vi.fn();
    const shell: ReminderDeliveryAdapter = {
      name: "shell",
      deliver: () => ({ ok: false, channel: "shell" }),
    };
    const result = deliverReminder({
      intent: buildDeliveryIntent({
        record: record(),
        sound: false,
        panelUrl: "http://127.0.0.1:7423/",
      }),
      adapters: [shell, hudDeliveryAdapter({ run })],
    });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("hud");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns failure when all adapters fail without throwing", () => {
    const result = deliverReminder({
      intent: buildDeliveryIntent({
        record: record(),
        sound: false,
        panelUrl: "http://127.0.0.1:7423/",
      }),
      adapters: [
        { name: "shell", deliver: () => ({ ok: false, channel: "shell" }) },
        { name: "hud", deliver: () => ({ ok: false, channel: "hud" }) },
      ],
    });
    expect(result).toEqual({ ok: false, channel: "none" });
  });
});

describe("notifyReminder with adapters", () => {
  it("uses injected adapters instead of default argv run", () => {
    const seen: string[] = [];
    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      adapters: [
        {
          name: "shell",
          deliver: (intent) => {
            seen.push(`shell:${intent.conversationId}`);
            return { ok: true, channel: "shell" };
          },
        },
      ],
    });
    expect(seen).toEqual(["shell:conv-42"]);
  });
});

describe("shellDeliveryAdapter", () => {
  it("fails when shell.alive is absent and succeeds when present", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-shell-"));
    const intent = buildDeliveryIntent({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
    });
    const adapter = shellDeliveryAdapter(home);
    expect(adapter.deliver(intent)).toEqual({ ok: false, channel: "shell" });

    const dir = shellNotifyDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "shell.alive"), "1");
    expect(adapter.deliver(intent)).toEqual({ ok: true, channel: "shell" });
    const jsons = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(jsons).toHaveLength(1);
    const payload = JSON.parse(
      fs.readFileSync(path.join(dir, jsons[0]!), "utf8"),
    );
    expect(payload.notifyId).toBe("cursor-watch-reminder-conv-42");
    expect(payload.openUrl).toContain("conversationId=conv-42");
  });

  it("falls back when shell.alive is stale", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-shell-stale-"));
    const dir = shellNotifyDir(home);
    fs.mkdirSync(dir, { recursive: true });
    const alive = path.join(dir, "shell.alive");
    fs.writeFileSync(alive, "1");
    const old = Date.now() - 120_000;
    fs.utimesSync(alive, old / 1000, old / 1000);
    const intent = buildDeliveryIntent({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
    });
    expect(shellDeliveryAdapter(home).deliver(intent)).toEqual({
      ok: false,
      channel: "shell",
    });
  });
});
