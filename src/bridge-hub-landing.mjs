/**
 * Bridge hub public landing — the product face of lattice.kitepon.dev.
 *
 * Pure rendering only: no I/O, no clock, no store access. The hub server
 * (`bridge-hub-server.mjs`) reads the registry, projects the public view,
 * applies the operator's visibility file, and passes the result here.
 *
 * Design canon (ADR 0164): the page follows the kitepon.dev brand canon
 * (RootSitePromotion docs/color-system.md, docs/identity-system.md) — not
 * the loopback dashboard's look. Constraints baked in:
 * - No arrow glyphs as link decoration (identity-system.md "Links").
 * - No external resources: CSP stays `default-src 'none'`, the diagram is
 *   inline SVG, fonts are the system stack.
 * - No white small text on #EF8D32; deep orange for small labels.
 * - No noindex: this page exists to be found (ADR 0164 Decision 5).
 */

export const BRIDGE_HUB_LANDING_LANGUAGES = Object.freeze(['ja', 'en']);

const ORIGIN = 'https://lattice.kitepon.dev';

// One table for both languages: a missing translation is a visible
// structural gap here, never a silent fallback at a call site.
const LANDING_COPY = Object.freeze({
  ja: Object.freeze({
    htmlLang: 'ja',
    canonicalPath: '/',
    switchHref: '/en/',
    switchLabel: 'English',
    title: 'Lattice — 並列開発のschedulability compiler',
    description: 'コードベースの実際の変更境界を解析し、開発タスクの並列実行可否を判定するLatticeの製品紹介と、公開中のライブ工程表。',
    eyebrow: '公開 / 特許出願済み',
    heroLead: 'コードベースの実際の変更境界を解析し、複数の開発タスクを並列実行できるか判定するschedulability compiler。競合する場合は境界を分割し、計画を再コンパイルする。',
    howTitle: 'Latticeがしていること',
    howCards: [
      { title: '境界を観測する', body: 'コードの実際の変更境界——ファイル・シンボル・依存の交差——を、索引済みのコード知識グラフから読み取ります。宣言や推測ではなく、実態から始めます。' },
      { title: '並列可能を証明する', body: 'タスク同士の書込範囲が交差しないことを検証し、同時に走らせてよい組を確定します。並列化は雰囲気ではなく、証明の結果です。' },
      { title: '分割して、再コンパイル', body: 'タスクが衝突したら、境界を切り分けて計画を再コンパイルします。工程は止まらず、次に走れる形へ組み直されます。' },
    ],
    diagramLabel: '衝突した2つのタスクの境界を分割し、並列の2経路へ再コンパイルする図',
    liveTitle: 'ライブ工程表',
    liveCaption: 'この一覧は、Latticeが管理している実プロジェクトの公開データから、いまこの瞬間に生成されています。開くと各工程の現在地が見られます。この一覧自体が動作デモです。',
    hostPrefix: '配信元',
    statusOnline: 'オンライン',
    statusOffline: 'オフライン',
    empty: 'いまは公開中の端末がありません。少し待ってから再読み込みしてください。',
    ctaGithub: 'GitHubで見る',
    ctaRoot: 'kitepon.devへ戻る',
    rootHref: 'https://kitepon.dev/',
    footerNote: 'kitepon.dev の開発工程を、Lattice自身で可視化しています。',
    footerNavLabel: '関連リンク',
  }),
  en: Object.freeze({
    htmlLang: 'en',
    canonicalPath: '/en/',
    switchHref: '/',
    switchLabel: '日本語',
    title: 'Lattice — a schedulability compiler for parallel development',
    description: 'Product page and live public plans for Lattice, a schedulability compiler that proves which development tasks can run in parallel.',
    eyebrow: 'PUBLIC / PATENT PENDING',
    heroLead: 'A schedulability compiler that analyzes real code-change boundaries and proves which development tasks can run in parallel. When tasks collide, it splits the boundary and recompiles the plan.',
    howTitle: 'What Lattice does',
    howCards: [
      { title: 'Observe real boundaries', body: 'It reads the actual change boundaries of the code — files, symbols, crossing dependencies — from an indexed knowledge graph. It starts from reality, not from declarations.' },
      { title: 'Prove parallelism', body: 'It verifies that tasks touch non-overlapping write ranges and pins down which of them may run at the same time. Parallelism is a proof result, not a mood.' },
      { title: 'Split and recompile', body: 'When tasks collide, it splits the seam and recompiles the plan. The work does not stop; it is reshaped into what can run next.' },
    ],
    diagramLabel: 'Diagram: two colliding tasks are split at the boundary and recompiled into two parallel routes',
    liveTitle: 'Live plans',
    liveCaption: 'This list is compiled at this very moment from public data of real projects managed by Lattice itself. Open one to see where the work stands. The list is the demo.',
    hostPrefix: 'served by',
    statusOnline: 'ONLINE',
    statusOffline: 'OFFLINE',
    empty: 'No terminals are publishing right now. Check back in a moment.',
    ctaGithub: 'View on GitHub',
    ctaRoot: 'Back to kitepon.dev',
    rootHref: 'https://kitepon.dev/en',
    footerNote: 'The development of kitepon.dev, made visible by Lattice itself.',
    footerNavLabel: 'Related links',
  }),
});

const GITHUB_URL = 'https://github.com/kitepon-rgb/Lattice';

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Brand-canon tokens (RootSitePromotion docs/color-system.md, 2026-07-27).
// Paper/White carry the page; Ink carries text; Orange is confined to
// eyebrow/labels/pills/CTA; Cobalt to the diagram and hover borders.
const LANDING_STYLE = `:root{color-scheme:light;--paper:#f8f5ef;--white:#fffef9;--ink:#111b35;--ink-soft:rgba(17,27,53,.62);--line:rgba(17,27,53,.14);--orange:#ef8d32;--orange-strong:#c65300;--orange-deep:#a84400;--orange-soft:#fbe5d2;--cobalt:#2149aa}
*{box-sizing:border-box}
body{min-height:100vh;margin:0;color:var(--ink);background:var(--paper);font:16px/1.8 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
.shell{max-width:960px;margin:0 auto;padding:28px 22px 48px}
.brand{display:flex;align-items:center;gap:9px;padding-bottom:22px;border-bottom:1px solid var(--line);font-size:.88rem}
.brand a{color:var(--ink);font-weight:800;text-decoration:none}
.brand a:hover{color:var(--orange-strong)}
.brand .sep{color:var(--ink-soft)}
.brand .lang{margin-left:auto;font-weight:700;color:var(--ink-soft)}
.brand .lang:hover{color:var(--orange-strong)}
.hero{padding:58px 0 40px}
.eyebrow{margin:0 0 10px;color:var(--orange-deep);font-size:.72rem;font-weight:800;letter-spacing:.18em}
h1{margin:0 0 16px;font-size:clamp(2.4rem,7vw,4rem);line-height:1.12;letter-spacing:-.04em}
.lead{max-width:640px;margin:0;font-size:1.06rem;color:var(--ink)}
.how{margin:14px 0 0;padding:30px 26px 34px;border-radius:16px;background:var(--orange-soft)}
h2{margin:0 0 18px;font-size:1.28rem;letter-spacing:-.01em}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0;padding:0;list-style:none}
.cards li{padding:18px 18px 20px;border:1px solid var(--line);border-radius:12px;background:var(--white)}
.cards h3{margin:0 0 8px;font-size:.98rem}
.cards p{margin:0;font-size:.86rem;line-height:1.75;color:var(--ink-soft)}
.diagram{display:block;margin:26px auto 0;max-width:520px;width:100%;height:auto}
.live{padding:44px 0 8px}
.live-caption{max-width:640px;margin:0 0 22px;font-size:.92rem;color:var(--ink-soft)}
.plans{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.plans a{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 20px;padding:16px 20px;border:1px solid var(--line);border-radius:12px;color:inherit;background:var(--white);text-decoration:none}
.plans a:hover{border-color:var(--cobalt);transform:translateY(-1px)}
.plans a:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px}
.plans strong{font-size:1.04rem}
.plans .host{grid-column:1;font-size:.76rem;color:var(--ink-soft)}
.plans .pill{grid-column:2;grid-row:1/span 2;justify-self:end;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:800;letter-spacing:.06em}
.pill.online{color:var(--orange-strong);background:var(--orange-soft)}
.pill.offline{color:var(--ink-soft);background:rgba(17,27,53,.07)}
.empty{padding:18px 20px;border:1px dashed var(--line);border-radius:12px;color:var(--ink-soft)}
.cta{display:flex;flex-wrap:wrap;gap:12px;padding:36px 0 44px}
.cta a{display:inline-block;padding:12px 22px;border-radius:999px;font-weight:800;font-size:.94rem;text-decoration:none}
.cta .primary{color:var(--white);background:var(--orange-strong)}
.cta .primary:hover{background:var(--orange-deep)}
.cta .secondary{color:var(--ink);border:1px solid var(--line);background:var(--white)}
.cta .secondary:hover{border-color:var(--orange-strong);color:var(--orange-strong)}
.cta a:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px}
.footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding-top:20px;border-top:1px solid var(--line);color:var(--ink-soft);font-size:.82rem}
.footer a{color:var(--ink);font-weight:700;text-decoration:none}
.footer a:hover{color:var(--orange-strong)}
.footer nav{display:flex;gap:18px}
@media(max-width:720px){.cards{grid-template-columns:1fr}}
@media(max-width:560px){.shell{padding:20px 16px 36px}.hero{padding:44px 0 30px}.how{padding:22px 18px 26px}.plans a{padding:14px 16px}.footer{display:block}.footer nav{margin-top:10px}}`;

// Collide -> split -> parallel, in brand geometry: Cobalt trajectories,
// Discovery Orange nodes. Inline so the CSP never needs img-src.
function landingDiagram(label) {
  return `<svg class="diagram" viewBox="0 0 520 150" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg">`
    + `<path d="M20 45 C 90 45 130 72 180 75" fill="none" stroke="#2149aa" stroke-width="2"/>`
    + `<path d="M20 105 C 90 105 130 78 180 75" fill="none" stroke="#2149aa" stroke-width="2"/>`
    + `<circle cx="180" cy="75" r="7" fill="#ef8d32"/>`
    + `<path d="M187 75 C 240 75 260 40 320 40 L 500 40" fill="none" stroke="#2149aa" stroke-width="2"/>`
    + `<path d="M187 75 C 240 75 260 110 320 110 L 500 110" fill="none" stroke="#2149aa" stroke-width="2"/>`
    + `<circle cx="320" cy="40" r="5" fill="#ef8d32"/>`
    + `<circle cx="320" cy="110" r="5" fill="#ef8d32"/>`
    + `<circle cx="500" cy="40" r="5" fill="#ef8d32"/>`
    + `<circle cx="500" cy="110" r="5" fill="#ef8d32"/>`
    + `</svg>`;
}

function landingHead(copy) {
  const canonical = `${ORIGIN}${copy.canonicalPath}`;
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="description" content="${escapeHtml(copy.description)}">`
    + `<link rel="canonical" href="${canonical}">`
    + `<link rel="alternate" hreflang="ja" href="${ORIGIN}/">`
    + `<link rel="alternate" hreflang="en" href="${ORIGIN}/en/">`
    + `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`
    + `<meta property="og:title" content="${escapeHtml(copy.title)}">`
    + `<meta property="og:description" content="${escapeHtml(copy.description)}">`
    + `<meta name="theme-color" content="#f8f5ef">`
    + `<title>${escapeHtml(copy.title)}</title>`
    + `<style>${LANDING_STYLE}</style>`;
}

function landingPlanList(copy, projects, displayNames) {
  if (projects.length === 0) return `<p class="empty">${escapeHtml(copy.empty)}</p>`;
  const rows = projects.map((project) => {
    const href = `/projects/${encodeURIComponent(project.project_id)}/`;
    const online = project.status === 'online';
    const title = displayNames[project.project_id] ?? project.project_id;
    return `<li><a href="${escapeHtml(href)}">`
      + `<strong>${escapeHtml(title)}</strong>`
      + `<span class="pill ${online ? 'online' : 'offline'}">${escapeHtml(online ? copy.statusOnline : copy.statusOffline)}</span>`
      + `<span class="host">${escapeHtml(copy.hostPrefix)}: ${escapeHtml(project.display_name)}</span>`
      + `</a></li>`;
  }).join('');
  return `<ul class="plans">${rows}</ul>`;
}

/**
 * Render the public landing.
 *
 * @param {object} input
 * @param {Array<{project_id: string, display_name: string, status: string}>} input.projects
 *   The already-filtered public view (visibility applied by the caller).
 * @param {'ja'|'en'} input.lang
 * @param {Record<string, string>} [input.displayNames]
 *   Operator display-name map (public-visibility.json); unmapped ids render as-is.
 */
export function renderBridgeHubLanding({ projects, lang, displayNames = {} }) {
  const copy = LANDING_COPY[lang];
  if (copy === undefined) throw new RangeError(`unsupported landing language: ${lang}`);
  const cards = copy.howCards.map((card) =>
    `<li><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p></li>`).join('');
  return `<!doctype html><html lang="${copy.htmlLang}"><head>${landingHead(copy)}</head><body><div class="shell">`
    + `<header class="brand">`
    + `<a href="${escapeHtml(copy.rootHref)}">kitepon.dev</a><span class="sep" aria-hidden="true">/</span><strong>Lattice</strong>`
    + `<a class="lang" href="${copy.switchHref}" lang="${lang === 'ja' ? 'en' : 'ja'}" hreflang="${lang === 'ja' ? 'en' : 'ja'}">${copy.switchLabel}</a>`
    + `</header>`
    + `<main>`
    + `<section class="hero"><p class="eyebrow">${escapeHtml(copy.eyebrow)}</p><h1>Lattice</h1>`
    + `<p class="lead">${escapeHtml(copy.heroLead)}</p></section>`
    + `<section class="how"><h2>${escapeHtml(copy.howTitle)}</h2><ul class="cards">${cards}</ul>`
    + `${landingDiagram(copy.diagramLabel)}</section>`
    + `<section class="live"><h2>${escapeHtml(copy.liveTitle)}</h2>`
    + `<p class="live-caption">${escapeHtml(copy.liveCaption)}</p>`
    + `${landingPlanList(copy, projects, displayNames)}</section>`
    + `<div class="cta">`
    + `<a class="primary" href="${GITHUB_URL}">${escapeHtml(copy.ctaGithub)}</a>`
    + `<a class="secondary" href="${escapeHtml(copy.rootHref)}">${escapeHtml(copy.ctaRoot)}</a>`
    + `</div>`
    + `</main>`
    + `<footer class="footer"><span>${escapeHtml(copy.footerNote)}</span>`
    + `<nav aria-label="${escapeHtml(copy.footerNavLabel)}"><a href="${escapeHtml(copy.rootHref)}">kitepon.dev</a><a href="${GITHUB_URL}">GitHub</a></nav>`
    + `</footer></div></body></html>`;
}
