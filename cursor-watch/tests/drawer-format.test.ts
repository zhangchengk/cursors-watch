import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  formatStatusSentence,
  isToolOnlyMessage,
  latestProgressText,
  pickReadableMessages,
} from "../src/web/drawer-format.js";

describe("formatRelativeTime", () => {
  const now = 1_000_000;
  it("formats buckets", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 2 * 3600_000, now)).toBe("2 小时前");
  });
});

describe("formatStatusSentence", () => {
  it("uses Chinese status and soft flags", () => {
    const s = formatStatusSentence(
      {
        status: "running",
        live: true,
        hasUnread: false,
        turnEnded: false,
        lastActivityAt: 1_000_000 - 120_000,
      },
      1_000_000,
    );
    expect(s).toContain("正在运行");
    expect(s).toContain("实时活跃");
    expect(s).toContain("2 分钟前");
    expect(s).not.toContain("turnEnded");
  });

  it("mentions unread in Chinese", () => {
    const s = formatStatusSentence(
      { status: "idle", hasUnread: true, lastActivityAt: 1_000_000 },
      1_000_000,
    );
    expect(s).toMatch(/未读/);
  });
});

describe("pickReadableMessages", () => {
  it("skips tool-only lines and keeps body text", () => {
    const picked = pickReadableMessages(
      [
        { role: "assistant", text: "[tool] Shell" },
        { role: "assistant", text: "[tool] AwaitShell" },
        { role: "assistant", text: "首轮全量冒烟全绿，loop 已停止。" },
        { role: "user", text: "继续" },
      ],
      2,
    );
    expect(picked).toHaveLength(2);
    expect(picked[0].text).toContain("冒烟");
    expect(picked[1].text).toBe("继续");
    expect(picked.every((m) => !isToolOnlyMessage(m.text))).toBe(true);
  });

  it("skips Cursor meta prompts like Briefly inform the user", () => {
    const picked = pickReadableMessages(
      [
        {
          role: "user",
          text: "Briefly inform the user about the task result and perform any follow-up actions (if needed). If there's no follow-ups needed, don't explicitly say that.",
        },
        { role: "assistant", text: "[tool] Shell" },
        {
          role: "assistant",
          text: "**三联巡检**（11:21） B1=1 B2=56",
        },
      ],
      2,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].text).toContain("三联巡检");
  });
});

describe("latestProgressText", () => {
  it("uses latest readable message for card subtitle", () => {
    const text = latestProgressText({
      recentMessages: [
        { role: "assistant", text: "[tool] Glob" },
        {
          role: "assistant",
          text: "Agent 按 /grill-me 走 grilling 流程；先对齐判定规则。",
        },
      ],
    });
    expect(text).toContain("grilling");
    expect(text).not.toMatch(/\[tool\]/);
  });

  it("prefers Agent assistant text over meta user prompts", () => {
    const text = latestProgressText({
      recentMessages: [
        {
          role: "user",
          text: "Briefly inform the user about the task result and perform any follow-up actions (if needed).",
        },
        { role: "assistant", text: "[tool] Shell" },
        {
          role: "assistant",
          text: "**三联巡检**（11:21） | B1 | 1 | B2 | 56",
        },
      ],
    });
    expect(text).toContain("三联巡检");
    expect(text).not.toMatch(/Briefly inform/i);
  });
});
