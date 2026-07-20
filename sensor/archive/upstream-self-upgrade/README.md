# Archived upstream self-update path

This directory preserves the absorbed Codegraph self-update implementation and
its tests for attribution and migration history. Files use the `.archived`
suffix, live outside `src/`, are not compiled, and are not included in the
`@quolu/lattice` package.

Lattice releases are installed only through the `@quolu/lattice` release
channel. Restoring this code to the runtime would violate ADR 0047 and ADR 0059
because it can install or execute the independent Codegraph package.
