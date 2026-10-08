/**
 * Imagen detect subcommand — object detection with bounding boxes using Gemini.
 *
 * Identifies objects in images and returns their locations as bounding boxes.
 * Optionally draws the boxes on the image.
 */

import { Command } from "commander";
import sharp from "sharp";
import { IMAGEN_MODEL, generateStructuredContent, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64, writeImageBuffer } from "./util";

interface DetectedObject {
  label: string;
  box: { x: number; y: number; width: number; height: number };
}

interface DetectionResult {
  objects: DetectedObject[];
}

// Gemini returns boxes as [y0, x0, y1, x1] normalized to 0-1000
interface RawDetection {
  objects: Array<{
    label: string;
    box: [number, number, number, number];
  }>;
}

const DETECT_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Object label/name" },
          box: {
            type: "array",
            items: { type: "number" },
            description: "Bounding box as [y_min, x_min, y_max, x_max] normalized 0-1000",
          },
        },
        required: ["label", "box"],
      },
    },
  },
  required: ["objects"],
};

const BOX_COLORS = [
  "#FF4444",
  "#44FF44",
  "#4444FF",
  "#FFFF44",
  "#FF44FF",
  "#44FFFF",
  "#FF8844",
  "#8844FF",
  "#44FF88",
  "#FF4488",
];

function normalizeBoxes(raw: RawDetection, imgWidth: number, imgHeight: number): DetectionResult {
  return {
    objects: raw.objects.map((obj) => {
      const [y0, x0, y1, x1] = obj.box;
      return {
        label: obj.label,
        box: {
          x: Math.round((x0 / 1000) * imgWidth),
          y: Math.round((y0 / 1000) * imgHeight),
          width: Math.round(((x1 - x0) / 1000) * imgWidth),
          height: Math.round(((y1 - y0) / 1000) * imgHeight),
        },
      };
    }),
  };
}

async function drawBoxes(
  imagePath: string,
  objects: DetectedObject[],
  outputPath: string
): Promise<void> {
  const metadata = await sharp(imagePath).metadata();
  const w = metadata.width!;
  const h = metadata.height!;
  const thickness = Math.max(2, Math.round(Math.min(w, h) / 200));

  // Create SVG overlay with boxes and labels
  const rects = objects
    .map((obj, i) => {
      const color = BOX_COLORS[i % BOX_COLORS.length];
      const { x, y, width, height } = obj.box;
      const fontSize = Math.max(12, Math.round(Math.min(w, h) / 40));
      const labelY = y > fontSize + 4 ? y - 4 : y + height + fontSize + 2;

      return `
        <rect x="${x}" y="${y}" width="${width}" height="${height}"
              fill="none" stroke="${color}" stroke-width="${thickness}"/>
        <text x="${x + 2}" y="${labelY}" font-size="${fontSize}"
              fill="${color}" font-family="sans-serif" font-weight="bold"
              stroke="black" stroke-width="1" paint-order="stroke">
          ${obj.label}
        </text>`;
    })
    .join("\n");

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;

  const buffer = await sharp(imagePath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();

  writeImageBuffer(outputPath, buffer);
}

export function registerDetect(program: Command): void {
  program
    .command("detect")
    .description("Detect objects and return bounding boxes")
    .argument("<image>", "Path to the image file")
    .option("--model <model>", "Gemini model override")
    .option("--what <description>", "What to detect (default: all prominent objects)")
    .option("--draw <output>", "Draw boxes on the image and save to path")
    .option("--json", "Output structured JSON")
    .action(
      async (
        image: string,
        opts: { model?: string; what?: string; draw?: string; json?: boolean }
      ) => {
        if (opts.json) log.toStderr();

        const model = opts.model ?? IMAGEN_MODEL;
        log.dim(`Using ${model}`);

        const { base64, mimeType } = loadImageAsBase64(image);
        const what = opts.what ?? "all prominent objects";

        const parts: Part[] = [
          { inlineData: { data: base64, mimeType } },
          {
            text: `Detect ${what} in this image. Return bounding boxes as [y_min, x_min, y_max, x_max] with coordinates normalized to 0-1000.`,
          },
        ];

        const raw = await generateStructuredContent<RawDetection>(model, parts, DETECT_SCHEMA);

        const metadata = await sharp(image).metadata();
        const result = normalizeBoxes(raw, metadata.width!, metadata.height!);

        if (opts.draw) {
          await drawBoxes(image, result.objects, opts.draw);
        }

        if (opts.json) {
          console.log(JSON.stringify(result));
          return;
        }

        // Default: human-readable
        log.info(`Found ${result.objects.length} object(s)`);
        for (const obj of result.objects) {
          const { x, y, width, height } = obj.box;
          console.log(`  ${obj.label}: ${x},${y} ${width}x${height}`);
        }
      }
    );
}
