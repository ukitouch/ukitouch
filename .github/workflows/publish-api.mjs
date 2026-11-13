import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkgDir = fileURLToPath(new URL("../../dist/api/", import.meta.url));
const version = process.env.TAG.slice(1);

const pkg = {
  name: "@ukitouch/api",
  version,
  description: "Type definitions for ukitouch frontend extensions",
  exports: { ".": { types: "./api/index.d.ts" } },
  types: "api/index.d.ts",
  license: "GPL-3.0-or-later",
  files: ["**/*.d.ts", "LICENSE", "README.md"],
  peerDependencies: { react: "^19" },
};
fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

fs.copyFileSync(path.join(root, "LICENSE"), path.join(pkgDir, "LICENSE"));
const readme = path.join(root, "src/api/README.md");
if (fs.existsSync(readme))
  fs.copyFileSync(readme, path.join(pkgDir, "README.md"));

const npm = (args) => execSync(`npm ${args}`, { encoding: "utf8" }).trim();
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

// .d.ts -> relative path -> sha256
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
  published = JSON.parse(npm("view @ukitouch/api versions --json"));
} catch {
  // first publish
}

if (published.length > 0) {
  const latest = npm("view @ukitouch/api dist-tags.latest");
  const tarball = npm(`view @ukitouch/api@${latest} dist.tarball`);
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

execSync("npm publish", { cwd: pkgDir, stdio: "inherit" });
console.log(`published @ukitouch/api@${version}`);
