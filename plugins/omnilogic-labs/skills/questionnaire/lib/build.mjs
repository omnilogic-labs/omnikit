// Build a questionnaire page from a JSON spec. Runs under bun or node.
//
//   build.mjs [--embed] <spec.json> <out dir>
//
// Writes <out dir>/index.html and copies each image to <out dir>/images/, then
// prints JSON to stdout: { page, files } where files maps each published path
// ("images/01-render.png") to its copy on disk, ready for the Artifact tool's
// `files` input. With --embed, images go into the page as data: URIs and files
// is empty. Warnings and errors go to stderr; errors exit 1.
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
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};
// Artifact limits: 15 MB per binary file, 16 MB for the page itself.
const MB = 1024 * 1024;
const FILE_MAX = 15 * MB;
const PAGE_MAX = 16 * MB;
const WARN_AT = 4 * MB;

const str = (v) => typeof v === "string" && v.trim() !== "";

// An image is a path string or { path, caption?, alt? }.
const imagePath = (img) => (typeof img === "string" ? img : img?.path);

function checkImages(list, at, errs) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return errs.push(`${at}: must be a list`);
  list.forEach((img, k) => {
    const iat = `${at}[${k}]`;
    const path = imagePath(img);
    if (!str(path)) return errs.push(`${iat}: a path string, or an object with a path`);
    if (/^https?:/i.test(path)) {
      errs.push(`${iat}: download remote images first; the artifact page cannot load other sites`);
    }
    for (const key of ["caption", "alt"]) {
      if (typeof img === "object" && img[key] !== undefined && typeof img[key] !== "string")
        errs.push(`${iat}.${key}: must be a string`);
    }
  });
}

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
        checkImages(o.images, `${oat}.images`, errs);
        const v = o.value ?? o.label;
        if (values.has(v)) errs.push(`${oat}: duplicate value "${v}"`);
        values.add(v);
      });
    }
    checkImages(q.images, `${at}.images`, errs);
  });
  return errs;
}

// Keep "</script" and "<!--" out of the inline JSON.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const escHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Build the page. `baseDir` resolves relative image paths (the spec file's
 * dir). With `embed`, images become data: URIs. Returns
 * { html, images: [{ src, dest }], warnings } without touching disk.
 */
export function render(spec, baseDir, { embed = false } = {}) {
  const errs = validate(spec);
  if (errs.length) throw new Error(`invalid spec:\n  ${errs.join("\n  ")}`);
  const images = [];
  const warnings = [];
  const bySrc = new Map(); // one copy per source file, however often it is used
  let total = 0;
  const image = (img) => {
    const path = imagePath(img);
    const caption = (typeof img === "object" && img.caption) || "";
    const alt = (typeof img === "object" && img.alt) || caption;
    if (path.startsWith("data:")) return { path, caption, alt };
    const src = resolve(baseDir, path);
    if (bySrc.has(src)) return { path: bySrc.get(src), caption, alt };
    if (!existsSync(src) || !statSync(src).isFile())
      throw new Error(`image not found: ${path} (${src})`);
    const ext = extname(src).toLowerCase();
    if (!MIME[ext]) throw new Error(`not a web image (${Object.keys(MIME).join(" ")}): ${path}`);
    const size = statSync(src).size;
    if (size > FILE_MAX)
      throw new Error(`image over 15 MB, the artifact file limit: ${path} (shrink or convert it)`);
    if (size > WARN_AT)
      warnings.push(`${path} is ${(size / MB).toFixed(1)} MB; a jpg or webp loads faster`);
    total += size;
    let dest;
    if (embed) {
      dest = `data:${MIME[ext]};base64,${readFileSync(src).toString("base64")}`;
    } else {
      const safe =
        basename(src, extname(src))
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .slice(0, 60) || "image";
      dest = `images/${String(images.length + 1).padStart(2, "0")}-${safe}${ext}`;
      images.push({ src, dest });
    }
    bySrc.set(src, dest);
    return { path: dest, caption, alt };
  };
  const questions = spec.questions.map((q) => ({
    id: q.id,
    title: q.title,
    tag: q.tag ?? "",
    blocking: q.blocking === true,
    multi: q.multi === true,
    background: q.background ?? "",
    what_happened: q.what_happened ?? "",
    idk: q.idk,
    images: (q.images ?? []).map(image),
    options: q.options.map((o) => ({
      label: o.label,
      value: o.value ?? o.label,
      description: o.description ?? "",
      images: (o.images ?? []).map(image),
    })),
  }));
  const data = { title: spec.title, intro: spec.intro ?? "", questions };
  const page = readFileSync(join(here, "page.html"), "utf8");
  const app = readFileSync(join(here, "app.js"), "utf8");
  const html = page
    .replaceAll("__TITLE__", () => escHtml(spec.title))
    .replace("__SPEC__", () => jsonForScript(data))
    .replace("__APP__", () => app);
  if (embed && html.length > PAGE_MAX) {
    throw new Error(
      `embedded page is ${(html.length / MB).toFixed(1)} MB, over the 16 MB artifact limit; build without --embed`
    );
  }
  if (!embed && total > 64 * MB) {
    warnings.push("images total over 64 MB: publish them over several Artifact calls");
  }
  return { html, images, warnings };
}

/** Write <outDir>/index.html and the images; return { page, files }. */
export function build(specPath, outDir, { embed = false } = {}) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const { html, images, warnings } = render(spec, dirname(resolve(specPath)), { embed });
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
  return { page, files, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const embed = args.includes("--embed");
  const [specPath, outDir] = args.filter((a) => a !== "--embed");
  if (!specPath || !outDir) {
    console.error("usage: questionnaire [--embed] <spec.json> <out dir>");
    process.exit(2);
  }
  try {
    const { page, files, warnings } = build(specPath, outDir, { embed });
    for (const w of warnings) console.error(`questionnaire: warning: ${w}`);
    console.error(
      `questionnaire: wrote ${page}` +
        (embed ? " with images embedded" : ` and ${Object.keys(files).length} image(s)`)
    );
    console.log(JSON.stringify({ page, files }, null, 2));
  } catch (e) {
    console.error(`questionnaire: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
