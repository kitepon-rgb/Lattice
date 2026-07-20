# Lattice Sensor Phase adversarial review

- Date: 2026-07-21
- Phase: `lattice-codegraph-removal` (historical migration identifier)
- Review event: `e3f8c16bf8ee844827d782f94050007262281269d58394ad411ffb5d7d8f37c0`
- Verdict: accept

## Counter-hypotheses tested

### H1 — the rename is cosmetic and runtime still reads the retired product

Rejected. Current root runtime, embedded source, built distribution, tests, scripts, active product/integration documents, package manifests, and locks contain no retired product token or filename. A clean AIShell clone created only `.lattice/sensor/`; no migration or fallback path was exercised.

### H2 — daemon and MCP paths still use split identities

Rejected after repair. The first full gate exposed daemon tests expecting `.sensor/`; those tests were corrected to `.lattice/sensor/` and the real detached-daemon suite passed all 10 lifecycle cases. MCP exposes exactly the eight `lattice_sensor_*` tools and identifies the server as `lattice-sensor`.

### H3 — green tests are produced by replaying old evidence

Rejected. The current product runner prints and excludes 25 immutable RC1/RC2 artifact-replay suites from the verdict. Fresh AIShell index and representative queries were regenerated using the current embedded binary. Historical artifact files remain only for forensics and cannot decide the product gate.

### H4 — removed standalone distribution surfaces still constrain the embedded product

Rejected. Installer, upgrade implementation, uninstall output, npm shim/SDK, and release-preparation suites are outside the embedded Lattice contract and are explicitly excluded from its gate. The package dry-run contains the Lattice-owned binary and no independent executable alias. Legal attribution remains in `sensor/LICENSE` and `sensor/NOTICE` only.

### H5 — broad mechanical replacement left malformed current paths or package entries

Rejected after repair. `git diff --check` passed; the recursive current-surface name scan returned no finding; built `sensor/dist` has no retired path/name; root syntax check passed; package dry-run rebuilt successfully. RC3 scaffold was corrected to generate its own root ignore instead of treating generated state as a tracked source blob.

## Gate receipts

- Root current-product gate: exit 0, 54 suites.
- Embedded sensor: 139 test files and 2,187 tests passed; 3 files and 37 tests skipped by declared platform/kernel conditions.
- Fresh AIShell: 48 files, 797 nodes, 2,078 edges, complete index in 0.57 seconds.
- Concrete symbol impact: 74 nodes and 107 edges at depth 3.
- Lattice plan verify: snapshot current, journal through sequence 11, no active or ready ToDo, Phase reviewing.

## Bounded caveats

- Historical ADR/evidence and the Phase migration identifier retain the predecessor name as provenance; they are not runtime, package, config, cache, or current evidence inputs.
- Module import-name impact can return matches with zero edges. Effect claims are limited to concrete symbols/change boundaries, where the AIShell probe produced a connected impact graph.
