#!/usr/bin/env node
/** Refresh SC_LIVE in crave-2026-explorer.html from api-widget.soundcloud.com */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'crave-2026-explorer.html');
const CID = 'gxPRNsEq7CDD7Wvem4iymWOq3YfU7KS8';
const API = 'https://api-widget.soundcloud.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugsFromHtml(html) {
  const slugs = new Set();
  for (const m of html.matchAll(/\{id:'[^']+',[\s\S]*?\n \]\},/g)) {
    const sc = m[0].match(/\n sc:'([^']*)'/);
    if (sc && sc[1].trim()) slugs.add(sc[1].trim());
  }
  ['whoisstranger', 'setaoc_mass'].forEach((s) => slugs.add(s));
  return [...slugs].sort();
}

async function fetchAllTracks(userId) {
  const tracks = [];
  let url = `${API}/users/${userId}/tracks?client_id=${CID}&limit=200`;
  let guard = 0;
  while (url && guard++ < 40) {
    const r = await fetch(url);
    if (!r.ok) break;
    const j = await r.json();
    tracks.push(...(j.collection || []));
    url = j.next_href || null;
    if (url && !url.includes('client_id=')) {
      url += (url.includes('?') ? '&' : '?') + `client_id=${CID}`;
    }
    await sleep(80);
  }
  return tracks;
}

async function fetchSlug(slug) {
  const r = await fetch(
    `${API}/resolve?url=${encodeURIComponent('https://soundcloud.com/' + slug)}&client_id=${CID}`
  );
  if (!r.ok) return { error: `resolve ${r.status}` };
  const u = await r.json();
  if (!u.id) return { error: u.message || 'no user' };
  const tracks = await fetchAllTracks(u.id);
  let plays = 0;
  let trackLikes = 0;
  let top = { title: '', playback_count: 0 };
  const tops = [];
  for (const t of tracks) {
    const p = t.playback_count || 0;
    plays += p;
    trackLikes += t.likes_count || 0;
    if (p > top.playback_count) top = { title: t.title, playback_count: p };
    tops.push({
      title: t.title,
      playback_count: p,
      permalink_url: t.permalink_url || '',
      policy: t.policy || '',
      streamable: t.streamable !== false,
    });
  }
  tops.sort((a, b) => b.playback_count - a.playback_count);
  const sub = u.creator_subscriptions?.[0]?.product?.id || '';
  const visual = u.visuals?.visuals?.[0]?.visual_url || '';
  const avatar = u.avatar_url || '';
  return {
    followers: u.followers_count || 0,
    trackCount: u.track_count || tracks.length,
    playlistCount: u.playlist_count || 0,
    plays,
    trackLikes,
    city: u.city || '',
    top: top.playback_count ? top : null,
    tops: tops.slice(0, 8),
    pro: /pro/.test(sub),
    avatar,
    visual,
  };
}

function toScLive(cache) {
  const out = {};
  for (const [k, v] of Object.entries(cache)) {
    if (v.error) {
      out[k] = { err: 1 };
      continue;
    }
    const av =
      v.avatar && !String(v.avatar).includes('default_avatar') ? v.avatar : '';
    out[k] = {
      f: v.followers,
      tc: v.trackCount,
      pc: v.playlistCount,
      p: v.plays,
      tl: v.trackLikes,
      c: v.city || '',
      top: v.top ? [v.top.title, v.top.playback_count] : null,
      ...(v.pro ? { pro: 1 } : {}),
      ...(v.tops?.length
        ? {
            tops: v.tops.map((t) => [
              t.title,
              t.playback_count,
              t.permalink_url,
            ]),
          }
        : {}),
      ...(av ? { av } : {}),
      ...(v.visual ? { vis: v.visual } : {}),
    };
  }
  return out;
}

async function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const slugs = slugsFromHtml(html);
  const cache = {};
  for (const slug of slugs) {
    try {
      cache[slug] = await fetchSlug(slug);
      const v = cache[slug];
      console.log(
        slug.padEnd(22),
        v.error || `f=${v.followers} tc=${v.trackCount} p=${v.plays}`
      );
    } catch (e) {
      cache[slug] = { error: e.message };
      console.log(slug.padEnd(22), 'EXC', e.message);
    }
    await sleep(150);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const scLive = 'const SC_LIVE=' + JSON.stringify(toScLive(cache)) + ';';
  const next = html.replace(
    /\/\/ SoundCloud catalog stats[\s\S]*?^const SC_LIVE=\{[\s\S]*?\};/m,
    `// SoundCloud catalog stats (api-widget.soundcloud.com · refreshed ${stamp})\n${scLive}`
  );
  fs.writeFileSync(HTML, next);
  fs.writeFileSync(path.join(__dirname, '.sc-cache.json'), JSON.stringify(cache, null, 2));
  console.log(`\nWrote SC_LIVE (${Object.keys(cache).length} slugs) → ${HTML}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
