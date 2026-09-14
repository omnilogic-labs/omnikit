/**
 * Imagen describe subcommand — ask about or describe an image using Gemini.
 *
 * Also exports describeImage() for use by --inspect flag and other subcommands.
 */

import { Command } from "commander";
import { getGoogleAI, IMAGEN_MODEL, extractTextFromResponse, type Part } from "./google";
import { log } from "./log";
import { loadImageAsBase64 } from "./util";

/** Core describe logic — reusable by other subcommands (e.g., --inspect flag). */
export async function describeImage(
  imagePath: string,
  question = "Describe this image in detail.",
  model?: string
): Promise<string> {
  const ai = getGoogleAI();
  const m = model ?? IMAGEN_MODEL;
  const { base64, mimeType } = loadImageAsBase64(imagePath);

  const parts: Part[] = [{ inlineData: { data: base64, mimeType } }, { text: question }];

  const response = await ai.models.generateContent({
    model: m,
    contents: [{ role: "user", parts }],
  });

  const text = extractTextFromResponse(response);
  if (!text) {
    throw new Error("No text response received.");
  }
  return text;
}

export function registerDescribe(program: Command): void {
  program
    .command("describe")
    .description("Describe or ask questions about an image")
    .argument("<image>", "Path to the image file")
    .argument("[question]", "Optional question about the image", "Describe this image in detail.")
    .option("--model <model>", "Gemini model override")
    .action(async (image: string, question: string, opts: { model?: string }) => {
      log.dim(`Using ${opts.model ?? IMAGEN_MODEL}`);

      try {
        const text = await describeImage(image, question, opts.model);
        console.log(text);
      } catch (e) {
        log.warn((e as Error).message);
      }
    });
}
