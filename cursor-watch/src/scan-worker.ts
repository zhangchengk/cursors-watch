import { parentPort, workerData } from "node:worker_threads";
import { scanProjects } from "./scanner.js";

const { projectsDir, homeDir } = workerData as {
  projectsDir: string;
  homeDir: string;
};

try {
  parentPort?.postMessage(scanProjects(projectsDir, homeDir));
} catch (err) {
  parentPort?.postMessage({ error: err instanceof Error ? err.message : String(err) });
}
