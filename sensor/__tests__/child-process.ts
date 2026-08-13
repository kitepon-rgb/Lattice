import type { ChildProcessWithoutNullStreams } from 'child_process';

export async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const streamsClosed = child.stdin.closed && child.stdout.closed && child.stderr.closed;
  if ((child.exitCode !== null || child.signalCode !== null) && streamsClosed) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
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
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
}
