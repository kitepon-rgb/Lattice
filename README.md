<p align="center">
  <img src=".github/og.png" alt="Lattice — stop serializing work that only looks like it conflicts" width="100%">
</p>

# Lattice

[![npm](https://img.shields.io/npm/v/@quolu/lattice?color=cb3837&logo=npm)](https://www.npmjs.com/package/@quolu/lattice)
[![CI](https://github.com/kitepon-rgb/Lattice/actions/workflows/ci.yml/badge.svg)](https://github.com/kitepon-rgb/Lattice/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@quolu/lattice?color=339933&logo=node.js&logoColor=white)](https://nodejs.org/)
[![patent](https://img.shields.io/badge/patent-pending%20JP%202026--178950-6366f1)](#patent)

**English** · [日本語](README.ja.md)

> **Stop serializing work that only looks like it conflicts.**
> Lattice is a schedulability compiler for multi-agent development. It observes the real
> boundaries of your codebase, proves which tasks can run in parallel, and — when two tasks
> genuinely collide — **refactors the seam between them and recompiles the plan** so they can
> run in parallel after all.

## Why

Give three coding agents three tasks and the usual outcome is one of two failures:

- **You serialize too much.** "These both touch `renderer.ts`, so run them one at a time."
  Often they touch *different symbols* in that file and could have run together.
- **You serialize too little.** Nothing declared a dependency, so you run them in parallel and
  discover the collision after both have written conflicting code.

Both failures come from the same gap: *nobody actually measured the boundary.* Dependency
arrows in a task list are a claim about intent, not evidence about code.

Lattice closes that gap with a different move. It does not just **detect** the conflict — it
**removes** it. When two tasks contend for one file, Lattice derives a cut, applies it in an
isolated worktree, verifies the transform against five acceptance conditions, and recompiles the
plan against the transformed source. The conflict edge disappears because the shared surface
stopped being shared.

## What it actually does

```
declare boundaries → compile independence → conflict?
                                              ├─ no  → run in parallel
                                              └─ yes → propose a seam
                                                       → transform in an isolated worktree
                                                       → verify (5 conditions)
                                                       → land + recompile → run in parallel
```

**A real example, from this repository.** Two tasks both needed to change
`src/seam-commit.mjs`. Lattice compiled the declarations, reported `conflict_count: 1` with
`severability: code_seam`, proposed a cut, and applied it in an isolated worktree. After all
five acceptance conditions passed, the file was split into one owned surface per task plus a
shared and a residual surface. Recompiling reported `conflict_count: 0` and placed both tasks in
the same parallel group.

Nobody hand-refactored that file. The product cut it so the work could parallelize.

### The five acceptance conditions

A transform is adopted only when **all five** hold. One missing condition rejects it:

| Condition | Meaning |
|---|---|
| `behavior_equivalent` | The original path's public export surface is preserved |
| `focused_tests_passed` | The affected tests actually pass against the transformed source |
| `sensor_fresh` | The structure index was rebuilt and covers the new surfaces |
| `overlap_reduced` | The target conflict is gone **and** plan-wide conflict pairs did not increase |
| `parallelism_improved` | The number of execution waves went down |

### Runtime, not just planning

Complete separation is not obtainable at planning time — dynamic dispatch, runtime-resolved
paths, and external state always leave residue. That is the design, not a deficiency: Lattice
carries a second stage at runtime.

While work executes, Lattice observes **what was actually changed**, not what was declared. When
it sees a task writing outside its declared scope, or into another running task's scope, it
raises a runtime conflict — and can either hold one side while the other commits, or transform
the seam and resume both.

## Install

```bash
npm install -g @quolu/lattice
```

Requires **Node.js 22.13+**. The structure sensor ships inside the package — there is nothing
else to install, and Lattice never falls back to a sensor on your `PATH`.

## Quick start

Every project begins with typed discovery. Never guess from directory layout:

```bash
lattice status --json
```

`state` is one of `uninitialized | ready | active_run | invalid`, and `next_action` gives the
canonical next command. Then index the codebase and declare boundaries:

```bash
lattice sensor init . --json
```

Write a draft declaring what each task owns, then let the tool supply the parts you cannot
hand-write — fresh observations, provenance wiring, canonical bytes:

```bash
lattice todo independence witness scaffold --plan <key> --input draft.json
lattice todo independence compile --plan <key> --input .lattice/todo/witness/<key>.json
lattice todo independence --plan <key> --json
```

If the verdict reports a conflict with `severability: code_seam`, ask for a cut and apply it:

```bash
lattice todo seam-proposal compile --plan <key>
lattice todo seam-proposal apply   --plan <key>               # isolated worktree, five conditions
lattice todo seam-proposal land    --plan <key> --names names.json
```

Full CLI surface: `lattice --help`, then
`lattice <plan|run|event|todo|sensor|bridge|runtime-errors> --help`.

## Design principles

**The operating AI is part of the apparatus.** Lattice is driven by an AI agent, and that agent
is not outside the system — it is a component of it. So Lattice supplies only what the AI
*cannot* produce for itself: structure observation, contracts, verification, records, and
version boundaries. Estimation, judgment, and naming remain the AI's job. You will not find an
LLM call inside this product; adding one would duplicate a capability already present at the
point of use.

**Unknown is never rounded to "no conflict."** If a boundary was not verified, the verdict says
`missing`, not "independent." The absence of a dependency edge is not evidence of independence.

**Fail closed, and say why.** Every rejection carries a typed reason and a next action. A
transform that cannot be verified is not adopted. A finding that cannot be independently
re-derived is not recorded.

## Patent

The design in this repository is the subject of a Japanese patent application:

| | |
|---|---|
| Application number | 特願2026-178950 (JP 2026-178950) |
| Filing date | 2026-07-27 |
| Title | 情報処理装置、ソフトウェア開発制御方法及びプログラム<br>(Information processing apparatus, software development control method, and program) |
| Claims | 12 |

**Patent rights are reserved.** Noncommercial use is licensed together with the software (see
[License](#license)). Commercial use is not granted — neither the copyright license nor the
patent license extends to it. The application is disclosed here so the rights position is
visible up front rather than discovered later.

## Factory role

Lattice is one of the ten self-owned core products managed by the
[dotagents development factory](https://github.com/kitepon-rgb/dotagents). This repository owns
the plan/ToDo/run store, the bundled sensor, schemas, migrations, releases, and diagnostics;
dotagents owns cross-product installation and host integration.

- Product philosophy: [PLAN.md](PLAN.md)
- Public contract: [docs/00_product-contract.md](docs/00_product-contract.md)
- Immutable decisions: [docs/adr/](docs/adr/)
- Document map: [docs/README.md](docs/README.md)

## Development

```bash
npm test        # product test gate
npm run check   # syntax + control-character gate
npm run ci      # full gate
```

The full gate includes checks that are unusual and deliberate:

- **`check:cli-surface`** — every shipped command must have help text *and* be exercised through
  a CLI entry point by a test. Shipping a command nobody ever ran is treated as a defect.
- **`check:open-questions`** — every unresolved question in an ADR must carry an explicit firing
  condition, so "deferred" is never indistinguishable from "forgotten."
- **`check:reachability`** — every module must be reachable from a product entry point, or be
  declared a research artifact with a reason.

Detailed operational notes (dashboard, bridge, actor environment, store transactions) are in
[README.ja.md](README.ja.md) and [docs/](docs/).

## License

**[PolyForm Noncommercial License 1.0.0](LICENSE)** — free for noncommercial use.

- **Free:** personal projects, study and research, hobby and amateur work, charities,
  educational institutions, public research organizations, and government institutions.
- **Not granted:** commercial use. That includes use inside a company's paid work or products,
  regardless of whether Lattice itself is redistributed.

This is **not** an OSI-approved open source license, and that is deliberate: the design is
covered by a patent application and commercial rights are retained.

**Want to use Lattice commercially?** Open an
[issue](https://github.com/kitepon-rgb/Lattice/issues) — commercial licensing is available.

The bundled structure sensor in [`sensor/`](sensor/) is third-party work absorbed into this
repository and remains under the **MIT License**. Its upstream origin and attribution are
recorded in [`sensor/NOTICE`](sensor/NOTICE); the license text is
[`sensor/LICENSE`](sensor/LICENSE). The terms above do not modify it.

© 2026 quolu (kitepon-rgb)
