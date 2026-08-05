import * as vscode from "vscode";
import {
  listInterestingCommands,
  probeCanvasOpenOnly,
  probeFocusByConversationId,
} from "./focus-probe";
import { classifySpikeVerdict } from "./spike-verdict";

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Cursors Watch Bridge");

  const confirmVisualFocus = async () => {
    const pick = await vscode.window.showInformationMessage(
      "Did the correct Agent chat focus?",
      "Yes",
      "No",
    );
    return pick === "Yes";
  };

  const runProbe = async (
    title: string,
    runner: typeof probeFocusByConversationId,
  ) => {
    const conversationId = await vscode.window.showInputBox({
      prompt: `${title} — paste Watch conversationId (UUID)`,
      placeHolder: "e.g. 4e1edc86-6661-4e22-a253-d493dc0886e3",
    });
    if (!conversationId?.trim()) return;

    const attempts = await runner(conversationId.trim(), {
      executeCommand: (c, ...a) => vscode.commands.executeCommand(c, ...a),
      getCommands: (f) => vscode.commands.getCommands(f),
      log: (line) => out.appendLine(line),
      confirmVisualFocus,
    });
    const verdict = classifySpikeVerdict(attempts);
    out.appendLine(`Verdict: ${verdict}`);
    out.appendLine(JSON.stringify(attempts, null, 2));
    out.show(true);
    void vscode.window.showInformationMessage(`Spike verdict: ${verdict}`);
  };

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
      await runProbe("Focus (multi)", probeFocusByConversationId);
    }),

    vscode.commands.registerCommand("cursor-watch.bridge.focusCanvasOnly", async () => {
      await runProbe("Focus (canvas only)", probeCanvasOpenOnly);
    }),
  );
}

export function deactivate() {}
