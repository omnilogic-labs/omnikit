/**
 * Imagen info subcommand — print image metadata using sharp.
 *
 * Quick way to check dimensions, format, channels, and file size
 * without opening an image editor. No API call needed.
 */

import { statSync } from "fs";
import { Command } from "commander";
import sharp from "sharp";

export function registerInfo(program: Command): void {
  program
    .command("info")
    .description("Print image dimensions, format, channels, and file size")
    .argument("<image>", "Path to the image file")
    .action(async (image: string) => {
      const metadata = await sharp(image).metadata();
      const stat = statSync(image);

      const sizeKb = (stat.size / 1024).toFixed(1);
      const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
      const sizeStr = stat.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

      console.log(`File:       ${image}`);
      console.log(`Format:     ${metadata.format}`);
      console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
      console.log(`Channels:   ${metadata.channels}`);
      console.log(`Color space: ${metadata.space}`);
      console.log(`File size:  ${sizeStr} (${stat.size} bytes)`);
      if (metadata.density) {
        console.log(`Density:    ${metadata.density} DPI`);
      }
      if (metadata.hasAlpha) {
        console.log(`Alpha:      yes`);
      }
    });
}
