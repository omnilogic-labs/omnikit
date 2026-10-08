/**
 * Imagen compare subcommand — compare two images using Gemini.
 *
 * Useful for diffing before/after edits, comparing sprite variants,
 * or checking visual regressions.
 */

import { Command } from "commander";
import { getGoogleAI, IMAGEN_MODEL, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64 } from "./util";

export function registerCompare(program: Command): void {
  program
    .command("compare")
    .description("Compare two images and describe differences")
    .argument("<image1>", "First image file path")
    .argument("<image2>", "Second image file path")
    .argument(
      "[question]",
      "Optional comparison question",
      "Compare these two images. Describe the differences in detail."
    )
    .option("--model <model>", "Gemini model override")
    .action(async (image1: string, image2: string, question: string, opts: { model?: string }) => {
      const ai = getGoogleAI();
      const model = opts.model ?? IMAGEN_MODEL;
      const img1 = loadImageAsBase64(image1);
      const img2 = loadImageAsBase64(image2);

      log.dim(`Using ${model}`);

      const parts: Part[] = [
        { inlineData: { data: img1.base64, mimeType: img1.mimeType } },
        { inlineData: { data: img2.base64, mimeType: img2.mimeType } },
        { text: question },
      ];

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
      });

      const text = response.candidates?.[0]?.content?.parts
        ?.filter((p: Part) => p.text)
        .map((p: Part) => p.text)
        .join("\n");

      if (text) {
        console.log(text);
      } else {
        log.warn("No text response received.");
      }
    });
}
