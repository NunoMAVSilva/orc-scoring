// Migra os dados da estrutura v1 (data-export/) para a v2 (data-v2/):
//   Campeonato → Prova (evento, com inscritos) → Regatas; Barcos com Skipper e Clube.
// Depois confirma que as classificações do campeonato ficam exatamente iguais.
// Uso: node scripts/migrate-v2.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const E1 = require(join(root, 'docs', 'engine.js'));
const E2 = require(join(root, 'app', 'engine.js'));

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const load = col => {
  const dir = join(root, 'data-export', col), o = {};
  if (existsSync(dir)) for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) o[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return o;
};
const v1 = { boats: load('boats'), classes: load('classes'), champs: load('champs'), races: load('races') };
const v2 = { champs: {}, events: {}, races: {}, boats: {}, classes: v1.classes, clubs: {}, skippers: {} };

// clubes
const CLUB_NAMES = { GCNFaro: 'Ginásio Clube Naval de Faro' };
const clubId = code => {
  if (!code) return '';
  const id = slug(code);
  if (!v2.clubs[id]) v2.clubs[id] = { name: CLUB_NAMES[code] || code, short: code };
  return id;
};
for (const c of Object.values(v1.champs)) if (c.club) { const k = Object.keys(CLUB_NAMES).find(k => CLUB_NAMES[k] === c.club); if (k) clubId(k); }

// barcos + skippers
for (const [id, b] of Object.entries(v1.boats)) {
  const { club, skipper, ...rest } = b;
  const nb = Object.assign({}, rest, { clubId: clubId(club) });
  if (skipper) {
    const sid = slug(skipper);
    v2.skippers[sid] = v2.skippers[sid] || { name: skipper, clubId: clubId(club), license: '' };
    nb.skipperId = sid;
  }
  v2.boats[id] = nb;
}

// campeonatos
for (const [id, c] of Object.entries(v1.champs)) {
  const { order, club, ...rest } = c;
  v2.champs[id] = Object.assign({}, rest, { clubId: Object.keys(CLUB_NAMES).find(k => CLUB_NAMES[k] === club) ? clubId(Object.keys(CLUB_NAMES).find(k => CLUB_NAMES[k] === club)) : '' });
}

// provas a partir de race.event; regatas passam a apontar para a prova
for (const [rid, r] of Object.entries(v1.races)) {
  const evName = r.event || r.name;
  const eid = `${r.champ}-${slug(evName)}`;
  const ev = v2.events[eid] = v2.events[eid] || { name: evName, champ: r.champ, clubId: v2.champs[r.champ] ? v2.champs[r.champ].clubId : '', dateFrom: r.date, dateTo: r.date, venue: '', entries: [] };
  if (r.date < ev.dateFrom) ev.dateFrom = r.date;
  if (r.date > ev.dateTo) ev.dateTo = r.date;
  for (const f of r.finishes || []) if (!ev.entries.includes(f.boatId)) ev.entries.push(f.boatId);
  const { champ, event, n, ...rest } = r;
  v2.races[rid] = Object.assign({}, rest, { event: eid });
}
for (const ev of Object.values(v2.events)) ev.entries.sort();

// ---- verificação: classificações v1 vs v2 ----
const champRaces1 = cid => (v1.champs[cid].order || []).map(id => Object.assign({ id }, v1.races[id])).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const champRaces2 = cid => Object.entries(v2.races).filter(([, r]) => v2.events[r.event].champ === cid).map(([id, r]) => Object.assign({ id }, r)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const champEntries2 = cid => [...new Set(Object.values(v2.events).filter(e => e.champ === cid).flatMap(e => e.entries))];
const sig = st => JSON.stringify(st.table.map(r => [r.boatId, r.rank, r.net, r.total, r.cells.map(c => [c.pts, c.code || '', !!c.disc])]).sort((a, b) => a[0].localeCompare(b[0]))) + '|' + st.dnc + '|' + st.nDiscards;
let checks = 0;
for (const cid of Object.keys(v1.champs)) {
  const c = v1.champs[cid];
  const groups = [null].concat((c.groups || []).map(d => b => E1.divisionOf(b, '', v1, c) === d)).concat((c.classGroups || []).map(cl => b => b.classRef === cl));
  for (const g of groups) {
    const a = E1.seriesStandings(champRaces1(cid), v1, { champ: c, filter: g });
    const b = E2.seriesStandings(champRaces2(cid), v2, { champ: v2.champs[cid], filter: g, boats: champEntries2(cid) });
    if (sig(a) !== sig(b)) { console.error('DIFERENÇA na classificação', cid); process.exit(1); }
    checks++;
  }
}
for (const [rid, r] of Object.entries(v1.races)) {
  const a = E1.raceResults(Object.assign({ id: rid }, r), v1).rows, b = E2.raceResults(Object.assign({ id: rid }, v2.races[rid]), v2).rows;
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('DIFERENÇA na regata', rid); process.exit(1); }
  checks++;
}

const out = join(root, 'data-v2');
rmSync(out, { recursive: true, force: true });
for (const [col, docs] of Object.entries(v2)) {
  mkdirSync(join(out, col), { recursive: true });
  for (const [id, d] of Object.entries(docs)) writeFileSync(join(out, col, id + '.json'), JSON.stringify(d, null, 2) + '\n');
}
console.log(Object.entries(v2).map(([k, o]) => `${k}: ${Object.keys(o).length}`).join(' · '));
console.log(`${checks} verificações: classificações e regatas iguais às da v1.`);
