import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

type JsonObject = Record<string, unknown>;

interface RuntimeRequirement {
  id: string;
  check: string[];
}

interface KitManifest {
  id: string;
  version: string;
  entrypoints: Record<string, string>;
  installation: { payloads: Array<{ source: string }> };
  requirements: { runtimes: RuntimeRequirement[] };
  verification: {
    files: string[];
    commands: Array<{
      id: string;
      runtime: string;
      entrypoint: string;
      argv: string[];
      cwd: string;
    }>;
  };
}

interface Issue {
  code: string;
  message: string;
}

const AUTHORING_SCHEMA = resolve(
  import.meta.dirname,
  "kit-manifest.schema.json",
);

function usage(): never {
  console.error("usage: node validate-kit.ts <kit-folder> [--json]");
  process.exit(2);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(issues: Issue[], code: string, message: string): void {
  issues.push({ code, message });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveReference(
  rootSchema: JsonObject,
  reference: string,
): JsonObject {
  if (!reference.startsWith("#/")) {
    throw new Error(`unsupported schema reference ${reference}`);
  }
  let current: unknown = rootSchema;
  for (const segment of reference.slice(2).split("/")) {
    if (!isRecord(current)) {
      throw new Error(`cannot resolve schema reference ${reference}`);
    }
    current = current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  if (!isRecord(current)) {
    throw new Error(`schema reference ${reference} is not an object`);
  }
  return current;
}

function schemaErrors(
  rootSchema: JsonObject,
  schema: JsonObject,
  value: unknown,
  location: string,
): string[] {
  if (typeof schema.$ref === "string") {
    return schemaErrors(
      rootSchema,
      resolveReference(rootSchema, schema.$ref),
      value,
      location,
    );
  }

  const errors: string[] = [];
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) {
      if (isRecord(child)) {
        errors.push(...schemaErrors(rootSchema, child, value, location));
      }
    }
  }
  if (schema.type === "object" && !isRecord(value)) {
    return [`${location} must be an object`];
  }
  if (schema.type === "array" && !Array.isArray(value)) {
    return [`${location} must be an array`];
  }
  if (schema.type === "string" && typeof value !== "string") {
    return [`${location} must be a string`];
  }
  if (
    "const" in schema &&
    canonicalJson(value) !== canonicalJson(schema.const)
  ) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => canonicalJson(item) === canonicalJson(value))
  ) {
    errors.push(
      `${location} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`,
    );
  }
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      errors.push(`${location} must not be empty`);
    }
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern).test(value)
    ) {
      errors.push(`${location} must match ${schema.pattern}`);
    }
  }
  if (
    schema.not &&
    isRecord(schema.not) &&
    schemaErrors(rootSchema, schema.not, value, location).length === 0
  ) {
    errors.push(`${location} must not match the forbidden schema`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(
        `${location} must contain at least ${schema.minItems} item(s)`,
      );
    }
    const itemSchema = schema.items;
    if (isRecord(itemSchema)) {
      value.forEach((item, index) =>
        errors.push(
          ...schemaErrors(
            rootSchema,
            itemSchema,
            item,
            `${location}[${index}]`,
          ),
        ),
      );
    }
  }
  if (isRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${location}.${key} is required`);
        }
      }
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${location}.${key} is not allowed`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isRecord(propertySchema)) {
        errors.push(
          ...schemaErrors(
            rootSchema,
            propertySchema,
            value[key],
            `${location}.${key}`,
          ),
        );
      }
    }
  }
  return errors;
}

async function readJson(
  path: string,
  label: string,
  issues: Issue[],
): Promise<JsonObject | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value)) {
      add(issues, "schema-read", `${label} must contain a JSON object`);
      return null;
    }
    return value;
  } catch (error) {
    add(
      issues,
      "schema-read",
      `cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function validateManifestSchema(
  root: string,
  manifest: unknown,
  issues: Issue[],
): Promise<KitManifest | null> {
  const authoringSchema = await readJson(
    AUTHORING_SCHEMA,
    "kit-manifest.schema.json",
    issues,
  );
  const kitSchema = await readJson(
    resolve(root, "kit.schema.json"),
    "kit.schema.json",
    issues,
  );
  if (!authoringSchema || !kitSchema) {
    return null;
  }
  if (canonicalJson(authoringSchema) !== canonicalJson(kitSchema)) {
    add(
      issues,
      "schema-copy-drift",
      "kit.schema.json must match the root kit-manifest.schema.json",
    );
  }
  let valid = true;
  try {
    const errors = schemaErrors(kitSchema, kitSchema, manifest, "kit.json");
    valid = errors.length === 0;
    for (const message of errors) {
      add(issues, "schema", message);
    }
  } catch (error) {
    add(
      issues,
      "schema-invalid",
      `cannot evaluate kit.schema.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return valid && isRecord(manifest)
    ? (manifest as unknown as KitManifest)
    : null;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function checkPath(
  root: string,
  candidate: string,
  label: string,
  issues: Issue[],
): Promise<void> {
  const full = resolve(root, candidate);
  if (!isWithin(root, full)) {
    add(issues, "unsafe-path", `${label}: path escapes the kit folder`);
    return;
  }
  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(root),
      realpath(full),
    ]);
    if (!isWithin(realRoot, realCandidate)) {
      add(
        issues,
        "unsafe-path",
        `${label}: resolved path escapes the kit folder via symlink: ${candidate}`,
      );
    }
  } catch {
    add(issues, "missing-path", `${label} does not exist: ${candidate}`);
  }
}

async function validatePaths(
  root: string,
  manifest: KitManifest,
  issues: Issue[],
): Promise<void> {
  await checkPath(root, "kit.schema.json", "package schema", issues);
  await checkPath(root, "VERSION", "package version", issues);
  await checkPath(root, "CHANGELOG.md", "package changelog", issues);
  for (const [key, path] of Object.entries(manifest.entrypoints)) {
    await checkPath(root, path, `entrypoints.${key}`, issues);
  }
  for (const [index, payload] of manifest.installation.payloads.entries()) {
    await checkPath(
      root,
      payload.source,
      `installation.payloads[${index}].source`,
      issues,
    );
  }
  for (const [index, path] of manifest.verification.files.entries()) {
    await checkPath(root, path, `verification.files[${index}]`, issues);
  }
  for (const [index, command] of manifest.verification.commands.entries()) {
    await checkPath(
      root,
      command.cwd,
      `verification.commands[${index}].cwd`,
      issues,
    );
    const cwd = resolve(root, command.cwd);
    const entrypoint = resolve(cwd, command.entrypoint);
    const label = `verification.commands[${index}].entrypoint`;
    if (!isWithin(root, entrypoint)) {
      add(issues, "unsafe-path", `${label}: path escapes the kit folder`);
    } else {
      try {
        const [realRoot, realCwd, realEntrypoint, entrypointStat] =
          await Promise.all([
            realpath(root),
            realpath(cwd),
            realpath(entrypoint),
            stat(entrypoint),
          ]);
        if (
          !isWithin(realRoot, realCwd) ||
          !isWithin(realRoot, realEntrypoint)
        ) {
          add(
            issues,
            "unsafe-path",
            `${label}: resolved path escapes the kit folder via symlink: ${command.entrypoint}`,
          );
        } else if (!entrypointStat.isFile()) {
          add(
            issues,
            "entrypoint-not-file",
            `${label} must name a file: ${command.entrypoint}`,
          );
        }
      } catch {
        add(
          issues,
          "missing-path",
          `${label} does not exist: ${command.entrypoint}`,
        );
      }
    }
    if (command.argv[1] !== command.entrypoint) {
      add(
        issues,
        "entrypoint-argv-mismatch",
        `verification command ${command.id} must use exact entrypoint ${command.entrypoint} at argv[1]`,
      );
    }
    const runtime = manifest.requirements.runtimes.find(
      ({ id }) => id === command.runtime,
    );
    if (!runtime) {
      add(
        issues,
        "undeclared-runtime",
        `verification command ${command.id} uses undeclared runtime ${command.runtime}`,
      );
    } else if (runtime.check[0] !== command.argv[0]) {
      add(
        issues,
        "runtime-command-mismatch",
        `verification command ${command.id} must start with ${runtime.check[0]}, the ${command.runtime} check executable`,
      );
    }
  }
}

async function validateVersionLockstep(
  root: string,
  manifest: KitManifest,
  issues: Issue[],
): Promise<void> {
  try {
    const version = (await readFile(resolve(root, "VERSION"), "utf8")).trim();
    if (version !== manifest.version) {
      add(
        issues,
        "version-drift",
        `VERSION is ${version || "empty"}; kit.json is ${manifest.version}`,
      );
    }
  } catch {
    return;
  }

  try {
    const packagePath = resolve(root, "package.json");
    await stat(packagePath);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      version?: unknown;
    };
    if (packageJson.version !== manifest.version) {
      add(
        issues,
        "package-version-drift",
        `package.json version must match ${manifest.version}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    add(
      issues,
      "package-json",
      `cannot validate package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const positional = argv.filter((value) => value !== "--json");
  if (positional.length !== 1) usage();

  const root = resolve(positional[0]);
  const issues: Issue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(root, "kit.json"), "utf8"));
  } catch (error) {
    add(
      issues,
      "manifest-read",
      `cannot read kit.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = await validateManifestSchema(root, parsed, issues);
  if (manifest) {
    await validatePaths(root, manifest, issues);
    await validateVersionLockstep(root, manifest, issues);
  }

  const result = {
    ok: issues.length === 0,
    kit: manifest?.id || null,
    version: manifest?.version || null,
    issues,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok)
    console.log(`PASS ${result.kit}@${result.version}: kit contract is valid`);
  else
    for (const issue of issues)
      console.error(`ERROR ${issue.code}: ${issue.message}`);
  if (!result.ok) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(
    `validate-kit failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
