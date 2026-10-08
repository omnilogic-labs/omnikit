/**
 * Imagen diff subcommand — structured semantic diff of two images.
 *
 * Combines pixel-level analysis (via sharp) with AI-powered semantic
 * understanding of what changed and whether it's an improvement.
 */

import { Command } from "commander";
import sharp from "sharp";
import { IMAGEN_MODEL, generateStructuredContent, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64 } from "./util";

interface DiffChange {
  category: "layout" | "color" | "content" | "quality" | "style" | "size";
  severity: "minor" | "moderate" | "major";
  description: string;
}

interface DiffResult {
  similarity: number;
  pixelDiffPercent: number;
  changes: DiffChange[];
  summary: string;
  isImprovement: boolean | null;
}

interface AIDiff {
  similarity: number;
  changes: DiffChange[];
  summary: string;
  isImprovement: boolean | null;
}

const DIFF_SCHEMA = {
  type: "object",
  properties: {
    similarity: { type: "number", description: "Overall similarity 0-100" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["layout", "color", "content", "quality", "style", "size"],
          },
          severity: { type: "string", enum: ["minor", "moderate", "major"] },
          description: { type: "string" },
        },
        required: ["category", "severity", "description"],
      },
    },
    summary: { type: "string", description: "One-sentence summary of changes" },
    isImprovement: {
      type: ["boolean", "null"],
      description: "Whether image2 is an improvement over image1, or null if not comparable",
    },
  },
  required: ["similarity", "changes", "summary", "isImprovement"],
};

async function pixelDiff(image1: string, image2: string): Promise<number> {
  // Resize both to same dimensions for comparison
  const size = 256;
  const buf1 = await sharp(image1).resize(size, size, { fit: "fill" }).raw().toBuffer();
  const buf2 = await sharp(image2).resize(size, size, { fit: "fill" }).raw().toBuffer();

  const len = Math.min(buf1.length, buf2.length);
  let diffPixels = 0;
  const totalPixels = size * size;
  const threshold = 30; // Ignore minor color differences

  for (let i = 0; i < len; i += 3) {
    const dr = Math.abs(buf1[i] - buf2[i]);
    const dg = Math.abs(buf1[i + 1] - buf2[i + 1]);
    const db = Math.abs(buf1[i + 2] - buf2[i + 2]);
    if (dr + dg + db > threshold) {
      diffPixels++;
    }
  }

  return Math.round((diffPixels / totalPixels) * 10000) / 100;
}

export function registerDiff(program: Command): void {
  program
    .command("diff")
    .description("Structured semantic diff of two images")
    .argument("<image1>", "First image (before)")
    .argument("<image2>", "Second image (after)")
    .option("--model <model>", "Gemini model override")
    .option("--json", "Output structured JSON")
    .action(async (image1: string, image2: string, opts: { model?: string; json?: boolean }) => {
      if (opts.json) log.toStderr();

      const model = opts.model ?? IMAGEN_MODEL;
      log.dim(`Using ${model}`);

      // Local pixel diff
      const pixelDiffPercent = await pixelDiff(image1, image2);

      // AI semantic diff
      const img1 = loadImageAsBase64(image1);
      const img2 = loadImageAsBase64(image2);

      const parts: Part[] = [
        { inlineData: { data: img1.base64, mimeType: img1.mimeType } },
        { inlineData: { data: img2.base64, mimeType: img2.mimeType } },
        {
          text: "Compare these two images (first is 'before', second is 'after'). Identify all meaningful differences, categorize them, and assess whether the second image is an improvement.",
        },
      ];

      const ai = await generateStructuredContent<AIDiff>(model, parts, DIFF_SCHEMA);

      const result: DiffResult = { ...ai, pixelDiffPercent };

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      // Human-readable output
      console.log(`Similarity: ${result.similarity}%`);
      console.log(`Pixel diff: ${result.pixelDiffPercent}%`);
      if (result.isImprovement !== null) {
        console.log(`Improvement: ${result.isImprovement ? "yes" : "no"}`);
      }
      console.log(`Summary: ${result.summary}`);

      if (result.changes.length > 0) {
        console.log("\nChanges:");
        for (const c of result.changes) {
          const icon = c.severity === "major" ? "!!!" : c.severity === "moderate" ? " !!" : "  !";
          console.log(`  ${icon} [${c.category}] ${c.description}`);
        }
      }
    });
}
