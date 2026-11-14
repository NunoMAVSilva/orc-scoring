// Junta a exportação da base de dados da app no Claude (data-export/<coleção>/<id>.json)
// num único ficheiro docs/data/db.json, lido pelo site público (modo só leitura).
// Uso: node scripts/build-db.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data-export');
const COLS = ['boats', 'classes', 'champs', 'races'];
const out = { exportedAt: new Date().toISOString() };

for (const col of COLS) {
  out[col] = {};
  const dir = join(src, col);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    out[col][f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
}

writeFileSync(join(root, 'docs', 'data', 'db.json'), JSON.stringify(out));
console.log(COLS.map(c => `${c}: ${Object.keys(out[c]).length}`).join(' · '));
