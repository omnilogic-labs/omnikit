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

// What the band above the prompt shows about omsg mail.
export type MailBand = {
  // Unread mail for the owner.
  owner: number;
};

declare module "claude-code" {
  interface PluginState {
    "omnilogic-labs": { jobs: WorkerJob[]; mail: MailBand };
  }
}
