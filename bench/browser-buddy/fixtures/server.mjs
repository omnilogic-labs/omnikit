// Fixture server for the browser-buddy evaluation harness.
//
// Serves the planted-defect site and appends every request to an access log.
// The access log is ground truth for what a trial actually visited, which is
// how coverage claims in a report get checked against reality.
//
// Usage: PORT=8900 LOG=/path/access.log node server.mjs

import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");
const PORT = Number(process.env.PORT || 8900);
const LOG = process.env.LOG || "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function log(method, url, status) {
  if (!LOG) return;
  await appendFile(LOG, `${new Date().toISOString()}\t${method}\t${url}\t${status}\n`).catch(
    () => {}
  );
}

// Planted defect: row 27 carries a negative price, and it only lives on page 3.
function tableRows() {
  const rows = [];
  for (let i = 1; i <= 30; i++) {
    const price = i === 27 ? -14 : 8 + ((i * 7) % 40);
    rows.push({ id: `SKU-${String(1000 + i)}`, name: `Component ${i}`, price });
  }
  return rows;
}

function tablePage(page) {
  const rows = tableRows();
  const start = (page - 1) * 10;
  const slice = rows.slice(start, start + 10);
  const body = slice
    .map(
      (r) =>
        `<tr><td>${r.id}</td><td>${r.name}</td><td class="price">${
          r.price < 0 ? "-$" + Math.abs(r.price).toFixed(2) : "$" + r.price.toFixed(2)
        }</td></tr>`
    )
    .join("\n      ");
  const prev =
    page > 1 ? `<a href="/table.html?page=${page - 1}">Previous</a>` : "<span>Previous</span>";
  const next = page < 3 ? `<a href="/table.html?page=${page + 1}">Next</a>` : "<span>Next</span>";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Price list, page ${page} of 3</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
  <h1>Price list</h1>
  <p>Page ${page} of 3. Showing items ${start + 1} to ${start + slice.length} of 30.</p>
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th>Unit price</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>
  <nav class="pager">${prev} | Page ${page} of 3 | ${next}</nav>
  <p><a href="/">Back to index</a></p>
</body>
</html>`;
}

function receiptPage() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Order confirmed</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
  <h1>Order confirmed</h1>
  <p class="confirm">Thank you. Your order number is <strong>ORD-90210</strong>.</p>
  <p>A confirmation email is on its way. Keep the order number for your records.</p>
  <p><a href="/">Back to index</a></p>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  const send = async (status, type, body) => {
    await log(req.method, req.url, status);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  // Planted defect: a real 404, linked from the nav on links.html.
  if (path === "/gone") {
    return send(
      404,
      "text/html; charset=utf-8",
      "<!doctype html><title>404</title><h1>404 Not Found</h1>"
    );
  }

  // Planted defect: the inventory call on console-error.html always fails.
  if (path === "/api/inventory") {
    return send(
      500,
      "application/json; charset=utf-8",
      '{"error":"inventory service unavailable"}'
    );
  }

  if (path === "/receipt") {
    return send(200, "text/html; charset=utf-8", receiptPage());
  }

  if (path === "/table.html") {
    const page = Math.min(3, Math.max(1, Number(url.searchParams.get("page") || 1)));
    return send(200, "text/html; charset=utf-8", tablePage(page));
  }

  const rel = path === "/" ? "/index.html" : path;
  const file = join(SITE, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(SITE)) return send(403, "text/plain", "forbidden");

  try {
    const buf = await readFile(file);
    const ext = file.slice(file.lastIndexOf("."));
    return send(200, TYPES[ext] || "application/octet-stream", buf);
  } catch {
    return send(
      404,
      "text/html; charset=utf-8",
      "<!doctype html><title>404</title><h1>404 Not Found</h1>"
    );
  }
});

server.listen(PORT, () => {
  process.stderr.write(`fixture server on http://localhost:${PORT}\n`);
});
