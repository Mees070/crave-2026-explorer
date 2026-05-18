#!/usr/bin/env node
/**
 * Suggest or apply genre tags from Beatport (top-track genres) or Discogs.
 *
 * Beatport auth (pick one):
 *   BEATPORT_TOKEN / BEATPORT_ACCESS_TOKEN — Bearer token directly
 *   OAuth password grant (register app at api.beatport.com/v4/docs/):
 *     BEATPORT_CLIENT_ID, BEATPORT_CLIENT_SECRET, BEATPORT_USERNAME, BEATPORT_PASSWORD
 *   OAuth refresh:
 *     BEATPORT_CLIENT_ID, BEATPORT_REFRESH_TOKEN
 *   Optional .env file in project root with the same variable names
 *
 * Note: browser cookies do NOT work on api.beatport.com — use OAuth or a Bearer token.
 *
 * Usage:
 *   node _fetch-bp.js --discogs --apply   # Discogs, no login (~1 req/s)
 *   node _fetch-bp.js --apply             # Beatport (OAuth or token)
 *   node _fetch-bp.js --id maryk
 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'crave-2026-explorer.html');
const CACHE = path.join(__dirname, '.bp-cache.json');
const API = 'https://api.beatport.com/v4';
const DISCOGS = 'https://api.discogs.com';
const UA = 'Crave2026Explorer/1.0 +https://github.com/Mees070/crave-2026-explorer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Optional overrides: search query, fixed Beatport artist id, extra queries (b2b). */
const ARTIST_META = {
  vtl: { bpQuery: 'donato dozzy', reject: [/voices from the lake/i] },
  dozzy: { bpQuery: 'donato dozzy' },
  fredky: { bpQueries: ['freddy k', 'setaoc mass'] },
  chlstr: { bpQueries: ['chlär', 'stranger nl'] },
  rhood: { bpQuery: 'robert hood' },
  djrum: { bpQuery: 'djrum' },
  uziq: { bpQuery: 'µ-ziq' },
  phpacho: { bpQuery: 'philippa pacho' },
  uberk: { bpQuery: 'überkikz' },
  xclub: { bpQuery: 'x club' },
  salute: { bpQuery: 'salute', reject: [/salute vocals/i] },
  kia: { bpQuery: 'kia', reject: [/kiasmos|kia motors/i] },
  oceanic: { bpQuery: 'oceanic', reject: [/oceanic flight/i] },
  spray: { bpQuery: 'spray', reject: [/bug spray|spray paint/i] },
  sybil: { bpQuery: 'sybil', reject: [/sybil vane/i] },
  darwin: { bpQuery: 'darwin', reject: [/charles darwin/i] },
  djcontest: { skip: true },
};

/** Beatport genre name → short tag (matches explorer chips). */
const GENRE_SHORT = {
  'techno (peak time / driving)': 'Techno',
  'techno (raw / deep / hypnotic)': 'Dub techno',
  'melodic house & techno': 'Melodic techno',
  'minimal / deep tech': 'Minimal techno',
  'tech house': 'Tech house',
  'deep house': 'Deep house',
  'progressive house': 'Progressive house',
  'afro house': 'Afro house',
  'bass house': 'Bass house',
  'uk garage / bassline': 'UK garage',
  'breaks / breakbeat / uk bass': 'Breakbeat',
  'hard dance / hardcore / neo rave': 'Hard dance',
  'trance (main floor)': 'Trance',
  'trance (raw / deep / hypnotic)': 'Trance',
  'psy-trance': 'Psy-trance',
  'nu disco / disco': 'Disco',
  'indie dance': 'Indie dance',
  'electronica': 'Electronica',
  'drum & bass': 'DnB',
  'dubstep': 'Dubstep',
  'dance / pop': 'Dance',
  'mainstage': 'Mainstage',
  house: 'House',
  techno: 'Techno',
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const USE_DISCOGS = args.includes('--discogs');
const ONLY = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;

loadDotEnv(path.join(__dirname, '.env'));

const DISCOGS_SKIP = new Set([
  'non-music',
  'interview',
  'rock',
  'jazz',
  'fusion',
  'prog rock',
  'free improvisation',
  'abstract',
]);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function oauthCredsFromEnv() {
  return {
    clientId: (process.env.BEATPORT_CLIENT_ID || '').trim(),
    clientSecret: (process.env.BEATPORT_CLIENT_SECRET || '').trim(),
    username: (process.env.BEATPORT_USERNAME || '').trim(),
    password: (process.env.BEATPORT_PASSWORD || '').trim(),
    refreshToken: (process.env.BEATPORT_REFRESH_TOKEN || '').trim(),
  };
}

async function beatportTokenRequest(body) {
  const r = await fetch(`${API}/auth/o/token/`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!r.ok) {
    const msg =
      json.error_description ||
      json.error ||
      json.detail ||
      text.slice(0, 160) ||
      r.statusText;
    throw new Error(`OAuth ${r.status}: ${msg}`);
  }
  if (!json.access_token) throw new Error('OAuth response missing access_token');
  return json;
}

async function obtainBeatportToken() {
  const direct = (
    process.env.BEATPORT_TOKEN ||
    process.env.BEATPORT_ACCESS_TOKEN ||
    ''
  ).trim();
  if (direct) return { type: 'token', token: direct };

  const { clientId, clientSecret, username, password, refreshToken } =
    oauthCredsFromEnv();

  if (clientId && refreshToken) {
    const json = await beatportTokenRequest({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    return { type: 'token', token: json.access_token, oauth: json };
  }

  if (clientId && clientSecret && username && password) {
    const json = await beatportTokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
      grant_type: 'password',
    });
    return { type: 'token', token: json.access_token, oauth: json };
  }

  if (clientId && clientSecret) {
    const json = await beatportTokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    return { type: 'token', token: json.access_token, oauth: json };
  }

  return null;
}

function bpHeaders(auth) {
  return {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${auth.token}`,
    'User-Agent': UA,
  };
}

function artistsFromHtml(html) {
  const out = [];
  for (const m of html.matchAll(/\{id:'([^']+)',[\s\S]*?\n \]\},/g)) {
    const block = m[0];
    const id = m[1];
    const nameM = block.match(/\n name:'((?:\\.|[^'])*)'/);
    const genresM = block.match(/\n genres:\[([^\]]*)\]/);
    const name = nameM ? nameM[1].replace(/\\'/g, "'") : id;
    const genres = genresM
      ? [...genresM[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((x) =>
          x[1].replace(/\\'/g, "'")
        )
      : [];
    out.push({ id, name, genres, block });
  }
  return out;
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanName(name) {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/\s+b2b\s+.*/i, '')
    .replace(/\s+DJ Contest.*/i, '')
    .trim();
}

function defaultQueries(displayName) {
  const c = cleanName(displayName);
  return [c];
}

function shortenGenre(name) {
  const raw = (name || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (GENRE_SHORT[key]) return GENRE_SHORT[key];
  const noParen = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const k2 = noParen.toLowerCase();
  if (GENRE_SHORT[k2]) return GENRE_SHORT[k2];
  if (/techno/i.test(noParen) && /dub|deep|raw/i.test(noParen)) return 'Dub techno';
  if (/techno/i.test(noParen)) return 'Techno';
  if (/house/i.test(noParen) && /acid/i.test(noParen)) return 'Acid house';
  if (/house/i.test(noParen)) return 'House';
  if (/trance/i.test(noParen)) return 'Trance';
  if (/garage/i.test(noParen)) return 'UK garage';
  if (/break/i.test(noParen)) return 'Breakbeat';
  if (/bass/i.test(noParen) && !/house/i.test(noParen)) return 'Bass';
  return noParen
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function unwrapResults(payload, key) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  if (key && payload[key]) return unwrapResults(payload[key], null);
  return [];
}

async function bpGet(auth, pathname) {
  const url = pathname.startsWith('http') ? pathname : `${API}${pathname}`;
  const r = await fetch(url, { headers: bpHeaders(auth) });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { detail: text.slice(0, 200) };
  }
  if (!r.ok) {
    const msg = json.detail || json.error || text.slice(0, 120) || r.statusText;
    throw new Error(`${r.status} ${msg}`);
  }
  return json;
}

async function searchArtists(auth, query) {
  const q = encodeURIComponent(query);
  const json = await bpGet(
    auth,
    `/catalog/search/?q=${q}&type=artists&per_page=12`
  );
  return unwrapResults(json, 'artists');
}

async function topTracks(auth, artistId) {
  const json = await bpGet(
    auth,
    `/catalog/artists/${artistId}/top-10-tracks/?per_page=10`
  );
  return unwrapResults(json, null);
}

function scoreArtist(candidate, query, meta) {
  const name = candidate.name || '';
  const hay = normalize(name);
  const q = normalize(query);
  if (meta.reject?.some((re) => re.test(name))) return -1;
  if (hay === q) return 100;
  if (hay.startsWith(q) || q.startsWith(hay)) return 85;
  const qTok = q.split(' ').filter(Boolean);
  const hits = qTok.filter((t) => hay.includes(t)).length;
  if (hits === qTok.length && qTok.length) return 70 + hits;
  if (hits >= Math.max(1, Math.ceil(qTok.length * 0.6))) return 40 + hits;
  return hits;
}

async function resolveArtist(auth, query, meta) {
  if (meta.bpId) {
    return { id: meta.bpId, name: query, slug: '' };
  }
  const list = await searchArtists(auth, query);
  let best = null;
  let bestScore = -1;
  for (const a of list) {
    const s = scoreArtist(a, query, meta);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  if (!best || bestScore < 40) return null;
  return best;
}

function genresFromTracks(tracks) {
  const counts = new Map();
  for (const t of tracks) {
    const g = t.genre?.name || t.genre_name;
    const sg = t.sub_genre?.name || t.sub_genre_name;
    for (const raw of [g, sg]) {
      const tag = shortenGenre(raw);
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 4);
}

function patchGenres(block, genres) {
  const inner = genres.map((g) => `'${g.replace(/'/g, "\\'")}'`).join(',');
  if (/\n genres:\[/.test(block)) {
    return block.replace(/\n genres:\[[^\]]*\]/, `\n genres:[${inner}]`);
  }
  return block.replace(
    /(\n warm:(?:true|false),)/,
    `$1\n genres:[${inner}],`
  );
}

async function discogsGet(pathname) {
  const url = pathname.startsWith('http') ? pathname : `${DISCOGS}${pathname}`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  if (!r.ok) throw new Error(`${r.status} ${json.message || r.statusText}`);
  return json;
}

async function discogsSearchReleases(query) {
  const q = encodeURIComponent(query);
  return discogsGet(
    `/database/search?artist=${q}&type=release&per_page=25`
  );
}

function shortenDiscogsTag(raw) {
  const t = (raw || '').trim();
  if (!t) return '';
  const k = t.toLowerCase();
  const map = {
    'drum n bass': 'DnB',
    'acid house': 'Acid house',
    'deep techno': 'Techno',
    'uk garage': 'UK garage',
    'hard techno': 'Hard techno',
    'industrial techno': 'Industrial techno',
    'minimal techno': 'Minimal techno',
    'dub techno': 'Dub techno',
    'ambient techno': 'Ambient techno',
    electronic: '',
  };
  if (map[k] !== undefined) return map[k];
  if (k === 'electronic') return '';
  return t
    .replace(/\bN\b/g, 'n')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bUk\b/g, 'UK')
    .replace(/\bDnB\b/g, 'DnB');
}

function genresFromDiscogsResults(results) {
  const counts = new Map();
  for (const r of results || []) {
    const styles = r.style || [];
    const genres = (r.genre || []).filter((g) => g.toLowerCase() !== 'electronic');
    const items = styles.length ? styles : genres;
    for (const raw of items) {
      const tag = shortenDiscogsTag(raw);
      if (!tag || DISCOGS_SKIP.has(tag.toLowerCase())) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 4);
}

async function fetchArtistGenresDiscogs(artist) {
  const meta = ARTIST_META[artist.id] || {};
  if (meta.skip) return { skip: true, reason: 'meta.skip' };

  const queries = meta.bpQueries || (meta.bpQuery ? [meta.bpQuery] : defaultQueries(artist.name));
  const counts = new Map();

  for (const q of queries) {
    const json = await discogsSearchReleases(q);
    await sleep(1250);
    for (const g of genresFromDiscogsResults(json.results)) {
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }

  const genres = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 4);

  return { genres, queries, source: 'discogs' };
}

async function fetchArtistGenres(auth, artist) {
  const meta = ARTIST_META[artist.id] || {};
  if (meta.skip) return { skip: true, reason: 'meta.skip' };

  const queries = meta.bpQueries || (meta.bpQuery ? [meta.bpQuery] : defaultQueries(artist.name));
  const counts = new Map();
  let bpArtist = null;

  for (const q of queries) {
    const match = await resolveArtist(auth, q, meta);
    await sleep(200);
    if (!match) continue;
    if (!bpArtist) bpArtist = match;
    const tracks = await topTracks(auth, match.id);
    await sleep(200);
    for (const g of genresFromTracks(tracks)) {
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }

  const genres = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 4);

  return {
    genres,
    bpArtist: bpArtist ? { id: bpArtist.id, name: bpArtist.name } : null,
    queries,
  };
}

async function runDiscogs(artists) {
  console.log(`Discogs · ${artists.length} artists (~1.1s each)\n`);
  const cache = {};
  const updates = [];

  for (const a of artists) {
    try {
      const res = await fetchArtistGenresDiscogs(a);
      cache[a.id] = res;
      if (res.skip) {
        console.log(`${a.id.padEnd(10)} — skip`);
        continue;
      }
      if (!res.genres.length) {
        console.log(`${a.id.padEnd(10)} !  no match (${res.queries.join(', ')})`);
        continue;
      }
      const was = a.genres.join(', ') || '—';
      console.log(
        `${a.id.padEnd(10)} ${res.genres.join(' · ').padEnd(36)}  was: ${was}`
      );
      updates.push({ id: a.id, genres: res.genres });
    } catch (e) {
      cache[a.id] = { error: e.message };
      console.log(`${a.id.padEnd(10)} ERR ${e.message}`);
    }
  }

  return { cache, updates, source: 'discogs' };
}

async function runBeatport(artists, auth) {
  console.log('Beatport API\n');
  try {
    await bpGet(auth, '/catalog/genres/?per_page=1');
  } catch (e) {
    throw new Error(`Auth check failed: ${e.message}`);
  }

  if (auth.oauth?.refresh_token) {
    console.log(
      'Tip: save BEATPORT_REFRESH_TOKEN in .env for next runs:\n',
      auth.oauth.refresh_token,
      '\n'
    );
  }

  const cache = {};
  const updates = [];

  for (const a of artists) {
    try {
      const res = await fetchArtistGenres(auth, a);
      cache[a.id] = res;
      if (res.skip) {
        console.log(`${a.id.padEnd(10)} — skip`);
        continue;
      }
      if (!res.genres.length) {
        console.log(`${a.id.padEnd(10)} !  no match (${res.queries.join(', ')})`);
        continue;
      }
      const bp = res.bpArtist ? ` · ${res.bpArtist.name}` : '';
      const was = a.genres.join(', ') || '—';
      console.log(
        `${a.id.padEnd(10)} ${res.genres.join(' · ').padEnd(36)}  was: ${was}${bp}`
      );
      updates.push({ id: a.id, genres: res.genres });
    } catch (e) {
      cache[a.id] = { error: e.message };
      console.log(`${a.id.padEnd(10)} ERR ${e.message}`);
    }
    await sleep(120);
  }

  return { cache, updates, source: 'beatport' };
}

async function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  let artists = artistsFromHtml(html);
  if (ONLY) artists = artists.filter((a) => a.id === ONLY);
  if (!artists.length) {
    console.error(ONLY ? `No artist id "${ONLY}"` : 'No artists found in HTML');
    process.exit(1);
  }

  let result;
  if (USE_DISCOGS) {
    result = await runDiscogs(artists);
  } else {
    let auth;
    try {
      auth = await obtainBeatportToken();
    } catch (e) {
      console.error('Beatport OAuth failed:', e.message);
      console.error('Use --discogs or fix credentials. See _fetch-bp.js header.');
      process.exit(1);
    }
    if (!auth) {
      console.error(
        'No Beatport credentials. Set in .env:\n' +
          '  BEATPORT_CLIENT_ID, BEATPORT_CLIENT_SECRET, BEATPORT_USERNAME, BEATPORT_PASSWORD\n' +
          'or BEATPORT_TOKEN=…\n' +
          'Or use: node _fetch-bp.js --discogs --apply'
      );
      process.exit(1);
    }
    try {
      result = await runBeatport(artists, auth);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  fs.writeFileSync(CACHE, JSON.stringify(result.cache, null, 2));

  if (!APPLY) {
    console.log(`\nDry run (${result.source}) — cache → ${CACHE}`);
    console.log(`Apply: node _fetch-bp.js${USE_DISCOGS ? ' --discogs' : ''} --apply`);
    return;
  }

  if (!result.updates.length) {
    console.log('\nNothing to apply.');
    return;
  }

  let next = html;
  for (const { id, genres } of result.updates) {
    const re = new RegExp(`\\{id:'${id}',[\\s\\S]*?\\n \\]\\},`);
    const m = next.match(re);
    if (!m) {
      console.warn(`block not found: ${id}`);
      continue;
    }
    next = next.replace(m[0], patchGenres(m[0], genres));
  }
  fs.writeFileSync(HTML, next);
  console.log(`\nApplied ${result.updates.length} genre lists (${result.source}) → ${HTML}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
