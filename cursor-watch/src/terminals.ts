export interface TerminalMeta {
  pid: number | null;
  cwd: string | null;
  exitCode: number | null;
  running: boolean;
}

export function parseTerminalMeta(text: string): TerminalMeta {
  const headerMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const header = headerMatch?.[1] ?? "";
  const pid = header.match(/^pid:\s*(\d+)/m);
  const cwd = header.match(/^cwd:\s*(.+)$/m);
  const exit = header.match(/^exit_code:\s*(-?\d+)/m);
  const exitCode = exit ? Number(exit[1]) : null;
  return {
    pid: pid ? Number(pid[1]) : null,
    cwd: cwd ? cwd[1].trim() : null,
    exitCode,
    running: exitCode === null && pid !== null,
  };
}
