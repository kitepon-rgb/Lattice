// directory fsync の唯一の置き場。rename後のdirectory entry永続化に使う。
// 同一のwin32ガード付き実装が14 fileに複製されていたのを一本化した（2026-08-24）。
import { open } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export async function fsyncDirectory(directory) {
  // O_DIRECTORYはPOSIXでdirectory以外をfail-loudにする（win32は未定義=0）。
  const handle = await open(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  // Windowsはdirectory handleのfsyncを許さず常にEPERM/EINVALを返す（Node仕様）。
  // win32のこの2値だけ許容し、他OS・他エラーは従来どおり失敗させる。
  try { await handle.sync(); } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EINVAL'].includes(error?.code)) throw error;
  } finally { await handle.close(); }
}
