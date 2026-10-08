/**
 * Imagen extract subcommand — AI-guided subject extraction / background removal.
 *
 * Simpler interface than crafting edit prompts manually.
 * Always outputs PNG to preserve transparency.
 */

import { extname } from "path";
import { Command } from "commander";
import { getGoogleAI, IMAGEN_MODEL, extractImageFromResponse, type Part } from "./google";
import { keyToAlpha, type KeyColor } from "./key";
import { log } from "./log";
import { loadImageAsBase64, writeImageBuffer } from "./util";
import { describeImage } from "./describe";

const KEY_HEX: Record<KeyColor, string> = {
  green: "#00FF00",
  magenta: "#FF00FF",
};

export function registerExtract(program: Command): void {
  program
    .command("extract")
    .description("Extract subject from image (remove background)")
    .argument("<input>", "Source image file path")
    .argument("<output>", "Output file path (should be .png for transparency)")
    .option("--subject <description>", "What to keep (default: the main subject)")
    .option("--key <color>", "Chroma key color: green or magenta", "green")
    .option("--model <model>", "Gemini model override")
    .option("--inspect [question]", "Auto-describe the result")
    .action(
      async (
        input: string,
        output: string,
        opts: {
          subject?: string;
          key: string;
          model?: string;
          inspect?: string | true;
        }
      ) => {
        const model = opts.model ?? IMAGEN_MODEL;
        const subject = opts.subject ?? "the main subject";
        const keyColor = opts.key as KeyColor;
        if (keyColor !== "green" && keyColor !== "magenta") {
          log.error(`Unsupported key color: ${opts.key} (use green or magenta)`);
          process.exit(1);
        }

        if (extname(output).toLowerCase() !== ".png") {
          log.warn("Output should be .png to preserve transparency.");
        }

        log.dim(`Using ${model}`);
        log.info(`Extracting: "${subject}" (${keyColor} key)`);

        const ai = getGoogleAI();
        const { base64, mimeType } = loadImageAsBase64(input);

        // The model cannot emit real alpha (asking for transparency yields a
        // painted checkerboard), so render onto a solid key color and key it
        // out locally afterwards.
        const parts: Part[] = [
          { inlineData: { data: base64, mimeType } },
          {
            text:
              `Keep only ${subject} from this image, exactly as it appears — identical pixels, detail, lighting and scale. ` +
              `Replace everything else with one flat, solid, pure ${keyColor} (${KEY_HEX[keyColor]}). ` +
              `The background must be a single uniform ${keyColor} with no gradients, no shadows, no texture, and absolutely no checkerboard pattern.`,
          },
        ];

        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        });

        const buffer = extractImageFromResponse(response);
        if (!buffer) {
          log.error("No image in response.");
          const text = response.candidates?.[0]?.content?.parts
            ?.filter((p: { text?: string }) => p.text)
            .map((p: { text?: string }) => p.text)
            .join("\n");
          if (text) {
            log.warn("Model returned text instead:");
            console.log(text);
          }
          process.exit(1);
        }

        const { png, keyedFraction } = await keyToAlpha(buffer, keyColor);
        if (keyedFraction < 0.03) {
          log.warn(
            `Only ${(keyedFraction * 100).toFixed(1)}% of pixels keyed out — the model likely ignored the ${keyColor} background request; inspect the result.`
          );
        }
        writeImageBuffer(output, png);

        if (opts.inspect !== undefined) {
          const question =
            typeof opts.inspect === "string" && opts.inspect !== ""
              ? opts.inspect
              : "Describe the extracted subject. Was the background fully removed? Any quality issues?";
          log.dim("\n--- Inspect ---");
          try {
            const description = await describeImage(output, question);
            console.log(description);
          } catch (e) {
            log.warn(`Inspect failed: ${(e as Error).message}`);
          }
        }
      }
    );
}
