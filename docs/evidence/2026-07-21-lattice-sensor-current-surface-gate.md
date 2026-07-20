# Lattice Sensor current-surface gate

- Date: 2026-07-21
- Scope: current runtime, package, tests, operational documentation, embedded sensor source and implementation documentation
- Historical boundary: immutable RC1/RC2 artifacts and historical ADR/evidence are retained for provenance but do not participate in the current product verdict

## Result

- The bundled binary is `sensor/dist/bin/lattice-sensor.js` and project state is `.lattice/sensor/sensor.db`.
- Public MCP tools use only `lattice_sensor_*`; config and environment use `lattice-sensor.json` and `LATTICE_SENSOR_*`.
- The embedded package is private and exposes no independent bin, installer, upgrade, or uninstall surface.
- `npm test` now uses `scripts/run-product-tests.mjs`, which prints an explicit list of 25 immutable artifact replay suites excluded from the current verdict and runs 54 current suites.
- The no-retired-name gate recursively checks root runtime/scripts/tests, sensor source/scripts/docs, package locks, and active product/integration documents.
- Focused current-surface gate: 3 passed, 0 failed.
- Focused RC3 scaffold and campaign repair: 14 passed, 0 failed.
- Full embedded sensor suite completed with exit status 0 after the naming and storage cutover.

## Adversarial checks

- A clean probe creates only `.lattice/sensor/` and does not consult a pre-existing external cache.
- RC3 scaffold now creates its own root `.gitignore` for generated sensor state instead of pretending generated state is a tracked Lattice source blob.
- Frozen artifact replay remains callable for forensics but cannot make the current product gate green or red.
