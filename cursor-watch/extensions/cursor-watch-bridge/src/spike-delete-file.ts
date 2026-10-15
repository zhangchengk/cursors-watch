import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import {
  listDeleteInterestingCommands,
  probeDeleteByConversationId,
} from "./delete-probe";
import { classifySpikeVerdict } from "./spike-verdict";

export type SpikeDeleteRequest = {
  conversationId: string;
  /** Optional; for logs only */
  note?: string;
};

export function spikeDeleteRequestPath(home = os.homedir()): string {
  return path.join(home, ".cursor-watch", "spike-delete-request.json");
}

export function spikeDeleteResultPath(home = os.homedir()): string {
  return path.join(home, ".cursor-watch", "spike-delete-result.json");
}

/**
 * If ~/.cursor-watch/spike-delete-request.json exists, run auto delete probe,
 * write result, and remove the request file (one-shot).
 */
export async function maybeRunSpikeDeleteFromFile(opts: {
  log: (line: string) => void;
  executeCommand: typeof vscode.commands.executeCommand;
  getCommands: typeof vscode.commands.getCommands;
  home?: string;
}): Promise<boolean> {
  const home = opts.home ?? os.homedir();
  const reqPath = spikeDeleteRequestPath(home);
  if (!fs.existsSync(reqPath)) return false;

  let raw: string;
  try {
    raw = fs.readFileSync(reqPath, "utf8");
  } catch (err) {
    opts.log(`spike-delete: read request failed: ${err}`);
    return false;
  }

  let req: SpikeDeleteRequest;
  try {
    req = JSON.parse(raw) as SpikeDeleteRequest;
  } catch (err) {
    opts.log(`spike-delete: bad JSON: ${err}`);
    try {
      fs.unlinkSync(reqPath);
    } catch {
      /* ignore */
    }
    return false;
  }

  const conversationId =
    typeof req.conversationId === "string" ? req.conversationId.trim() : "";
  if (!conversationId) {
    opts.log("spike-delete: missing conversationId");
    try {
      fs.unlinkSync(reqPath);
    } catch {
      /* ignore */
    }
    return false;
  }

  opts.log(`spike-delete: auto probe ${conversationId}`);
  const attempts = await probeDeleteByConversationId(conversationId, {
    executeCommand: (c, ...a) => opts.executeCommand(c, ...a),
    getCommands: (f) => opts.getCommands(f),
    log: opts.log,
    autoNoConfirm: true,
  });
  const verdict = classifySpikeVerdict(attempts);
  const result = {
    at: new Date().toISOString(),
    conversationId,
    note: req.note ?? null,
    verdict,
    attempts,
    interestingDump: null as string[] | null,
  };

  try {
    const all = await opts.getCommands(false);
    result.interestingDump = listDeleteInterestingCommands(all);
  } catch {
    /* optional */
  }

  const outPath = spikeDeleteResultPath(home);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    opts.log(`spike-delete: wrote ${outPath}`);
  } catch (err) {
    opts.log(`spike-delete: write result failed: ${err}`);
  }

  try {
    fs.unlinkSync(reqPath);
  } catch {
    /* ignore */
  }
  return true;
}
