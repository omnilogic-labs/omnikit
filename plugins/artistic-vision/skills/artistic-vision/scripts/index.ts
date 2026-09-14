/**
 * Artistic Vision CLI: image understanding, generation, editing, and manipulation.
 *
 * A general-purpose AI image intelligence toolkit. Gemini-powered subcommands
 * handle AI tasks (describe, generate, edit, compare, analyze, ocr, detect,
 * extract, diff). Sharp-powered subcommands handle local manipulation
 * (info, resize, upscale, crop, palette, optimize, sheet, convert).
 */

import { Command } from "commander";

// Gemini-powered
import { registerDescribe } from "./describe";
import { registerGenerate } from "./generate";
import { registerEdit } from "./edit";
import { registerCompare } from "./compare";
import { registerAnalyze } from "./analyze";
import { registerOCR } from "./ocr";
import { registerDetect } from "./detect";
import { registerExtract } from "./extract";
import { registerKey } from "./key";
import { registerDiff } from "./diff";
import { registerBatch } from "./batch";

// Sharp-powered (local, no API)
import { registerInfo } from "./info";
import { registerResize } from "./resize";
import { registerUpscale } from "./upscale";
import { registerCrop } from "./crop";
import { registerPalette } from "./palette";
import { registerOptimize } from "./optimize";
import { registerSheet } from "./sheet";
import { registerConvert } from "./convert";

const program = new Command()
  .name("art")
  .description("Image understanding, generation, editing, and manipulation")
  .version("3.0.0");

// Gemini-powered
registerDescribe(program);
registerGenerate(program);
registerEdit(program);
registerCompare(program);
registerAnalyze(program);
registerOCR(program);
registerDetect(program);
registerExtract(program);
registerKey(program);
registerDiff(program);
registerBatch(program);

// Sharp-powered (local, no API)
registerInfo(program);
registerResize(program);
registerUpscale(program);
registerCrop(program);
registerPalette(program);
registerOptimize(program);
registerSheet(program);
registerConvert(program);

program.parse();
