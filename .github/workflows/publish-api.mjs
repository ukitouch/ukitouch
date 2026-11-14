import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const npm = (args) => execSync(`npm ${args}`, { encoding: "utf8" }).trim();

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkgDir = fileURLToPath(new URL("../../dist/api/", import.meta.url));
const version = process.env.TAG?.startsWith("v")
  ? process.env.TAG.slice(1)
  : process.env.TAG;

if (!version) {
  console.error("TAG env var is required (e.g. TAG=v1.2.3)");
  process.exit(1);
}

console.log("building types...");
fs.rmSync(pkgDir, { recursive: true, force: true });
npm("run api");

const pkg = {
  name: "@ukitouch/extension",
  version,
  description: "Type definitions for ukitouch frontend extensions",
  exports: { ".": { types: "./index.d.ts" } },
  types: "index.d.ts",
  license: "GPL-3.0-or-later",
  files: ["**/*.d.ts", "LICENSE", "README.md"],
  peerDependencies: { react: "^19" },
  repository: {
    type: "git",
    url: "https://github.com/ukitouch/ukitouch",
  },
};
fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

fs.copyFileSync(path.join(root, "LICENSE"), path.join(pkgDir, "LICENSE"));
const readme = path.join(root, "src/api/README.md");
if (fs.existsSync(readme)) {
  fs.copyFileSync(readme, path.join(pkgDir, "README.md"));
}

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

const dts = (root) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".d.ts")) out[path.relative(root, full)] = sha(full);
    }
  };
  walk(root);
  return out;
};

let published = [];
try {
  published = JSON.parse(npm("view @ukitouch/extension versions --json"));
} catch {
  // first publish
}

if (published.length > 0) {
  const latest = npm("view @ukitouch/extension dist-tags.latest");
  const tarball = npm(`view @ukitouch/extension@${latest} dist.tarball`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ukitouch-api-"));
  execSync(`curl -sL ${tarball} | tar xz -C ${dir}`);

  const remote = dts(path.join(dir, "package"));
  const local = dts(pkgDir);
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
  const diff = [...keys].filter((k) => remote[k] !== local[k]);

  if (diff.length === 0) {
    console.log(`types unchanged vs ${latest}, skip`);
    process.exit(0);
  }
  console.log("changed:", diff.join(", "));
}

npm("publish ./dist/api --access public");
console.log(`published @ukitouch/extension@${version}`);
