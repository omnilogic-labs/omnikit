/**
 * Imagen resize subcommand — resize images using sharp.
 *
 * Common operation for preparing sprites, thumbnails, or assets.
 * Supports pixel art via --kernel nearest to avoid blurring.
 */

import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";
import { parseDimensions, writeImageBuffer } from "./util";

export function registerResize(program: Command): void {
  program
    .command("resize")
    .description("Resize an image (WxH, W, xH, or N%)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path")
    .argument("<dims>", "Target dimensions: WxH, W, xH, or N%")
    .option("--kernel <kernel>", "Resize kernel (nearest, cubic, lanczos3)", "lanczos3")
    .option("--fit <fit>", "Fit mode (cover, contain, fill, inside, outside)", "fill")
    .action(
      async (
        input: string,
        output: string,
        dims: string,
        opts: { kernel: string; fit: string }
      ) => {
        const parsed = parseDimensions(dims);
        // rotate() with no args bakes in EXIF orientation, so phone photos
        // resize the way they display instead of the way they are stored
        const img = sharp(input).rotate();
        const metadata = await img.metadata();
        const exifSwapped = (metadata.orientation ?? 1) >= 5;
        const srcWidth = exifSwapped ? metadata.height! : metadata.width!;
        const srcHeight = exifSwapped ? metadata.width! : metadata.height!;

        let width = parsed.width;
        let height = parsed.height;

        if (parsed.percentage) {
          width = Math.round((srcWidth * parsed.percentage) / 100);
          height = Math.round((srcHeight * parsed.percentage) / 100);
        }

        log.info(
          `Resizing: ${srcWidth}x${srcHeight} → ${width ?? "auto"}x${height ?? "auto"} (kernel: ${opts.kernel})`
        );

        // fit modes only make sense when both dimensions are pinned; passing
        // fill with a lone W or H stretches the free axis to its original size
        const bothDims = width !== undefined && height !== undefined;
        const buffer = await img
          .resize({
            width,
            height,
            kernel: opts.kernel as keyof sharp.KernelEnum,
            ...(bothDims ? { fit: opts.fit as keyof sharp.FitEnum } : {}),
          })
          .toBuffer();

        writeImageBuffer(output, buffer);
      }
    );
}
