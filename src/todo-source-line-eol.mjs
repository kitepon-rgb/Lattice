import { createHash } from 'node:crypto';

const CARRIAGE_RETURN = 0x0d;
const CR_BYTES = Buffer.from([CARRIAGE_RETURN]);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Gitのcheckout EOL変換だけを同一source lineとして扱う。
 * 呼出側はLFで分割済みなので、差になり得る行末CR一byteだけを往復させる。
 */
export function matchesTodoSourceLineDigest(lineBytes, expectedDigest) {
  if (digest(lineBytes) === expectedDigest) return true;
  if (lineBytes.at(-1) === CARRIAGE_RETURN) {
    return digest(lineBytes.subarray(0, -1)) === expectedDigest;
  }
  return digest(Buffer.concat([lineBytes, CR_BYTES])) === expectedDigest;
}
