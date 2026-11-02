/**
 * Google GenAI client setup for imagen CLI.
 *
 * Self-contained wrapper around @google/genai with env validation,
 * shared model constants, and structured output helpers.
 */

import { GoogleGenAI, type Part } from "@google/genai";
import { log } from "./log";

export { type Part };

export function getGoogleAI(): GoogleGenAI {
  // GEMINI_API_KEY is the current name; GOOGLE_API_KEY kept as a fallback.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("Missing required environment variable: GEMINI_API_KEY");
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Nano Banana 2.1: the only image model. generate, edit and extract always use
 * it; there is no Flash/Pro choice.
 */
export const IMAGEN_MODEL = "gemini-nano-banana-2.1";

/**
 * Gemini 3.8 Flash, the text model behind anything that has to answer in words
 * or JSON.
 *
 * The image models cannot do it. They accept responseMimeType and
 * responseSchema without complaint, then reply with a single inlineData image
 * part and no text at all, which is what used to abort a judged run.
 */
export const VISION_MODEL = "gemini-3.8-flash";

/**
 * Image-only models, which answer with a picture whatever the config asks for.
 * Nano Banana 2.1's id has no "-image" in it, so match it by name too.
 */
function isImageOnlyModel(model: string): boolean {
  return model.includes("-image") || model.includes("nano-banana");
}

/**
 * Aspect ratios accepted by ImageConfig.aspectRatio.
 *
 * Taken from the API's own rejection message for Nano Banana 2.1, not the
 * SDK's ImageConfig typedoc, which omits several of them.
 */
export const ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "4:1",
  "8:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

/**
 * Sizes Nano Banana 2.1 accepts for ImageConfig.imageSize. Uppercase K is
 * required; default 1K. The API also lists 512, but this model rejects it.
 */
export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;

export interface ImageShapeOpts {
  aspect?: string;
  size?: string;
}

/**
 * Build the `imageConfig` block for a generateContent image call.
 *
 * Returns undefined when neither flag is set, so the model's own defaults are
 * left alone. Invalid values exit rather than fall through: a typo'd aspect
 * ratio would otherwise be silently ignored and hand back a 1K square.
 */
export function buildImageConfig(
  opts: ImageShapeOpts
): { aspectRatio?: string; imageSize?: string } | undefined {
  const config: { aspectRatio?: string; imageSize?: string } = {};

  if (opts.aspect !== undefined) {
    if (!(ASPECT_RATIOS as readonly string[]).includes(opts.aspect)) {
      console.error(`Invalid --aspect "${opts.aspect}". Supported: ${ASPECT_RATIOS.join(", ")}`);
      process.exit(1);
    }
    config.aspectRatio = opts.aspect;
  }

  if (opts.size !== undefined) {
    if (!(IMAGE_SIZES as readonly string[]).includes(opts.size)) {
      console.error(`Invalid --size "${opts.size}". Supported: ${IMAGE_SIZES.join(", ")}`);
      process.exit(1);
    }
    config.imageSize = opts.size;
  }

  return Object.keys(config).length ? config : undefined;
}

/**
 * Extract the first image part from a Gemini response as a base64 buffer.
 * Returns null if the response contains no image data.
 */
export function extractImageFromResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any
): Buffer | null {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  return null;
}

/**
 * Extract text from a Gemini response.
 * Returns null if no text content found.
 */
export function extractTextFromResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any
): string | null {
  const text = response.candidates?.[0]?.content?.parts
    ?.filter((p: Part) => p.text)
    .map((p: Part) => p.text)
    .join("\n");
  return text || null;
}

/**
 * Generate structured JSON output from Gemini using a JSON schema.
 * Guarantees the response conforms to the provided schema.
 */
export async function generateStructuredContent<T>(
  model: string,
  parts: Part[],
  jsonSchema: object
): Promise<T> {
  const ai = getGoogleAI();
  // Send the request to a text model even when the caller named an image one:
  // the schema is ignored by the image models, and an image comes back instead.
  const textModel = isImageOnlyModel(model) ? VISION_MODEL : model;
  if (textModel !== model) {
    log.dim(`${model} cannot return JSON, asking ${textModel} instead`);
  }

  const response = await ai.models.generateContent({
    model: textModel,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: jsonSchema as never,
    },
  });

  const text = extractTextFromResponse(response);
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason;
    throw new Error(
      `No text in ${textModel} response${reason ? ` (finishReason: ${reason})` : ""}`
    );
  }
  return JSON.parse(text) as T;
}

/**
 * Judge an image against criteria and return a score.
 * Always uses the Flash text model: it reads images and can return JSON.
 */
export async function judgeImage(
  imagePath: string,
  criteria: string,
  loadImage: (path: string) => { base64: string; mimeType: string }
): Promise<{ score: number; reasoning: string }> {
  const { base64, mimeType } = loadImage(imagePath);
  return generateStructuredContent<{ score: number; reasoning: string }>(
    VISION_MODEL,
    [
      { inlineData: { data: base64, mimeType } },
      {
        text: `Rate this image on a scale of 1-10 based on the following criteria: ${criteria}\n\nBe critical and specific in your reasoning.`,
      },
    ],
    {
      type: "object",
      properties: {
        score: { type: "number", description: "Score from 1-10" },
        reasoning: {
          type: "string",
          description: "Brief explanation of the score",
        },
      },
      required: ["score", "reasoning"],
    }
  );
}
