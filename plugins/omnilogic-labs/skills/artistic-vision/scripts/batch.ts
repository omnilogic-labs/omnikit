/**
 * Imagen batch subcommand — run any subcommand across multiple files.
 *
 * Resolves a glob pattern and applies the specified operation to each
 * file, with configurable concurrency for API operations.
 */

import { globSync, statSync } from "fs";
import { Command } from "commander";
import { log } from "./log";
import { describeImage } from "./describe";
import { paletteCore } from "./palette";

// Core functions for batchable subcommands
const BATCH_HANDLERS: Record<string, (file: string, args: string[]) => Promise<unknown>> = {
  describe: async (file, args) => {
    const question = args.join(" ") || undefined;
    return { file, result: await describeImage(file, question) };
  },
  palette: async (file, args) => {
    const limit = args[0] ? parseInt(args[0], 10) : 16;
    return { file, result: await paletteCore(file, limit) };
  },
  info: async (file) => {
    const sharp = (await import("sharp")).default;
    const { statSync } = await import("fs");
    const metadata = await sharp(file).metadata();
    const stat = statSync(file);
    return {
      file,
      result: {
        format: metadata.format,
        dimensions: `${metadata.width}x${metadata.height}`,
        channels: metadata.channels,
        hasAlpha: metadata.hasAlpha ?? false,
        fileSize: stat.size,
      },
    };
  },
};

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function registerBatch(program: Command): void {
  program
    .command("batch")
    .description("Run a subcommand across multiple files matching a glob")
    .argument("<subcommand>", `Subcommand to run (${Object.keys(BATCH_HANDLERS).join(", ")})`)
    .argument("<glob>", "File glob pattern (e.g., '*.png', 'sprites/**/*.png')")
    .argument("[args...]", "Additional arguments for the subcommand")
    .option(
      "--concurrency <n>",
      "Max concurrent operations (default: 3 for API, unlimited for local)",
      "3"
    )
    .option("--json", "Output results as JSON array")
    .action(
      async (
        subcommand: string,
        pattern: string,
        args: string[],
        opts: { concurrency: string; json?: boolean }
      ) => {
        if (opts.json) log.toStderr();

        const handler = BATCH_HANDLERS[subcommand];
        if (!handler) {
          log.error(
            `Unknown batch subcommand: ${subcommand}. Available: ${Object.keys(BATCH_HANDLERS).join(", ")}`
          );
          process.exit(1);
        }

        const files = (globSync(pattern) as unknown as string[]).filter((f) => {
          try {
            return !statSync(f).isDirectory();
          } catch {
            return false;
          }
        });
        if (files.length === 0) {
          log.warn(`No files matched: ${pattern}`);
          return;
        }

        files.sort();
        const concurrency = parseInt(opts.concurrency, 10);
        const isLocal = subcommand === "info";
        const effectiveConcurrency = isLocal ? files.length : concurrency;

        log.info(`Processing ${files.length} file(s) with ${subcommand}...`);

        const tasks = files.map((file, i) => async () => {
          log.step(i + 1, files.length, file);
          try {
            return await handler(file, args);
          } catch (e) {
            log.warn(`Failed: ${file} — ${(e as Error).message}`);
            return { file, error: (e as Error).message };
          }
        });

        const results = await runWithConcurrency(tasks, effectiveConcurrency);

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (!opts.json) {
          // Results already printed inline during processing for non-JSON mode
          for (const r of results) {
            if (r && typeof r === "object" && "result" in r) {
              const entry = r as { file: string; result: unknown };
              if (typeof entry.result === "string") {
                console.log(`\n${entry.file}:`);
                console.log(entry.result);
              }
            }
          }
          log.success(`\nDone: ${results.length} file(s) processed.`);
        }
      }
    );
}
