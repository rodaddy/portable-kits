import { afterAll, describe, expect, runCommand, test } from "./harness.ts";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const KITS_ROOT = resolve(import.meta.dirname, "..");
const AUTHORING_SCHEMA = await readFile(
  join(KITS_ROOT, "kit-manifest.schema.json"),
  "utf8",
);
const CASE_ROOT = await mkdtemp(
  join(tmpdir(), "rtech-portable-kits-contract-"),
);

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface FixtureOptions {
  runtime?: boolean;
  undeclaredCommand?: boolean;
  runtimeArgv?: string[];
}

async function run(command: string[], cwd = KITS_ROOT): Promise<CommandResult> {
  return runCommand(command, cwd);
}

function runValidator(folder: string): Promise<CommandResult> {
  return run(["node", join(KITS_ROOT, "validate-kit.ts"), folder]);
}

async function readManifest(folder: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(folder, "kit.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

async function writeManifest(
  folder: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    join(folder, "kit.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function createFixture(
  folder: string,
  options: FixtureOptions = {},
): Promise<void> {
  await mkdir(join(folder, "payload"), { recursive: true });
  await writeFile(join(folder, "INSTALL.md"), "# Install\n");
  await writeFile(join(folder, "README.md"), "# Fixture\n");
  await writeFile(join(folder, "kit.schema.json"), AUTHORING_SCHEMA);
  await writeFile(join(folder, "VERSION"), "1.0.0\n");
  await writeFile(join(folder, "CHANGELOG.md"), "# Changelog\n");
  await writeFile(join(folder, "payload", "prompt.md"), "# Prompt\n");
  await mkdir(join(folder, "payload", "scripts"), { recursive: true });
  await writeFile(
    join(folder, "payload", "scripts", "fixture-check.ts"),
    "console.log('fixture check');\n",
  );

  const runtimes = options.runtime
    ? [
        {
          id: "node",
          version: ">=22.0.0",
          check: ["node", "--version"],
          required_for: ["fixture verification"],
        },
      ]
    : [];
  const commands =
    options.runtime || options.undeclaredCommand
      ? [
          {
            id: "fixture-check",
            runtime: "node",
            entrypoint: "scripts/fixture-check.ts",
            argv: options.runtimeArgv ?? ["node", "scripts/fixture-check.ts"],
            cwd: "payload",
          },
        ]
      : [];

  await writeManifest(folder, {
    $schema: "./kit.schema.json",
    schema_version: 1,
    id: "fixture-kit",
    name: "Fixture Kit",
    version: "1.0.0",
    description: "Portable kit contract fixture.",
    entrypoints: { install: "INSTALL.md", readme: "README.md" },
    installation: {
      strategy: "agent-managed",
      payloads: [
        {
          source: "payload",
          kind: "project-files",
          destination: "the selected project",
        },
      ],
      writes: ["the selected project"],
      preserve: ["existing project files"],
      forbidden: ["unrelated paths"],
    },
    requirements: { runtimes },
    verification: { files: ["payload/prompt.md"], commands },
  });
}

afterAll(async () => {
  await rm(CASE_ROOT, { recursive: true, force: true });
});

describe("portable kit contract", () => {
  test("accepts a no-code kit with no runtime requirement", async () => {
    const folder = join(CASE_ROOT, "no-code");
    await createFixture(folder);

    const result = await runValidator(folder);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS fixture-kit@1.0.0");
  });

  test("rejects a command whose runtime was not declared", async () => {
    const folder = join(CASE_ROOT, "undeclared-runtime");
    await createFixture(folder, { undeclaredCommand: true });

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR undeclared-runtime");
  });

  test("accepts a code kit with a declared runtime", async () => {
    const folder = join(CASE_ROOT, "code");
    await createFixture(folder, { runtime: true });

    const result = await runValidator(folder);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS fixture-kit@1.0.0");
  });

  test("rejects VERSION drift", async () => {
    const folder = join(CASE_ROOT, "version-drift");
    await createFixture(folder);
    await writeFile(join(folder, "VERSION"), "1.0.1\n");

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR version-drift");
  });

  test("rejects unknown manifest keys through the shipped schema", async () => {
    const folder = join(CASE_ROOT, "unknown-key");
    await createFixture(folder);
    const manifest = await readManifest(folder);
    manifest.unexpected = true;
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR schema: kit.json.unexpected is not allowed",
    );
  });

  test("rejects invalid payload kinds through the shipped schema", async () => {
    const folder = join(CASE_ROOT, "invalid-payload-kind");
    await createFixture(folder);
    const manifest = await readManifest(folder);
    const installation = manifest.installation as {
      payloads: Array<Record<string, unknown>>;
    };
    installation.payloads[0].kind = "not-a-payload-kind";
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR schema: kit.json.installation.payloads[0].kind must be one of",
    );
  });

  test("rejects slash and backslash traversal segments through the shipped schema", async () => {
    const folder = join(CASE_ROOT, "traversal");
    await createFixture(folder);
    const manifest = await readManifest(folder);
    const entrypoints = manifest.entrypoints as Record<string, string>;
    entrypoints.install = "payload\\..\\INSTALL.md";
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR schema: kit.json.entrypoints.install must not match the forbidden schema",
    );
  });

  test("rejects a verification command without a required entrypoint", async () => {
    const folder = join(CASE_ROOT, "missing-entrypoint");
    await createFixture(folder, { runtime: true });
    const manifest = await readManifest(folder);
    const commands = (
      manifest.verification as { commands: Array<Record<string, unknown>> }
    ).commands;
    delete commands[0].entrypoint;
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR schema: kit.json.verification.commands[0].entrypoint is required",
    );
  });

  test("rejects traversal in a verification command entrypoint", async () => {
    const folder = join(CASE_ROOT, "entrypoint-traversal");
    await createFixture(folder, { runtime: true });
    const manifest = await readManifest(folder);
    const command = (
      manifest.verification as { commands: Array<Record<string, unknown>> }
    ).commands[0];
    command.entrypoint = "scripts\\..\\fixture-check.ts";
    command.argv = ["node", "scripts\\..\\fixture-check.ts"];
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR schema: kit.json.verification.commands[0].entrypoint must not match the forbidden schema",
    );
  });

  test("rejects a declared payload symlink that escapes the real kit root", async () => {
    const folder = join(CASE_ROOT, "escaping-symlink", "kit");
    const outside = join(CASE_ROOT, "escaping-symlink", "outside");
    await createFixture(folder);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "prompt.md"), "outside\n");
    await symlink("../outside", join(folder, "escape"));
    const manifest = await readManifest(folder);
    const installation = manifest.installation as {
      payloads: Array<Record<string, unknown>>;
    };
    installation.payloads[0].source = "escape";
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR unsafe-path: installation.payloads[0].source: resolved path escapes the kit folder via symlink",
    );
  });

  test("rejects shell wrappers for a declared Node runtime", async () => {
    const folder = join(CASE_ROOT, "runtime-argv-mismatch");
    await createFixture(folder, {
      runtime: true,
      runtimeArgv: ["sh", "-c", "node --version"],
    });

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR runtime-command-mismatch");
  });

  test("rejects an entrypoint omitted from argv after the executable", async () => {
    const folder = join(CASE_ROOT, "entrypoint-argv-mismatch");
    await createFixture(folder, {
      runtime: true,
      runtimeArgv: ["node", "--version"],
    });

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR entrypoint-argv-mismatch");
  });

  test("rejects an entrypoint placed after runtime arguments", async () => {
    const folder = join(CASE_ROOT, "entrypoint-after-runtime-arguments");
    await createFixture(folder, {
      runtime: true,
      runtimeArgv: [
        "node",
        "--eval",
        "process.exit(0)",
        "scripts/fixture-check.ts",
      ],
    });

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR entrypoint-argv-mismatch");
  });

  test("rejects an entrypoint symlink whose realpath escapes the kit", async () => {
    const folder = join(CASE_ROOT, "entrypoint-symlink", "kit");
    const outside = join(CASE_ROOT, "entrypoint-symlink", "outside.ts");
    await createFixture(folder, { runtime: true });
    await writeFile(outside, "console.log('outside');\n");
    await symlink(
      "../../../outside.ts",
      join(folder, "payload", "scripts", "outside.ts"),
    );
    const manifest = await readManifest(folder);
    const command = (
      manifest.verification as { commands: Array<Record<string, unknown>> }
    ).commands[0];
    command.entrypoint = "scripts/outside.ts";
    command.argv = ["node", "scripts/outside.ts"];
    await writeManifest(folder, manifest);

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR unsafe-path: verification.commands[0].entrypoint: resolved path escapes the kit folder via symlink",
    );
  });

  test("rejects a shipped schema copy that drifts from the authoring schema", async () => {
    const folder = join(CASE_ROOT, "schema-copy-drift");
    await createFixture(folder);
    const schema = JSON.parse(
      await readFile(join(folder, "kit.schema.json"), "utf8"),
    ) as Record<string, unknown>;
    schema.title = "Drifted kit manifest";
    await writeFile(
      join(folder, "kit.schema.json"),
      `${JSON.stringify(schema, null, 2)}\n`,
    );

    const result = await runValidator(folder);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ERROR schema-copy-drift");
  });

  test("verifies a copied install from its retained source and exercises the copied payload", async () => {
    const sourceKit = join(KITS_ROOT, "synthetic-customer-panel");
    const source = join(
      KITS_ROOT,
      "synthetic-customer-panel",
      "skills",
      "synthetic-customer-panel",
    );
    const destination = join(CASE_ROOT, "installed-destination");
    await cp(source, destination, { recursive: true });

    const sourceVerification = await run(
      ["node", "verify-copied-install.ts", destination],
      sourceKit,
    );
    expect(sourceVerification.code).toBe(0);
    expect(sourceVerification.stdout).toContain(
      "PASS copied-install equality verified",
    );

    const localVerification = await run(
      ["node", "scripts/verify-install.ts"],
      destination,
    );
    expect(localVerification.code).toBe(0);
    expect(localVerification.stdout).toContain(
      "PASS synthetic-customer-panel@1.2.3",
    );

    const installedSkill = join(destination, "SKILL.md");
    const originalSkill = await readFile(installedSkill, "utf8");
    await writeFile(installedSkill, "corrupted installed payload\n");
    const corruptedPayload = await run(
      ["node", "scripts/verify-install.ts"],
      destination,
    );
    expect(corruptedPayload.code).toBe(1);
    expect(corruptedPayload.stderr).toContain(
      "ERROR integrity-mismatch: SKILL.md",
    );
    await writeFile(installedSkill, originalSkill);

    const workspace = join(CASE_ROOT, `installed-draft-${randomUUID()}`);
    const initialized = await run(
      [
        "node",
        "scripts/init-panel.ts",
        "--owned-root",
        CASE_ROOT,
        workspace,
        "--name",
        "Install Check",
      ],
      destination,
    );
    expect(initialized.code).toBe(0);
    const draft = await run(
      ["node", "scripts/validate-panel.ts", workspace, "--allow-draft"],
      destination,
    );
    expect(draft.code).toBe(0);

    await writeFile(
      join(destination, "scripts", "verify-install.ts"),
      "console.log('PASS synthetic-customer-panel@1.1.1');\n",
    );
    const replacedVerifier = await run(
      ["node", "verify-copied-install.ts", destination],
      sourceKit,
    );
    expect(replacedVerifier.code).toBe(1);
    expect(replacedVerifier.stderr).toContain(
      "ERROR copied-install-mismatch: scripts/verify-install.ts",
    );
  });
});
