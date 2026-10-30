// Render the immutable Dokploy stack for one release.
//
// Usage:
//   node .github/workflows/scripts/render-release-stack.mjs \
//     --sha <40-hex-commit> --prefix <ghcr.io/owner-lower> \
//     --in docker-compose.swarm.yml --out /tmp/docker-compose.release.yml
//   # rollback to an existing immutable tag instead of the fresh SHA:
//   node .github/workflows/scripts/render-release-stack.mjs \
//     --version v1.0.0 --prefix <ghcr.io/owner-lower> \
//     --in docker-compose.swarm.yml --out /tmp/docker-compose.release.yml
//
// Substitutes ONLY the two CI-owned tokens (${GHCR_IMAGE_PREFIX} and
// ${VERSION}). Every other ${VAR} / ${VAR:-default} / ${VAR:?error} is
// runtime configuration resolved by Dokploy from the stack environment,
// so the rendered file keeps them verbatim. Fails closed when the template
// is missing, a token survives rendering, or the tag is not a plausible
// immutable image tag.
import { readFileSync, writeFileSync } from "node:fs";

const args = new Map();
const raw = process.argv.slice(2);

for (let index = 0; index < raw.length; index += 2) {
  const flag = raw[index];
  const value = raw[index + 1];

  if (flag === undefined || value === undefined || !flag.startsWith("--")) {
    throw new Error(`usage: --sha <sha> --prefix <prefix> --in <file> --out <file>`);
  }

  args.set(flag.slice(2), value);
}

const sha = args.get("sha") ?? "";
const explicit = args.get("version") ?? "";
const prefix = args.get("prefix") ?? "";
const input = args.get("in") ?? "";
const output = args.get("out") ?? "";

let version = "";

if (explicit !== "") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(explicit)) {
    throw new Error(`refusing to render: version is not a valid image tag, got ${explicit}`);
  }

  version = explicit;
} else {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`refusing to render: sha must be a 40-hex commit, got ${sha}`);
  }

  version = `sha-${sha}`;
}

if (!/^ghcr\.io\/[a-z0-9-]+$/.test(prefix)) {
  throw new Error(`refusing to render: prefix must look like ghcr.io/owner, got ${prefix}`);
}

if (input === "" || output === "") {
  throw new Error("refusing to render: --in and --out are required");
}

let rendered = readFileSync(input, "utf8");

if (
  !/\$\{GHCR_IMAGE_PREFIX(?::[^}]*)?\}/.test(rendered) ||
  !/\$\{VERSION(?::[^}]*)?\}/.test(rendered)
) {
  throw new Error("refusing to render: template lacks GHCR_IMAGE_PREFIX or VERSION tokens");
}

// CI owns exactly these two tokens, bare and fail-fast (${VAR:?message})
// alike. Every other ${VAR} stays verbatim for Dokploy's runtime
// environment.
const tokenPattern = (name) => new RegExp(`\\$\\{${name}(?::[^}]*)?\\}`, "g");

rendered = rendered
  .replace(tokenPattern("GHCR_IMAGE_PREFIX"), () => prefix)
  .replace(tokenPattern("VERSION"), () => version);

if (rendered.includes("${GHCR_IMAGE_PREFIX}") || rendered.includes("${VERSION}")) {
  throw new Error("refusing to render: unsubstituted template token remains");
}

writeFileSync(output, rendered);

console.log(`rendered pinned stack ${version} -> ${output}`);
