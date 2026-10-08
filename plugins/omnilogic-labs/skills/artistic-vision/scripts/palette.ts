/**
 * Imagen palette subcommand — extract color palette from an image using sharp.
 *
 * Counts unique colors by frequency, useful for design consistency,
 * brand color extraction, and pixel art analysis. No API call needed.
 */

import { Command } from "commander";
import sharp from "sharp";
import { log } from "./log";

interface ColorEntry {
  hex: string;
  rgb: { r: number; g: number; b: number };
  count: number;
  percentage: number;
}

export async function paletteCore(
  imagePath: string,
  limit: number
): Promise<{ dominant: string; colors: ColorEntry[]; totalPixels: number }> {
  const { data, info } = await sharp(imagePath)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const totalPixels = info.width * info.height;
  const colorMap = new Map<string, number>();

  for (let i = 0; i < data.length; i += channels) {
    // Skip fully transparent pixels
    if (channels >= 4 && data[i + 3] === 0) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  const opaquePixels = [...colorMap.values()].reduce((a, b) => a + b, 0);

  const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  const colors: ColorEntry[] = sorted.map(([key, count]) => {
    const [r, g, b] = key.split(",").map(Number);
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    return {
      hex,
      rgb: { r, g, b },
      count,
      percentage: Math.round((count / opaquePixels) * 10000) / 100,
    };
  });

  const stats = await sharp(imagePath).stats();
  const d = stats.dominant;
  const dominant = `#${d.r.toString(16).padStart(2, "0")}${d.g.toString(16).padStart(2, "0")}${d.b.toString(16).padStart(2, "0")}`;

  return { dominant, colors, totalPixels };
}

export function registerPalette(program: Command): void {
  program
    .command("palette")
    .description("Extract color palette from an image")
    .argument("<image>", "Path to the image file")
    .option("--limit <n>", "Max colors to show", "16")
    .option("--json", "Output as JSON")
    .action(async (image: string, opts: { limit: string; json?: boolean }) => {
      if (opts.json) log.toStderr();

      const limit = parseInt(opts.limit, 10);
      const result = await paletteCore(image, limit);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Dominant: ${result.dominant}`);
      console.log(
        `Unique colors: ${result.colors.length}${result.colors.length >= limit ? "+" : ""}`
      );
      console.log();

      for (const c of result.colors) {
        const bar = "█".repeat(Math.max(1, Math.round(c.percentage / 2)));
        console.log(`  ${c.hex}  ${String(c.percentage).padStart(6)}%  ${bar}`);
      }
    });
}
