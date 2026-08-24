# ADR 0185: legacy storeのEOL変換はGit境界で修復する

- status: accepted
- date: 2026-08-25

## 文脈

LatticeのToDo storeはcanonical JSON／JSONLのLF byte列を正本とし、CRを拒否する。現行の新規storeは
`.lattice/.gitattributes`の`* -text`でGitのEOL変換を止めるが、この保護を追加する前に作られた
storeには移行経路が無かった。

Windowsで`core.autocrlf=true`のrepoをcheckoutすると、HEAD blobは正しいLFのままworktreeだけが
CRLFになる。`lattice status --json`は一般的なbyte破損として停止し、原因pathも正規の修復commandも
示さなかった。このため利用者には、厳密なstore契約が工程を理由不明で停止させたように見えた。

JSONをparseして再serializeする修復は、旧schema・旧format・実際の編集をEOL変換と誤認して書き換える。
CRを無条件除去する修復も、CRLF以外の破損を隠す。必要なのはGit checkout境界だけを元へ戻す処理である。

## 決定

1. canonical artifactとjournalでCRを検出した時は`artifact_eol_converted`、原因`ref`、
   `lattice todo repair-eol --json`を返す。snapshotの他の形式破損は従来どおりstaleとして再生成可能だが、
   EOL変換だけは再発防止が必要なのでstaleへ丸めない。
2. `repair-eol`はstore配下のJSON／JSONLだけを対象にする。CRがすべてCRLFの一部であり、CRを除いたbyte列が
   同じpathの`HEAD` blobと完全一致するfileだけを修復する。意味、key順、空白、schemaは変更しない。
3. untracked file、HEADと一致しない編集、staged変更、純粋なCRLF変換でない破損、symlink／junctionは
   変更せずtyped errorで拒否する。store rootからartifactまでの全directory componentを検査し、repo外へ
   到達するreparse pointを辿らない。
4. 修復後は`.lattice/.gitattributes`へ`* -text`を置く。既存fileにこの規則が無い場合は、他の規則を
   推測して上書きせず拒否する。
5. atomic replace後、修復したpathだけ`git add --refresh`でGit indexのstat cacheを更新する。index blobは
   HEADと完全一致する場合だけ修復を開始し、利用者の他のdirty pathやstagingへ触れず、内容差分ゼロの
   store artifactを変更扱いで残さない。

## 結果

旧storeはbyte契約を弱めずに復旧でき、修復後のcheckoutではEOL変換が再発しない。真の編集や破損は
修復commandで隠れない。OS依存なのはGit worktreeのEOL境界だけで、canonical store readerとschemaは
全OS共通の厳密契約を維持する。
