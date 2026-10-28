import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

interface KitManifest {
  id: string;
  version: string;
  installation: { payloads: Array<{ source: string }> };
}

const EXEMPT_FILES = new Set([
  "KIT-METADATA.json",
  "scripts/verify-install.ts",
]);

function usage(): never {
  console.error("usage: node generate-install-integrity.ts <kit-folder>");
  process.exit(2);
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadataPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`payload contains a symlink: ${relative(root, full)}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, full)));
    } else if (entry.isFile()) {
      files.push(metadataPath(root, full));
    } else {
      throw new Error(
        `payload contains a non-file entry: ${relative(root, full)}`,
      );
    }
  }
  return files;
}

async function main(): Promise<void> {
  const [kitArgument, ...extra] = process.argv.slice(2);
  if (!kitArgument || extra.length > 0) usage();

  const authoringRoot = await realpath(import.meta.dirname);
  const kitRoot = await realpath(resolve(authoringRoot, kitArgument));
  if (!isWithin(authoringRoot, kitRoot) || kitRoot === authoringRoot) {
    throw new Error(
      "kit folder must be a child of the portable-kits authoring root",
    );
  }
  const manifest = JSON.parse(
    await readFile(resolve(kitRoot, "kit.json"), "utf8"),
  ) as KitManifest;
  if (
    !manifest.id ||
    !manifest.version ||
    manifest.installation?.payloads?.length !== 1
  ) {
    throw new Error(
      "kit manifest must declare one payload plus id and version",
    );
  }
  const payload = await realpath(
    resolve(kitRoot, manifest.installation.payloads[0].source),
  );
  if (!isWithin(kitRoot, payload)) {
    throw new Error("declared payload escapes the kit folder");
  }
  const verifierPath = resolve(payload, "scripts", "verify-install.ts");
  if (!(await stat(verifierPath)).isFile()) {
    throw new Error("payload does not contain scripts/verify-install.ts");
  }

  const files: Record<string, string> = {};
  for (const path of (await listFiles(payload))
    .filter((path) => !EXEMPT_FILES.has(path))
    .sort()) {
    files[path] = digest(await readFile(resolve(payload, path)));
  }
  const metadata = `${JSON.stringify({ kit_id: manifest.id, version: manifest.version, files }, null, 2)}\n`;
  await writeFile(resolve(payload, "KIT-METADATA.json"), metadata, "utf8");

  const verifier = await readFile(verifierPath, "utf8");
  const metadataDigest = digest(new TextEncoder().encode(metadata));
  const updatedVerifier = verifier
    .replace(
      /^const KIT_ID = .*;$/m,
      `const KIT_ID = ${JSON.stringify(manifest.id)};`,
    )
    .replace(
      /^const VERSION = .*;$/m,
      `const VERSION = ${JSON.stringify(manifest.version)};`,
    )
    .replace(
      /^const METADATA_SHA256 = .*;$/m,
      `const METADATA_SHA256 = ${JSON.stringify(metadataDigest)};`,
    );
  if (
    !updatedVerifier.includes(
      `const KIT_ID = ${JSON.stringify(manifest.id)};`,
    ) ||
    !updatedVerifier.includes(
      `const VERSION = ${JSON.stringify(manifest.version)};`,
    ) ||
    !updatedVerifier.includes(
      `const METADATA_SHA256 = ${JSON.stringify(metadataDigest)};`,
    )
  ) {
    throw new Error(
      "verifier constants were not updated; inspect its expected constant declarations",
    );
  }
  await writeFile(verifierPath, updatedVerifier, "utf8");
  console.log(
    `updated install integrity for ${manifest.id}@${manifest.version}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `generate-install-integrity failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
