import { scanProjects } from "./scanner.js";

process.on("message", (msg: unknown) => {
  const data = msg as { projectsDir?: string; homeDir?: string };
  if (!data?.projectsDir || !data?.homeDir) {
    process.send?.({ error: "missing projectsDir/homeDir" });
    return;
  }
  try {
    process.send?.(scanProjects(data.projectsDir, data.homeDir));
  } catch (err) {
    process.send?.({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
