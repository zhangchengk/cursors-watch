import { describe, expect, it } from "vitest";
import { daemonSpawnShellCommand, softNofileLimit } from "../src/nofile.js";

describe("nofile helpers", () => {
  it("softNofileLimit returns a positive number", () => {
    expect(softNofileLimit()).toBeGreaterThan(0);
  });

  it("daemonSpawnShellCommand raises ulimit then execs node", () => {
    const cmd = daemonSpawnShellCommand(
      "/usr/bin/node",
      ["--import", "tsx"],
      "/app/cli.ts",
      ["daemon"],
      "/tmp/cw.log",
    );
    expect(cmd).toContain("ulimit -n 65536");
    expect(cmd).toContain("CURSOR_WATCH_NOFILE_RAISED=1");
    expect(cmd).toContain('exec "/usr/bin/node" "--import" "tsx" "/app/cli.ts" "daemon" >>"/tmp/cw.log" 2>&1');
  });
});
