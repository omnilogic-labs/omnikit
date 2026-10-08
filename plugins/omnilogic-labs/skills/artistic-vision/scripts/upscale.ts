/**
 * Imagen upscale subcommand — integer nearest-neighbor upscale.
 *
 * Shortcut for the common pattern of scaling pixel art, icons, or
 * low-res assets by an integer multiplier without blurring.
 */

import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";
import { writeImageBuffer } from "./util";

export function registerUpscale(program: Command): void {
  program
    .command("upscale")
    .description("Upscale an image by integer multiplier (nearest-neighbor)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path")
    .argument("<scale>", "Integer scale multiplier (2, 3, 4, 8, etc.)")
    .action(async (input: string, output: string, scaleStr: string) => {
      const scale = parseInt(scaleStr, 10);
      if (isNaN(scale) || scale < 1) {
        log.error("Scale must be a positive integer.");
        process.exit(1);
      }

      const metadata = await sharp(input).metadata();
      const width = metadata.width! * scale;
      const height = metadata.height! * scale;

      log.info(
        `Upscaling: ${metadata.width}x${metadata.height} → ${width}x${height} (${scale}x nearest-neighbor)`
      );

      const buffer = await sharp(input).resize({ width, height, kernel: "nearest" }).toBuffer();

      writeImageBuffer(output, buffer);
    });
}
