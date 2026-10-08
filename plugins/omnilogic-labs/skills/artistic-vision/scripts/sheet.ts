/**
 * Imagen sheet subcommand — split/assemble/analyze sprite sheets.
 *
 * Split and assemble are local sharp operations. Analyze uses Gemini
 * for AI-powered sprite sheet understanding.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import { Command } from "commander";
import sharp from "sharp";
import { IMAGEN_MODEL, generateStructuredContent, type Part } from "./google";
import { log } from "./log";
import {
  loadImageAsBase64,
  writeImageBuffer,
  splitSheet,
  assembleSheet,
  loadFramesFromDir,
} from "./util";

export function registerSheet(program: Command): void {
  const sheet = program.command("sheet").description("Sprite sheet split/assemble operations");

  sheet
    .command("split")
    .description("Split a sprite sheet into individual frames")
    .argument("<image>", "Sprite sheet image path")
    .requiredOption("--frame <WxH>", "Frame size as WxH")
    .requiredOption("--out <dir>", "Output directory for frames")
    .option("--prefix <prefix>", "Frame filename prefix", "frame")
    .action(async (image: string, opts: { frame: string; out: string; prefix: string }) => {
      const [fw, fh] = opts.frame.split("x").map(Number);
      if (!fw || !fh) {
        log.error("Frame size must be WxH (e.g., 16x16)");
        process.exit(1);
      }

      const metadata = await sharp(image).metadata();
      const imgWidth = metadata.width!;
      const imgHeight = metadata.height!;
      const cols = Math.floor(imgWidth / fw);
      const rows = Math.floor(imgHeight / fh);
      const total = cols * rows;

      log.info(
        `Splitting ${imgWidth}x${imgHeight} sheet into ${cols}x${rows} = ${total} frames (${fw}x${fh} each)`
      );

      const { buffers } = await splitSheet(image, fw, fh);

      mkdirSync(opts.out, { recursive: true });
      for (let i = 0; i < buffers.length; i++) {
        const idx = String(i).padStart(String(total).length, "0");
        const outPath = join(opts.out, `${opts.prefix}_${idx}.png`);
        writeImageBuffer(outPath, buffers[i]);
      }

      log.success(`Split into ${buffers.length} frames in ${opts.out}`);
    });

  sheet
    .command("assemble")
    .description("Assemble frames from a directory into a sprite sheet")
    .argument("<dir>", "Directory containing frame images")
    .requiredOption("--out <file>", "Output sprite sheet path")
    .option("--cols <n>", "Number of columns in the sheet")
    .action(async (dir: string, opts: { out: string; cols?: string }) => {
      const { buffers, frameWidth, frameHeight, files } = await loadFramesFromDir(dir);

      const cols = opts.cols ? parseInt(opts.cols, 10) : files.length;
      const rows = Math.ceil(files.length / cols);

      log.info(
        `Assembling ${files.length} frames (${frameWidth}x${frameHeight}) into ${cols}x${rows} sheet (${cols * frameWidth}x${rows * frameHeight})`
      );

      const buffer = await assembleSheet(buffers, frameWidth, frameHeight, cols);
      writeImageBuffer(opts.out, buffer);
    });

  const SHEET_ANALYZE_SCHEMA = {
    type: "object",
    properties: {
      frameCount: { type: "number", description: "Estimated total frames" },
      grid: {
        type: "object",
        properties: {
          cols: { type: "number" },
          rows: { type: "number" },
        },
        required: ["cols", "rows"],
      },
      frameSizeEstimate: {
        type: "object",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      emptyFrames: {
        type: "array",
        items: { type: "number" },
        description: "Indices of empty/blank frames (0-based)",
      },
      animationType: {
        type: "string",
        description: "e.g., walk cycle, idle, attack, mixed",
      },
      directionsDetected: {
        type: "array",
        items: { type: "string" },
        description: "e.g., down, up, left, right",
      },
      consistency: {
        type: "object",
        properties: {
          score: { type: "number", description: "1-10 consistency score" },
          issues: { type: "array", items: { type: "string" } },
        },
        required: ["score", "issues"],
      },
      description: {
        type: "string",
        description: "Brief description of the character/subject",
      },
    },
    required: [
      "frameCount",
      "grid",
      "frameSizeEstimate",
      "emptyFrames",
      "animationType",
      "directionsDetected",
      "consistency",
      "description",
    ],
  };

  sheet
    .command("analyze")
    .description("AI-powered sprite sheet analysis")
    .argument("<image>", "Sprite sheet image path")
    .option("--frame <WxH>", "Known frame size (improves accuracy)")
    .option("--model <model>", "Gemini model override")
    .option("--json", "Output structured JSON")
    .action(async (image: string, opts: { frame?: string; model?: string; json?: boolean }) => {
      if (opts.json) log.toStderr();

      const model = opts.model ?? IMAGEN_MODEL;
      const metadata = await sharp(image).metadata();
      const imgWidth = metadata.width!;
      const imgHeight = metadata.height!;

      // Local analysis: detect empty frames if frame size known
      const localEmpty: number[] = [];
      if (opts.frame) {
        const [fw, fh] = opts.frame.split("x").map(Number);
        if (fw && fh) {
          const { buffers } = await splitSheet(image, fw, fh);
          for (let i = 0; i < buffers.length; i++) {
            const { data, info } = await sharp(buffers[i])
              .raw()
              .ensureAlpha()
              .toBuffer({ resolveWithObject: true });

            let transparent = 0;
            for (let p = 0; p < data.length; p += info.channels) {
              if (data[p + 3] === 0) transparent++;
            }
            const total = info.width * info.height;
            if (transparent / total > 0.95) {
              localEmpty.push(i);
            }
          }
        }
      }

      // AI analysis
      log.dim(`Using ${model}`);
      const { base64, mimeType } = loadImageAsBase64(image);

      const frameHint = opts.frame ? ` The frame size is ${opts.frame}.` : "";

      const parts: Part[] = [
        { inlineData: { data: base64, mimeType } },
        {
          text: `Analyze this sprite sheet (${imgWidth}x${imgHeight}).${frameHint} Identify the grid layout, animation type, directions, and assess frame-to-frame consistency.`,
        },
      ];

      const ai = await generateStructuredContent<Record<string, unknown>>(
        model,
        parts,
        SHEET_ANALYZE_SCHEMA
      );

      // Merge local empty frame detection if available
      const result = {
        ...ai,
        dimensions: { width: imgWidth, height: imgHeight },
        ...(localEmpty.length > 0 ? { localEmptyFrames: localEmpty } : {}),
      };

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      console.log(JSON.stringify(result, null, 2));
    });
}
