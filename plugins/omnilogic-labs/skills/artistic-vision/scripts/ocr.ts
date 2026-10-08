/**
 * Imagen ocr subcommand — extract text from images using Gemini.
 *
 * Handles screenshots, UI mockups, documents, diagrams, handwriting,
 * code in images, photos of whiteboards, and more.
 */

import { Command } from "commander";
import { IMAGEN_MODEL, generateStructuredContent, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64 } from "./util";

interface OCRBlock {
  text: string;
  type: "heading" | "body" | "code" | "label" | "caption" | "other";
}

interface OCRResult {
  blocks: OCRBlock[];
  language: string;
}

const OCR_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The extracted text content" },
          type: {
            type: "string",
            enum: ["heading", "body", "code", "label", "caption", "other"],
            description: "Type of text block",
          },
        },
        required: ["text", "type"],
      },
      description: "Text blocks found in the image, in reading order",
    },
    language: {
      type: "string",
      description: "Primary language detected (e.g., 'en', 'ja', 'mixed')",
    },
  },
  required: ["blocks", "language"],
};

export function registerOCR(program: Command): void {
  program
    .command("ocr")
    .description("Extract text from an image (OCR)")
    .argument("<image>", "Path to the image file")
    .option("--model <model>", "Gemini model override")
    .option("--plain", "Output plain text only (no structure)")
    .option("--json", "Output structured JSON")
    .action(async (image: string, opts: { model?: string; plain?: boolean; json?: boolean }) => {
      if (opts.json || opts.plain) log.toStderr();

      const model = opts.model ?? IMAGEN_MODEL;
      log.dim(`Using ${model}`);

      const { base64, mimeType } = loadImageAsBase64(image);
      const parts: Part[] = [
        { inlineData: { data: base64, mimeType } },
        {
          text: "Extract all visible text from this image. Preserve the text exactly as written. Identify each distinct text block and classify its type. Return blocks in natural reading order.",
        },
      ];

      const result = await generateStructuredContent<OCRResult>(model, parts, OCR_SCHEMA);

      if (opts.plain) {
        console.log(result.blocks.map((b) => b.text).join("\n\n"));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      // Default: human-readable
      if (result.language !== "en") {
        log.dim(`Language: ${result.language}`);
      }
      for (const block of result.blocks) {
        if (block.type !== "body" && block.type !== "other") {
          log.dim(`[${block.type}]`);
        }
        console.log(block.text);
        console.log();
      }
    });
}
