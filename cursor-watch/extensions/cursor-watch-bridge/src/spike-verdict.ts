export type SpikeVerdict = "pass" | "fragile_pass" | "fail";

export type ProbeAttempt = {
  strategy: "command" | "cdp";
  ok: boolean;
  detail: string;
};

export function classifySpikeVerdict(attempts: ProbeAttempt[]): SpikeVerdict {
  if (attempts.some((a) => a.strategy === "command" && a.ok)) return "pass";
  if (attempts.some((a) => a.strategy === "cdp" && a.ok)) return "fragile_pass";
  return "fail";
}
