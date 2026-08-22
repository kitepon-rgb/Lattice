import type { ChildProcessWithoutNullStreams } from 'child_process';

export async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const streamsClosed = child.stdin.closed && child.stdout.closed && child.stderr.closed;
  if ((child.exitCode !== null || child.signalCode !== null) && streamsClosed) return;

  await new Promise<void>((resolve, reject) => {
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (forceTimer !== null) clearTimeout(forceTimer);
      child.off('close', onClose);
      child.off('error', onError);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    child.once('close', onClose);
    child.once('error', onError);
    if (child.exitCode === null && child.signalCode === null) {
      // MCP transportはstdin EOFでwatcherとSQLiteを閉じて終了する。即SIGKILLするとWindowsで
      // child cwd/native handleの解放が遅れ、一時directory cleanupがEPERMになる。
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2_000);
    }
  });
}
