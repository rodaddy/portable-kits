# Changelog

All notable changes to the portable-kit contract are recorded here. This file
follows Keep a Changelog and Semantic Versioning.

## [0.1.2] - 2026-08-13

### Changed

- Authoring tools (`validate-kit.ts`, `generate-install-integrity.ts`) and the
  contract suite run under plain `node` instead of Bun, per the 2026-08-13
  design rule that kits never require Bun. `import.meta.dir` -> `import.meta.dirname`
  and `bun:test` / `Bun.spawn` -> `node --test` with `node:child_process` via a
  dependency-free `tests/harness.ts` shim.
- Contract fixtures declare a `node` runtime rather than a `bun` one, so the
  fixture reflects what a real kit is now allowed to require.

### Fixed

- `tests/kit-contract.test.ts` asserted the copied install reported
  `synthetic-customer-panel@1.1.1` while the kit had already moved to `1.2.0`.
  The assertion was stale at HEAD and is now pinned to `1.2.1`.

### Verified

- All 16 contract tests pass under plain `node --test`. Exit `0`.

## [0.1.1] - 2026-07-16

### Added

- Added deterministic installed-payload integrity generation, retained-source
  copy equality verification, and local checking of metadata plus non-verifier
  files.
- Added regression coverage for schema drift, path traversal, symlink escape,
  runtime command substitution, and copied-install corruption.

### Changed

- Made the shipped manifest schema authoritative for validator behavior.
- Confined declared package paths after realpath resolution.
- Bound every verification command to a declared, confined local entrypoint at
  `argv[1]`.
- Clarified that only a retained-source copied-install check covers the
  installed verifier and that neither check authenticates a publisher.

## [0.1.0] - 2026-07-16

### Added

- Defined the agent-managed `INSTALL.md` and `kit.json` package contract.
- Added a manifest schema and deterministic package validator.
- Added regression coverage for code-free and runtime-bearing kits.
- Added Synthetic Customer Panel as the first reference PoC.

### Changed

- Established `pocs/<name>/_working/` as the only location for internal dogfood copies.
