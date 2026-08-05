import { describe, expect, it } from "vitest";
import { preferredFocusCommands } from "../extensions/cursor-watch-bridge/src/focus-probe.js";

describe("preferredFocusCommands", () => {
  it("orders PREFERRED first then other composer open/focus", () => {
    expect(
      preferredFocusCommands([
        "composer.openChatAsEditor",
        "zzz.other",
        "composer.focusComposer",
        "canvas.openAgentByConversationId",
      ]),
    ).toEqual([
      "canvas.openAgentByConversationId",
      "composer.focusComposer",
      "composer.openChatAsEditor",
    ]);
  });

  it("excludes cloud / backgroundComposer commands", () => {
    expect(
      preferredFocusCommands([
        "canvas.openAgentByConversationId",
        "workbench.action.backgroundComposer.openCloudAgentById",
      ]),
    ).toEqual(["canvas.openAgentByConversationId"]);
  });
});
