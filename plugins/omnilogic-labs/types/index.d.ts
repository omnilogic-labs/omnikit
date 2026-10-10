export type WorkerEngine = "codex" | "agy" | "fake";

export type WorkerStatus = "running" | "done" | "failed";

export type WorkerJob = {
  id: string;
  sessionId: string;
  engine: WorkerEngine;
  cwd: string;
  task: string;
  dir: string;
  taskId: string | null;
  timeoutSec: number;
  lines: number;
  lastLine: string;
  status: WorkerStatus;
  exitCode: number | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
};

// What the band above the prompt shows about the owner inbox.
export type InboxBand = {
  url: string;
  // Items in "Do now" that the owner has not marked done or dismissed.
  waiting: number;
  // How many of those this session posted.
  mine: number;
};

declare module "claude-code" {
  interface PluginState {
    "omnilogic-labs": { jobs: WorkerJob[]; inbox: InboxBand };
  }
}
