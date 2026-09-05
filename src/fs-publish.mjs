import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

/** Windowsは読み手が開いている宛先へのrenameを一時的にEPERMで拒否する。
 * 同じatomic renameを待って再実行し、恒久的な拒否は元のエラーで返す。 */
export async function renamePublishedFile(source, destination, {
  renameFile = rename, platform = process.platform, wait = setTimeout, attempts = 8,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await renameFile(source, destination); }
    catch (error) {
      if (platform !== 'win32' || error?.code !== 'EPERM' || attempt + 1 >= attempts) throw error;
      await wait(Math.min(64, 2 ** attempt));
    }
  }
}
