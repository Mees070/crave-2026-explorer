#!/usr/bin/env node
/** Refresh RA follower counts in crave-2026-explorer.html via ra.co/graphql */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'crave-2026-explorer.html');
const QUERY = 'query($slug:String!){artist(slug:$slug){name followerCount}}';
const EXTRA = { fredky: ['setaocmass'], chlstr: ['stranger-nl'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRa(slug) {
  const res = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Crave2026Explorer/1.0 (local refresh script)' },
    body: JSON.stringify({ query: QUERY, variables: { slug } }),
  });
  const json = await res.json();
  const a = json.data?.artist;
  if (!a) return null;
  return { name: a.name, count: a.followerCount };
}

function raSlugFromBlock(block) {
  const m = block.match(/ra\.co\/dj\/([^/'"\s]+)/);
  return m ? m[1] : null;
}

function patchArtist(block, count, note) {
  let out = block.replace(/\bra:\d+,/, `ra:${count},`);
  out = out.replace(/\bra_c:(?:true|false),/, 'ra_c:true,');
  const safe = note.replace(/'/g, "\\'");
  if (/\bra_n:'/.test(out)) {
    out = out.replace(/\bra_n:'(?:\\.|[^'])*',/g, '').replace(/\bra_c:true,/, `ra_c:true, ra_n:'${safe}',`);
  } else {
    out = out.replace(/\bra_c:true,/, `ra_c:true, ra_n:'${safe}',`);
  }
  return out;
}

async function main() {
  let html = fs.readFileSync(HTML, 'utf8');
  const blocks = [...html.matchAll(/\{id:'[^']+',[\s\S]*?\n \]\},/g)].map((m) => m[0]);
  const updates = [];
  for (const block of blocks) {
    const idM = block.match(/\{id:'([^']+)'/);
    if (!idM) continue;
    const id = idM[1];
    const slug = raSlugFromBlock(block);
    if (!slug) { console.warn(`skip ${id}: no ra.co/dj link`); continue; }
    const parts = [slug, ...(EXTRA[id] || [])];
    let total = 0;
    const names = [];
    for (const s of parts) {
      const info = await fetchRa(s);
      await sleep(150);
      if (!info) { console.warn(`  ${id}: slug "${s}" not found`); continue; }
      total += info.count;
      names.push(`${info.name} (${info.count.toLocaleString()})`);
    }
    if (!total) { console.warn(`skip ${id}: no counts`); continue; }
    const note = parts.length > 1
      ? `Confirmed combined RA followers: ${names.join(' + ')}.`
      : `Confirmed via ra.co (${names[0]}).`;
    updates.push({ id, total, note, slug });
    console.log(`${id.padEnd(8)} ${String(total).padStart(6)}  ${slug}${parts.length > 1 ? ' +' + EXTRA[id].join('+') : ''}`);
  }
  for (const { id, total, note } of updates) {
    const re = new RegExp(`\\{id:'${id}',[\\s\\S]*?\\n \\]\\},`);
    const m = html.match(re);
    if (!m) { console.warn(`block not found for ${id}`); continue; }
    html = html.replace(m[0], patchArtist(m[0], total, note));
  }
  html = html.replace(/bars\(a\.ra,15000/g, 'bars(a.ra,35000');
  fs.writeFileSync(HTML, html);
  console.log(`\nUpdated ${updates.length} artists in ${HTML}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
