/**
 * Imagen key subcommand — chroma-key a solid backdrop to true alpha, locally.
 *
 * The generative models cannot emit an alpha channel; the reliable pattern is
 * to render the subject on a saturated solid color and key that color out.
 * This does the keying (soft matte + despill) with sharp, no API call.
 */

import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";
import { writeImageBuffer } from "./util";

export type KeyColor = "green" | "magenta";

/**
 * keyness: how strongly a pixel reads as the key color, 0..1, relative to its
 * brightness — a dark green (60,40,40) must key as hard as neon (0,255,0),
 * because the model often renders the requested backdrop darker than asked.
 */
function keyness(r: number, g: number, b: number, color: KeyColor): number {
  const dom = color === "green" ? g - Math.max(r, b) : Math.min(r, b) - g;
  const ref = color === "green" ? g : Math.max(r, b);
  return dom <= 0 ? 0 : dom / Math.max(1, ref);
}

/**
 * Turn every key-colored pixel transparent (soft-edged) and pull the key
 * color's spill back out of edge pixels. Returns the PNG plus the fraction
 * of pixels that were keyed away, so callers can tell when the model ignored
 * the key-color request entirely.
 */
export async function keyToAlpha(
  input: Buffer | string,
  color: KeyColor
): Promise<{ png: Buffer; keyedFraction: number }> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // full transparency above HI, full opacity below LO, soft ramp between
  const LO = 0.08;
  const HI = 0.28;
  let keyed = 0;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    const k = keyness(r, g, b, color);
    if (k <= LO) continue;
    const t = Math.min(1, (k - LO) / (HI - LO));
    const a = Math.round(data[o + 3] * (1 - t));
    data[o + 3] = a;
    if (a === 0) keyed++;
    // despill: clamp the key channel to the others on surviving edge pixels
    if (a > 0) {
      if (color === "green") {
        data[o + 1] = Math.min(g, Math.max(r, b));
      } else {
        const cap = g;
        data[o] = Math.min(r, cap);
        data[o + 2] = Math.min(b, cap);
      }
    }
  }

  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return { png, keyedFraction: keyed / px };
}

export function registerKey(program: Command): void {
  program
    .command("key")
    .description("Chroma-key a solid green/magenta backdrop to transparency (local)")
    .argument("<input>", "Source image with a solid key-color background")
    .argument("<output>", "Output file path (.png)")
    .option("--color <color>", "Key color: green or magenta", "green")
    .option("--trim", "Trim fully transparent borders from the result")
    .action(async (input: string, output: string, opts: { color: string; trim?: boolean }) => {
      const color = opts.color as KeyColor;
      if (color !== "green" && color !== "magenta") {
        log.error(`Unsupported key color: ${opts.color} (use green or magenta)`);
        process.exit(1);
      }
      let { png, keyedFraction } = await keyToAlpha(input, color);
      if (keyedFraction < 0.03) {
        log.warn(
          `Only ${(keyedFraction * 100).toFixed(1)}% of pixels keyed out — the background probably is not solid ${color}.`
        );
      }
      if (opts.trim) {
        png = await sharp(png).trim().png().toBuffer();
      }
      writeImageBuffer(output, png);
      log.info(`Keyed ${(keyedFraction * 100).toFixed(1)}% of pixels to transparent.`);
    });
}
