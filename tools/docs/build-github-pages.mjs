#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const source = join(root, "docs");
const destination = join(root, "_site");
const title = "Oxigraph semantic-parity extension";

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  }))).flat();
}

function pageShell(body, pageTitle, stylesheet) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle} · ${title}</title><link rel="stylesheet" href="${stylesheet}"></head>
<body><header><a href="/oxigraph/">Oxigraph semantic-parity extension</a><nav><a href="/oxigraph/research/semantic-parity-current-summary.html">Evidence</a><a href="/oxigraph/adr/README.html">ADRs</a><a href="/oxigraph/plans/semantic-parity-metaharness-plan.html">Plan</a></nav></header><main>${body}</main><footer>Published from the <a href="https://github.com/sparkling/oxigraph">sparkling/oxigraph</a> fork.</footer></body></html>`;
}

for (const file of await files(destination)) {
  if (!file.endsWith(".md")) continue;
  const output = file.replace(/\.md$/, ".html");
  const rendered = spawnSync("pandoc", [file, "--from=gfm", "--to=html5"], { encoding: "utf8" });
  if (rendered.status !== 0) throw new Error(rendered.stderr);
  const document = rendered.stdout
    .replace(/href="([^"#?]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"')
    .replace(/<body[^>]*>([\s\S]*)<\/body>/, (_, body) => pageShell(body, title, relative(join(output, ".."), join(destination, "site.css"))));
  const page = document.includes("<body")
    ? document
    : pageShell(document, title, relative(join(output, ".."), join(destination, "site.css")));
  await writeFile(output, page);
}

for (const file of await files(destination)) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(file, "utf8");
  const normalized = html.replace(/href="((?![a-z][a-z0-9+.-]*:)[^"#?]+)\.md(#[^"]*)?"/gi, 'href="$1.html$2"');
  const page = normalized.replace(
    /href="((?![a-z][a-z0-9+.-]*:)[^"#?]+)\.html(#[^"]*)?"/gi,
    (match, link, fragment = "") => {
      const target = resolve(dirname(file), `${link}.html`);
      const path = relative(destination, target);
      return path.startsWith("../")
        ? `href="https://github.com/sparkling/oxigraph/blob/main/${path.slice(3).replace(/\.html$/, ".md")}${fragment}"`
        : match;
    },
  );
  await writeFile(
    file,
    page,
  );
}

const index = await readFile(join(source, "index.html"), "utf8");
await writeFile(join(destination, "index.html"), index);
console.log(`Built GitHub Pages site from ${relative(root, source)}`);
