export const SQLITE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
export const SQLITE_EXPERIMENTAL_WARNING_MESSAGE =
  'SQLite is an experimental feature and might change at any time';

export function sensorNodeRuntimeFlags(nodeVersion = process.versions.node) {
  const major = Number(nodeVersion.split('.')[0]);
  return major === 22 ? [SQLITE_EXPERIMENTAL_WARNING_FLAG] : [];
}

/**
 * Node 22 prints node:sqlite's ExperimentalWarning to stderr. The CLI has a
 * JSON-only output contract, so suppress that exact warning while node:sqlite loads.
 * Every other process warning keeps Node's original behavior.
 */
export function installNode22SqliteWarningFilter({
  nodeVersion = process.versions.node,
  processObject = process,
} = {}) {
  if (sensorNodeRuntimeFlags(nodeVersion).length === 0) return () => {};

  const originalEmitWarning = processObject.emitWarning;
  processObject.emitWarning = function filteredEmitWarning(warning, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    const message = typeof warning === 'string' ? warning : warning?.message;
    if (type === 'ExperimentalWarning' && message === SQLITE_EXPERIMENTAL_WARNING_MESSAGE) return;
    return Reflect.apply(originalEmitWarning, processObject, [warning, ...args]);
  };

  return () => {
    processObject.emitWarning = originalEmitWarning;
  };
}
