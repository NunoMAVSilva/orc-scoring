// Junta a exportação da base de dados da app no Claude (data-v2/<coleção>/<id>.json)
// num único ficheiro docs/data/db.json, lido pelo site público (modo só leitura).
// Uso: node scripts/build-db.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data-v2');
const COLS = ['champs', 'events', 'races', 'boats', 'classes', 'clubs', 'skippers'];
const out = { exportedAt: new Date().toISOString() };

for (const col of COLS) {
  out[col] = {};
  const dir = join(src, col);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    out[col][f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
}

// só muda exportedAt (e o ficheiro) se os dados mudaram — evita publicações vazias
const file = join(root, 'docs', 'data', 'db.json');
let changed = true;
if (existsSync(file)) {
  const prev = JSON.parse(readFileSync(file, 'utf8'));
  const strip = o => JSON.stringify(Object.fromEntries(COLS.map(c => [c, o[c] || {}])));
  if (strip(prev) === strip(out)) { changed = false; out.exportedAt = prev.exportedAt; }
}
if (changed) writeFileSync(file, JSON.stringify(out));
console.log(changed ? 'db.json ATUALIZADO' : 'db.json sem alterações');
console.log(COLS.map(c => `${c}: ${Object.keys(out[c]).length}`).join(' · '));
