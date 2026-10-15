import * as vscode from "vscode";
import {
  focusLocalAgentByConversationId,
  startBridgeClient,
} from "./bridge-client";
import {
  AGE_BATCH_DELETE_COMMANDS,
  listDeleteInterestingCommands,
  probeDeleteByConversationId,
} from "./delete-probe";
import {
  listInterestingCommands,
  probeCanvasOpenOnly,
  probeFocusByConversationId,
} from "./focus-probe";
import { maybeRunSpikeDeleteFromFile } from "./spike-delete-file";
import { classifySpikeVerdict } from "./spike-verdict";

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Cursors Watch Bridge");
  const version =
    (context.extension.packageJSON as { version?: string })?.version ?? "0.1.0";

  const bridge = startBridgeClient({
    extensionVersion: version,
    log: (line) => out.appendLine(line),
    executeFocus: focusLocalAgentByConversationId,
  });

  void maybeRunSpikeDeleteFromFile({
    log: (line) => out.appendLine(line),
    executeCommand: (c, ...a) => vscode.commands.executeCommand(c, ...a),
    getCommands: (f) => vscode.commands.getCommands(f),
  }).then((ran) => {
    if (ran) out.show(true);
  });

  const confirmVisualFocus = async () => {
    const pick = await vscode.window.showInformationMessage(
      "Did the correct Agent chat focus?",
      "Yes",
      "No",
    );
    return pick === "Yes";
  };

  const confirmVisualDeleted = async () => {
    const pick = await vscode.window.showInformationMessage(
      "Did that Agent chat disappear from the sidebar?",
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
    { dispose: () => bridge.dispose() },
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

    vscode.commands.registerCommand(
      "cursor-watch.bridge.dumpDeleteCommands",
      async () => {
        const all = await vscode.commands.getCommands(false);
        const ids = listDeleteInterestingCommands(all);
        out.clear();
        out.appendLine(`Delete/remove/purge/composer-ish commands (${ids.length}):`);
        for (const id of ids) out.appendLine(id);
        out.appendLine("");
        out.appendLine("Age-batch (not a per-id pass):");
        for (const id of AGE_BATCH_DELETE_COMMANDS) {
          out.appendLine(`  ${id}: ${all.includes(id) ? "PRESENT" : "absent"}`);
        }
        out.show(true);
        void vscode.window.showInformationMessage(
          `Dumped ${ids.length} delete-related commands to Output`,
        );
      },
    ),

    vscode.commands.registerCommand("cursor-watch.bridge.deleteById", async () => {
      const conversationId = await vscode.window.showInputBox({
        prompt:
          "Delete probe — paste unmarked conversationId (UUID). Do NOT use Todo/Archive ids.",
        placeHolder: "e.g. 4e1edc86-6661-4e22-a253-d493dc0886e3",
      });
      if (!conversationId?.trim()) return;

      const attempts = await probeDeleteByConversationId(conversationId.trim(), {
        executeCommand: (c, ...a) => vscode.commands.executeCommand(c, ...a),
        getCommands: (f) => vscode.commands.getCommands(f),
        log: (line) => out.appendLine(line),
        confirmVisualDeleted,
      });
      const verdict = classifySpikeVerdict(attempts);
      out.appendLine(`Delete spike verdict: ${verdict}`);
      out.appendLine(JSON.stringify(attempts, null, 2));
      out.show(true);
      void vscode.window.showInformationMessage(`Delete spike verdict: ${verdict}`);
    }),
  );
}

export function deactivate() {}
