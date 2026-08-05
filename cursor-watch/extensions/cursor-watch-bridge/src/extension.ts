import * as vscode from "vscode";
import { listInterestingCommands, probeFocusByConversationId } from "./focus-probe";
import { classifySpikeVerdict } from "./spike-verdict";

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Cursors Watch Bridge");

  context.subscriptions.push(
    out,
    vscode.commands.registerCommand("cursor-watch.bridge.dumpCommands", async () => {
      const ids = await listInterestingCommands((f) => vscode.commands.getCommands(f));
      out.clear();
      out.appendLine(`Cursor commands matching composer|chat|agent (${ids.length}):`);
      for (const id of ids) out.appendLine(id);
      out.show(true);
      void vscode.window.showInformationMessage(`Dumped ${ids.length} commands to Output`);
    }),

    vscode.commands.registerCommand("cursor-watch.bridge.focusById", async () => {
      const conversationId = await vscode.window.showInputBox({
        prompt: "conversationId / composerId",
        placeHolder: "uuid from Watch card / composerHeaders",
      });
      if (!conversationId?.trim()) return;

      const attempts = await probeFocusByConversationId(conversationId.trim(), {
        executeCommand: (c, ...a) => vscode.commands.executeCommand(c, ...a),
        getCommands: (f) => vscode.commands.getCommands(f),
        log: (line) => out.appendLine(line),
        confirmVisualFocus: async () => {
          const pick = await vscode.window.showInformationMessage(
            "Did the correct Agent chat focus?",
            "Yes",
            "No",
          );
          return pick === "Yes";
        },
      });
      const verdict = classifySpikeVerdict(attempts);
      out.appendLine(`Verdict: ${verdict}`);
      out.appendLine(JSON.stringify(attempts, null, 2));
      out.show(true);
      void vscode.window.showInformationMessage(`Spike verdict: ${verdict}`);
    }),
  );
}

export function deactivate() {}
