import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const root = process.cwd();
const markdownFiles = await findMarkdown(root);
const failures = [];
const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split("#", 1)[0].split("?", 1)[0];
    if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
    const absolute = resolve(dirname(file), decodeURIComponent(target));
    try {
      await access(absolute);
    } catch {
      failures.push(`${file.slice(root.length + 1)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Broken local Markdown links:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${markdownFiles.length} Markdown files; no broken local links.\n`);
}

async function findMarkdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMarkdown(path));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
  }
  return files;
}
