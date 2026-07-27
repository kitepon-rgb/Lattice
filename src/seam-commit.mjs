/**
 * 採用された変換を、branchを動かさずにcommitとして確定する（ADR 0141）。
 *
 * 再開先が実在するbaseを要る。後継planへ旧baseを渡すと、splitが「T1は新pathを所有する」と
 * 述べるのに、再開したworkerのworktreeにそのfileが無い——所有すると宣言されたものが存在しない。
 *
 * canonical branchへは出さない。detached HEADでcommitし、`refs/lattice/seam/<id>`へ繋いでGCから
 * 守る。branchは動かず外部へ効果を出さないまま、worktreeを張れる実在のcommitになる。
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
export { commitSeamTransform } from './seam-commit-transform.mjs';
export { seamRefFor } from './seam-ref.mjs';

