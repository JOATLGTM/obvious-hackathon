# obvious-hackathon — Agent Guidance

**Repository status: currently EMPTY.**

This repository (`JOATLGTM/obvious-hackathon`) contained no commits, no source files, and no dependency
manifests when this contract was generated (onboarding scan, 2026-10-09, UTC). GitHub itself reports the
repository as empty, and the setup PR that added this file is the first content it has ever received.

## Why there are no commands, ports, or stack claims here

There is no application yet — no runtime, package manager, build system, service, or entry point to
document. Writing guessed commands or stack details would make this contract lie about how to run the
app, so everything in that category is deliberately left out until real code exists.

## What the next setup run will fill in

Once the first application code lands in this repository, a fresh onboarding run should:

- Discover the actual stack (runtimes, package manager, apps/services, env vars) from real manifests,
  Dockerfiles, Compose files, Makefiles, and guidance docs (README, CONTRIBUTING, AGENTS.md).
- Bring the local dev stack up and verify a primary user flow end-to-end.
- Capture a sandbox snapshot of the working environment.
- Replace this file's content with stack details, start/test/lint commands, a codebase map, a local
  verification summary, and snapshot info.
- Add `.obvious/skills/local-dev/SKILL.md` recording how local dev was brought up.

## Sections intentionally omitted (nothing to document yet)

- Stack & commands — no manifests exist.
- Codebase map — no source files exist (see `.obvious/codebase-map.md` note below; not written for an
  empty repo).
- Local verification — no dev stack was brought up; `dev_stack_healthy: false` for this run.
- Snapshot info — no snapshot taken; there is no dev environment to capture.

## Files present in this contract

| File | Purpose |
|---|---|
| `.obvious/obvious.md` | This file — top-level agent guidance. |
| `.obvious/config.yml` | Default repo policy (branches, merge method). |
