#!/usr/bin/env node
// Checks the publishable packages before `npm publish`. Read-only: it builds nothing and publishes
// nothing. Run `npm run build` first. Usage: node scripts/release-check.mjs [expected-version]
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const expected = process.argv[2] ?? "0.1.0";
// Publication order: each package depends on the ones before it.
const PACKAGES = ["packages/wallet", "packages/playwright"];
const FORBIDDEN = [/^docs\//, /vendor-research/, /(^|\/)test\//, /\.test\./, /(^|\/)e2e\//, /^src\//, /tsconfig/, /\.log$/];

let failures = 0;
const fail = (pkg, message) => {
  failures++;
  console.error(`  ✗ ${pkg}: ${message}`);
};

const versions = new Map();

for (const dir of PACKAGES) {
  const cwd = join(root, dir);
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const name = manifest.name;
  console.log(`${name}`);
  versions.set(name, manifest.version);

  if (manifest.private) fail(name, "is private");
  if (manifest.version !== expected) fail(name, `version ${manifest.version}, expected ${expected}`);
  if (manifest.license !== "MIT") fail(name, `license ${manifest.license}, expected MIT`);
  if (!existsSync(join(cwd, "LICENSE"))) fail(name, "LICENSE file missing");
  if (!existsSync(join(cwd, "README.md"))) fail(name, "README.md missing");
  if (!/^git\+https:\/\/github\.com\/.+\.git$/.test(manifest.repository?.url ?? "")) fail(name, `repository.url looks wrong: ${manifest.repository?.url}`);
  if (manifest.repository?.directory !== dir) fail(name, `repository.directory should be ${dir}`);
  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist")) fail(name, '"files" must list dist');
  if (manifest.type !== "module") fail(name, 'type should be "module"');

  for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
    if (versions.has(dep) && !range.includes(versions.get(dep))) fail(name, `depends on ${dep}@${range}, local version is ${versions.get(dep)}`);
  }

  const packed = JSON.parse(execSync("npm pack --dry-run --json", { cwd, encoding: "utf8" }));
  const files = packed[0].files.map((file) => file.path.replaceAll("\\", "/"));
  for (const file of files) {
    if (FORBIDDEN.some((pattern) => pattern.test(file))) fail(name, `tarball includes ${file}`);
  }

  const targets = [];
  for (const entry of Object.values(manifest.exports ?? {})) {
    if (typeof entry === "string") targets.push(entry);
    else targets.push(...Object.values(entry));
  }
  if (!targets.length) fail(name, "no exports");
  for (const target of targets) {
    const path = target.replace(/^\.\//, "");
    if (!files.includes(path)) fail(name, `export target ${target} is not in the tarball (did you run npm run build?)`);
  }
  console.log(`  ${files.length} files, ${(packed[0].size / 1024).toFixed(1)} kB packed`);
}

if (failures) {
  console.error(`\n${failures} problem(s). Fix them before publishing.`);
  process.exit(1);
}
console.log(`\nAll packages ready for ${expected}. Publish in this order: ${PACKAGES.join(" → ")}`);
