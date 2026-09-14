/**
 * Imagen analyze subcommand — comprehensive image analysis.
 *
 * Combines local sharp metadata with Gemini AI structured analysis
 * to produce a detailed JSON report about an image.
 */

import { statSync } from "fs";
import { Command } from "commander";
import sharp from "sharp";
import { IMAGEN_MODEL, generateStructuredContent, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64 } from "./util";

interface LocalAnalysis {
  file: string;
  dimensions: { width: number; height: number };
  format: string;
  channels: number;
  hasAlpha: boolean;
  fileSize: { bytes: number; display: string };
  dominantColor: string;
  uniqueColors: number;
}

interface AIAnalysis {
  subjects: string[];
  style: string;
  contentType: string;
  quality: { score: number; issues: string[] };
  composition: { description: string; balance: string };
  colors: { dominant: string[]; coherence: string };
}

type FullAnalysis = LocalAnalysis & { ai: AIAnalysis };

const AI_SCHEMA = {
  type: "object",
  properties: {
    subjects: {
      type: "array",
      items: { type: "string" },
      description: "Main subjects or objects in the image",
    },
    style: {
      type: "string",
      description: "Visual style (e.g., photograph, pixel art, illustration, screenshot)",
    },
    contentType: {
      type: "string",
      description: "Content category (e.g., photo, icon, sprite, UI, diagram, art)",
    },
    quality: {
      type: "object",
      properties: {
        score: { type: "number", description: "Quality score 1-10" },
        issues: {
          type: "array",
          items: { type: "string" },
          description: "Quality issues found, if any",
        },
      },
      required: ["score", "issues"],
    },
    composition: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Brief composition description",
        },
        balance: { type: "string", description: "Visual balance assessment" },
      },
      required: ["description", "balance"],
    },
    colors: {
      type: "object",
      properties: {
        dominant: {
          type: "array",
          items: { type: "string" },
          description: "Top 3-5 dominant color names",
        },
        coherence: {
          type: "string",
          description: "Color palette coherence assessment",
        },
      },
      required: ["dominant", "coherence"],
    },
  },
  required: ["subjects", "style", "contentType", "quality", "composition", "colors"],
};

async function analyzeLocal(imagePath: string): Promise<LocalAnalysis> {
  const metadata = await sharp(imagePath).metadata();
  const stat = statSync(imagePath);
  const stats = await sharp(imagePath).stats();

  const sizeKb = (stat.size / 1024).toFixed(1);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  const display = stat.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

  const d = stats.dominant;
  const dominant = `#${d.r.toString(16).padStart(2, "0")}${d.g.toString(16).padStart(2, "0")}${d.b.toString(16).padStart(2, "0")}`;

  // Count unique colors (sample for large images)
  const { data, info } = await sharp(imagePath)
    .resize({ width: Math.min(metadata.width!, 256), kernel: "nearest" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (info.channels >= 4 && data[i + 3] === 0) continue;
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }

  return {
    file: imagePath,
    dimensions: { width: metadata.width!, height: metadata.height! },
    format: metadata.format!,
    channels: metadata.channels!,
    hasAlpha: metadata.hasAlpha ?? false,
    fileSize: { bytes: stat.size, display },
    dominantColor: dominant,
    uniqueColors: colors.size,
  };
}

export function registerAnalyze(program: Command): void {
  program
    .command("analyze")
    .description("Comprehensive image analysis (local metadata + AI)")
    .argument("<image>", "Path to the image file")
    .option("--model <model>", "Gemini model override")
    .option("--local-only", "Skip AI analysis, only show local metadata")
    .option("--json", "Output compact JSON")
    .action(
      async (image: string, opts: { model?: string; localOnly?: boolean; json?: boolean }) => {
        if (opts.json) log.toStderr();

        const local = await analyzeLocal(image);

        if (opts.localOnly) {
          if (opts.json) {
            console.log(JSON.stringify(local, null, 2));
          } else {
            console.log(JSON.stringify(local, null, 2));
          }
          return;
        }

        const model = opts.model ?? IMAGEN_MODEL;
        log.dim(`Using ${model}`);

        const { base64, mimeType } = loadImageAsBase64(image);
        const parts: Part[] = [
          { inlineData: { data: base64, mimeType } },
          { text: "Analyze this image comprehensively." },
        ];

        const ai = await generateStructuredContent<AIAnalysis>(model, parts, AI_SCHEMA);

        const full: FullAnalysis = { ...local, ai };

        if (opts.json) {
          console.log(JSON.stringify(full));
        } else {
          console.log(JSON.stringify(full, null, 2));
        }
      }
    );
}
