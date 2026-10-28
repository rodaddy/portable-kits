# How Portable Kits was built

Sources: the commit history of the private monorepo it was developed in (it
was published here as a single snapshot commit on 2026-10-27), the two
`CHANGELOG.md` files, and the test suites.

## The problem and the first version (2026-07-16)

The goal was a line of small AI kits for small businesses: a folder the owner
downloads, gives to whatever AI app they use, and asks to install. The weak point is
the install itself: an agent told to "install this" improvises,
skips steps its environment cannot do, and reports success anyway.

The first version, merged on 2026-07-16, set the rules that still hold:

- A kit declares its finished state in `kit.json`, validated by a JSON
  Schema, and carries agent-facing instructions in `INSTALL.md`.
- The agent chooses the tools; the kit defines success. The agent reports the
  strongest install mode it honestly reached in a fixed-format receipt.
- The reusable kit source stays clean. Real use happens in copies, so no
  customer data or experiment ever lands in the source.

The same commit shipped the reference kit (Synthetic Customer Panel). The
commit records that it went through a multi-agent review, a focused check of
each fix, and an audit run on a second AI runtime before it merged.

Version 0.1.1, the same day, added installed-payload integrity records and
regression tests for schema drift, path traversal, symlink escape, command
substitution in runtime checks and a corrupted copied install. The changelog
also states plainly what the check does not do: it proves a copy matches its
source; it does not authenticate a publisher.

## Room lifecycle (2026-08-12)

Panel kits are meant to be reused, but a panel "room" could only be used once.
Starting again meant hand-editing state files or throwing away the previous
run's transcripts. `room.sh` added four verbs (clean, seat bounce, refresh,
new room), all archive-only: nothing in the lifecycle deletes a file. It was
written for bash 3.2, the version macOS ships, because buyers do not have the
newer bash used during development. The commit records four bugs found against
proof transcripts during the build and a five-room concurrency run with no
state crossing between rooms.

## Portability across AI apps (2026-08-13)

A rule was set that a kit has to work in every supported AI app, not just the
one it was built in. Each kit gained an install table per app and a capability
ladder (T1 to T3) that says what breaks at each level. Losing a capability has
to be announced to the buyer, never silent. The commit is explicit that the
browser-only tier had not been tried by a person yet, and records it as
unverified rather than assuming it works.

## Off Bun, onto plain Node (2026-08-13)

The kits were first written for Bun. On 2026-08-13 the rule became that a
kit must never ask a buyer to install Bun. The scripts stayed TypeScript and
now run directly on Node with no build step: `import.meta.dir` became
`import.meta.dirname`, relative imports got explicit `.ts` extensions, and
`bun:test` was replaced by `node --test` through a small dependency-free
`tests/harness.ts` shim.

**What did not work:** a source scan for Bun APIs came back clean while a
tracked `bun.lock` was still being shipped inside every buyer's zip. The scan
read code; the leftover was tooling state. The lockfile was removed and the
lesson recorded: check what ships, not just what the code calls. The same
change fixed a stale test assertion that still expected an older kit version.

The Node floor was later raised to 22.18.0 after narrowing down
(bisecting) the first Node release that runs the kit's TypeScript as written.

## Second-model review (2026-08-17)

The kits were reviewed by two model families (Claude Opus and a GPT-family
reviewer) and fixed in one pass. For the reference kit (1.2.3) the review
found that the "test it on your own data" step and its refusal sat inside the
bullet for one install mode, so three other modes could report an install
without ever touching the buyer's data. The step became a required top-level
step in every mode, and the refusal moved into the workflow that owns it, with
a mechanical trigger.

## How it is tested

- `tests/kit-contract.test.ts`: 16 contract tests run with `node --test`
  (schema, path confinement, integrity, copied install).
- `validate-kit.ts` run against the reference kit.
- The reference kit's own test in `synthetic-customer-panel/tests/`.

## Current state (2026-10-27)

Contract 0.1.2, reference kit 1.2.3. The validator passes the reference kit
and the kit's own test passes. 15 of 16 contract tests pass: folder README
files added on 2026-08-24 were not added to the reference kit's integrity
record, so the copied-install check reports a file-set mismatch. That is a
real finding of the integrity check, and the fix is to regenerate the record.
