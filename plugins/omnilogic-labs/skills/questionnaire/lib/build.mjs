// Build a questionnaire page from a JSON spec. Runs under bun or node.
//
//   build.mjs <spec.json> <out dir>
//
// Writes <out dir>/index.html and copies each image to <out dir>/images/, then
// prints JSON to stdout: { page, files } where files maps each published path
// ("images/01-render.png") to its copy on disk, ready for the Artifact tool's
// `files` input. Errors go to stderr with exit 1.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

const str = (v) => typeof v === "string" && v.trim() !== "";

/** Check a spec; return a list of problems, empty when it is valid. */
export function validate(spec) {
  const errs = [];
  if (spec === null || typeof spec !== "object") return ["spec must be a JSON object"];
  if (!str(spec.title)) errs.push("title: required string");
  if (spec.intro !== undefined && typeof spec.intro !== "string")
    errs.push("intro: must be a string");
  if (!Array.isArray(spec.questions) || spec.questions.length === 0) {
    errs.push("questions: required, at least one");
    return errs;
  }
  const ids = new Set();
  spec.questions.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (q === null || typeof q !== "object") return errs.push(`${at}: must be an object`);
    if (!str(q.id)) errs.push(`${at}.id: required string`);
    else if (ids.has(q.id)) errs.push(`${at}.id: duplicate id "${q.id}"`);
    else ids.add(q.id);
    if (!str(q.title)) errs.push(`${at}.title: required string`);
    if (!str(q.idk))
      errs.push(`${at}.idk: required, what happens if the owner answers "I don't know"`);
    for (const k of ["tag", "background", "what_happened"]) {
      if (q[k] !== undefined && typeof q[k] !== "string") errs.push(`${at}.${k}: must be a string`);
    }
    for (const k of ["blocking", "multi"]) {
      if (q[k] !== undefined && typeof q[k] !== "boolean")
        errs.push(`${at}.${k}: must be true or false`);
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      errs.push(`${at}.options: required, at least one`);
    } else {
      const values = new Set();
      q.options.forEach((o, j) => {
        const oat = `${at}.options[${j}]`;
        if (o === null || typeof o !== "object" || !str(o.label))
          return errs.push(`${oat}.label: required string`);
        if (o.value !== undefined && !str(o.value))
          errs.push(`${oat}.value: must be a non-empty string`);
        if (o.description !== undefined && typeof o.description !== "string") {
          errs.push(`${oat}.description: must be a string`);
        }
        const v = o.value ?? o.label;
        if (values.has(v)) errs.push(`${oat}: duplicate value "${v}"`);
        values.add(v);
      });
    }
    if (q.images !== undefined) {
      if (!Array.isArray(q.images)) errs.push(`${at}.images: must be a list`);
      else
        q.images.forEach((img, k) => {
          const iat = `${at}.images[${k}]`;
          if (img === null || typeof img !== "object" || !str(img.path))
            errs.push(`${iat}.path: required string`);
          else if (/^https?:/i.test(img.path)) {
            errs.push(
              `${iat}.path: download remote images first; the artifact page cannot load other sites`
            );
          }
        });
    }
  });
  return errs;
}

// Keep "</script" and "<!--" out of the inline JSON.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const escHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Build the page. `baseDir` resolves relative image paths (the spec file's
 * dir). Returns { html, images: [{ src, dest }] } without touching disk.
 */
export function render(spec, baseDir) {
  const errs = validate(spec);
  if (errs.length) throw new Error(`invalid spec:\n  ${errs.join("\n  ")}`);
  const images = [];
  let n = 0;
  const questions = spec.questions.map((q) => ({
    id: q.id,
    title: q.title,
    tag: q.tag ?? "",
    blocking: q.blocking === true,
    multi: q.multi === true,
    background: q.background ?? "",
    what_happened: q.what_happened ?? "",
    idk: q.idk,
    options: q.options.map((o) => ({
      label: o.label,
      value: o.value ?? o.label,
      description: o.description ?? "",
    })),
    images: (q.images ?? []).map((img) => {
      if (img.path.startsWith("data:")) return { path: img.path, caption: img.caption ?? "" };
      const src = resolve(baseDir, img.path);
      if (!existsSync(src) || !statSync(src).isFile())
        throw new Error(`image not found: ${img.path} (${src})`);
      const ext = extname(src).toLowerCase();
      if (!IMAGE_EXT.has(ext))
        throw new Error(`not a web image (${[...IMAGE_EXT].join(" ")}): ${img.path}`);
      n += 1;
      const safe =
        basename(src, extname(src))
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .slice(0, 60) || "image";
      const dest = `images/${String(n).padStart(2, "0")}-${safe}${ext}`;
      images.push({ src, dest });
      return { path: dest, caption: img.caption ?? "" };
    }),
  }));
  const data = { title: spec.title, intro: spec.intro ?? "", questions };
  const page = readFileSync(join(here, "page.html"), "utf8");
  const app = readFileSync(join(here, "app.js"), "utf8");
  const html = page
    .replaceAll("__TITLE__", () => escHtml(spec.title))
    .replace("__SPEC__", () => jsonForScript(data))
    .replace("__APP__", () => app);
  return { html, images };
}

/** Write <outDir>/index.html and the images; return { page, files }. */
export function build(specPath, outDir) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const { html, images } = render(spec, dirname(resolve(specPath)));
  const out = resolve(outDir);
  mkdirSync(join(out, "images"), { recursive: true });
  const files = {};
  for (const img of images) {
    const dest = join(out, img.dest);
    copyFileSync(img.src, dest);
    files[img.dest] = dest;
  }
  const page = join(out, "index.html");
  writeFileSync(page, html);
  return { page, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specPath, outDir] = process.argv.slice(2);
  if (!specPath || !outDir) {
    console.error("usage: questionnaire <spec.json> <out dir>");
    process.exit(2);
  }
  try {
    const result = build(specPath, outDir);
    console.error(
      `questionnaire: wrote ${result.page} and ${Object.keys(result.files).length} image(s)`
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`questionnaire: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
