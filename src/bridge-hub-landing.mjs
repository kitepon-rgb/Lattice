/**
 * Bridge hub public landing (bhl2) — the HTML face of lattice.kitepon.dev.
 *
 * Pure rendering only: no I/O, no clock, no store access. The hub server
 * (`bridge-hub-server.mjs`) reads the registry, projects the public view,
 * and passes it here. Extracted from `hubIndexHtml` in the server module so
 * the renderer can be tested without sockets (ADR 0164).
 */

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function hubIndexHtml(view) {
  const rows = view.map((project) => {
    const href = `/projects/${encodeURIComponent(project.project_id)}/`;
    const online = project.status === 'online';
    const statusLabel = online ? 'オンライン' : 'オフライン';
    const statusClass = online ? 'status-online' : 'status-offline';
    const identity = project.display_name === project.project_id ? '' : `<code>${escapeHtml(project.project_id)}</code>`;
    return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(project.display_name)}</strong>`
      + `${identity}<span class="${statusClass}">${escapeHtml(statusLabel)}</span>`
      + `<span aria-hidden="true">→</span></a></li>`;
  }).join('');
  const content = rows.length === 0 ? '<p>登録されている端末はありません。</p>' : `<ul>${rows}</ul>`;
  return `<!doctype html><html lang="ja"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Latticeが管理している公開中の工程と現在地を確認できます。"><meta name="robots" content="noindex, nofollow"><meta property="og:title" content="公開中の工程表 — Lattice"><meta property="og:description" content="Latticeが管理している公開中の工程と現在地を確認できます。"><meta name="theme-color" content="#f7f3ea"><title>公開中の工程表 — Lattice</title><style>:root{color-scheme:light;--paper:#f7f3ea;--panel:#fffdf8;--ink:#201d19;--soft:#6c655d;--line:#d8d0c5;--cobalt:#315cbe;--orange:#e85f2a;--good:#0ca30c;--critical:#d03b3b}*{box-sizing:border-box}body{min-height:100vh;margin:0;color:var(--ink);background:var(--paper);font:16px/1.7 system-ui,-apple-system,sans-serif}.shell{max-width:880px;margin:0 auto;padding:28px 22px 40px}.brand{display:flex;align-items:center;gap:9px;padding-bottom:24px;border-bottom:1px solid var(--line);font-size:.88rem}.brand a,.footer a{color:var(--ink);font-weight:800;text-decoration:none}.brand a:hover,.footer a:hover{color:var(--cobalt)}.brand span{color:var(--soft)}main{padding:64px 0 72px}.eyebrow{margin:0 0 8px;color:var(--orange);font-size:.76rem;font-weight:800;letter-spacing:.14em}.lead{max-width:620px;margin:0 0 34px;color:var(--soft)}h1{margin:0 0 14px;font-size:clamp(2rem,6vw,3.4rem);line-height:1.12;letter-spacing:-.04em}ul{display:grid;gap:12px;margin:0;padding:0;list-style:none}li a{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:20px;padding:18px 20px;border:1px solid var(--line);border-radius:12px;color:inherit;background:var(--panel);text-decoration:none;box-shadow:0 8px 28px rgba(48,39,27,.04)}li a:hover{border-color:var(--cobalt);transform:translateY(-1px)}li strong{font-size:1.04rem}li code{color:var(--soft);font-size:.78rem}li .status-online{color:var(--good);font-weight:800}li .status-offline{color:var(--critical);font-weight:800}li>a>span[aria-hidden]{color:var(--cobalt);font-weight:800}.note{margin:28px 0 0;padding:16px 18px;border-left:3px solid var(--orange);color:var(--soft);background:rgba(255,253,248,.72);font-size:.88rem}.footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding-top:20px;border-top:1px solid var(--line);color:var(--soft);font-size:.82rem}.footer nav{display:flex;gap:18px}@media(max-width:560px){.shell{padding:20px 16px 32px}main{padding:44px 0 56px}li a{grid-template-columns:minmax(0,1fr) auto;padding:16px}li code{grid-column:1/-1;grid-row:2}.footer{display:block}.footer nav{margin-top:10px}}</style></head><body><div class="shell"><header class="brand"><a href="https://kitepon.dev/">kitepon.dev</a><span aria-hidden="true">/</span><strong>Lattice</strong></header><main><p class="eyebrow">LIVE DEVELOPMENT</p><h1>公開中の工程表</h1><p class="lead">Latticeが管理しているプロジェクトの工程と、いまどこまで進んでいるかを公開データから確認できます。</p>${content}<p class="note">表示内容はLatticeの記録から自動生成されます。製品の紹介や使い方はGitHubをご覧ください。</p></main><footer class="footer"><span>kitepon.dev の開発工程を、Latticeで可視化しています。</span><nav aria-label="関連リンク"><a href="https://kitepon.dev/">kitepon.dev</a><a href="https://github.com/kitepon-rgb/Lattice">GitHub</a></nav></footer></div></body></html>`;
}
