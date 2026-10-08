/**
 * Imagen crop subcommand — crop an image region using sharp.
 *
 * Extract specific regions from sprite sheets, screenshots, or any
 * image. Takes x,y,w,h coordinates.
 */

import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";
import { parseRegion, writeImageBuffer } from "./util";

export function registerCrop(program: Command): void {
  program
    .command("crop")
    .description("Crop an image to a specific region (x,y,w,h)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path")
    .argument("<region>", "Crop region as x,y,w,h")
    .action(async (input: string, output: string, region: string) => {
      const { left, top, width, height } = parseRegion(region);

      log.info(`Cropping: region ${left},${top} ${width}x${height}`);

      const buffer = await sharp(input).extract({ left, top, width, height }).toBuffer();

      writeImageBuffer(output, buffer);
    });
}
