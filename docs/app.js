/* ORC Scoring — app */
'use strict';
const E = window.ORC;
const S = { boats: {}, classes: {}, champs: {}, races: {}, loaded: {}, canEdit: false, champId: null, group: 'GERAL', raceGroup: 'GERAL', edit: null, catalog: null };
let DB = null, ASSETS = null, SAMPLE = null, DOWN = null;
// STATIC: site público (GitHub Pages) sem o runtime do Claude — dados de data/db.json, só leitura.
const STATIC = !(window.claude && typeof window.claude.use === 'function');
const COLS = ['boats', 'classes', 'champs', 'races'];
const CODES = ['FIN', 'DNF', 'DNS', 'RET', 'OCS', 'BFD', 'UFD', 'DSQ', 'DNE'];
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt4 = v => v == null || v === '' ? '—' : Number(v).toFixed(4).replace('.', ',');
const fmt1 = v => v == null || v === '' ? '—' : Number(v).toFixed(1).replace('.', ',');
const ptsF = p => (p % 1 ? p.toFixed(1) : String(p)).replace('.', ',');
const today = () => new Date().toISOString().slice(0, 10);
const dPT = d => d ? d.split('-').reverse().join('/') : '';
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('x' + Date.now());
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function dbState() { return { boats: S.boats, classes: S.classes }; }
function champ() { return S.champs[S.champId]; }
function champRaces(cid) {
  const c = S.champs[cid || S.champId]; if (!c) return [];
  const ids = (c.order || []).filter(id => S.races[id]);
  Object.keys(S.races).forEach(id => { if (S.races[id].champ === (cid || S.champId) && !ids.includes(id)) ids.push(id); });
  return ids.map(id => Object.assign({ id }, S.races[id])).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
function divOf(b) { return E.divisionOf(b, '', dbState(), champ()); }
function groupsOf(c) {
  const g = [{ k: 'GERAL', t: 'Geral' }];
  ((c && c.groups) || ['A', 'B', 'C', 'SB']).forEach(d => g.push({ k: 'DIV:' + d, t: 'Div. ' + d }));
  ((c && c.classGroups) || []).forEach(cl => S.classes[cl] && g.push({ k: 'CLS:' + cl, t: S.classes[cl].name }));
  return g;
}
function groupFilter(k) {
  if (k === 'GERAL') return null;
  if (k.startsWith('DIV:')) { const d = k.slice(4); return b => divOf(b) === d; }
  if (k.startsWith('CLS:')) { const c = k.slice(4); return b => b.classRef === c; }
  return null;
}
function boatSub(b) { return [b.sail, b.type].filter(Boolean).join(' · '); }
function divChip(b) { const d = divOf(b); return `<span class="chip div-${esc(d)}">${esc(d)}</span>`; }

/* ---------- arranque / dados ---------- */
async function init() {
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  $('#dlgX').onclick = () => $('#dlg').close();
  $('#champSel').onchange = e => { if (e.target.value === '__new') { e.target.value = S.champId || ''; return openChampForm(null); } S.champId = e.target.value; try { localStorage.setItem('champ', S.champId); } catch (_) {} render(); };
  document.addEventListener('click', onClick);
  render();
  const timer = setTimeout(() => { if (!S.ready) $('#view').innerHTML = '<div class="warn">Não foi possível ligar à base de dados ainda. Verifique a ligação; os dados aparecem assim que houver resposta.</div>'; }, 10000);
  if (STATIC) return loadStatic(timer);
  try { DB = await window.claude.use('db'); } catch (_) { DB = null; }
  if (!DB) { clearTimeout(timer); $('#view').innerHTML = '<div class="warn">Esta vista não tem acesso à base de dados. Abra a app em claude.ai com sessão iniciada.</div>'; return; }
  const user = await window.claude.use('user').catch(() => null);
  S.canEdit = user ? !!(await Promise.resolve(user.canEdit()).catch(() => false)) : false;
  COLS.forEach(col => DB.collection(col).onSnapshot(snap => {
    const o = {}; snap.docs.forEach(d => { o[d.id] = d.data(); });
    S[col] = o; S.loaded[col] = true;
    if (COLS.every(c => S.loaded[c])) { S.ready = true; clearTimeout(timer); }
    if (S.ready) { pickChamp(); if (!S.edit) render(); }
  }, err => { clearTimeout(timer); $('#view').innerHTML = `<div class="warn">Erro ao ler dados (${esc(err.code)}).</div>`; }));
  window.claude.use('assets').then(a => { ASSETS = a; }).catch(() => {});
  window.claude.use('sample').then(s => { SAMPLE = s; }).catch(() => {});
  window.claude.use('downloads').then(d => { DOWN = d; }).catch(() => {});
}
async function loadStatic(timer) {
  try {
    const data = await fetch('data/db.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    COLS.forEach(col => { S[col] = data[col] || {}; S.loaded[col] = true; });
    S.exportedAt = data.exportedAt || null;
    S.ready = true; clearTimeout(timer);
    pickChamp(); render();
  } catch (e) {
    clearTimeout(timer);
    $('#view').innerHTML = `<div class="warn">Não foi possível carregar os resultados (${esc(e.message)}).</div>`;
  }
}
function downloadFile(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type: type || 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pickChamp() {
  const ids = Object.keys(S.champs).sort((a, b) => (S.champs[b].season || '').localeCompare(S.champs[a].season || ''));
  let saved = null; try { saved = localStorage.getItem('champ'); } catch (_) {}
  if (!S.champId || !S.champs[S.champId]) S.champId = (saved && S.champs[saved]) ? saved : ids[0] || null;
  $('#champSel').innerHTML = ids.map(id => `<option value="${esc(id)}" ${id === S.champId ? 'selected' : ''}>${esc(S.champs[id].name)}</option>`).join('') + (S.canEdit ? '<option value="__new">+ Novo campeonato</option>' : '');
  if (S.champId) $('#clubName').textContent = S.champs[S.champId].club || '';
}
async function save(col, id, data) {
  if (!S.canEdit) { toast('Só os editores podem alterar dados.'); return false; }
  try { await DB.doc(col + '/' + id).set(JSON.parse(JSON.stringify(data))); return true; }
  catch (e) { toast('Não gravou: ' + (e.code || e.message)); return false; }
}
async function del(col, id) { try { await DB.doc(col + '/' + id).delete(); return true; } catch (e) { toast('Não apagou: ' + (e.code || e.message)); return false; } }

/* ---------- router ---------- */
function route() { const h = (location.hash || '#classificacao').slice(1); return h; }
function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', r.startsWith(a.dataset.r) || (a.dataset.r === 'regatas' && r.startsWith('race-')) || (a.dataset.r === 'frota' && r.startsWith('boat-'))));
  if (!S.ready) return;
  const v = $('#view');
  if (r.startsWith('race-')) v.innerHTML = viewRace(r.slice(5));
  else if (r.startsWith('boat-')) v.innerHTML = viewBoat(r.slice(5));
  else if (r === 'regatas') v.innerHTML = viewRaces();
  else if (r === 'frota') v.innerHTML = viewFleet();
  else v.innerHTML = viewStandings();
}

/* ---------- classificações ---------- */
function viewStandings() {
  const c = champ();
  if (!c) return `<div class="empty">Ainda não há campeonatos.${S.canEdit ? '<br><br><button class="btn pri" data-a="newChamp">Criar campeonato</button>' : ''}</div>`;
  const races = champRaces();
  const tabs = groupsOf(c).concat([{ k: 'PROVAS', t: 'Provas' }]);
  if (!tabs.find(t => t.k === S.group)) S.group = 'GERAL';
  let body = '';
  if (S.group === 'PROVAS') body = eventsBlock(races);
  else {
    const st = E.seriesStandings(races, dbState(), { champ: c, filter: groupFilter(S.group) });
    body = standingsTable(st, races) + `<p class="small muted">DNC = ${st.dnc} pontos (barcos do grupo no campeonato + 1) · ${st.nDiscards} descarte(s) com ${races.length} regatas · desempates RRS A8. Pontos riscados = descartes.${STATIC && S.exportedAt ? ' · Dados atualizados em ' + dPT(S.exportedAt.slice(0, 10)) + '.' : ''}</p>`;
  }
  const fin = races.filter(r => r.status === 'final').length;
  return `<section class="row spread"><div><h1>${esc(c.name)}</h1><div class="small muted">${races.length} regatas · ${fin} finais · ${esc(c.season || '')}</div></div>
    <div class="row">${S.canEdit ? `<button class="btn sm" data-a="editChamp">Definições</button>` : ''}<button class="btn sm" data-a="export">Exportar</button></div></section>
    <div class="tabs">${tabs.map(t => `<button data-a="grp" data-k="${esc(t.k)}" class="${S.group === t.k ? 'on' : ''}">${esc(t.t)}</button>`).join('')}</div>
    ${body}`;
}
function standingsTable(st, races) {
  if (!st.table.length) return '<div class="empty">Sem resultados ainda.</div>';
  const head = races.map((r, i) => `<th class="n" title="${esc(r.name)}"><a href="#race-${esc(r.id)}">R${i + 1}</a></th>`).join('');
  const rows = st.table.map(r => {
    const b = S.boats[r.boatId] || {};
    const cells = r.cells.map(c => `<td class="n ${c.disc ? 'disc' : ''} ${c.code && !c.disc ? 'code' : ''}"><span>${c.code ? esc(c.code) + ' ' : ''}${ptsF(c.pts)}</span></td>`).join('');
    return `<tr class="podium-${r.rank}"><td class="pos sticky">${r.rank}</td><td class="boat"><a href="#boat-${esc(r.boatId)}" style="color:inherit;text-decoration:none">${esc(r.name)}</a> ${divChip(b)}<span class="sub">${esc(boatSub(b))}</span></td><td class="n net">${ptsF(r.net)}</td><td class="n muted">${ptsF(r.total)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr><th class="sticky">#</th><th>Barco</th><th class="n">Líq.</th><th class="n">Total</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function eventsBlock(races) {
  const evs = {}; races.forEach(r => { (evs[r.event || r.name] = evs[r.event || r.name] || []).push(r); });
  const multi = Object.entries(evs).filter(([, rs]) => rs.length > 1);
  if (!multi.length) return '<div class="empty">Nenhuma prova com mais de uma regata.</div>';
  return multi.map(([name, rs]) => {
    const st = E.seriesStandings(rs, dbState(), { discards: 0, filter: groupFilter('GERAL') });
    return `<div class="card"><h2>${esc(name)}</h2><div class="small muted">${rs.length} regatas · ${dPT(rs[0].date)} · soma sem descartes</div>${standingsTable(st, rs)}</div>`;
  }).join('');
}

/* ---------- lista de regatas ---------- */
function viewRaces() {
  const c = champ();
  if (!c) return '<div class="empty">Crie primeiro um campeonato.</div>';
  const races = champRaces();
  const items = races.map((r, i) => {
    const n = (r.finishes || []).length, nf = (r.finishes || []).filter(f => !f.code || f.code === 'FIN').length;
    return `<a class="item" href="#race-${esc(r.id)}"><div class="idx">R${i + 1}</div><div class="grow"><div class="title">${esc(r.name)}</div>
      <div class="meta">${dPT(r.date)} · largada ${esc((r.start || '').slice(0, 5))} · ${esc(E.SYSTEMS[r.system] || r.system)}${r.event && r.event !== r.name ? ' · ' + esc(r.event) : ''}</div>
      <div class="meta">${nf} chegados de ${n} na prova</div></div><span class="chip st-${r.status === 'final' ? 'final' : 'provisoria'}">${r.status === 'final' ? 'Final' : 'Provisória'}</span></a>`;
  }).join('');
  return `<section class="row spread"><h1>Regatas</h1>${S.canEdit ? '<button class="btn pri" data-a="newRace">+ Nova regata</button>' : ''}</section>
    <div class="list">${items || '<div class="empty">Sem regatas neste campeonato.</div>'}</div>`;
}

/* ---------- regata ---------- */
function viewRace(id) {
  const r0 = S.races[id];
  if (!r0) return '<div class="empty">Regata não encontrada.</div>';
  const race = Object.assign({ id }, r0);
  const idx = champRaces(race.champ).findIndex(x => x.id === id) + 1;
  const { problems } = E.scoreRace(race, dbState());
  const c = S.champs[race.champ];
  const tabs = groupsOf(c);
  if (!tabs.find(t => t.k === S.raceGroup)) S.raceGroup = 'GERAL';
  const { rows } = E.raceResults(race, dbState(), groupFilter(S.raceGroup));
  const isToD = race.system.startsWith('ToD');
  const tr = rows.map(x => {
    const b = S.boats[x.boatId] || {};
    if (x.code) return `<tr><td class="pos">—</td><td class="boat">${esc(x.name)} ${divChip(b)}<span class="sub">${esc(x.note || boatSub(b))}</span></td><td class="code" colspan="5">${esc(x.code)}${x.finish ? ' · ' + esc(x.finish) : ''}</td><td class="n">${ptsF(x.pts)}</td></tr>`;
    return `<tr class="podium-${x.pos}"><td class="pos">${x.pos}</td><td class="boat">${esc(x.name)} ${divChip(b)}<span class="sub">${esc(boatSub(b))}</span></td>
      <td class="n">${esc(x.finish)}</td><td class="n">${E.hms2(x.elapsed)}</td><td class="n" title="${esc(x.certSrc)}">${isToD ? fmt1(x.rating) : fmt4(x.rating)}</td><td class="n">${E.hms2(x.corrected)}</td><td class="n">${x.delta ? '+' + E.hms(x.delta) : '—'}</td><td class="n">${ptsF(x.pts)}</td></tr>`;
  }).join('');
  const photos = STATIC ? '' : (race.photos || []).map(p => `<a href="/_blob/${esc(p)}" target="_blank" rel="noopener"><img src="/_blob/${esc(p)}" alt="Folha de chegadas"></a>`).join('');
  return `<section class="row spread"><div><div class="small muted"><a href="#regatas">Regatas</a> · R${idx}${race.event && race.event !== race.name ? ' · ' + esc(race.event) : ''}</div><h1>${esc(race.name)}</h1></div>
      <span class="chip st-${race.status === 'final' ? 'final' : 'provisoria'}">${race.status === 'final' ? 'Final' : 'Provisória'}</span></section>
    <div class="kpis"><div class="kpi"><b>${dPT(race.date).slice(0, 5)}</b><span>${esc(race.date.slice(0, 4))}</span></div><div class="kpi"><b>${esc((race.start || '').slice(0, 5))}</b><span>largada</span></div>
      <div class="kpi"><b>${esc(race.system.replace('_', ' '))}</b><span>${race.system.endsWith('WL') ? 'barl./sotav.' : 'costeiro'}</span></div>${race.distance ? `<div class="kpi"><b>${esc(race.distance)} NM</b><span>distância</span></div>` : ''}${race.timeLimit ? `<div class="kpi"><b>${esc(race.timeLimit.slice(0, 5))}</b><span>hora limite</span></div>` : ''}</div>
    ${problems.map(p => `<div class="warn">${esc(p)}</div>`).join('')}
    <div class="tabs">${tabs.map(t => `<button data-a="rgrp" data-k="${esc(t.k)}" class="${S.raceGroup === t.k ? 'on' : ''}">${esc(t.t)}</button>`).join('')}</div>
    <div class="scroll"><table><thead><tr><th>#</th><th>Barco</th><th class="n">Chegada</th><th class="n">Decorrido</th><th class="n">${isToD ? 'ToD' : 'ToT'}</th><th class="n">Corrigido</th><th class="n">Delta</th><th class="n">Pts</th></tr></thead><tbody>${tr || '<tr><td colspan="8" class="empty">Sem chegadas.</td></tr>'}</tbody></table></div>
    <p class="small muted">Siglas (DNF, DNS, RET…) = barcos na prova + 1. Barcos do campeonato ausentes da prova ficam DNC na classificação geral. Rating = certificado em vigor a ${dPT(race.date)}; toque no valor para ver a origem.</p>
    <div class="row">${S.canEdit ? `<button class="btn pri" data-a="editFin" data-id="${esc(id)}">Editar chegadas</button><button class="btn" data-a="editRace" data-id="${esc(id)}">Dados da regata</button>` : ''}<button class="btn" data-a="copyRace" data-id="${esc(id)}">Copiar resultados</button></div>
    ${S.canEdit || photos ? `<div class="card photo"><div class="row spread"><h3>Folha de chegadas</h3>${S.canEdit ? `<label class="btn sm" for="photoIn">Adicionar foto</label><input id="photoIn" type="file" accept="image/*" data-id="${esc(id)}" hidden>` : ''}</div>${photos || '<div class="small muted">Sem fotografia. Adicione a foto da folha para a ler com o Claude e para ficar como registo.</div>'}
      ${S.canEdit && (race.photos || []).length ? `<button class="btn" data-a="readSheet" data-id="${esc(id)}">Ler folha com o Claude</button>` : ''}</div>` : ''}`;
}

/* ---------- editor de chegadas ---------- */
function openFinishEditor(id, proposal) {
  const race = S.races[id];
  S.edit = { id, rows: (proposal || race.finishes || []).map(f => Object.assign({}, f)) };
  drawFinishEditor();
}
function drawFinishEditor() {
  const ed = S.edit, race = S.races[ed.id];
  const boatsSorted = Object.entries(S.boats).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const opts = sel => '<option value="">— barco —</option>' + boatsSorted.map(([bid, b]) => `<option value="${esc(bid)}" ${bid === sel ? 'selected' : ''}>${esc(b.name)}${b.sail ? ' (' + esc(b.sail) + ')' : ''}</option>`).join('');
  const rows = ed.rows.map((f, i) => `<div class="fin-row"><select data-fi="${i}" data-k="boatId" aria-label="Barco ${i + 1}">${opts(f.boatId)}</select>
     <input data-fi="${i}" data-k="finish" value="${esc(f.finish || '')}" placeholder="hh:mm:ss" inputmode="numeric" aria-label="Hora de chegada ${i + 1}">
     <select data-fi="${i}" data-k="code" aria-label="Sigla ${i + 1}">${CODES.map(c => `<option ${(f.code || 'FIN') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
     <button class="x" data-a="finDel" data-i="${i}" aria-label="Remover linha">×</button>${f.read ? `<div class="small muted" style="grid-column:1/-1">lido: “${esc(f.read)}”</div>` : ''}</div>`).join('');
  const inRace = new Set(ed.rows.map(r => r.boatId));
  const quick = boatsSorted.filter(([bid]) => !inRace.has(bid)).map(([bid, b]) => `<button class="btn sm" data-a="finAdd" data-b="${esc(bid)}">${esc(b.name)}</button>`).join('');
  dialog(`Chegadas · ${race.name}`, `<div class="small muted">Largada ${esc(race.start)} · Ordem de chegada. FIN = chegou (precisa de hora). Siglas DNF/DNS/RET… para barcos que estiveram na prova. Quem não está aqui fica DNC.</div>
    <div class="list">${rows || '<div class="muted small">Sem linhas.</div>'}</div>
    <div class="row"><button class="btn sm" data-a="finAdd">+ Linha</button></div>
    <details><summary class="small">Adicionar barco da frota</summary><div class="row" style="margin-top:8px">${quick}</div></details>
    <div class="row spread"><button class="btn" data-a="finCancel">Cancelar</button><button class="btn pri" data-a="finSave">Gravar chegadas</button></div>`);
  $('#dlgB').oninput = $('#dlgB').onchange = e => {
    const el = e.target; if (el.dataset.fi == null) return;
    const f = S.edit.rows[+el.dataset.fi]; f[el.dataset.k] = el.value;
    if (el.dataset.k === 'finish') f.finish = el.value.replace(/[.,h ]/g, ':');
  };
}

/* ---------- frota ---------- */
function viewFleet() {
  const q = S.fleetQ || '';
  const list = Object.entries(S.boats).filter(([, b]) => !q || norm(b.name + b.sail + b.type + (b.aka || []).join('')).includes(norm(q))).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const d = today();
  const items = list.map(([id, b]) => {
    const cl = E.ratingAt(b, d, 'ToT_CL', dbState()), wl = E.ratingAt(b, d, 'ToT_WL', dbState());
    const k = cl ? cl.cert.kind || 'orc' : null;
    return `<a class="item" href="#boat-${esc(id)}"><div class="grow"><div class="title">${esc(b.name)} ${divChip(b)}</div><div class="meta">${esc(boatSub(b))}${b.club ? ' · ' + esc(b.club) : ''}</div>
      <div class="meta num">ToT costeiro ${fmt4(cl && cl.value)} · barl./sotav. ${fmt4(wl && wl.value)}</div></div>${k ? `<span class="chip k-${esc(k)}">${esc(k)}</span>` : '<span class="chip">sem rating</span>'}</a>`;
  }).join('');
  return `<section class="row spread"><h1>Frota</h1>${S.canEdit ? '<button class="btn pri" data-a="newBoat">+ Novo barco</button>' : ''}</section>
    <input id="fleetQ" value="${esc(q)}" placeholder="Procurar barco, número de vela ou tipo" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">
    <div class="small muted">${list.length} barcos · ratings em vigor hoje (${dPT(d)})</div>
    <div class="list">${items}</div>`;
}
function viewBoat(id) {
  const b = S.boats[id]; if (!b) return '<div class="empty">Barco não encontrado.</div>';
  const certs = (b.classRef && S.classes[b.classRef] ? S.classes[b.classRef].certs : b.certs || []).map((c, i) => ({ c, i })).sort((x, y) => (y.c.from || '').localeCompare(x.c.from || ''));
  const races = Object.entries(S.races).filter(([, r]) => (r.finishes || []).some(f => f.boatId === id)).sort((x, y) => y[1].date.localeCompare(x[1].date));
  const crow = ({ c, i }) => `<tr><td>${dPT(c.from)}</td><td><span class="chip k-${esc(c.kind || 'orc')}">${esc(c.kind || 'orc')}</span></td><td class="n">${fmt4(c.ToT_CL)}</td><td class="n">${fmt4(c.ToT_WL)}</td><td class="n">${fmt1(E.certValue(c, 'ToD_CL'))}</td><td class="n">${c.CDL ? Number(c.CDL).toFixed(3) : '—'}</td><td class="small" style="white-space:normal;min-width:160px">${esc(c.src || '')}</td>${S.canEdit && !b.classRef ? `<td><button class="x btn sm dang" data-a="certDel" data-b="${esc(id)}" data-i="${i}" aria-label="Apagar certificado">×</button></td>` : ''}</tr>`;
  return `<section><div class="small muted"><a href="#frota">Frota</a></div><div class="row spread"><h1>${esc(b.name)} ${divChip(b)}</h1>${S.canEdit ? `<button class="btn sm" data-a="editBoat" data-id="${esc(id)}">Editar</button>` : ''}</div>
    <div class="muted">${esc([b.sail, b.type, b.club, b.skipper].filter(Boolean).join(' · '))}</div>${(b.aka || []).length ? `<div class="small muted">Também conhecido por: ${esc(b.aka.join(', '))}</div>` : ''}${b.note ? `<div class="info">${esc(b.note)}</div>` : ''}</section>
    <div class="card"><div class="row spread"><h3>Certificados${b.classRef ? ' da classe ' + esc((S.classes[b.classRef] || {}).name) : ''}</h3>${S.canEdit && !b.classRef ? `<button class="btn sm pri" data-a="addCert" data-id="${esc(id)}">+ Certificado</button>` : ''}</div>
      <div class="small muted">Em cada regata usa-se o certificado em vigor nessa data. ToD costeiro = 600 ÷ ToT quando não indicado.</div>
      <div class="scroll"><table><thead><tr><th>Desde</th><th>Tipo</th><th class="n">ToT cost.</th><th class="n">ToT b/s</th><th class="n">ToD cost.</th><th class="n">CDL</th><th>Origem</th>${S.canEdit && !b.classRef ? '<th></th>' : ''}</tr></thead><tbody>${certs.map(crow).join('') || '<tr><td colspan="8" class="muted">Sem certificados.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Regatas</h3>${races.map(([rid, r]) => { const res = E.raceResults(Object.assign({ id: rid }, r), dbState()).rows.find(x => x.boatId === id) || {}; return `<a class="item" href="#race-${esc(rid)}"><div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${dPT(r.date)} · ${esc((S.champs[r.champ] || {}).name || '')}</div></div><b class="num">${res.code ? esc(res.code) : res.pos ? res.pos + 'º' : ''}</b></a>`; }).join('') || '<div class="muted small">Ainda sem regatas.</div>'}</div>`;
}

/* ---------- formulários ---------- */
function dialog(title, html) { $('#dlgT').textContent = title; $('#dlgB').innerHTML = html; $('#dlgB').oninput = $('#dlgB').onchange = null; if (!$('#dlg').open) $('#dlg').showModal(); }
function closeDlg() { $('#dlg').close(); S.edit = null; render(); }
function field(id, label, val, attrs) { return `<label class="f" for="${id}">${label}<input id="${id}" value="${esc(val == null ? '' : val)}" ${attrs || ''}></label>`; }
function sel(id, label, val, opts) { return `<label class="f" for="${id}">${label}<select id="${id}">${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`; }
const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

function openRaceForm(id) {
  const r = id ? S.races[id] : { champ: S.champId, date: today(), start: '', system: 'ToT_CL', status: 'provisoria', finishes: [] };
  const evs = [...new Set(champRaces(r.champ).map(x => x.event).filter(Boolean))];
  dialog(id ? 'Dados da regata' : 'Nova regata', `<div class="grid-f">
    ${field('rName', 'Nome da regata', r.name)}${field('rEvent', 'Prova (agrupa regatas do mesmo dia)', r.event, 'list="evList"')}<datalist id="evList">${evs.map(e => `<option value="${esc(e)}">`).join('')}</datalist>
    ${field('rDate', 'Data', r.date, 'type="date"')}${field('rStart', 'Hora da largada', r.start, 'placeholder="hh:mm:ss"')}
    ${sel('rSys', 'Sistema de pontuação', r.system, Object.entries(E.SYSTEMS))}${field('rDist', 'Distância (NM, para ToD)', r.distance || '', 'inputmode="decimal"')}
    ${field('rLim', 'Hora limite de chegada', r.timeLimit || '', 'placeholder="hh:mm:ss"')}${sel('rStatus', 'Estado', r.status || 'provisoria', [['provisoria', 'Provisória'], ['final', 'Final']])}</div>
    <div class="row spread">${id ? `<button class="btn dang" data-a="raceDel" data-id="${esc(id)}">Apagar regata</button>` : '<span></span>'}<button class="btn pri" data-a="raceSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openBoatForm(id) {
  const b = id ? S.boats[id] : { name: '', certs: [] };
  dialog(id ? 'Editar barco' : 'Novo barco', `<div class="grid-f">${field('bName', 'Nome', b.name)}${field('bSail', 'Número de vela', b.sail)}${field('bType', 'Tipo / modelo', b.type)}
    ${field('bClub', 'Clube', b.club)}${field('bSkip', 'Timoneiro / skipper', b.skipper)}${field('bAka', 'Outros nomes (separados por vírgula)', (b.aka || []).join(', '))}
    ${sel('bDiv', 'Divisão', b.div || '', [['', 'Automática (CDL)'], 'A', 'B', 'C', 'SB'])}${sel('bCls', 'Monotipia (rating da classe)', b.classRef || '', [['', '— não —']].concat(Object.entries(S.classes).map(([k, c]) => [k, c.name])))}
    <label class="f" for="bNote" style="flex-basis:100%">Notas<textarea id="bNote" rows="2">${esc(b.note || '')}</textarea></label></div>
    <div class="row spread">${id ? `<button class="btn dang" data-a="boatDel" data-id="${esc(id)}">Apagar barco</button>` : '<span></span>'}<button class="btn pri" data-a="boatSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openChampForm(id) {
  const c = id ? S.champs[id] : { name: '', club: 'Ginásio Clube Naval de Faro', season: '', discards: [{ upTo: 3, n: 0 }, { upTo: 8, n: 1 }, { upTo: 999, n: 2 }], divLimits: { A: 9.9, B: 8.8 }, groups: ['A', 'B', 'C', 'SB'], classGroups: [] };
  dialog(id ? 'Definições do campeonato' : 'Novo campeonato', `<div class="grid-f">${field('cName', 'Nome', c.name)}${field('cSeason', 'Época', c.season)}${field('cClub', 'Clube organizador', c.club)}
    ${field('cDisc', 'Descartes (até N regatas: descartes)', (c.discards || []).map(d => d.upTo + ':' + d.n).join(', '), 'placeholder="3:0, 8:1, 999:2"')}
    ${field('cA', 'Divisão A: CDL ≥', c.divLimits.A, 'inputmode="decimal"')}${field('cB', 'Divisão B: CDL ≥', c.divLimits.B, 'inputmode="decimal"')}
    ${field('cGroups', 'Divisões a classificar', (c.groups || []).join(', '))}</div>
    <div class="small muted">Classificações por classe (monotipias):</div><div class="row">${Object.entries(S.classes).map(([k, cl]) => `<label class="row small"><input type="checkbox" class="cCls" value="${esc(k)}" ${(c.classGroups || []).includes(k) ? 'checked' : ''}> ${esc(cl.name)}</label>`).join('') || '<span class="small muted">Sem classes definidas.</span>'}</div>
    <div class="row spread"><span></span><button class="btn pri" data-a="champSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}

/* ---------- certificados ---------- */
function openCertForm(boatId, tab) {
  tab = tab || 'orc';
  const tabs = [['orc', 'Pesquisar ORC'], ['manual', 'Manual'], ['deriv', 'Derivado']];
  let body = '';
  if (tab === 'orc') body = `<div class="info small">Certificados ORC ativos de todos os países (base de dados ORC, atualizada a ${esc(S.catalog ? S.catalog.built : '…')}). Para anos anteriores use o Sailor Services e introduza à mão.</div>
     <input id="catQ" placeholder="Nome, número de vela ou modelo (ex.: Hanse 400)" style="padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">
     ${field('cFrom', 'Válido a partir de', today(), 'type="date"')}<div id="catRes" class="list"></div>`;
  else if (tab === 'manual') body = `<div class="grid-f">${field('mFrom', 'Válido a partir de', today(), 'type="date"')}${sel('mKind', 'Tipo', 'manual', [['orc', 'Certificado ORC próprio'], ['teste', 'Certificado de teste'], ['copiado', 'Copiado de barco semelhante'], ['manual', 'Atribuído manualmente']])}
     ${field('mCL', 'ToT costeiro', '', 'inputmode="decimal"')}${field('mWL', 'ToT barl./sotav.', '', 'inputmode="decimal"')}${field('mTodCL', 'ToD costeiro (s/NM)', '', 'inputmode="decimal"')}${field('mTodWL', 'ToD barl./sotav. (s/NM)', '', 'inputmode="decimal"')}
     ${field('mCDL', 'CDL', '', 'inputmode="decimal"')}${field('mSrc', 'Origem (barco, país, ano)', '')}</div>
     <div class="small muted">Se só tiver o ToD, a app calcula o ToT = 600 ÷ ToD. Em certificados até 2019 o ToT barl./sotav. impresso usa 675 ÷ ToD: introduza o ToD para converter para a escala atual.</div>
     <button class="btn pri" data-a="certManual" data-b="${esc(boatId)}">Adicionar certificado</button>`;
  else {
    const refs = Object.entries(S.boats).filter(([k]) => k !== boatId).sort((a, b) => a[1].name.localeCompare(b[1].name));
    body = `<div class="small muted">Aplica um fator a todos os valores do certificado de um barco de referência (fator = ToT costeiro pretendido ÷ ToT costeiro da referência). Ex.: Titã a partir do Cidade de Faro.</div>
     <div class="grid-f">${sel('dRef', 'Barco de referência', '', refs.map(([k, b]) => [k, b.name]))}${field('dTarget', 'ToT costeiro pretendido', '', 'inputmode="decimal"')}${field('dFrom', 'Válido a partir de', today(), 'type="date"')}</div>
     <button class="btn pri" data-a="certDeriv" data-b="${esc(boatId)}">Calcular e adicionar</button>`;
  }
  dialog('Novo certificado · ' + S.boats[boatId].name, `<div class="tabs">${tabs.map(([k, t]) => `<button data-a="certTab" data-b="${esc(boatId)}" data-k="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`);
  if (tab === 'orc') {
    loadCatalog().then(() => { const q = $('#catQ'); if (!q) return; q.value = S.boats[boatId].name; q.oninput = () => catSearch(boatId); catSearch(boatId); q.focus(); });
  }
}
async function loadCatalog() {
  if (S.catalog) return S.catalog;
  try { S.catalog = await fetch('data/orc_catalog.json').then(r => r.json()); } catch (_) { toast('Não foi possível carregar a base ORC.'); S.catalog = { rows: [], fields: [] }; }
  return S.catalog;
}
function catSearch(boatId) {
  const q = norm($('#catQ').value); const out = $('#catRes'); if (!out) return;
  if (q.length < 3) { out.innerHTML = '<div class="small muted">Escreva pelo menos 3 caracteres.</div>'; return; }
  const hits = S.catalog.rows.filter(r => norm(r[0]).includes(q) || norm(r[1]).includes(q) || norm(r[2]).includes(q)).slice(0, 60);
  out.innerHTML = hits.map((r, i) => `<div class="item"><div class="grow"><div class="title">${esc(r[0])} <span class="chip">${esc(r[3])}</span> <span class="chip">${r[4] === 'I' ? 'ORCi' : 'Club'}</span>${r[9] ? ' <span class="chip div-SB">SB</span>' : ''}</div>
    <div class="meta">${esc(r[1])} · ${esc(r[2])} · emitido ${dPT(r[5])}</div><div class="meta num">ToT cost. ${fmt4(r[7])} · b/s ${fmt4(r[8])} · CDL ${r[6]}</div></div>
    <div class="row" style="flex-direction:column;align-items:stretch"><button class="btn sm pri" data-a="catUse" data-b="${esc(boatId)}" data-ref="${esc(r[10])}" data-k="orc">Próprio</button><button class="btn sm" data-a="catUse" data-b="${esc(boatId)}" data-ref="${esc(r[10])}" data-k="copiado">Copiar</button></div></div>`).join('') || '<div class="small muted">Nenhum certificado ativo encontrado.</div>';
}
async function addCert(boatId, cert) {
  const b = JSON.parse(JSON.stringify(S.boats[boatId]));
  b.certs = (b.certs || []).concat([cert]);
  if (await save('boats', boatId, b)) { toast('Certificado adicionado.'); closeDlg(); }
}

/* ---------- leitura da folha com o Claude ---------- */
async function readSheet(raceId) {
  const race = S.races[raceId];
  if (!SAMPLE) { toast('A leitura com o Claude não está disponível nesta vista.'); return; }
  const pid = (race.photos || []).slice(-1)[0];
  dialog('Ler folha com o Claude', '<div class="info">A ler a fotografia… pode demorar alguns segundos.</div>');
  try {
    const blob = await fetch('/_blob/' + pid).then(r => r.blob());
    const fleet = Object.entries(S.boats).map(([id, b]) => `${id} | ${b.name} | ${(b.aka || []).join('/')} | ${b.sail || ''} | ${b.type || ''}`).join('\n');
    const prompt = `És secretário de regata. Lê a folha de chegadas manuscrita da fotografia (regata "${race.name}", largada ${race.start}).
Devolve APENAS JSON com esta forma: {"start":"hh:mm:ss ou null","finishes":[{"read":"nome como está escrito","boatId":"id da lista ou null","finish":"hh:mm:ss ou null","code":"FIN|DNF|DNS|RET|OCS|BFD|UFD|DSQ"}],"notes":"observações curtas em português"}
Regras: ordem = ordem de chegada. Os nomes podem estar escritos meia linha acima ou abaixo da hora: emparelha pela ordem. Usa a hora de chegada, não o tempo de regata. Barcos na zona de "desclassificados"/siglas recebem a sigla (code) e finish null. Ignora listas de verificação ao lado. Se a hora tiver só minutos e segundos, completa com a hora da linha anterior.
Lista de barcos (id | nome | outros nomes | vela | tipo):
${fleet}`;
    const res = await SAMPLE.json(prompt, { images: [blob], modelTier: 'complex' });
    const list = (res && res.finishes) || [];
    const prop = list.map(f => ({ boatId: S.boats[f.boatId] ? f.boatId : '', finish: f.finish || '', code: f.code || 'FIN', read: f.read || '' }));
    openFinishEditor(raceId, prop);
    if (res && res.notes) $('#dlgB').insertAdjacentHTML('afterbegin', `<div class="info small">Notas da leitura: ${esc(res.notes)}${res.start ? ' · largada lida: ' + esc(res.start) : ''}. Confirme cada linha antes de gravar.</div>`);
  } catch (e) {
    dialog('Ler folha com o Claude', `<div class="warn">Não foi possível ler a folha (${esc(e.code || e.message || e)}). Introduza as chegadas à mão.</div>`);
  }
}
async function shrink(file) {
  try {
    const img = await createImageBitmap(file); const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  } catch (_) { return file; }
}

/* ---------- exportação ---------- */
function standingsText(st, races, title) {
  let t = title + '\n' + '#  Barco'.padEnd(22) + 'Líq  Tot  ' + races.map((r, i) => 'R' + (i + 1)).join(' ') + '\n';
  st.table.forEach(r => { t += String(r.rank).padEnd(3) + r.name.padEnd(19) + ptsF(r.net).padStart(4) + ptsF(r.total).padStart(5) + '  ' + r.cells.map(c => (c.disc ? '(' : '') + (c.code ? c.code + ' ' : '') + ptsF(c.pts) + (c.disc ? ')' : '')).join(' ') + '\n'; });
  return t;
}
function standingsHTML() {
  const c = champ(), races = champRaces();
  const blocks = groupsOf(c).map(g => { const st = E.seriesStandings(races, dbState(), { champ: c, filter: groupFilter(g.k) }); return st.table.length ? `<h2>${esc(g.t)}</h2>${standingsTable(st, races).replace(/<a [^>]*>|<\/a>/g, '')}<p>DNC = ${st.dnc} · ${st.nDiscards} descarte(s)</p>` : ''; }).join('');
  const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
  return `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(c.name)}</title><style>${css} body{padding:16px} .sticky{position:static}</style></head><body><h1>${esc(c.name)}</h1><p>${esc(c.club || '')} · ${races.length} regatas · gerado ${dPT(today())}</p>${blocks}</body></html>`;
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch (_) { dialog('Copiar', `<textarea rows="14" style="width:100%;font-family:monospace;font-size:12px">${esc(text)}</textarea>`); } }

/* ---------- ações ---------- */
async function onClick(e) {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  if (a === 'grp') { S.group = t.dataset.k; render(); }
  else if (a === 'rgrp') { S.raceGroup = t.dataset.k; render(); }
  else if (a === 'newRace') openRaceForm(null);
  else if (a === 'editRace') openRaceForm(id);
  else if (a === 'newBoat') openBoatForm(null);
  else if (a === 'editBoat') openBoatForm(id);
  else if (a === 'newChamp') openChampForm(null);
  else if (a === 'editChamp') openChampForm(S.champId);
  else if (a === 'editFin') openFinishEditor(id);
  else if (a === 'addCert') openCertForm(id, 'orc');
  else if (a === 'certTab') openCertForm(t.dataset.b, t.dataset.k);
  else if (a === 'readSheet') readSheet(id);
  else if (a === 'finAdd') { S.edit.rows.push({ boatId: t.dataset.b || '', finish: '', code: 'FIN' }); drawFinishEditor(); }
  else if (a === 'finDel') { S.edit.rows.splice(+t.dataset.i, 1); drawFinishEditor(); }
  else if (a === 'finCancel') closeDlg();
  else if (a === 'finSave') {
    const rows = S.edit.rows.filter(r => r.boatId).map(r => { const o = { boatId: r.boatId }; if (r.code && r.code !== 'FIN') o.code = r.code; else o.finish = r.finish; if (r.code && r.code !== 'FIN' && r.finish) o.finish = r.finish; return o; });
    const ids = rows.map(r => r.boatId); if (new Set(ids).size !== ids.length) { toast('Há barcos repetidos.'); return; }
    const bad = rows.find(r => !r.code && E.secs(r.finish) == null); if (bad) { toast('Falta a hora de ' + S.boats[bad.boatId].name + '.'); return; }
    const r = JSON.parse(JSON.stringify(S.races[S.edit.id])); r.finishes = rows;
    if (await save('races', S.edit.id, r)) { toast('Chegadas gravadas.'); closeDlg(); }
  }
  else if (a === 'raceSave') {
    if (!v('rName') || !v('rDate') || E.secs(v('rStart')) == null) { toast('Preencha nome, data e hora de largada.'); return; }
    const base = id ? JSON.parse(JSON.stringify(S.races[id])) : { champ: S.champId, finishes: [] };
    Object.assign(base, { name: v('rName'), event: v('rEvent') || v('rName'), date: v('rDate'), start: v('rStart').replace(/[.,h]/g, ':'), system: v('rSys'), distance: v('rDist') ? Number(v('rDist').replace(',', '.')) : null, timeLimit: v('rLim').replace(/[.,h]/g, ':'), status: v('rStatus') });
    const rid = id || (S.champId + '-' + slug(v('rName')) + '-' + v('rDate'));
    if (await save('races', rid, base)) {
      if (!id) { const c = JSON.parse(JSON.stringify(champ())); c.order = (c.order || []).concat([rid]); await save('champs', S.champId, c); }
      closeDlg(); location.hash = 'race-' + rid;
    }
  }
  else if (a === 'raceDel') { if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirmar: apagar de vez'; return; } if (await del('races', id)) { closeDlg(); location.hash = 'regatas'; } }
  else if (a === 'boatSave') {
    if (!v('bName')) { toast('O barco precisa de nome.'); return; }
    const b = id ? JSON.parse(JSON.stringify(S.boats[id])) : { certs: [] };
    Object.assign(b, { name: v('bName').toUpperCase(), sail: v('bSail'), type: v('bType'), club: v('bClub'), skipper: v('bSkip'), aka: v('bAka') ? v('bAka').split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [], div: v('bDiv'), note: $('#bNote').value.trim() });
    if (v('bCls')) b.classRef = v('bCls'); else delete b.classRef;
    const bid = id || slug(v('bName'));
    if (!id && S.boats[bid]) { toast('Já existe um barco com esse nome.'); return; }
    if (await save('boats', bid, b)) { closeDlg(); location.hash = 'boat-' + bid; }
  }
  else if (a === 'boatDel') {
    if (Object.values(S.races).some(r => (r.finishes || []).some(f => f.boatId === id))) { toast('Este barco tem regatas: não pode ser apagado.'); return; }
    if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirmar: apagar de vez'; return; }
    if (await del('boats', id)) { closeDlg(); location.hash = 'frota'; }
  }
  else if (a === 'champSave') {
    const c = id ? JSON.parse(JSON.stringify(S.champs[id])) : { order: [] };
    const disc = v('cDisc').split(',').map(s => s.split(':').map(Number)).filter(p => p.length === 2 && !p.some(isNaN)).map(([u, n]) => ({ upTo: u, n })).sort((x, y) => x.upTo - y.upTo);
    Object.assign(c, { name: v('cName'), season: v('cSeason'), club: v('cClub'), discards: disc, divLimits: { A: Number(v('cA').replace(',', '.')), B: Number(v('cB').replace(',', '.')) }, groups: v('cGroups').split(',').map(s => s.trim()).filter(Boolean), classGroups: [...document.querySelectorAll('.cCls:checked')].map(x => x.value) });
    if (!c.name) { toast('O campeonato precisa de nome.'); return; }
    const cid = id || slug(c.name);
    if (await save('champs', cid, c)) { S.champId = cid; closeDlg(); pickChamp(); render(); }
  }
  else if (a === 'certDel') {
    if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'apagar?'; return; }
    const b = JSON.parse(JSON.stringify(S.boats[t.dataset.b])); b.certs.splice(+t.dataset.i, 1); await save('boats', t.dataset.b, b);
  }
  else if (a === 'catUse') {
    const r = S.catalog.rows.find(x => x[10] === t.dataset.ref); if (!r) return;
    const kind = t.dataset.k;
    addCert(t.dataset.b, { from: v('cFrom') || r[5], kind, ToT_CL: r[7], ToT_WL: r[8], CDL: r[6], ref: r[10], src: (kind === 'copiado' ? 'copiado de ' : '') + `${r[0]} ${r[1]} ${r[3]} ${r[5].slice(0, 4)} ${r[4] === 'I' ? 'ORCi' : 'Club'} (${r[2]})` });
  }
  else if (a === 'certManual') {
    const n = x => x ? Number(x.replace(',', '.')) : null;
    let CL = n(v('mCL')), WL = n(v('mWL')); const tCL = n(v('mTodCL')), tWL = n(v('mTodWL'));
    if (!CL && tCL) CL = Math.round(600 / tCL * 1e4) / 1e4; if (tWL) WL = Math.round(600 / tWL * 1e4) / 1e4;
    if (!CL && !WL) { toast('Indique pelo menos um ToT ou ToD.'); return; }
    const c = { from: v('mFrom'), kind: v('mKind'), src: v('mSrc') || v('mKind') }; if (CL) c.ToT_CL = CL; if (WL) c.ToT_WL = WL; if (tCL) c.ToD_CL = tCL; if (tWL) c.ToD_WL = tWL; if (n(v('mCDL'))) c.CDL = n(v('mCDL'));
    addCert(t.dataset.b, c);
  }
  else if (a === 'certDeriv') {
    const ref = S.boats[v('dRef')], target = Number(v('dTarget').replace(',', '.')), from = v('dFrom');
    const rc = ref && E.certAt(ref, from, dbState(), 'ToT_CL');
    if (!rc || !target) { toast('Escolha a referência e o ToT pretendido.'); return; }
    const f = target / rc.ToT_CL, r4 = x => Math.round(x * 1e4) / 1e4;
    const c = { from, kind: 'derivado', ToT_CL: target, src: `derivado de ${ref.name} (${rc.src || ''}) × ${f.toFixed(5)}` };
    if (rc.ToT_WL) c.ToT_WL = r4(rc.ToT_WL * f);
    addCert(t.dataset.b, c);
  }
  else if (a === 'copyRace') {
    const race = Object.assign({ id }, S.races[id]); const { rows } = E.raceResults(race, dbState());
    copy(`${race.name} — ${dPT(race.date)} (${E.SYSTEMS[race.system]})\n` + rows.map(x => x.code ? `-  ${x.name}  ${x.code}  ${ptsF(x.pts)} pts` : `${x.pos}. ${x.name}  ${E.hms2(x.elapsed)}  corr ${E.hms2(x.corrected)}  +${E.hms(x.delta)}`).join('\n'));
  }
  else if (a === 'export') {
    const races = champRaces(), c = champ();
    dialog('Exportar classificação', `<div class="small muted">Para enviar aos velejadores: partilhe esta página (só leitura para quem não é editor), copie o texto ou descarregue um ficheiro HTML para imprimir ou publicar.</div>
      <div class="row"><button class="btn" data-a="expTxt">Copiar texto (${esc(groupsOf(c).find(g => g.k === S.group) ? groupsOf(c).find(g => g.k === S.group).t : 'Geral')})</button>${DOWN || STATIC ? '<button class="btn pri" data-a="expHtml">Descarregar HTML completo</button>' : ''}</div>`);
  }
  else if (a === 'expTxt') { const races = champRaces(), c = champ(); const k = S.group === 'PROVAS' ? 'GERAL' : S.group; copy(standingsText(E.seriesStandings(races, dbState(), { champ: c, filter: groupFilter(k) }), races, c.name + ' — ' + (groupsOf(c).find(g => g.k === k) || { t: 'Geral' }).t)); }
  else if (a === 'expHtml' && STATIC) downloadFile(slug(champ().name) + '.html', standingsHTML());
  else if (a === 'expHtml') { try { await DOWN.save({ filename: slug(champ().name) + '.html', data: standingsHTML() }); } catch (_) { toast('Descarga cancelada.'); } }
}
document.addEventListener('input', e => { if (e.target.id === 'fleetQ') { S.fleetQ = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#fleetQ'); q.focus(); q.setSelectionRange(pos, pos); } });
document.addEventListener('change', async e => {
  if (e.target.id !== 'photoIn' || !e.target.files[0]) return;
  if (!ASSETS) { toast('Só os editores podem guardar fotografias.'); return; }
  const id = e.target.dataset.id; toast('A enviar fotografia…');
  try {
    const up = await ASSETS.upload(await shrink(e.target.files[0]));
    const r = JSON.parse(JSON.stringify(S.races[id])); r.photos = (r.photos || []).concat([up.id]);
    if (await save('races', id, r)) toast('Fotografia guardada.');
  } catch (err) { toast('Não foi possível guardar a foto (' + (err.code || err.message) + ').'); }
});
$('#dlg') && $('#dlg').addEventListener('close', () => { if (S.edit) { S.edit = null; render(); } });
init();
