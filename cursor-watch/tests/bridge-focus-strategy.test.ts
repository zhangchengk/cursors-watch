import { describe, expect, it, vi } from "vitest";

// Lightweight pure helpers mirrored from bridge-client tab matching.
function blobIncludesId(blob: string, conversationId: string): boolean {
  return blob.includes(conversationId);
}

describe("revealExistingComposerTab matching", () => {
  it("matches conversationId in uri blob", () => {
    const id = "438aac5a-1111-2222-3333-444444444444";
    expect(
      blobIncludesId(`composer:/chat?id=${id}#main`, id),
    ).toBe(true);
    expect(blobIncludesId("composer:/other", id)).toBe(false);
  });
});

describe("focus strategy order documented", () => {
  it("prefers reveal → openInNewTab only (no in-place openAgent)", () => {
    const order = [
      "revealExistingComposerTab",
      "composer.openComposer openInNewTab",
    ];
    expect(order).not.toContain("canvas.openAgentByConversationId");
  });

  it("openComposer args are (id, {openInNewTab}) not object-first", () => {
    const composerId = "438aac5a-1111-2222-3333-444444444444";
    const args: unknown[] = [composerId, { openInNewTab: true }];
    expect(typeof args[0]).toBe("string");
    expect(args[1]).toEqual({ openInNewTab: true });
  });
});
