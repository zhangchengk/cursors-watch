import {
  LOOP_COMMAND_FINGERPRINT_MAX,
  LOOP_SENTINEL_MARKERS,
} from "../constants.js";

export function isLoopSentinelCommand(command: string): boolean {
  if (!command) return false;
  return LOOP_SENTINEL_MARKERS.some((m) => command.includes(m));
}

export function fingerprintCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= LOOP_COMMAND_FINGERPRINT_MAX) return normalized;
  return normalized.slice(0, LOOP_COMMAND_FINGERPRINT_MAX);
}
