/**
 * Shared utilities for imagen CLI subcommands.
 *
 * Image loading, writing, and dimension parsing are shared across
 * all subcommands. Centralizing avoids duplication and keeps each
 * subcommand focused on its own logic.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { dirname, extname, join } from "path";
import sharp from "sharp";
import { log } from "./log";

/** Load an image file and return base64 string + MIME type. */
export function loadImageAsBase64(path: string): {
  base64: string;
  mimeType: string;
} {
  const buffer = readFileSync(path);
  const ext = extname(path).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
  };
  const mimeType = mimeMap[ext] ?? "image/png";
  return { base64: buffer.toString("base64"), mimeType };
}

/** Write a Buffer to a file, creating parent directories as needed. */
export function writeImageBuffer(path: string, buffer: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  log.success(`Wrote ${path}`);
}

/** Extensions we can re-encode into, mapped to sharp's format name. */
const ENCODABLE: Record<string, "png" | "jpeg" | "webp" | "avif" | "tiff"> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
  ".avif": "avif",
  ".tif": "tiff",
  ".tiff": "tiff",
};

/**
 * Write a model-generated image, re-encoding it to match the requested
 * extension.
 *
 * The Gemini image models return whatever format they like — usually JPEG —
 * regardless of the filename you asked for. Writing those bytes verbatim to
 * `out.png` produces a file that lies about itself: `file` reports JPEG, and
 * strict readers reject it (pdf-lib's embedPng rightly refuses JPEG bytes).
 * The mismatch is invisible until something downstream breaks, so normalise
 * here rather than leaving every caller to remember.
 */
export async function writeGeneratedImage(path: string, buffer: Buffer): Promise<void> {
  const target = ENCODABLE[extname(path).toLowerCase()];
  if (!target) {
    writeImageBuffer(path, buffer);
    return;
  }

  const actual = (await sharp(buffer).metadata()).format;
  if (actual === target) {
    writeImageBuffer(path, buffer);
    return;
  }

  // PNG is lossless, so re-encoding a JPEG into it adds no further loss.
  const out = await sharp(buffer).toFormat(target).toBuffer();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  log.success(`Wrote ${path} (re-encoded ${actual ?? "unknown"} → ${target})`);
}

/** Parsed dimensions from strings like "128x64", "256", "x128", "50%". */
export interface Dimensions {
  width?: number;
  height?: number;
  percentage?: number;
}

/** Parse a dimension string: "WxH", "W", "xH", or "N%". */
export function parseDimensions(input: string): Dimensions {
  if (input.endsWith("%")) {
    const pct = parseInt(input.slice(0, -1), 10);
    if (isNaN(pct) || pct <= 0) throw new Error(`Invalid percentage: ${input}`);
    return { percentage: pct };
  }

  const match = input.match(/^(\d+)?x(\d+)?$/i);
  if (match) {
    const w = match[1] ? parseInt(match[1], 10) : undefined;
    const h = match[2] ? parseInt(match[2], 10) : undefined;
    if (!w && !h) throw new Error(`Invalid dimensions: ${input}`);
    return { width: w, height: h };
  }

  const n = parseInt(input, 10);
  if (!isNaN(n) && n > 0) return { width: n };

  throw new Error(`Invalid dimensions: ${input}. Use WxH, W, xH, or N% format.`);
}

/** Split a sprite sheet into individual frame buffers. */
export async function splitSheet(
  imagePath: string,
  frameWidth: number,
  frameHeight: number
): Promise<{ buffers: Buffer[]; cols: number; rows: number }> {
  const metadata = await sharp(imagePath).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  const cols = Math.floor(imgWidth / frameWidth);
  const rows = Math.floor(imgHeight / frameHeight);

  const buffers: Buffer[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const buffer = await sharp(imagePath)
        .extract({
          left: col * frameWidth,
          top: row * frameHeight,
          width: frameWidth,
          height: frameHeight,
        })
        .toBuffer();
      buffers.push(buffer);
    }
  }

  return { buffers, cols, rows };
}

/** Assemble frame buffers into a sprite sheet. */
export async function assembleSheet(
  frames: Buffer[],
  frameWidth: number,
  frameHeight: number,
  cols: number
): Promise<Buffer> {
  const rows = Math.ceil(frames.length / cols);
  const sheetWidth = cols * frameWidth;
  const sheetHeight = rows * frameHeight;

  const composites: sharp.OverlayOptions[] = frames.map((input, i) => ({
    input,
    left: (i % cols) * frameWidth,
    top: Math.floor(i / cols) * frameHeight,
  }));

  return sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/** Load all image files from a directory as sorted buffers. Returns buffers + frame dimensions from first image. */
export async function loadFramesFromDir(dir: string): Promise<{
  buffers: Buffer[];
  frameWidth: number;
  frameHeight: number;
  files: string[];
}> {
  const files = readdirSync(dir)
    .filter((f) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new Error(`No image files found in ${dir}`);
  }

  const firstFrame = await sharp(join(dir, files[0])).metadata();
  const frameWidth = firstFrame.width!;
  const frameHeight = firstFrame.height!;

  const buffers = await Promise.all(files.map((f) => sharp(join(dir, f)).toBuffer()));

  return { buffers, frameWidth, frameHeight, files };
}

/** Parse a region string "x,y,w,h" into extract options. */
export function parseRegion(input: string): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const parts = input.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(`Invalid region: ${input}. Use x,y,w,h format.`);
  }
  const [left, top, width, height] = parts;
  if (width <= 0 || height <= 0) {
    throw new Error("Region width and height must be positive.");
  }
  return { left, top, width, height };
}
