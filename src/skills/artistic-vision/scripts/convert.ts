/**
 * Imagen convert subcommand — convert image format using sharp.
 *
 * Quick format conversion between PNG, JPEG, WebP, and AVIF
 * without needing external tools. Detects target format from extension.
 */

import { Command } from "commander";
import sharp from "sharp";
import { extname } from "path";
import { log } from "./log";
import { writeImageBuffer } from "./util";

const FORMAT_MAP: Record<string, keyof sharp.FormatEnum> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
  ".avif": "avif",
};

export function registerConvert(program: Command): void {
  program
    .command("convert")
    .description("Convert image format (detected from output extension)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path (format from extension)")
    .option("--quality <n>", "Quality for lossy formats (1-100)", "80")
    .action(async (input: string, output: string, opts: { quality: string }) => {
      const ext = extname(output).toLowerCase();
      const format = FORMAT_MAP[ext];

      if (!format) {
        log.error(`Unsupported output format: ${ext}. Use .png, .jpg, .webp, or .avif`);
        process.exit(1);
      }

      const quality = parseInt(opts.quality, 10);
      const inputMeta = await sharp(input).metadata();

      log.info(`Converting: ${String(inputMeta.format)} → ${String(format)}`);

      // PNG is lossless: sharp treats a `quality` option on it as a request
      // to palette-quantize, silently crushing the image to 256 colours.
      // That is never what someone converting *to* PNG wants, so only pass
      // quality to the genuinely lossy formats.
      const buffer = await sharp(input)
        .toFormat(format, format === "png" ? {} : { quality })
        .toBuffer();

      writeImageBuffer(output, buffer);
    });
}
