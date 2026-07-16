import type { ParsedTranscript } from "../parser/transcript.js";
import type { AgentStatus } from "../types.js";

export interface InferInput {
  parsed: ParsedTranscript;
  now: number;
  shellRunning: boolean;
  shellExitCode: number | null;
  subagentRunning: number;
}

export interface InferResult {
  status: AgentStatus;
  currentAction: string;
  waitingSince?: number;
  runningSince?: number;
}

export function inferSessionFields(input: InferInput): InferResult {
  const { parsed, now, shellRunning, shellExitCode, subagentRunning } = input;

  if (parsed.lastToolFailed || (shellExitCode !== null && shellExitCode !== 0)) {
    return {
      status: "error",
      currentAction: parsed.lastToolFailed
        ? `工具失败: ${parsed.lastToolName ?? "unknown"}`
        : `终端退出码 ${shellExitCode}`,
    };
  }

  const running =
    parsed.hadToolUseRecently || shellRunning || parsed.lastMessageHadToolUse;

  if (running) {
    const action = parsed.lastToolName
      ? parsed.lastToolCommand
        ? `${parsed.lastToolName}: ${truncate(parsed.lastToolCommand, 60)}`
        : parsed.lastToolName
      : shellRunning
        ? "Shell 运行中"
        : "运行中";
    return {
      status: "running",
      currentAction: action,
      runningSince: parsed.lastActivityAt,
    };
  }

  if (subagentRunning > 0) {
    return {
      status: "subagent",
      currentAction: `${subagentRunning} 个子 Agent 运行中`,
      runningSince: parsed.lastActivityAt,
    };
  }

  if (parsed.lastRole === "assistant") {
    return {
      status: "waiting",
      currentAction: "等待你回复",
      waitingSince: parsed.lastActivityAt,
    };
  }

  return {
    status: "idle",
    currentAction: parsed.lastRole === "user" ? "等待 Agent" : "空闲",
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
