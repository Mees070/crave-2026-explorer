#!/usr/bin/env node
/** Refresh YT_LIVE — artist-matched sets, ranked by relevance + popularity. */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'crave-2026-explorer.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-artist: name strings that must match (in title or channel), optional extra queries. */
const ARTIST_META = {
  maryk: { names: ['mary lake'] },
  jakojako: { names: ['jakojako'] },
  vtl: { names: ['voices from the lake', 'vftl', 'donato dozzy and neel'] },
  yanam: { names: ['yanamaste'] },
  fredky: {
    names: ['freddy k', 'setaoc mass'],
    queries: ['freddy k boiler room', 'setaoc mass boiler room', 'freddy k live set'],
  },
  rhood: { names: ['robert hood', 'floorplan'] },
  kyrak: {
    names: ['kyra khaldi'],
    titleMustInclude: ['kyra khaldi'],
    reject: [/mangue d'amour|house party mix/i],
    queries: ['kyra khaldi boiler room', 'kyra khaldi HÖR', 'kyra khaldi live set'],
  },
  spray: { names: ['spray'], minTitleLen: 5, titleMustInclude: ['spray'] },
  sallc: { names: ['sally c', 'sallyc'] },
  benwal: { names: ['benwal', 'ben wal'] },
  xclub: { names: ['x club', 'xclub', 'x club.'] },
  salute: { names: ['salute'], reject: [/salute\s*(vocals|choir|army)/i] },
  uberk: { names: ['überkikz', 'uberkikz', 'uber kikz'] },
  kink: { names: ['kink'], requireSet: true, reject: [/kink\s*os\b|kink\s*academy|kinks?\s*explained/i] },
  phpacho: { names: ['philippa pacho', 'pacho'] },
  chlstr: {
    names: ['chlär', 'chlar', 'stranger'],
    queries: ['chlar boiler room', 'stranger nl boiler room'],
  },
  dkolo: { names: ['daria kolosova', 'kolosova'] },
  sybil: {
    names: ['sybil'],
    reject: [/sibil\b|sybil\s+vane|voert|uitvoert|love i lost|soulto/i],
    queries: ['sybil dekmantel live', 'sybil sustain release'],
  },
  fdw: {
    names: ['forest drive west'],
    queries: ['forest drive west dekmantel', 'forest drive west boiler room'],
  },
  spekki: { names: ['spekki webu', 'spekkiwebu'] },
  uziq: { names: ['µ-ziq', 'mu-ziq', 'uzi q'] },
  darwin: {
    names: ['darwin'],
    reject: [/charles darwin|darwin award|darwin\s+fish|natural selection/i],
    requireSet: true,
  },
  djrum: { names: ['djrum', 'dj rum'] },
  dozzy: { names: ['donato dozzy'] },
  jetti: { names: ['jetti'], queries: ['jetti HÖR', 'jetti live set'] },
  d6teen: { names: ['sweet6teen', 'dj sweet6teen', 'sweet 6teen'] },
  reyco: { names: ['rey colino'] },
  oceanic: {
    names: ['oceanic'],
    reject: [/oceanic\s*flight|maldives|ritz carlton|melodic house mix 202/i],
    requireSet: true,
  },
  kia: {
    names: ['kia'],
    reject: [/kiasmos|kia motors|kia ora|kia oval|friction.*kia|mixmag an/i],
    requireSet: true,
    queries: ['kia DJ HÖR', 'kia the lot radio'],
  },
  carista: { names: ['carista'] },
};

const SET =
  /boiler room|hör|hor berlin|hoer berlin|\bhor\b|live set|full set|dj set|recorded live|dekmantel|mixmag|ra live|cercle|nts live|the lot radio|hoersturz|@\s|festival|ade \d|warehouse|berghain|boilerroom|live at|live @|live for|live in|b2b|all night long|hour set|\d+\s*hour/i;
const PREFERRED =
  /boiler room|hör|hoer |hor |mixmag|dekmantel|cercle|ra live|nts live|the lot radio|glitch festival|united identities|hoersturz/i;
const AVOID =
  /reaction|review|tutorial|karaoke|cover version|podcast|interview|in conversation|people of boiler room|news|trailer|teaser|#shorts|\bshorts\b|full album|official video|music video|\bmv\b|lyrics|werk zoekt|how to mix|masterclass|unboxing|vlog|behind the scenes|performs\s+".*"\s+at|walkthrough|documentary|miley cyrus/i;

function artistsFromHtml(html) {
  const out = [];
  for (const m of html.matchAll(/\{id:'([^']+)',[\s\S]*?\n \]\},/g)) {
    const block = m[0];
    const id = m[1];
    const nameM = block.match(/\n name:'((?:\\.|[^'])*)'/);
    const name = nameM ? nameM[1].replace(/\\'/g, "'") : id;
    const ytLinks = [...block.matchAll(/youtube\.com\/[^\s'"]+/g)].map((x) => x[0]);
    out.push({ id, name, ytLinks });
  }
  return out;
}

function watchId(url) {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function searchQueryFromUrl(url) {
  const m = url.match(/search_query=([^&]+)/);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
}

function cleanName(name) {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/\s+b2b\s+.*/i, '')
    .replace(/\s+DJ Contest.*/i, '')
    .trim();
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function defaultNames(displayName) {
  const c = cleanName(displayName);
  const names = [normalize(c)];
  const parts = c.split(/\s+/).filter((w) => w.length > 2);
  if (parts.length >= 2) names.push(normalize(parts.join(' ')));
  if (parts[0] && parts[0].length > 4) names.push(normalize(parts[0]));
  return [...new Set(names)];
}

function parseViews(s) {
  if (!s) return 0;
  const t = String(s).toLowerCase().replace(/\s/g, '');
  const km = t.match(/([\d.,]+)\s*([km])/);
  if (km) {
    let n = parseFloat(km[1].replace(',', '.'));
    if (km[2] === 'k') n *= 1e3;
    if (km[2] === 'm') n *= 1e6;
    return Math.round(n);
  }
  const digits = t.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function isSet(title) {
  return SET.test(title || '');
}

function nameMatches(hay, namePhrase) {
  const n = normalize(namePhrase);
  if (!n) return false;
  const tokens = n.split(' ').filter((w) => w.length > 1);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) {
    const w = tokens[0];
    if (w.length <= 4) return new RegExp(`\\b${w}\\b`).test(hay);
    return hay.includes(w);
  }
  const hit = tokens.filter((t) => hay.includes(t)).length;
  if (tokens.length === 2) return hit >= 2;
  return hit >= Math.max(2, Math.ceil(tokens.length * 0.75));
}

function artistMatch(v, artistId, displayName) {
  const meta = ARTIST_META[artistId] || {};
  const hay = normalize(`${v.title} ${v.channel}`);
  const names = meta.names || defaultNames(displayName);

  if (meta.reject?.some((re) => re.test(v.title))) return false;
  if (AVOID.test(v.title)) return false;

  const ok = names.some((n) => nameMatches(hay, n));
  if (!ok) return false;

  if (meta.titleMustInclude?.length) {
    const ht = normalize(v.title);
    if (!meta.titleMustInclude.some((p) => ht.includes(normalize(p)))) return false;
  }

  if (meta.requireSet && !isSet(v.title)) return false;

  if (meta.minTitleLen && normalize(v.title).length < meta.minTitleLen) return false;

  const short = names.every((n) => normalize(n).replace(/\s/g, '').length <= 6);
  if (short && !isSet(v.title) && !PREFERRED.test(v.title)) return false;

  return true;
}

function scoreVideo(v, artistId, displayName, opts = {}) {
  if (!artistMatch(v, artistId, displayName)) return -9999;

  const t = v.title || '';
  let s = 0;

  if (!opts.linked && !isSet(t)) return -9999;

  if (isSet(t)) s += 28;
  else s -= 12;

  if (PREFERRED.test(t) || PREFERRED.test(v.channel || '')) s += 22;
  if (AVOID.test(t)) s -= 80;

  const views = parseViews(v.views);
  if (views > 0) s += Math.min(24, Math.log10(views + 1) * 4);

  const meta = ARTIST_META[artistId];
  const names = meta?.names || defaultNames(displayName);
  const hay = normalize(t);
  for (const n of names) {
    const nn = normalize(n);
    if (nn.length > 4 && hay.includes(nn)) s += 12;
  }

  if (/\b\d+\s*h(our|rs)?\b/i.test(t) || /all night/i.test(t)) s += 6;

  return s;
}

async function ytSearch(q, max = 20) {
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240401.00.00',
        hl: 'en',
        gl: 'NL',
      },
    },
    query: q,
  };
  const r = await fetch(
    'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Crave2026Explorer/1.0)',
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`search ${r.status}`);
  const j = await r.json();
  const items = [];
  for (const sec of j.contents?.twoColumnSearchResultsRenderer
    ?.primaryContents?.sectionListRenderer?.contents || []) {
    for (const it of sec.itemSectionRenderer?.contents || []) {
      const v = it.videoRenderer;
      if (!v?.videoId) continue;
      const title = (v.title?.runs || []).map((x) => x.text).join('');
      const views = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
      const channel = (v.ownerText?.runs || v.longBylineText?.runs || [])
        .map((x) => x.text)
        .join('');
      items.push({ id: v.videoId, title, views, channel });
    }
  }
  return items.slice(0, max);
}

function queriesFor(artist) {
  const meta = ARTIST_META[artist.id] || {};
  if (meta.queries?.length) return [...meta.queries];
  const n = cleanName(artist.name);
  const qs = new Set();
  for (const link of artist.ytLinks) {
    const q = searchQueryFromUrl(link);
    if (q) qs.add(q);
  }
  if (n) {
    qs.add(`${n} boiler room`);
    qs.add(`${n} HÖR`);
    qs.add(`${n} live set`);
    qs.add(`${n} dekmantel`);
  }
  return [...qs];
}

async function pickVideos(artist) {
  const seen = new Set();
  const pool = [];

  for (const link of artist.ytLinks) {
    const id = watchId(link);
    if (id && !seen.has(id)) {
      seen.add(id);
      pool.push({
        id,
        title: 'Linked from lineup',
        views: '',
        channel: '',
        score: 40,
        linked: true,
      });
    }
  }

  for (const q of queriesFor(artist)) {
    try {
      const found = await ytSearch(q);
      for (const v of found) {
        if (seen.has(v.id)) continue;
        const score = scoreVideo(v, artist.id, artist.name, { linked: false });
        if (score < 12) continue;
        seen.add(v.id);
        pool.push({ ...v, score });
      }
    } catch (e) {
      console.warn('  search fail', q, e.message);
    }
    await sleep(400);
  }

  pool.sort((a, b) => b.score - a.score);

  const good = pool.filter((v) => v.score >= 12);
  const ok = pool.filter((v) => v.score > 0);
  const picked = (good.length >= 3 ? good : ok).slice(0, 3);

  return picked.map(({ id, title, views }) => ({ id, title, views }));
}

async function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const artists = artistsFromHtml(html);
  const live = {};

  for (const a of artists) {
    if (a.id === 'djcontest' || !a.name || a.name === 'DJ Contest') continue;
    try {
      const videos = await pickVideos(a);
      if (videos.length) live[a.id] = videos;
      const tag = videos.length < 3 ? '!' : ' ';
      console.log(
        tag + a.id.padEnd(9),
        videos.length,
        videos.map((v) => `[${v.views || '?'}] ${v.title.slice(0, 42)}`).join(' | ')
      );
    } catch (e) {
      console.log('!', a.id.padEnd(9), 'ERR', e.message);
    }
    await sleep(250);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const block = `// YouTube top videos (artist-matched sets · refreshed ${stamp})\nconst YT_LIVE=${JSON.stringify(live)};`;
  const next = html.replace(
    /\/\/ YouTube top videos[\s\S]*?^const YT_LIVE=\{[\s\S]*?\};/m,
    block
  );
  fs.writeFileSync(HTML, next);
  console.log(`\nWrote YT_LIVE (${Object.keys(live).length} artists) → ${HTML}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
