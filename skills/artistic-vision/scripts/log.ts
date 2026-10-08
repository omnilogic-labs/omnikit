/** Colored console output for CLI scripts. No dependencies. */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

let useStderr = false;

function out(msg: string): void {
  if (useStderr) {
    process.stderr.write(msg + "\n");
  } else {
    console.log(msg);
  }
}

export const log = {
  info: (msg: string) => out(`${CYAN}${msg}${RESET}`),
  success: (msg: string) => out(`${GREEN}${msg}${RESET}`),
  warn: (msg: string) => out(`${YELLOW}${msg}${RESET}`),
  error: (msg: string) => console.error(`${RED}${msg}${RESET}`),
  dim: (msg: string) => out(`${DIM}${msg}${RESET}`),
  step: (n: number, total: number, msg: string) =>
    out(`${BOLD}${CYAN}[${n}/${total}]${RESET} ${msg}`),
  /** Route all non-error output to stderr so stdout stays clean for JSON. */
  toStderr: () => {
    useStderr = true;
  },
};
