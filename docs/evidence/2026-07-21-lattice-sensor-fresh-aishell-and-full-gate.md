# Lattice Sensor fresh AIShell dogfood and full gate

- Date: 2026-07-21
- Lattice version: 0.9.0 working tree
- Embedded sensor version: 0.7.3-lattice.1
- Target: a new local clone of AIShell Git HEAD `2705b407cde704873c40b833507059eba99a1a82`
- Legacy-data policy: no retired cache, database, executable, SDK, or artifact was copied or read

## Fresh AIShell measurement

- Public initialization: `lattice sensor init <fresh-clone> --json`
- Wall time: 0.57 seconds
- State: `.lattice/sensor/sensor.db` only
- Files: 48
- Nodes: 797
- Edges: 2,078
- Database bytes: 2,924,544
- Languages: JavaScript, Swift, YAML
- Pending changes: 0 added, 0 modified, 0 removed
- Index state: complete; extraction version 24; reindex not recommended

Representative structural query:

- `DevelopmentRuntimeService` resolved exactly to its public Swift class.
- Impact depth 3 returned 74 nodes and 107 edges spanning implementation, MCP adapter, and tests.
- A module import-name query returned matching imports but zero structural edges. The useful claim is therefore bounded to concrete symbol/change boundaries, not arbitrary module-name queries.

## Current product gate

- Root current-product gate: exit 0; 54 suites. The runner printed 25 immutable research-artifact replay suites that are retained for forensics and excluded from the current verdict.
- Embedded sensor full gate: 139 test files passed, 3 skipped; 2,187 tests passed, 37 skipped.
- Root syntax check: exit 0.
- Package dry-run: exit 0; 709 entries; bundled executable is `sensor/dist/bin/lattice-sensor.js`; no retired executable name is present.
- Current-surface retired-name gate: 3 passed, 0 failed.

## Adversarial findings closed during the gate

- Corrected daemon lifecycle tests that still expected `.sensor/` instead of `.lattice/sensor/`.
- Removed standalone installer-prune and npm-SDK suites from the embedded-product verdict because those distribution surfaces are not shipped by Lattice.
- Updated the Node-version diagnostic test to the Lattice issue URL.
- Updated the private CLI affordance test from the pre-cutover executable spelling to `lattice-sensor`.
- No fallback or migration path to retired data was added.
