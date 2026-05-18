#!/usr/bin/env node
/**
 * Resolve artist photos and bake img: fields into crave-2026-explorer.html
 * Sources: SoundCloud avatar/visual, then Instagram via unavatar (rate-limited).
 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'crave-2026-explorer.html');
const CID = 'gxPRNsEq7CDD7Wvem4iymWOq3YfU7KS8';
const SC_API = 'https://api-widget.soundcloud.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArtists(html) {
  const artists = [];
  for (const m of html.matchAll(/\{id:'([^']+)',[\s\S]*?\n \]\},/g)) {
    const block = m[0];
    const id = m[1];
    const pick = (re) => {
      const x = block.match(re);
      return x ? x[1] : '';
    };
    const raM = block.match(/ra\.co\/dj\/([^/'"\s]+)/);
    artists.push({
      id,
      block,
      sc: pick(/\n sc:'([^']*)'/),
      ig_h: pick(/\n ig_h:'([^']*)'/),
      ra: raM ? raM[1] : '',
    });
  }
  return artists;
}

function isDefaultScAvatar(url) {
  return !url || /default_avatar/i.test(url);
}

async function scImages(slug) {
  if (!slug) return { avatar: '', visual: '' };
  const r = await fetch(
    `${SC_API}/resolve?url=${encodeURIComponent('https://soundcloud.com/' + slug)}&client_id=${CID}`
  );
  if (!r.ok) return { avatar: '', visual: '' };
  const u = await r.json();
  return {
    avatar: u.avatar_url || '',
    visual: u.visuals?.visuals?.[0]?.visual_url || '',
  };
}

async function urlOk(url) {
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'User-Agent': 'Crave2026Explorer/1.0' },
      redirect: 'follow',
    });
    const ct = r.headers.get('content-type') || '';
    return r.ok && ct.startsWith('image/');
  } catch {
    return false;
  }
}

async function igPhoto(igH) {
  if (!igH) return '';
  const url = `https://unavatar.io/instagram/${encodeURIComponent(igH)}`;
  await sleep(2200);
  if (await urlOk(url)) return url;
  return '';
}

function bestPhoto(candidates) {
  for (const { url, src } of candidates) {
    if (url && !isDefaultScAvatar(url)) return { url, src };
  }
  for (const { url, src } of candidates) {
    if (url) return { url, src };
  }
  return null;
}

function patchBlock(block, img) {
  const safe = img.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (/\n img:'/.test(block)) {
    return block.replace(/\n img:'(?:\\.|[^'])*',/, `\n img:'${safe}',`);
  }
  if (/\n ig_h:'/.test(block)) {
    return block.replace(/(\n ig_h:'[^']*',)/, `$1\n img:'${safe}',`);
  }
  if (/\n sc:'/.test(block)) {
    return block.replace(/(\n sc:'[^']*',)/, `$1\n img:'${safe}',`);
  }
  return block.replace(/(\n name:'[^']*',)/, `$1\n img:'${safe}',`);
}

function removeImg(block) {
  return block.replace(/\n img:'(?:\\.|[^'])*',/g, '');
}

async function main() {
  let html = fs.readFileSync(HTML, 'utf8');
  const artists = parseArtists(html);
  const results = [];

  for (const a of artists) {
    const candidates = [];
    const sc = await scImages(a.sc);
    await sleep(120);
    if (!isDefaultScAvatar(sc.avatar)) {
      candidates.push({ url: sc.avatar, src: 'soundcloud-avatar' });
    }
    if (sc.visual) {
      candidates.push({ url: sc.visual, src: 'soundcloud-visual' });
    }
    let pick = bestPhoto(candidates);
    if (!pick && a.ig_h) {
      const ig = await igPhoto(a.ig_h);
      if (ig) pick = { url: ig, src: 'instagram' };
    }
    results.push({ id: a.id, name: a.block.match(/\n name:'([^']*)'/)?.[1], pick });
    console.log(
      a.id.padEnd(12),
      pick ? `${pick.src} → ${pick.url.slice(0, 72)}…` : 'no photo'
    );
  }

  for (const a of artists) {
    const r = results.find((x) => x.id === a.id);
    const re = new RegExp(`\\{id:'${a.id}',[\\s\\S]*?\\n \\]\\},`);
    const m = html.match(re);
    if (!m) continue;
    let block = m[0];
    if (r?.pick?.url) block = patchBlock(block, r.pick.url);
    else block = removeImg(block);
    html = html.replace(m[0], block);
  }

  fs.writeFileSync(HTML, html);
  const got = results.filter((r) => r.pick).length;
  console.log(`\nBaked img for ${got}/${artists.length} artists → ${HTML}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
