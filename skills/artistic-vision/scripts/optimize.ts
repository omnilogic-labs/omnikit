/**
 * Imagen optimize subcommand — smart web image optimization.
 *
 * Analyzes an image and converts to the optimal format/quality/size
 * for web use. All local via sharp, no API needed.
 */

import { statSync } from "fs";
import { extname } from "path";
import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";
import { writeImageBuffer } from "./util";

interface OptimizeResult {
  input: { path: string; format: string; size: number; dimensions: string };
  output: {
    path: string;
    format: string;
    size: number;
    quality: number;
    dimensions: string;
  };
  savings: { bytes: number; percent: number };
}

const WEB_FORMATS: Record<string, keyof sharp.FormatEnum> = {
  ".webp": "webp",
  ".avif": "avif",
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
};

function detectBestFormat(
  hasAlpha: boolean,
  uniqueColors: number
): { format: keyof sharp.FormatEnum; ext: string } {
  // Pixel art / simple graphics with few colors — keep PNG
  if (uniqueColors < 256) {
    return { format: "png", ext: ".png" };
  }
  // Alpha required — WebP handles it well
  if (hasAlpha) {
    return { format: "webp", ext: ".webp" };
  }
  // Photos / complex images — WebP for best compression
  return { format: "webp", ext: ".webp" };
}

async function findQualityForSize(
  input: string,
  format: keyof sharp.FormatEnum,
  targetBytes: number,
  maxWidth?: number
): Promise<{ buffer: Buffer; quality: number; width: number; height: number }> {
  let low = 10;
  let high = 95;
  let bestBuffer: Buffer | null = null;
  let bestQuality = 80;

  const img = sharp(input);
  if (maxWidth) {
    const meta = await sharp(input).metadata();
    if (meta.width! > maxWidth) {
      img.resize({ width: maxWidth });
    }
  }

  // Binary search for optimal quality
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const buf = await img.clone().toFormat(format, { quality: mid }).toBuffer();

    if (buf.length <= targetBytes) {
      bestBuffer = buf;
      bestQuality = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!bestBuffer) {
    bestBuffer = await img.toFormat(format, { quality: 10 }).toBuffer();
    bestQuality = 10;
  }

  const meta = await sharp(bestBuffer).metadata();
  return {
    buffer: bestBuffer,
    quality: bestQuality,
    width: meta.width!,
    height: meta.height!,
  };
}

export function registerOptimize(program: Command): void {
  program
    .command("optimize")
    .description("Smart web image optimization (format, quality, size)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path")
    .option("--format <fmt>", "Force output format (webp, avif, png, jpeg)")
    .option("--quality <n>", "Quality 1-100 (default: auto)")
    .option("--max-width <n>", "Maximum width in pixels")
    .option("--target-size <kb>", "Target file size in KB")
    .option("--json", "Output optimization report as JSON")
    .action(
      async (
        input: string,
        output: string,
        opts: {
          format?: string;
          quality?: string;
          maxWidth?: string;
          targetSize?: string;
          json?: boolean;
        }
      ) => {
        if (opts.json) log.toStderr();

        const inputMeta = await sharp(input).metadata();
        const inputStat = statSync(input);
        const maxWidth = opts.maxWidth ? parseInt(opts.maxWidth, 10) : undefined;

        // Determine output format
        let format: keyof sharp.FormatEnum;
        if (opts.format) {
          format = opts.format as keyof sharp.FormatEnum;
        } else {
          const outExt = extname(output).toLowerCase();
          if (WEB_FORMATS[outExt]) {
            format = WEB_FORMATS[outExt];
          } else {
            // Auto-detect best format
            const { data, info } = await sharp(input)
              .resize({
                width: Math.min(inputMeta.width!, 128),
                kernel: "nearest",
              })
              .raw()
              .ensureAlpha()
              .toBuffer({ resolveWithObject: true });

            const colors = new Set<string>();
            for (let i = 0; i < data.length; i += info.channels) {
              if (info.channels >= 4 && data[i + 3] === 0) continue;
              colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
            }

            const detected = detectBestFormat(inputMeta.hasAlpha ?? false, colors.size);
            format = detected.format;
          }
        }

        let buffer: Buffer;
        let quality: number;
        let outWidth: number;
        let outHeight: number;

        if (opts.targetSize) {
          const targetBytes = parseInt(opts.targetSize, 10) * 1024;
          const result = await findQualityForSize(input, format, targetBytes, maxWidth);
          buffer = result.buffer;
          quality = result.quality;
          outWidth = result.width;
          outHeight = result.height;
        } else {
          quality = opts.quality ? parseInt(opts.quality, 10) : 80;
          let pipe = sharp(input);
          if (maxWidth && inputMeta.width! > maxWidth) {
            pipe = pipe.resize({ width: maxWidth });
          }
          buffer = await pipe.toFormat(format, { quality }).toBuffer();
          const outMeta = await sharp(buffer).metadata();
          outWidth = outMeta.width!;
          outHeight = outMeta.height!;
        }

        writeImageBuffer(output, buffer);

        const savings = inputStat.size - buffer.length;
        const savingsPercent = Math.round((savings / inputStat.size) * 10000) / 100;

        const result: OptimizeResult = {
          input: {
            path: input,
            format: inputMeta.format!,
            size: inputStat.size,
            dimensions: `${inputMeta.width}x${inputMeta.height}`,
          },
          output: {
            path: output,
            format,
            size: buffer.length,
            quality,
            dimensions: `${outWidth}x${outHeight}`,
          },
          savings: { bytes: savings, percent: savingsPercent },
        };

        if (opts.json) {
          console.log(JSON.stringify(result));
          return;
        }

        // Human-readable summary
        const inSize = (inputStat.size / 1024).toFixed(1);
        const outSize = (buffer.length / 1024).toFixed(1);
        log.info(
          `${String(inputMeta.format)} → ${String(format)} | ${inSize} KB → ${outSize} KB | ${savingsPercent > 0 ? `-${savingsPercent}%` : `+${Math.abs(savingsPercent)}%`}`
        );
        if (maxWidth && inputMeta.width! > maxWidth) {
          log.dim(`Resized: ${inputMeta.width}x${inputMeta.height} → ${outWidth}x${outHeight}`);
        }
      }
    );
}
