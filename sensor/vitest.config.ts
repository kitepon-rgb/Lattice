import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // Lattice does not ship or invoke the absorbed standalone install/update
    // machinery. Keeping those upstream-only suites in the product gate would
    // preserve a second owner and contradict the bundled-sensor contract.
    exclude: [
      '__tests__/installer.test.ts',
      '__tests__/installer-targets.test.ts',
      '__tests__/npm-shim.test.ts',
      '__tests__/prepare-release.test.ts',
      '__tests__/remove-binary.test.ts',
      '__tests__/beta-signup.test.ts',
      '__tests__/install-sh-prune.test.ts',
      '__tests__/npm-sdk.test.ts',
    ],
    /**
     * Several MCP integration tests (mcp-daemon, mcp-initialize, mcp-ppid-watchdog,
     * mcp-roots) spawn `dist/bin/lattice-sensor.js serve --mcp` with `process.execPath`
     * and rely on the child inheriting `process.env`. On a Node >= 25 dev machine
     * the CLI's hard-block (src/bin/lattice-sensor.ts) would otherwise exit the child
     * before it ever responds, so every spawn-based test times out — see #478.
     *
     * Setting the override here keeps the CLI's runtime guard intact for end
     * users (it's still enforced when `lattice-sensor` is invoked directly) while
     * letting the test suite run on whatever Node the contributor happens to
     * have installed. CI on Node 22/23 is unaffected — the guard doesn't fire
     * there, so the variable is a no-op.
     */
    env: {
      LATTICE_SENSOR_ALLOW_UNSAFE_NODE: '1',
      /**
       * The suite spawns real CLI/MCP processes; without this they would write
       * telemetry state into the contributor's real ~/.lattice-sensor and count test
       * tool calls as real usage. The telemetry unit tests are unaffected —
       * they inject their own `env` via the Telemetry constructor.
       */
      LATTICE_SENSOR_TELEMETRY: '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
