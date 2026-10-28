# basic

The only tier of this kit. It ships under the name `ai-marketing-panel` in
`kits/manifest.json`.

## What ships

The complete package from the parent folder:

- `START-HERE.md`, the first handoff file, and `INSTALL.md`, the canonical
  agent-executed installation contract. `installer.md` is a compatibility
  pointer for the original installer filename.
- `kit.json` (declared requirements, payloads, boundaries, verification) and
  `kit.schema.json` (the standalone manifest schema).
- `VERSION`, `CHANGELOG.md`, and `DOGFOOD-NOTES.md`.
- `OPERATIONS-MANUAL.md`, the plain-language operator guide.
- `skills/synthetic-customer-panel/` - the portable skill: workflows, standards
  references, deterministic scripts, workspace templates, and
  `KIT-METADATA.json`.
- `verify-copied-install.ts` and
  `skills/synthetic-customer-panel/scripts/verify-install.ts`, the two
  verification entrypoints declared in `kit.json`.

The four operator moves in `OPERATIONS-MANUAL.md` are build a customer panel
(5-15 researched seats with dossiers), wash an artifact through the panel,
rewrite and retest across three revisions, and calibrate the panel once real
outcomes arrive.

## Who it is for

An owner or operator who wants a directional read on an artifact - copy, a
page, an email, an offer, a document - before it goes out, and who has real
first-party customer evidence to build the panel from. It gives the people
already doing that work a way to test an artifact at all, at a price where
testing every artifact is a habit rather than a budget decision.

## What it refuses to do

- It refuses to build a panel without a real decision, stated so a real-world
  outcome could later prove it right or wrong, and without at least one
  first-party source about real customers. Missing either, it says what it has
  and what it is missing and asks one question rather than inventing personas.
- It does not send, publish, buy, approve, or deploy anything.
- It does not replace real customer interviews, professional review, legal
  review, accessibility testing, usability testing, analytics, or measured
  behavior. Sensitive, regulated, legal, medical, or financial decisions
  require the appropriate qualified human review.
- It never reports a stronger installation mode than the environment honestly
  supports, and it never silently downgrades a capability tier: every run
  records the tier it actually ran at in `RUN.json`.
- It never installs or upgrades machine-level software silently, and it never
  uses a hidden download-and-execute command.

## Install

Unzip the folder, open or upload it in the AI agent you want to use, and say:

> Read `INSTALL.md` and install this kit.

The agent detects its environment and selects the strongest honest mode of
`full`, `persistent-files`, `session-only`, or `handoff-required`, then returns
the `KIT_INSTALL_RECEIPT` block.

Node 22.18.0+ is the declared runtime requirement for the deterministic panel
tools; check it with the kit's own bash-only preflight,
`bash skills/synthetic-customer-panel/scripts/check-node.sh` (exit `0` pass,
`1` missing or too old, `3` harness error). Below the floor the room lifecycle
still works, but panel and run validation drops to the T3 self-report path.

Verify a full install from the retained source folder with
`node verify-copied-install.ts "<copied-destination>"`, then from the copied
destination `node scripts/verify-install.ts`, which must report
`PASS synthetic-customer-panel@1.2.3`.

Install is VERIFIED working on the Claude app and on Codex as of 2026-08-12;
the claude.ai web path is UNVERIFIED and has never been tested.

## Current version

The kit's own `VERSION` is `1.2.3`, matching `kit.json`. The portable-kits
`VERSION` beside the contract is `0.1.2`.
