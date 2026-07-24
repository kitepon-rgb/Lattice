/**
 * CLI stdio guards.
 *
 * Reading part of a result is a legitimate use: `lattice todo status --json |
 * head` stops the consumer as soon as it has what it wants. When that consumer
 * exits, the next write to stdout raises EPIPE, and Node's default handling
 * turns it into an unhandled 'error' event — the CLI dies with a stack trace
 * and a non-zero exit, so a working pipeline reports a failure that never
 * happened.
 *
 * EPIPE from a closed consumer is the POSIX contract, not a fault, so the
 * process stops quietly. This is deliberately narrow: only EPIPE, only on the
 * output streams. Every other stream error keeps its previous behaviour and
 * still crashes the CLI, because those are real faults.
 */

/**
 * @param {object} [options]
 * @param {Array<NodeJS.WriteStream>} [options.streams] streams to guard.
 * @param {(code: number) => void} [options.exit] process exit, injectable for tests.
 * @returns {() => void} removes the guards again (used by tests).
 */
export function installPipeCloseGuard({
  streams = [process.stdout, process.stderr],
  exit = (code) => process.exit(code),
} = {}) {
  const installed = [];
  for (const stream of streams) {
    if (stream === undefined || stream === null || typeof stream.on !== 'function') continue;
    const onError = (error) => {
      if (error?.code !== 'EPIPE') throw error;
      exit(0);
    };
    stream.on('error', onError);
    installed.push(() => stream.off('error', onError));
  }
  return () => {
    for (const remove of installed) remove();
  };
}
