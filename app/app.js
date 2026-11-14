/* ORC Scoring v2 — Campeonato → Prova (com inscritos) → Regatas */
'use strict';
const E = window.ORC;
const COLS = ['champs', 'events', 'races', 'boats', 'classes', 'clubs', 'skippers'];
const S = { loaded: {}, canEdit: false, ctx: null, group: 'GERAL', raceGroup: 'GERAL', evGroup: 'GERAL', fleetTab: 'champ', edit: null, catalog: null };
COLS.forEach(c => { S[c] = {}; });
let DB = null, ASSETS = null, SAMPLE = null, DOWN = null;
// STATIC: site público (GitHub Pages), fora do Claude — lê data/db.json, só leitura.
const STATIC = !(window.claude && typeof window.claude.use === 'function');
const CODES = ['FIN', 'DNF', 'DNS', 'RET', 'OCS', 'BFD', 'UFD', 'DSQ', 'DNE'];
const DEFAULT_RULES = { discards: [{ upTo: 3, n: 0 }, { upTo: 8, n: 1 }, { upTo: 999, n: 2 }], divLimits: { A: 9.9, B: 8.8 }, groups: ['A', 'B', 'C', 'SB'], classGroups: [] };
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt4 = v => v == null || v === '' ? '—' : Number(v).toFixed(4).replace('.', ',');
const fmt1 = v => v == null || v === '' ? '—' : Number(v).toFixed(1).replace('.', ',');
const ptsF = p => (p % 1 ? p.toFixed(1) : String(p)).replace('.', ',');
const today = () => new Date().toISOString().slice(0, 10);
const dPT = d => d ? d.split('-').reverse().join('/') : '';
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('x' + Date.now());
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
const byName = (a, b) => (a[1].name || '').localeCompare(b[1].name || '');
const uniqueId = (col, base) => { let id = base, i = 2; while (S[col][id]) id = base + '-' + i++; return id; };
const clone = o => JSON.parse(JSON.stringify(o));

// Mensagens no canto superior direito, sempre por cima de janelas abertas (camada "top layer" via popover).
function toast(msg) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  const dlg = $('#dlg');
  if (typeof t.showPopover === 'function') { t.popover = 'manual'; document.body.appendChild(t); t.showPopover(); }
  else (dlg && dlg.open ? dlg : document.body).appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function dbState() { return { boats: S.boats, classes: S.classes }; }

/* ---------- modelo ---------- */
const sortRaces = list => list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
function eventRaces(eid) { return sortRaces(Object.entries(S.races).filter(([, r]) => r.event === eid).map(([id, r]) => Object.assign({ id }, r))); }
function champEvents(cid) { return Object.entries(S.events).filter(([, e]) => e.champ === cid).sort((a, b) => (a[1].dateFrom || '').localeCompare(b[1].dateFrom || '')); }
function champRaces(cid) { return sortRaces(champEvents(cid).flatMap(([eid]) => eventRaces(eid))); }
function champEntries(cid) { return [...new Set(champEvents(cid).flatMap(([, e]) => e.entries || []))]; }
function rulesOfEvent(ev) { return ev && ev.champ && S.champs[ev.champ] ? S.champs[ev.champ] : Object.assign({}, DEFAULT_RULES, ev || {}); }
function rulesOfRace(r) { return rulesOfEvent(S.events[r.event]); }
function ctxKind() { return S.ctx ? S.ctx[0] : null; }
function ctxId() { return S.ctx ? S.ctx.slice(2) : null; }
function ctxRules() { return S.champs[ctxId()]; }
function ctxEvents() { return champEvents(ctxId()); }
function divOf(b, rules) { return E.divisionOf(b, '', dbState(), rules || ctxRules()); }
function groupsOf(rules) {
  const g = [{ k: 'GERAL', t: 'Geral' }];
  ((rules && rules.groups) || DEFAULT_RULES.groups).forEach(d => g.push({ k: 'DIV:' + d, t: 'Div. ' + d }));
  ((rules && rules.classGroups) || []).forEach(cl => S.classes[cl] && g.push({ k: 'CLS:' + cl, t: S.classes[cl].name }));
  return g;
}
function groupFilter(k, rules) {
  if (k === 'GERAL') return null;
  if (k.startsWith('DIV:')) { const d = k.slice(4); return b => divOf(b, rules) === d; }
  if (k.startsWith('CLS:')) { const c = k.slice(4); return b => b.classRef === c; }
  return null;
}
const clubShort = id => (S.clubs[id] && (S.clubs[id].short || S.clubs[id].name)) || '';
const skipperName = id => (S.skippers[id] && S.skippers[id].name) || '';
function boatSub(b) { return [b.sail, b.type, clubShort(b.clubId)].filter(Boolean).join(' · '); }
function divChip(b, rules) { const d = divOf(b, rules); return `<span class="chip div-${esc(d)}">${esc(d)}</span>`; }
function evDates(e) { return e.dateFrom && e.dateTo && e.dateTo !== e.dateFrom ? `${dPT(e.dateFrom)} a ${dPT(e.dateTo)}` : dPT(e.dateFrom); }

/* ---------- arranque / dados ---------- */
async function init() {
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  $('#dlgX').onclick = () => $('#dlg').close();
  $('#ctxSel').onchange = e => {
    const v = e.target.value;
    if (v === '__newC') { e.target.value = S.ctx || ''; return openChampForm(null); }
    if (v === '__newE') { e.target.value = S.ctx || ''; return S.ctx ? openEventForm(null, ctxId()) : null; }
    S.ctx = v; try { localStorage.setItem('ctx', v); } catch (_) {}
    S.group = 'GERAL'; location.hash = 'classificacao'; render();
  };
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
    if (S.ready) { pickCtx(); if (!S.edit) render(); }
  }, err => { clearTimeout(timer); $('#view').innerHTML = `<div class="warn">Erro ao ler dados (${esc(err.code)}).</div>`; }));
  window.claude.use('assets').then(a => { ASSETS = a; }).catch(() => {});
  window.claude.use('sample').then(s => { SAMPLE = s; }).catch(() => {});
  window.claude.use('downloads').then(d => { DOWN = d; }).catch(() => {});
}
async function loadStatic(timer) {
  try {
    const data = await fetch('data/db.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    COLS.forEach(col => { S[col] = data[col] || {}; S.loaded[col] = true; });
    S.exportedAt = data.exportedAt || null; S.ready = true; clearTimeout(timer); pickCtx(); render();
  } catch (e) { clearTimeout(timer); $('#view').innerHTML = `<div class="warn">Não foi possível carregar os resultados (${esc(e.message)}).</div>`; }
}
function downloadFile(filename, data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const updatedNote = () => STATIC && S.exportedAt ? ` · Atualizado a ${dPT(S.exportedAt.slice(0, 10))} às ${new Date(S.exportedAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })}.` : '';
function pickCtx() {
  const champs = Object.entries(S.champs).sort((a, b) => (b[1].dateFrom || b[1].season || '').localeCompare(a[1].dateFrom || a[1].season || ''));
  const valid = v => v && v[0] === 'c' && S.champs[v.slice(2)];
  let saved = null; try { saved = localStorage.getItem('ctx'); } catch (_) {}
  if (!valid(S.ctx)) S.ctx = valid(saved) ? saved : champs[0] ? 'c:' + champs[0][0] : null;
  const opt = (v, t) => `<option value="${esc(v)}" ${v === S.ctx ? 'selected' : ''}>${esc(t)}</option>`;
  $('#ctxSel').innerHTML = champs.map(([id, c]) => opt('c:' + id, c.name)).join('')
    + (S.canEdit ? `<option value="__newC">+ Criar campeonato</option><option value="__newE" ${S.ctx ? '' : 'disabled'}>+ Nova prova${S.ctx ? ' neste campeonato' : ' (escolha um campeonato)'}</option>` : '');
  if (!S.ctx) $('#ctxSel').insertAdjacentHTML('afterbegin', '<option value="" selected>—</option>');
  const c = S.ctx ? S.champs[ctxId()] : null;
  $('#clubName').textContent = c ? (S.clubs[c.clubId] || {}).name || '' : '';
}
async function save(col, id, data) {
  if (!S.canEdit) { toast('Só os editores podem alterar dados.'); return false; }
  try { await DB.doc(col + '/' + id).set(clone(data)); S[col][id] = clone(data); return true; }
  catch (e) { toast('Não gravou: ' + (e.code || e.message)); return false; }
}
async function del(col, id) { try { await DB.doc(col + '/' + id).delete(); delete S[col][id]; return true; } catch (e) { toast('Não apagou: ' + (e.code || e.message)); return false; } }

/* ---------- router ---------- */
function route() { return (location.hash || '#classificacao').slice(1); }
function render() {
  const r = route();
  const tab = r.startsWith('race-') || r.startsWith('prova-') || r === 'regatas' || r === 'provas' ? 'regatas' : r.startsWith('boat-') || r === 'frota' ? 'frota' : 'classificacao';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === tab));
  if (!S.ready) return;
  const v = $('#view');
  if (r.startsWith('race-')) v.innerHTML = viewRace(r.slice(5));
  else if (r.startsWith('prova-')) v.innerHTML = viewEvent(r.slice(6));
  else if (r.startsWith('boat-')) v.innerHTML = viewBoat(r.slice(5));
  else if (r === 'regatas' || r === 'provas') v.innerHTML = viewRegatas();
  else if (r === 'frota') v.innerHTML = viewFleet();
  else v.innerHTML = viewStandings();
}

/* ---------- classificações ---------- */
function viewStandings() {
  if (!S.ctx) return `<div class="empty">Ainda não há campeonatos.${S.canEdit ? '<br><br><button class="btn pri" data-a="newChamp">Criar campeonato</button>' : ''}</div>`;
  const cid = ctxId(), c = S.champs[cid], races = champRaces(cid);
  const tabs = groupsOf(c).concat(champEvents(cid).length > 1 ? [{ k: 'PROVAS', t: 'Por prova' }] : []);
  if (!tabs.find(t => t.k === S.group)) S.group = 'GERAL';
  let body;
  if (S.group === 'PROVAS') body = champEvents(cid).map(([eid, e]) => {
    const rs = eventRaces(eid);
    const st = E.seriesStandings(rs, dbState(), { discards: 0, boats: e.entries || [] });
    return `<div class="card"><div class="row spread"><h2><a href="#prova-${esc(eid)}" style="color:inherit">${esc(e.name)}</a></h2><span class="small muted">${evDates(e)}</span></div><div class="small muted">${rs.length} regata(s) · ${(e.entries || []).length} inscritos · soma sem descartes</div>${standingsTable(st, rs, c)}</div>`;
  }).join('') || '<div class="empty">Sem provas.</div>';
  else {
    const st = E.seriesStandings(races, dbState(), { champ: c, filter: groupFilter(S.group, c), boats: champEntries(cid) });
    body = standingsTable(st, races, c) + `<p class="small muted">DNC = ${st.dnc} pontos (inscritos do grupo no campeonato + 1) · ${st.nDiscards} descarte(s) com ${races.length} regatas · desempates RRS A8. Pontos riscados = descartes.${updatedNote()}</p>`;
  }
  const fin = races.filter(r => r.status === 'final').length;
  return `<section class="row spread"><div><h1>${esc(c.name)}</h1><div class="small muted">${c.dateFrom ? evDates(c) + ' · ' : ''}${champEvents(cid).length} provas · ${races.length} regatas · ${fin} finais${c.season ? ' · ' + esc(c.season) : ''}</div></div>
    <div class="row">${S.canEdit ? `<button class="btn sm" data-a="editChamp" data-id="${esc(cid)}">Definições</button>` : ''}<button class="btn sm" data-a="export">Exportar</button></div></section>
    <div class="tabs">${tabs.map(t => `<button data-a="grp" data-k="${esc(t.k)}" class="${S.group === t.k ? 'on' : ''}">${esc(t.t)}</button>`).join('')}</div>
    ${body}`;
}
function eventStandings(eid, groupKey) {
  const e = S.events[eid], rules = rulesOfEvent(e), rs = eventRaces(eid);
  // prova única no campeonato: aplica as regras (descartes) do campeonato; várias provas: soma sem descartes
  const single = champEvents(e.champ).length <= 1;
  const opts = single ? { champ: rules } : { discards: 0 };
  return { rs, rules, st: E.seriesStandings(rs, dbState(), Object.assign(opts, { filter: groupFilter(groupKey, rules), boats: e.entries || [] })) };
}
function standingsTable(st, races, rules) {
  if (!st.table.length) return '<div class="empty">Sem resultados ainda.</div>';
  const head = races.map((r, i) => `<th class="n" title="${esc(r.name)}"><a href="#race-${esc(r.id)}">R${i + 1}</a></th>`).join('');
  const rows = st.table.map(r => {
    const b = S.boats[r.boatId] || {};
    const cells = r.cells.map(c => `<td class="n ${c.disc ? 'disc' : ''} ${c.code && !c.disc ? 'code' : ''}"><span>${c.code ? esc(c.code) + ' ' : ''}${ptsF(c.pts)}</span></td>`).join('');
    return `<tr class="podium-${r.rank}"><td class="pos sticky">${r.rank}</td><td class="boat"><a href="#boat-${esc(r.boatId)}" style="color:inherit;text-decoration:none">${esc(r.name)}</a> ${divChip(b, rules)}<span class="sub">${esc(boatSub(b))}</span></td><td class="n net">${ptsF(r.net)}</td><td class="n muted">${ptsF(r.total)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr><th class="sticky">#</th><th>Barco</th><th class="n">Líq.</th><th class="n">Total</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- provas ---------- */
// Regatas: campeonato com uma só prova (ou nenhuma) mostra logo as regatas e os inscritos;
// com várias provas mostra a lista de provas.
function viewRegatas() {
  if (!S.ctx) return `<div class="empty">Escolha ou crie um campeonato no topo.${S.canEdit ? '<br><br><button class="btn pri" data-a="newChamp">Criar campeonato</button>' : ''}</div>`;
  const cid = ctxId(), evs = champEvents(cid);
  if (evs.length === 1) return viewEvent(evs[0][0], true);
  if (evs.length) return viewEvents();
  const c = S.champs[cid];
  return `<section><h1>Regatas</h1><div class="muted">${esc(c.name)}${c.dateFrom ? ' · ' + evDates(c) : ''}</div></section>
    <div class="card"><div class="row spread"><h3>Regatas</h3>${S.canEdit ? `<button class="btn sm pri" data-a="newRace" data-c="${esc(cid)}">+ Nova regata</button>` : ''}</div><div class="small muted">Ainda sem regatas.</div></div>
    <div class="small muted">0 inscritos — <a href="#frota" data-a="fleetGo">${S.canEdit ? 'inscrever barcos na Frota' : 'ver na Frota'}</a></div>`;
}
async function ensureEvent(cid) {
  const evs = champEvents(cid); if (evs.length) return evs[0][0];
  const c = S.champs[cid], eid = uniqueId('events', slug(c.name));
  return await save('events', eid, { name: c.name, champ: cid, clubId: c.clubId || '', dateFrom: c.dateFrom || today(), dateTo: c.dateTo || c.dateFrom || today(), venue: '', entries: [] }) ? eid : null;
}
function viewEvents() {
  const evs = ctxEvents();
  const items = evs.map(([eid, e]) => {
    const rs = eventRaces(eid);
    return `<a class="item" href="#prova-${esc(eid)}"><div class="grow"><div class="title">${esc(e.name)}</div>
      <div class="meta">${evDates(e)}${e.venue ? ' · ' + esc(e.venue) : ''} · ${rs.length} regata(s) · ${(e.entries || []).length} inscritos</div></div>
      <span class="chip st-${rs.length && rs.every(r => r.status === 'final') ? 'final' : 'provisoria'}">${rs.length && rs.every(r => r.status === 'final') ? 'Final' : rs.length ? 'Provisória' : 'Por correr'}</span></a>`;
  }).join('');
  return `<section class="row spread"><div><h1>Regatas</h1><div class="small muted">${esc(S.champs[ctxId()].name)} · ${evs.length} provas</div></div>${S.canEdit ? `<button class="btn pri" data-a="newEvent" data-c="${esc(ctxId())}">+ Nova prova</button>` : ''}</section>
    <div class="list">${items || '<div class="empty">Ainda sem provas neste campeonato.</div>'}</div>`;
}
function viewEvent(eid, single) {
  const e = S.events[eid];
  if (!e) return '<div class="empty">Prova não encontrada.</div>';
  const rules = rulesOfEvent(e), rs = eventRaces(eid);
  const raceItems = rs.map((r, i) => {
    const n = (r.finishes || []).length, nf = (r.finishes || []).filter(f => !f.code || f.code === 'FIN').length;
    return `<a class="item" href="#race-${esc(r.id)}"><div class="idx">R${i + 1}</div><div class="grow"><div class="title">${esc(r.name)}</div>
      <div class="meta">${dPT(r.date)} · largada ${esc((r.start || '').slice(0, 5))} · ${esc(E.SYSTEMS[r.system] || r.system)}${r.distance ? ' · ' + esc(r.distance) + ' NM' : ''}</div>
      <div class="meta">${nf} chegados de ${n}</div></div><span class="chip st-${r.status === 'final' ? 'final' : 'provisoria'}">${r.status === 'final' ? 'Final' : 'Provisória'}</span></a>`;
  }).join('');
  const entries = (e.entries || []).filter(id => S.boats[id]).map(id => [id, S.boats[id]]).sort(byName);
  const tabs = groupsOf(rules);
  if (!tabs.find(t => t.k === S.evGroup)) S.evGroup = 'GERAL';
  const { st } = eventStandings(eid, S.evGroup);
  const champ = e.champ && S.champs[e.champ];
  const head = single
    ? `<section><h1>Regatas</h1><div class="muted">${esc(champ ? champ.name : e.name)} · ${evDates(champ && champ.dateFrom ? champ : e)}${e.venue ? ' · ' + esc(e.venue) : ''}</div></section>`
    : `<section><div class="small muted"><a href="#regatas">Regatas</a>${champ ? ' · ' + esc(champ.name) : ''}</div>
      <div class="row spread"><h1>${esc(e.name)}</h1>${S.canEdit ? `<button class="btn sm" data-a="editEvent" data-id="${esc(eid)}">Editar prova</button>` : ''}</div>
      <div class="muted">${evDates(e)}${e.venue ? ' · ' + esc(e.venue) : ''}${S.clubs[e.clubId] ? ' · ' + esc(S.clubs[e.clubId].name) : ''}</div></section>`;
  return `${head}
    <div class="card"><div class="row spread"><h3>Regatas</h3>${S.canEdit ? `<button class="btn sm pri" data-a="newRace" data-e="${esc(eid)}">+ Nova regata</button>` : ''}</div>
      <div class="list">${raceItems || '<div class="small muted">Ainda sem regatas.</div>'}</div></div>
    ${single ? '' : `<div class="card"><div class="row spread"><h3>Classificação da prova</h3><span class="small muted">${champEvents(e.champ).length > 1 ? 'soma sem descartes' : st.nDiscards + ' descarte(s)'}</span></div>
      <div class="tabs">${tabs.map(t => `<button data-a="egrp" data-k="${esc(t.k)}" class="${S.evGroup === t.k ? 'on' : ''}">${esc(t.t)}</button>`).join('')}</div>
      ${standingsTable(st, rs, rules)}</div>`}
    <div class="small muted">${entries.length} inscritos${entries.length ? '' : ' — '}${entries.length ? ' · ' : ''}<a href="#frota" data-a="fleetGo">${S.canEdit ? 'gerir inscrições na Frota' : 'ver na Frota'}</a></div>`;
}

/* ---------- regata ---------- */
function viewRace(id) {
  const r0 = S.races[id];
  if (!r0) return '<div class="empty">Regata não encontrada.</div>';
  const race = Object.assign({ id }, r0), ev = S.events[race.event] || {}, rules = rulesOfRace(race);
  const idx = eventRaces(race.event).findIndex(x => x.id === id) + 1;
  const { problems } = E.scoreRace(race, dbState());
  const notEntered = (race.finishes || []).filter(f => S.boats[f.boatId] && !(ev.entries || []).includes(f.boatId)).map(f => S.boats[f.boatId].name);
  if (notEntered.length) problems.push('Não inscritos nesta prova: ' + notEntered.join(', '));
  const tabs = groupsOf(rules);
  if (!tabs.find(t => t.k === S.raceGroup)) S.raceGroup = 'GERAL';
  const { rows } = E.raceResults(race, dbState(), groupFilter(S.raceGroup, rules));
  const isToD = race.system.startsWith('ToD');
  const tr = rows.map(x => {
    const b = S.boats[x.boatId] || {};
    if (x.code) return `<tr><td class="pos">—</td><td class="boat">${esc(x.name)} ${divChip(b, rules)}<span class="sub">${esc(x.note || boatSub(b))}</span></td><td class="code" colspan="5">${esc(x.code)}${x.finish ? ' · ' + esc(x.finish) : ''}</td><td class="n">${ptsF(x.pts)}</td></tr>`;
    return `<tr class="podium-${x.pos}"><td class="pos">${x.pos}</td><td class="boat">${esc(x.name)} ${divChip(b, rules)}<span class="sub">${esc(boatSub(b))}</span></td>
      <td class="n">${esc(x.finish)}</td><td class="n">${E.hms2(x.elapsed)}</td><td class="n" title="${esc(x.certSrc)}">${isToD ? fmt1(x.rating) : fmt4(x.rating)}</td><td class="n">${E.hms2(x.corrected)}</td><td class="n">${x.delta ? '+' + E.hms(x.delta) : '—'}</td><td class="n">${ptsF(x.pts)}</td></tr>`;
  }).join('');
  const photos = STATIC ? '' : (race.photos || []).map(p => `<a href="/_blob/${esc(p)}" target="_blank" rel="noopener"><img src="/_blob/${esc(p)}" alt="Folha de chegadas"></a>`).join('');
  return `<section class="row spread"><div><div class="small muted"><a href="#${champEvents(ev.champ).length > 1 ? 'prova-' + esc(race.event) : 'regatas'}">${champEvents(ev.champ).length > 1 ? esc(ev.name || 'Prova') : 'Regatas'}</a> · R${idx}</div><h1>${esc(race.name)}</h1></div>
      <span class="chip st-${race.status === 'final' ? 'final' : 'provisoria'}">${race.status === 'final' ? 'Final' : 'Provisória'}</span></section>
    <div class="kpis"><div class="kpi"><b>${dPT(race.date).slice(0, 5)}</b><span>${esc(race.date.slice(0, 4))}</span></div><div class="kpi"><b>${esc((race.start || '').slice(0, 5))}</b><span>largada</span></div>
      <div class="kpi"><b>${esc(race.system.replace('_', ' '))}</b><span>${race.system.endsWith('WL') ? 'barl./sotav.' : race.system.endsWith('GPH') ? 'GPH' : 'costeiro'}</span></div>${race.distance ? `<div class="kpi"><b>${esc(race.distance)} NM</b><span>distância</span></div>` : ''}${race.timeLimit ? `<div class="kpi"><b>${esc(race.timeLimit.slice(0, 5))}</b><span>hora limite</span></div>` : ''}</div>
    ${problems.map(p => `<div class="warn">${esc(p)}</div>`).join('')}
    <div class="tabs">${tabs.map(t => `<button data-a="rgrp" data-k="${esc(t.k)}" class="${S.raceGroup === t.k ? 'on' : ''}">${esc(t.t)}</button>`).join('')}</div>
    <div class="scroll"><table><thead><tr><th>#</th><th>Barco</th><th class="n">Chegada</th><th class="n">Decorrido</th><th class="n">${isToD ? 'ToD' : 'ToT'}</th><th class="n">Corrigido</th><th class="n">Delta</th><th class="n">Pts</th></tr></thead><tbody>${tr || '<tr><td colspan="8" class="empty">Sem chegadas.</td></tr>'}</tbody></table></div>
    <p class="small muted">Siglas (DNF, DNS, RET…) = barcos na regata + 1. Inscritos sem resultado ficam DNC nas classificações. Rating = certificado em vigor a ${dPT(race.date)}; toque no valor para ver a origem.</p>
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
  const ed = S.edit, race = S.races[ed.id], ev = S.events[race.event] || {};
  const entered = new Set(ev.entries || []);
  const boatsSorted = Object.entries(S.boats).filter(([bid]) => entered.has(bid) || ed.rows.some(r => r.boatId === bid)).sort(byName);
  const opts = sel => '<option value="">— barco —</option>' + boatsSorted.map(([bid, b]) => `<option value="${esc(bid)}" ${bid === sel ? 'selected' : ''}>${esc(b.name)}${b.sail ? ' (' + esc(b.sail) + ')' : ''}${entered.has(bid) ? '' : ' · não inscrito'}</option>`).join('');
  const rows = ed.rows.map((f, i) => `<div class="fin-row"><select data-fi="${i}" data-k="boatId" aria-label="Barco ${i + 1}">${opts(f.boatId)}</select>
     <input data-fi="${i}" data-k="finish" value="${esc(f.finish || '')}" placeholder="hh:mm:ss" inputmode="numeric" aria-label="Hora de chegada ${i + 1}">
     <select data-fi="${i}" data-k="code" aria-label="Sigla ${i + 1}">${CODES.map(c => `<option ${(f.code || 'FIN') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
     <button class="x" data-a="finDel" data-i="${i}" aria-label="Remover linha">×</button>${f.read ? `<div class="small muted" style="grid-column:1/-1">lido: “${esc(f.read)}”${f.boatId ? '' : ' · escolha o barco'}</div>` : ''}</div>`).join('');
  const inRace = new Set(ed.rows.map(r => r.boatId));
  const quick = boatsSorted.filter(([bid]) => !inRace.has(bid) && entered.has(bid)).map(([bid, b]) => `<button class="btn sm" data-a="finAdd" data-b="${esc(bid)}">${esc(b.name)}</button>`).join('');
  dialog(`Chegadas · ${race.name}`, `<div class="small muted">Largada ${esc(race.start)} · Ordem de chegada. FIN = chegou (precisa de hora). Siglas DNF/DNS/RET… para barcos que estiveram na regata. Inscritos que não estão aqui ficam DNC.</div>
    <div class="list">${rows || '<div class="muted small">Sem linhas.</div>'}</div>
    <div class="row"><button class="btn sm" data-a="finAdd">+ Linha</button></div>
    <details><summary class="small">Adicionar inscrito (${quick ? 'faltam ' + (boatsSorted.filter(([bid]) => !inRace.has(bid) && entered.has(bid)).length) : 'todos na lista'})</summary><div class="row" style="margin-top:8px">${quick || '<span class="small muted">Para adicionar outro barco, inscreva-o primeiro na prova.</span>'}</div></details>
    <div class="row spread"><button class="btn" data-a="finCancel">Cancelar</button><button class="btn pri" data-a="finSave">Gravar chegadas</button></div>`);
  $('#dlgB').oninput = $('#dlgB').onchange = e => {
    const el = e.target; if (el.dataset.fi == null) return;
    const f = S.edit.rows[+el.dataset.fi]; f[el.dataset.k] = el.value;
    if (el.dataset.k === 'finish') f.finish = el.value.replace(/[.,h ]/g, ':');
  };
}

/* ---------- frota: barcos, skippers, clubes ---------- */
function viewFleet() {
  const cid = S.ctx ? ctxId() : null, entered = cid ? champEntries(cid).filter(id => S.boats[id]) : [];
  const tabs = [['champ', 'Inscritos', entered.length], ['boats', 'Base de dados', Object.keys(S.boats).length], ['skippers', 'Skippers', Object.keys(S.skippers).length], ['clubs', 'Clubes', Object.keys(S.clubs).length]];
  const t = S.fleetTab;
  const head = `<div class="tabs">${tabs.map(([k, n, c]) => `<button data-a="fleetTab" data-k="${k}" class="${t === k ? 'on' : ''}">${n} (${c})</button>`).join('')}</div>`;
  if (t === 'skippers') {
    const list = Object.entries(S.skippers).sort(byName).map(([id, s]) => {
      const boats = Object.values(S.boats).filter(b => b.skipperId === id).map(b => b.name).join(', ');
      return `<div class="item"><div class="grow"><div class="title">${esc(s.name)}</div><div class="meta">${esc(clubShort(s.clubId) || 'sem clube')}${s.license ? ' · licença ' + esc(s.license) : ''}${boats ? ' · ' + esc(boats) : ''}</div></div>${S.canEdit ? `<button class="btn sm" data-a="editSkipper" data-id="${esc(id)}">Editar</button>` : ''}</div>`;
    }).join('');
    return `<section class="row spread"><h1>Skippers</h1>${S.canEdit ? '<button class="btn pri" data-a="newSkipper">+ Novo skipper</button>' : ''}</section>${head}<div class="list">${list || '<div class="empty">Sem skippers.</div>'}</div>`;
  }
  if (t === 'clubs') {
    const list = Object.entries(S.clubs).sort(byName).map(([id, c]) => {
      const nb = Object.values(S.boats).filter(b => b.clubId === id).length;
      return `<div class="item"><div class="grow"><div class="title">${esc(c.name)}</div><div class="meta">${esc(c.short || '')} · ${nb} barco(s)</div></div>${S.canEdit ? `<button class="btn sm" data-a="editClub" data-id="${esc(id)}">Editar</button>` : ''}</div>`;
    }).join('');
    return `<section class="row spread"><h1>Clubes</h1>${S.canEdit ? '<button class="btn pri" data-a="newClub">+ Novo clube</button>' : ''}</section>${head}<div class="list">${list || '<div class="empty">Sem clubes.</div>'}</div>`;
  }
  if (t === 'champ') return viewFleetEntries(head);
  const q = S.fleetQ || '';
  const champMode = false;
  const pool = champMode ? entered.map(id => [id, S.boats[id]]) : Object.entries(S.boats);
  const list = pool.filter(([, b]) => !q || norm(b.name + b.sail + b.type + skipperName(b.skipperId) + clubShort(b.clubId) + (b.aka || []).join('')).includes(norm(q))).sort(byName);
  const d = today();
  const evCount = id => champEvents(cid).filter(([, e]) => (e.entries || []).includes(id)).length;
  const items = list.map(([id, b]) => {
    const cl = E.ratingAt(b, d, 'ToT_CL', dbState()), wl = E.ratingAt(b, d, 'ToT_WL', dbState());
    const k = cl ? cl.cert.kind || 'orc' : null;
    return `<a class="item" href="#boat-${esc(id)}"><div class="grow"><div class="title">${esc(b.name)}</div><div class="meta">${esc(boatSub(b))}${b.skipperId ? ' · ' + esc(skipperName(b.skipperId)) : ''}${champMode ? ' · ' + evCount(id) + ' prova(s)' : ''}</div>
      <div class="meta num">ToT costeiro ${fmt4(cl && cl.value)} · barl./sotav. ${fmt4(wl && wl.value)}</div></div>${k ? `<span class="chip k-${esc(k)}">${esc(k)}</span>` : '<span class="chip">sem rating</span>'}${S.canEdit && cid ? (champMode ? `<button class="btn sm dang" data-a="unenroll" data-id="${esc(id)}">Retirar</button>` : enrollBtn(id, evCount(id))) : ''}</a>`;
  }).join('');
  const intro = champMode
    ? `<div class="small muted">${cid ? `Barcos inscritos em pelo menos uma prova de ${esc(S.champs[cid].name)}. Inscreva barcos em Regatas → Gerir inscrições, ou na Base de dados com o botão Inscrever.` : 'Escolha um campeonato no topo.'}</div>`
    : '<div class="small muted">Todos os barcos guardados. Estar na base de dados não inscreve o barco em nenhuma prova.</div>';
  return `<section class="row spread"><h1>${champMode ? 'Frota' : 'Base de dados'}</h1>${S.canEdit && !champMode ? '<button class="btn pri" data-a="newBoat">+ Novo barco</button>' : ''}</section>${head}${intro}
    <input id="fleetQ" value="${esc(q)}" placeholder="Procurar barco, vela, tipo, skipper ou clube" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">
    <div class="small muted">${list.length} barcos · ratings em vigor hoje (${dPT(d)})</div>
    <div class="list">${items || `<div class="empty">${champMode ? 'Ainda sem barcos inscritos neste campeonato.' : 'Sem barcos.'}</div>`}</div>`;
}
/* Frota → Inscritos: gestão das inscrições do campeonato (por prova quando há várias). */
function entryRow(id, eid, rules, racedIds, day) {
  const b = S.boats[id];
  const del = !S.canEdit ? '' : `<td>${eid ? (racedIds.has(id) ? '<span class="small muted" title="Tem resultados nesta prova">—</span>' : `<button class="x btn sm dang" data-a="entryDel" data-e="${esc(eid)}" data-id="${esc(id)}" aria-label="Retirar ${esc(b.name)}" title="Retirar da prova">×</button>`) : `<button class="btn sm dang" data-a="unenroll" data-id="${esc(id)}">Retirar</button>`}</td>`;
  return `<tr><td class="boat"><a href="#boat-${esc(id)}" style="color:inherit;text-decoration:none">${esc(b.name)}</a> ${divChip(b, rules)}<span class="sub">${esc([b.sail, b.type].filter(Boolean).join(' · '))}</span><span class="sub">${esc([skipperName(b.skipperId), clubShort(b.clubId)].filter(Boolean).join(' · ') || 'sem skipper')}</span></td><td>${E.certAt(b, day, dbState()) ? '<span class="chip k-orc">ok</span>' : S.canEdit ? `<button class="btn sm dang" data-a="addCert" data-id="${esc(id)}">sem certificado</button>` : '<span class="chip">sem certificado</span>'}</td>${del}</tr>`;
}
function viewFleetEntries(head) {
  if (!S.ctx) return `<section><h1>Frota</h1></section>${head}<div class="empty">Escolha ou crie um campeonato no topo.</div>`;
  const cid = ctxId(), c = S.champs[cid], evs = champEvents(cid), rules = c;
  let eid = null;
  if (evs.length > 1) {
    if (S.fleetEv !== 'all' && !(S.events[S.fleetEv] && S.events[S.fleetEv].champ === cid)) S.fleetEv = evs[0][0];
    eid = S.fleetEv === 'all' ? null : S.fleetEv;
  } else eid = evs.length ? evs[0][0] : null;
  const single = evs.length <= 1, ev = eid ? S.events[eid] : null;
  const ids = (ev ? ev.entries || [] : champEntries(cid)).filter(id => S.boats[id]);
  const q = norm(S.fleetQ || '');
  const shown = ids.filter(id => { const b = S.boats[id]; return !q || norm(b.name + b.sail + b.type + skipperName(b.skipperId) + clubShort(b.clubId) + (b.aka || []).join('')).includes(q); }).sort((a, b) => S.boats[a].name.localeCompare(S.boats[b].name));
  const racedIds = new Set((eid ? eventRaces(eid) : champRaces(cid)).flatMap(r => (r.finishes || []).map(f => f.boatId)));
  const day = (ev && ev.dateFrom) || c.dateFrom || today();
  const target = eid ? `data-e="${esc(eid)}"` : single ? `data-c="${esc(cid)}"` : '';
  const canAct = S.canEdit && (eid || single);
  const actions = !canAct ? '' : `<div class="row">
      <label class="btn sm" for="impFile">Importar lista (Excel/CSV)</label><input id="impFile" type="file" accept=".xlsx,.xls,.csv,.ods" ${target} hidden>
      <button class="btn sm" data-a="entries" ${eid ? `data-id="${esc(eid)}"` : `data-c="${esc(cid)}"`}>Escolher da base de dados</button>
      <button class="btn sm pri" data-a="newBoat" ${target}>+ Novo barco</button>
      ${eid && ids.length ? `<button class="btn sm dang" data-a="entryDelAll" data-e="${esc(eid)}">Retirar todos</button>` : ''}</div>
    <div class="small muted">Importar: ficheiro com títulos Barco, Vela, Modelo, Skipper, Licença, Clube (só "Barco" é obrigatório).</div>`;
  const evTabs = evs.length > 1 ? `<div class="tabs">${evs.map(([k, e]) => `<button data-a="fleetEv" data-k="${esc(k)}" class="${S.fleetEv === k ? 'on' : ''}">${esc(e.name)} (${(e.entries || []).length})</button>`).join('')}<button data-a="fleetEv" data-k="all" class="${S.fleetEv === 'all' ? 'on' : ''}">Todas (${champEntries(cid).length})</button></div>` : '';
  const noCert = ids.filter(id => !E.certAt(S.boats[id], day, dbState())).length;
  return `<section><h1>Frota</h1><div class="muted">${esc(c.name)}${ev && !single ? ' · ' + esc(ev.name) : ''} · ${ids.length} inscritos${noCert ? ` · <span style="color:var(--flag-r)">${noCert} sem certificado</span>` : ''}</div></section>
    ${head}${evTabs}${actions}
    <input id="fleetQ" value="${esc(S.fleetQ || '')}" placeholder="Procurar inscrito" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">
    ${shown.length ? `<div class="scroll"><table><thead><tr><th>Barco · skipper · clube</th><th>Cert.</th>${S.canEdit ? '<th></th>' : ''}</tr></thead><tbody>${shown.map(id => entryRow(id, eid, rules, racedIds, day)).join('')}</tbody></table></div>`
      : `<div class="empty">${ids.length ? 'Nenhum inscrito corresponde à pesquisa.' : !single && !eid ? 'Ainda sem inscritos.' : 'Ainda sem inscritos. Importe a lista, escolha da base de dados ou crie um barco novo.'}</div>`}`;
}
function viewBoat(id) {
  const b = S.boats[id]; if (!b) return '<div class="empty">Barco não encontrado.</div>';
  const certs = (b.classRef && S.classes[b.classRef] ? S.classes[b.classRef].certs : b.certs || []).map((c, i) => ({ c, i })).sort((x, y) => (y.c.from || '').localeCompare(x.c.from || ''));
  const races = Object.entries(S.races).filter(([, r]) => (r.finishes || []).some(f => f.boatId === id)).sort((x, y) => y[1].date.localeCompare(x[1].date));
  const evs = Object.entries(S.events).filter(([, e]) => (e.entries || []).includes(id)).sort((x, y) => (y[1].dateFrom || '').localeCompare(x[1].dateFrom || ''));
  const sk = S.skippers[b.skipperId];
  const crow = ({ c, i }) => `<tr><td>${dPT(c.from)}</td><td><span class="chip k-${esc(c.kind || 'orc')}">${esc(c.kind || 'orc')}</span></td><td class="n">${fmt4(c.ToT_CL)}</td><td class="n">${fmt4(c.ToT_WL)}</td><td class="n">${fmt1(E.certValue(c, 'ToD_CL'))}</td><td class="n">${c.GPH ? fmt1(c.GPH) : '—'}</td><td class="n">${c.CDL ? Number(c.CDL).toFixed(3) : '—'}</td><td class="small" style="white-space:normal;min-width:160px">${esc(c.src || '')}</td>${S.canEdit && !b.classRef ? `<td><button class="x btn sm dang" data-a="certDel" data-b="${esc(id)}" data-i="${i}" aria-label="Apagar certificado">×</button></td>` : ''}</tr>`;
  return `<section><div class="small muted"><a href="#frota">Frota</a></div><div class="row spread"><h1>${esc(b.name)} ${divChip(b)}</h1>${S.canEdit ? `<button class="btn sm" data-a="editBoat" data-id="${esc(id)}">Editar</button>` : ''}</div>
    <div class="muted">${esc([b.sail, b.type].filter(Boolean).join(' · '))}</div>${(b.aka || []).length ? `<div class="small muted">Também conhecido por: ${esc(b.aka.join(', '))}</div>` : ''}${b.note ? `<div class="info">${esc(b.note)}</div>` : ''}</section>
    <div class="kpis"><div class="kpi"><b>${esc(sk ? sk.name : '—')}</b><span>skipper${sk && sk.license ? ' · lic. ' + esc(sk.license) : ''}</span></div><div class="kpi"><b>${esc(clubShort(b.clubId) || '—')}</b><span>clube do barco</span></div></div>
    <div class="card"><div class="row spread"><h3>Certificados${b.classRef ? ' da classe ' + esc((S.classes[b.classRef] || {}).name) : ''}</h3>${S.canEdit && !b.classRef ? `<button class="btn sm pri" data-a="addCert" data-id="${esc(id)}">+ Certificado</button>` : ''}</div>
      <div class="small muted">Em cada regata usa-se o certificado em vigor nessa data. ToD costeiro = 600 ÷ ToT quando não indicado.</div>
      <div class="scroll"><table><thead><tr><th>Desde</th><th>Tipo</th><th class="n">ToT cost.</th><th class="n">ToT b/s</th><th class="n">ToD cost.</th><th class="n">GPH</th><th class="n">CDL</th><th>Origem</th>${S.canEdit && !b.classRef ? '<th></th>' : ''}</tr></thead><tbody>${certs.map(crow).join('') || '<tr><td colspan="9" class="muted">Sem certificados.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Provas inscritas</h3>${evs.map(([eid, e]) => `<a class="item" href="#prova-${esc(eid)}"><div class="grow"><div class="title">${esc(e.name)}</div><div class="meta">${evDates(e)}${e.champ && S.champs[e.champ] ? ' · ' + esc(S.champs[e.champ].name) : ''}</div></div></a>`).join('') || '<div class="muted small">Sem inscrições.</div>'}</div>
    <div class="card"><h3>Regatas</h3>${races.map(([rid, r]) => { const res = E.raceResults(Object.assign({ id: rid }, r), dbState()).rows.find(x => x.boatId === id) || {}; return `<a class="item" href="#race-${esc(rid)}"><div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${dPT(r.date)} · ${esc((S.events[r.event] || {}).name || '')}</div></div><b class="num">${res.code ? esc(res.code) : res.pos ? res.pos + 'º' : ''}</b></a>`; }).join('') || '<div class="muted small">Ainda sem regatas.</div>'}</div>`;
}

/* ---------- formulários ---------- */
function dialog(title, html) { $('#dlgT').textContent = title; $('#dlgB').innerHTML = html; $('#dlgB').oninput = $('#dlgB').onchange = null; if (!$('#dlg').open) $('#dlg').showModal(); }
function closeDlg() { $('#dlg').close(); S.edit = null; render(); }
function field(id, label, val, attrs) { return `<label class="f" for="${id}">${label}<input id="${id}" value="${esc(val == null ? '' : val)}" ${attrs || ''}></label>`; }
function sel(id, label, val, opts) { return `<label class="f" for="${id}">${label}<select id="${id}">${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`; }
const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const clubOpts = () => [['', '— sem clube —']].concat(Object.entries(S.clubs).sort(byName).map(([k, c]) => [k, c.name]));
const delBtn = (a, id, label) => id ? `<button class="btn dang" data-a="${a}" data-id="${esc(id)}">${label}</button>` : '<span></span>';
function rulesFields(r) {
  return `${field('cDisc', 'Descartes (até N regatas: descartes)', (r.discards || []).map(d => d.upTo + ':' + d.n).join(', '), 'placeholder="3:0, 8:1, 999:2"')}
    ${field('cA', 'Divisão A: CDL ≥', (r.divLimits || DEFAULT_RULES.divLimits).A, 'inputmode="decimal"')}${field('cB', 'Divisão B: CDL ≥', (r.divLimits || DEFAULT_RULES.divLimits).B, 'inputmode="decimal"')}
    ${field('cGroups', 'Divisões a classificar', (r.groups || []).join(', '))}</div>
    <div class="small muted">Classificações por classe (monotipias):</div><div class="row">${Object.entries(S.classes).map(([k, cl]) => `<label class="row small"><input type="checkbox" class="cCls" value="${esc(k)}" ${(r.classGroups || []).includes(k) ? 'checked' : ''}> ${esc(cl.name)}</label>`).join('') || '<span class="small muted">Sem classes definidas.</span>'}</div>`;
}
function readRules() {
  return {
    discards: v('cDisc').split(',').map(s => s.split(':').map(Number)).filter(p => p.length === 2 && !p.some(isNaN)).map(([u, n]) => ({ upTo: u, n })).sort((x, y) => x.upTo - y.upTo),
    divLimits: { A: Number(v('cA').replace(',', '.')), B: Number(v('cB').replace(',', '.')) },
    groups: v('cGroups').split(',').map(s => s.trim()).filter(Boolean),
    classGroups: [...document.querySelectorAll('.cCls:checked')].map(x => x.value),
  };
}
function openChampForm(id) {
  const c = id ? S.champs[id] : Object.assign({ name: '', season: '', clubId: '', dateFrom: today(), dateTo: '' }, clone(DEFAULT_RULES));
  dialog(id ? 'Definições do campeonato' : 'Novo campeonato', `<div class="grid-f">${field('cName', 'Nome', c.name)}${field('cSeason', 'Época', c.season, 'placeholder="2026/27"')}${sel('cClub', 'Clube organizador', c.clubId, clubOpts())}
    ${field('cFrom', 'Data de início', c.dateFrom || '', 'type="date"')}${field('cTo', 'Data de fim', c.dateTo || '', 'type="date"')}
    ${rulesFields(c)}
    <div class="row spread">${delBtn('champDel', id, 'Apagar campeonato')}<button class="btn pri" data-a="champSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openEventForm(id, champId) {
  champId = champId || ctxId();
  const e = id ? S.events[id] : { name: '', champ: champId || '', clubId: champId && S.champs[champId] ? S.champs[champId].clubId : '', dateFrom: (S.champs[champId] || {}).dateFrom || today(), dateTo: (S.champs[champId] || {}).dateTo || (S.champs[champId] || {}).dateFrom || today(), venue: '', entries: [] };
  const champOpts = Object.entries(S.champs).map(([k, c]) => [k, c.name]);
  dialog(id ? 'Editar prova' : 'Nova prova', `<div class="grid-f">${field('eName', 'Nome da prova', e.name)}${sel('eChamp', 'Campeonato', e.champ || '', champOpts)}
    ${field('eFrom', 'Data de início', e.dateFrom, 'type="date"')}${field('eTo', 'Data de fim', e.dateTo, 'type="date"')}
    ${sel('eClub', 'Clube organizador', e.clubId, clubOpts())}${field('eVenue', 'Local', e.venue, 'placeholder="ex.: Ria Formosa"')}</div>
    <div class="small muted">Descartes e divisões seguem as definições do campeonato.</div>
    <div class="row spread">${delBtn('eventDel', id, 'Apagar prova')}<button class="btn pri" data-a="eventSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openRaceForm(id, eventId) {
  const r = id ? S.races[id] : { event: eventId, date: (S.events[eventId] || {}).dateFrom || today(), start: '', system: 'ToT_CL', status: 'provisoria', finishes: [] };
  const evOpts = Object.entries(S.events).sort((a, b) => (b[1].dateFrom || '').localeCompare(a[1].dateFrom || '')).map(([k, e]) => [k, e.name + (e.champ && S.champs[e.champ] ? ' · ' + S.champs[e.champ].name : '')]);
  dialog(id ? 'Dados da regata' : 'Nova regata', `<div class="grid-f">
    ${field('rName', 'Nome da regata', r.name, 'placeholder="ex.: Regata 1"')}${sel('rEvent', 'Prova', r.event, evOpts)}
    ${field('rDate', 'Data', r.date, 'type="date"')}${field('rStart', 'Hora da largada', r.start, 'placeholder="hh:mm:ss"')}
    ${sel('rSys', 'Sistema de pontuação', r.system, Object.entries(E.SYSTEMS))}${field('rDist', 'Distância do percurso (NM, para ToD)', r.distance || '', 'inputmode="decimal"')}
    ${field('rLim', 'Hora limite de chegada', r.timeLimit || '', 'placeholder="hh:mm:ss"')}${sel('rStatus', 'Estado', r.status || 'provisoria', [['provisoria', 'Provisória'], ['final', 'Final']])}</div>
    <div class="row spread">${delBtn('raceDel', id, 'Apagar regata')}<button class="btn pri" data-a="raceSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openEntriesForm(eid) {
  const e = S.events[eid];
  S.edit = { kind: 'entries', id: eid, set: new Set(e.entries || []), init: new Set(e.entries || []) };
  drawEntries();
}
function drawEntries() {
  const ed = S.edit, q = norm(ed.q || '');
  const raced = new Set(eventRaces(ed.id).flatMap(r => (r.finishes || []).map(f => f.boatId)));
  const list = Object.entries(S.boats).filter(([, b]) => !q || norm(b.name + b.sail + b.type + skipperName(b.skipperId)).includes(q)).sort((a, b) => (ed.init.has(b[0]) - ed.init.has(a[0])) || byName(a, b));
  const others = champEvents(S.events[ed.id].champ).filter(([eid, e]) => eid !== ed.id && (e.entries || []).length);
  const rows = list.map(([id, b]) => `<label class="item" style="cursor:pointer"><input type="checkbox" class="entChk" value="${esc(id)}" ${ed.set.has(id) ? 'checked' : ''} ${raced.has(id) && ed.set.has(id) ? 'disabled title="Tem resultados nesta prova"' : ''}><div class="grow"><div class="title">${esc(b.name)}</div><div class="meta">${esc(boatSub(b))}${b.skipperId ? ' · ' + esc(skipperName(b.skipperId)) : ''}${raced.has(id) ? ' · com resultados' : ''}</div></div></label>`).join('');
  dialog('Inscrições · ' + S.events[ed.id].name, `<div class="row spread"><span class="small muted">${ed.set.size} inscritos</span><button class="btn sm" data-a="newBoat" data-e="${esc(ed.id)}">+ Novo barco</button></div>
    <div class="small muted">Só os barcos marcados entram nesta prova (classificações, chegadas e leitura da folha).</div>
    ${others.length ? `<div class="row"><select id="entCopy" style="flex:1;padding:7px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">${others.map(([eid, e]) => `<option value="${esc(eid)}">${esc(e.name)} (${e.entries.length})</option>`).join('')}</select><button class="btn sm" data-a="entCopy">Copiar inscritos</button></div>` : ''}
    <input id="entQ" value="${esc(ed.q || '')}" placeholder="Procurar barco na base de dados" style="padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">
    <div class="list">${rows || '<div class="small muted">Nenhum barco.</div>'}</div>
    <div class="row spread"><button class="btn" data-a="finCancel">Cancelar</button><button class="btn pri" data-a="entriesSave">Gravar inscrições</button></div>`);
  $('#dlgB').onchange = ev => { if (ev.target.classList.contains('entChk')) { ev.target.checked ? ed.set.add(ev.target.value) : ed.set.delete(ev.target.value); } };
  $('#dlgB').oninput = ev => { if (ev.target.id === 'entQ') { ed.q = ev.target.value; const pos = ev.target.selectionStart; drawEntries(); const i = $('#entQ'); i.focus(); i.setSelectionRange(pos, pos); } };
}
function findSkipper(name) { const n = norm(name); return n ? (Object.entries(S.skippers).find(([, x]) => norm(x.name) === n) || [null])[0] : null; }
function openBoatForm(id, enterEvent) {
  const b = id ? S.boats[id] : { name: '', certs: [], clubId: '', skipperId: '' };
  const isNew = !id, needCert = isNew || (!b.classRef && !(b.certs || []).length);
  dialog(id ? 'Editar barco' : 'Novo barco', `<div class="grid-f">${field('bName', 'Nome', b.name)}${field('bSail', 'Número de vela', b.sail, 'placeholder="ex.: POR 1234"')}${field('bType', 'Tipo / modelo', b.type, 'placeholder="ex.: First 31.7"')}
    ${sel('bClub', 'Clube do barco', b.clubId, clubOpts())}
    ${field('bSkipName', 'Skipper (escreva o nome)', skipperName(b.skipperId), 'list="skList" autocomplete="off"')}<datalist id="skList">${Object.values(S.skippers).sort((x, y) => x.name.localeCompare(y.name)).map(x => `<option value="${esc(x.name)}">${esc(clubShort(x.clubId))}</option>`).join('')}</datalist></div>
    <div class="small muted" id="skHint"></div>
    <div class="grid-f" id="newSk" hidden>${field('skLic', 'Nº licença desportiva do novo skipper (opcional)', '')}${sel('skClub', 'Clube do skipper', b.clubId, clubOpts())}</div>
    ${needCert ? '<div class="card" style="padding:10px"><h3>Certificado</h3><div class="small muted">Procura automática na base ORC (certificados ativos) pelo nome, vela e modelo.</div><div id="certPick" class="list"></div></div>' : ''}
    <details><summary class="small">Mais opções</summary><div class="grid-f" style="margin-top:8px">${field('bAka', 'Outros nomes (separados por vírgula)', (b.aka || []).join(', '))}
    ${sel('bDiv', 'Divisão', b.div || '', [['', 'Automática (CDL)'], 'A', 'B', 'C', 'SB'])}${sel('bCls', 'Monotipia (rating da classe)', b.classRef || '', [['', '— não —']].concat(Object.entries(S.classes).map(([k, c]) => [k, c.name])))}
    <label class="f" for="bNote" style="flex-basis:100%">Notas<textarea id="bNote" rows="2">${esc(b.note || '')}</textarea></label></div></details>
    <div class="row spread">${delBtn('boatDel', id, 'Apagar barco')}<button class="btn pri" data-a="boatSave" data-id="${esc(id || '')}" data-e="${esc(enterEvent || '')}">Gravar</button></div>`);
  const skHint = () => {
    const nm = v('bSkipName'), sid = findSkipper(nm);
    $('#newSk').hidden = !nm || !!sid;
    $('#skHint').textContent = !nm ? '' : sid ? `Skipper existente: ${S.skippers[sid].name}${S.skippers[sid].clubId ? ' (' + clubShort(S.skippers[sid].clubId) + ')' : ''}${S.skippers[sid].license ? ' · licença ' + S.skippers[sid].license : ''}` : 'Skipper novo: será criado ao gravar.';
  };
  $('#bSkipName').oninput = skHint; skHint();
  if (!needCert) return;
  let timer = null, touched = false;
  const draw = () => {
    const box = $('#certPick'); if (!box) return;
    const prev = touched ? (document.querySelector('input[name=certPick]:checked') || {}).value : null;
    const { own, model } = certMatches(v('bName'), v('bSail'), v('bType'));
    const opt = (r, k, label) => `<label class="item" style="cursor:pointer"><input type="radio" name="certPick" value="${k}:${esc(r[10])}"><div class="grow">${catLine(r)}</div><span class="chip ${k === 'orc' ? 'k-orc' : 'k-copiado'}">${label}</span></label>`;
    box.innerHTML = (own.length ? `<div class="small"><b>Certificado próprio encontrado</b></div>${own.map(r => opt(r, 'orc', 'próprio')).join('')}` : (v('bName').length >= 3 || v('bSail').length >= 3 ? '<div class="small muted">Sem certificado ativo com este nome ou vela (pode ser de anos anteriores: Sailor Services).</div>' : ''))
      + (model.length ? `<div class="small" style="margin-top:6px"><b>Mesmo modelo</b> — copiar como referência</div>${model.map(r => opt(r, 'copiado', 'copiar')).join('')}` : '')
      + `<label class="item" style="cursor:pointer"><input type="radio" name="certPick" value="none"><div class="grow"><div class="title">Sem certificado por agora</div><div class="meta">Adicione depois na página do barco (manual ou Sailor Services).</div></div></label>`;
    const want = prev && box.querySelector(`input[value="${CSS.escape(prev)}"]`) ? prev : own.length ? `orc:${own[0][10]}` : 'none';
    const el = box.querySelector(`input[value="${CSS.escape(want)}"]`); if (el) el.checked = true;
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(draw, 250); };
  ['bName', 'bSail', 'bType'].forEach(k => { $('#' + k).addEventListener('input', later); });
  $('#certPick').addEventListener('change', () => { touched = true; });
  $('#certPick').innerHTML = '<div class="small muted">A carregar a base ORC…</div>';
  loadCatalog().then(draw);
}
function openSkipperForm(id) {
  const s = id ? S.skippers[id] : { name: '', clubId: '', license: '' };
  dialog(id ? 'Editar skipper' : 'Novo skipper', `<div class="grid-f">${field('sName', 'Nome', s.name)}${sel('sClub', 'Clube', s.clubId, clubOpts())}${field('sLic', 'Nº licença desportiva (opcional)', s.license)}</div>
    <div class="row spread">${delBtn('skipperDel', id, 'Apagar skipper')}<button class="btn pri" data-a="skipperSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}
function openClubForm(id) {
  const c = id ? S.clubs[id] : { name: '', short: '' };
  dialog(id ? 'Editar clube' : 'Novo clube', `<div class="grid-f">${field('clName', 'Nome completo', c.name, 'placeholder="ex.: Clube Naval de Tavira"')}${field('clShort', 'Sigla', c.short, 'placeholder="ex.: CNTavira"')}</div>
    <div class="row spread">${delBtn('clubDel', id, 'Apagar clube')}<button class="btn pri" data-a="clubSave" data-id="${esc(id || '')}">Gravar</button></div>`);
}

/* ---------- certificados ---------- */
function openCertForm(boatId, tab) {
  tab = tab || 'orc';
  const tabs = [['orc', 'Pesquisar ORC'], ['manual', 'Manual'], ['deriv', 'Derivado']];
  let body = '';
  if (tab === 'orc') body = `<div class="info small">Certificados ORC ativos de todos os países (base de dados ORC, atualizada a ${esc(S.catalog ? S.catalog.built : '…')}). Para anos anteriores use o Sailor Services e introduza à mão.</div>
     <input id="catQ" placeholder="Nome, número de vela ou modelo (ex.: Hanse 400)" style="padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">
     ${field('cFrom', 'Válido a partir de (vazio = 1 de janeiro do ano do certificado)', '', 'type="date"')}<div id="catRes" class="list"></div>`;
  else if (tab === 'manual') body = `<div class="grid-f">${field('mFrom', 'Válido a partir de', today(), 'type="date"')}${sel('mKind', 'Tipo', 'manual', [['orc', 'Certificado ORC próprio'], ['teste', 'Certificado de teste'], ['copiado', 'Copiado de barco semelhante'], ['manual', 'Atribuído manualmente']])}
     ${field('mCL', 'ToT costeiro', '', 'inputmode="decimal"')}${field('mWL', 'ToT barl./sotav.', '', 'inputmode="decimal"')}${field('mTodCL', 'ToD costeiro (s/NM)', '', 'inputmode="decimal"')}${field('mTodWL', 'ToD barl./sotav. (s/NM)', '', 'inputmode="decimal"')}
     ${field('mGPH', 'GPH (s/NM)', '', 'inputmode="decimal"')}${field('mCDL', 'CDL', '', 'inputmode="decimal"')}${field('mSrc', 'Origem (barco, país, ano)', '')}</div>
     <div class="small muted">Se só tiver o ToD, a app calcula o ToT = 600 ÷ ToD. Em certificados até 2019 o ToT barl./sotav. impresso usa 675 ÷ ToD: introduza o ToD para converter para a escala atual.</div>
     <button class="btn pri" data-a="certManual" data-b="${esc(boatId)}">Adicionar certificado</button>`;
  else {
    const refs = Object.entries(S.boats).filter(([k]) => k !== boatId).sort(byName);
    body = `<div class="small muted">Aplica um fator a todos os valores do certificado de um barco de referência (fator = ToT costeiro pretendido ÷ ToT costeiro da referência). Ex.: Titã a partir do Cidade de Faro.</div>
     <div class="grid-f">${sel('dRef', 'Barco de referência', '', refs.map(([k, b]) => [k, b.name]))}${field('dTarget', 'ToT costeiro pretendido', '', 'inputmode="decimal"')}${field('dFrom', 'Válido a partir de', today(), 'type="date"')}</div>
     <button class="btn pri" data-a="certDeriv" data-b="${esc(boatId)}">Calcular e adicionar</button>`;
  }
  dialog('Novo certificado · ' + S.boats[boatId].name, `<div class="tabs">${tabs.map(([k, t]) => `<button data-a="certTab" data-b="${esc(boatId)}" data-k="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`);
  if (tab === 'orc') loadCatalog().then(() => { const q = $('#catQ'); if (!q) return; q.value = S.boats[boatId].name; q.oninput = () => catSearch(boatId); catSearch(boatId); q.focus(); });
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
  const b = S.boats[boatId] || {}, refs = new Set(hits.map(r => r[10]));
  const model = certMatches('', '', b.type).model.filter(r => !refs.has(r[10]));
  const line = r => `<div class="item"><div class="grow">${catLine(r)}</div>
    <div class="row" style="flex-direction:column;align-items:stretch"><button class="btn sm pri" data-a="catUse" data-b="${esc(boatId)}" data-ref="${esc(r[10])}" data-k="orc">Próprio</button><button class="btn sm" data-a="catUse" data-b="${esc(boatId)}" data-ref="${esc(r[10])}" data-k="copiado">Copiar</button></div></div>`;
  out.innerHTML = (hits.map(line).join('') || '<div class="small muted">Nenhum certificado ativo com este nome ou vela. Veja os barcos do mesmo modelo abaixo, ou procure no Sailor Services (anos anteriores) e use o separador Manual.</div>')
    + (model.length ? `<h3 style="margin-top:8px">Mesmo modelo (${esc(b.type)}) — para copiar</h3>${model.map(line).join('')}` : '');
}
/* Correspondências na base ORC (certificados ativos, sobretudo 2026):
   own = mesmo nome ou número de vela; model = mesmo modelo (para copiar). */
const digits = x => String(x || '').replace(/\D/g, '');
function certMatches(name, sail, type) {
  const rows = (S.catalog && S.catalog.rows) || [];
  const n = norm(name), sl = norm(sail), sd = digits(sail), ty = norm(type);
  const rank = (a, b) => ((b[3] === 'POR') - (a[3] === 'POR')) || String(b[5]).localeCompare(String(a[5]));
  const sailHit = r => sl.length >= 3 && (norm(r[1]) === sl || (sd.length >= 3 && digits(r[1]) === sd && (!/[A-Z]/.test(sl.replace(/\d/g, '')) || norm(r[1]).startsWith(sl.replace(/\d.*/, '')))));
  const own = rows.filter(r => (n.length >= 3 && norm(r[0]) === n) || sailHit(r)).sort(rank).slice(0, 10);
  const ownRefs = new Set(own.map(r => r[10]));
  const model = ty.length >= 3 ? rows.filter(r => !ownRefs.has(r[10]) && norm(r[2]) && (norm(r[2]) === ty || norm(r[2]).includes(ty) || ty.includes(norm(r[2])))).sort(rank).slice(0, 15) : [];
  return { own, model };
}
function catCert(r, kind, from) {
  const c = { from: from || String(r[5]).slice(0, 4) + '-01-01', kind, ToT_CL: r[7], ToT_WL: r[8], CDL: r[6], ref: r[10], src: (kind === 'copiado' ? 'copiado de ' : '') + `${r[0]} ${r[1]} ${r[3]} ${String(r[5]).slice(0, 4)} ${r[4] === 'I' ? 'ORCi' : 'Club'} (${r[2]})` };
  if (r[11]) c.GPH = r[11];
  return c;
}
function catLine(r) {
  return `<div class="title">${esc(r[0])} <span class="chip">${esc(r[3])}</span> <span class="chip">${r[4] === 'I' ? 'ORCi' : 'Club'}</span>${r[9] ? ' <span class="chip div-SB">SB</span>' : ''}</div>
    <div class="meta">${esc(r[1])} · ${esc(r[2])} · emitido ${dPT(r[5])}</div><div class="meta num">ToT cost. ${fmt4(r[7])} · b/s ${fmt4(r[8])} · GPH ${fmt1(r[11])} · CDL ${r[6]}</div>`;
}
async function addCert(boatId, cert) {
  const b = clone(S.boats[boatId]);
  b.certs = (b.certs || []).concat([cert]);
  if (await save('boats', boatId, b)) { toast('Certificado adicionado.'); closeDlg(); }
}

/* ---------- leitura da folha com o Claude ---------- */
async function readSheet(raceId) {
  const race = S.races[raceId], ev = S.events[race.event] || {};
  if (!SAMPLE) { toast('A leitura com o Claude não está disponível nesta vista.'); return; }
  if (!(ev.entries || []).length) { toast('Inscreva primeiro os barcos nesta prova.'); return; }
  const pid = (race.photos || []).slice(-1)[0];
  dialog('Ler folha com o Claude', '<div class="info">A ler a fotografia… pode demorar alguns segundos.</div>');
  try {
    const blob = await fetch('/_blob/' + pid).then(r => r.blob());
    const ids = ev.entries || [];
    const fleet = ids.filter(id => S.boats[id]).map(id => { const b = S.boats[id]; return `${id} | ${b.name} | ${(b.aka || []).join('/')} | ${b.sail || ''} | ${b.type || ''} | ${skipperName(b.skipperId)}`; }).join('\n');
    const prompt = `És secretário de regata. Lê a folha de chegadas manuscrita da fotografia (regata "${race.name}", largada ${race.start}).
Devolve APENAS JSON com esta forma: {"start":"hh:mm:ss ou null","finishes":[{"read":"nome como está escrito","boatId":"id da lista ou null","finish":"hh:mm:ss ou null","code":"FIN|DNF|DNS|RET|OCS|BFD|UFD|DSQ"}],"notes":"observações curtas em português"}
Regras: ordem = ordem de chegada. Os nomes podem estar escritos meia linha acima ou abaixo da hora: emparelha pela ordem. Usa a hora de chegada, não o tempo de regata. Barcos na zona de "desclassificados"/siglas recebem a sigla (code) e finish null. Ignora listas de verificação ao lado. Se a hora tiver só minutos e segundos, completa com a hora da linha anterior. A folha pode identificar o barco pelo nome, número de vela ou skipper.
Barcos inscritos (id | nome | outros nomes | vela | tipo | skipper):
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
function ctxSeries(groupKey) {
  const cid = ctxId(), c = S.champs[cid], rs = champRaces(cid);
  return { rs, rules: c, st: E.seriesStandings(rs, dbState(), { champ: c, filter: groupFilter(groupKey, c), boats: champEntries(cid) }) };
}
function ctxName() { return S.champs[ctxId()].name; }
function standingsText(st, races, title) {
  let t = title + '\n' + '#  Barco'.padEnd(22) + 'Líq  Tot  ' + races.map((r, i) => 'R' + (i + 1)).join(' ') + '\n';
  st.table.forEach(r => { t += String(r.rank).padEnd(3) + r.name.padEnd(19) + ptsF(r.net).padStart(4) + ptsF(r.total).padStart(5) + '  ' + r.cells.map(c => (c.disc ? '(' : '') + (c.code ? c.code + ' ' : '') + ptsF(c.pts) + (c.disc ? ')' : '')).join(' ') + '\n'; });
  return t;
}
function standingsHTML() {
  const rules = ctxRules();
  const blocks = groupsOf(rules).map(g => { const { st, rs } = ctxSeries(g.k); return st.table.length ? `<h2>${esc(g.t)}</h2>${standingsTable(st, rs, rules).replace(/<a [^>]*>|<\/a>/g, '')}<p>DNC = ${st.dnc} · ${st.nDiscards} descarte(s)</p>` : ''; }).join('');
  const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
  const n = ctxSeries('GERAL').rs.length;
  return `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(ctxName())}</title><style>${css} body{padding:16px} .sticky{position:static}</style></head><body><h1>${esc(ctxName())}</h1><p>${n} regatas · gerado ${dPT(today())}</p>${blocks}</body></html>`;
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch (_) { dialog('Copiar', `<textarea rows="14" style="width:100%;font-family:monospace;font-size:12px">${esc(text)}</textarea>`); } }

/* ---------- ações ---------- */
function enrollBtn(id, n) {
  return n ? `<button class="btn sm" data-a="enroll" data-id="${esc(id)}" title="Alterar provas">Inscrito (${n})</button>` : `<button class="btn sm pri" data-a="enroll" data-id="${esc(id)}">Inscrever</button>`;
}
function openEnroll(boatId) {
  const cid = ctxId(), evs = champEvents(cid);
  const raced = eid => eventRaces(eid).some(r => (r.finishes || []).some(f => f.boatId === boatId));
  dialog('Inscrever · ' + S.boats[boatId].name, `<div class="small muted">Provas de ${esc(S.champs[cid].name)} em que o barco fica inscrito:</div>
    <div class="list">${evs.map(([eid, e]) => `<label class="item" style="cursor:pointer"><input type="checkbox" class="enrChk" value="${esc(eid)}" ${(e.entries || []).includes(boatId) ? 'checked' : ''} ${raced(eid) ? 'disabled title="Tem resultados nesta prova"' : ''}><div class="grow"><div class="title">${esc(e.name)}</div><div class="meta">${evDates(e)} · ${(e.entries || []).length} inscritos${raced(eid) ? ' · com resultados' : ''}</div></div></label>`).join('')}</div>
    <div class="row spread"><button class="btn" data-a="finCancel">Cancelar</button><button class="btn pri" data-a="enrollSave" data-id="${esc(boatId)}">Gravar</button></div>`);
}
async function setEntry(eid, boatId, on) {
  const ev = clone(S.events[eid]), has = (ev.entries || []).includes(boatId);
  if (on === has) return true;
  ev.entries = on ? [...(ev.entries || []), boatId].sort() : ev.entries.filter(b => b !== boatId);
  return save('events', eid, ev);
}
async function onClick(e) {
  const t = e.target.closest('[data-a]'); if (!t) return;
  if (t.closest('a[href]')) e.preventDefault();
  const a = t.dataset.a, id = t.dataset.id;
  const confirmOnce = (label) => { if (t.dataset.confirm === '1') return true; t.dataset.confirm = '1'; t.textContent = label || 'Confirmar: apagar de vez'; return false; };
  if (a === 'grp') { S.group = t.dataset.k; render(); }
  else if (a === 'rgrp') { S.raceGroup = t.dataset.k; render(); }
  else if (a === 'egrp') { S.evGroup = t.dataset.k; render(); }
  else if (a === 'fleetTab') { S.fleetTab = t.dataset.k; render(); }
  else if (a === 'fleetGo') { S.fleetTab = 'champ'; location.hash = 'frota'; render(); }
  else if (a === 'fleetEv') { S.fleetEv = t.dataset.k; render(); }
  else if (a === 'newChamp') openChampForm(null);
  else if (a === 'editChamp') openChampForm(id);
  else if (a === 'newEvent') openEventForm(null, t.dataset.c || null);
  else if (a === 'editEvent') openEventForm(id);
  else if (a === 'entries') { const eid = id || await ensureEvent(t.dataset.c); if (eid) openEntriesForm(eid); }
  else if (a === 'newRace') { const eid = t.dataset.e || await ensureEvent(t.dataset.c); if (eid) openRaceForm(null, eid); }
  else if (a === 'editRace') openRaceForm(id);
  else if (a === 'newBoat') openBoatForm(null, t.dataset.e || (t.dataset.c ? await ensureEvent(t.dataset.c) : '') || '');
  else if (a === 'editBoat') openBoatForm(id);
  else if (a === 'newSkipper') openSkipperForm(null);
  else if (a === 'editSkipper') openSkipperForm(id);
  else if (a === 'newClub') openClubForm(null);
  else if (a === 'editClub') openClubForm(id);
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
    const r = clone(S.races[S.edit.id]); r.finishes = rows;
    if (await save('races', S.edit.id, r)) { toast('Chegadas gravadas.'); closeDlg(); }
  }
  else if (a === 'enroll') {
    const evs = champEvents(ctxId());
    if (evs.length <= 1 && !(evs.length && (evs[0][1].entries || []).includes(id))) {
      const eid = await ensureEvent(ctxId());
      if (eid && await setEntry(eid, id, true)) { toast(S.boats[id].name + ' inscrito em ' + S.champs[ctxId()].name + '.'); render(); }
      return;
    }
    openEnroll(id);
  }
  else if (a === 'unenroll') {
    const evs = champEvents(ctxId()).filter(([, e]) => (e.entries || []).includes(id));
    const raced = eid => eventRaces(eid).some(r => (r.finishes || []).some(f => f.boatId === id));
    if (evs.length !== 1) { openEnroll(id); return; }
    if (raced(evs[0][0])) { toast('Este barco tem resultados nesta prova: não pode ser retirado.'); return; }
    if (!confirmOnce('retirar?')) return;
    if (await setEntry(evs[0][0], id, false)) { toast(S.boats[id].name + ' retirado (continua na base de dados).'); render(); }
  }
  else if (a === 'enrollSave') {
    let ok = true;
    for (const el of document.querySelectorAll('.enrChk:not(:disabled)')) ok = (await setEntry(el.value, id, el.checked)) && ok;
    if (ok) { toast('Inscrições gravadas.'); closeDlg(); }
  }
  else if (a === 'entCopy') {
    const src = S.events[v('entCopy')]; if (!src) return;
    let n = 0; (src.entries || []).forEach(b => { if (S.boats[b] && !S.edit.set.has(b)) { S.edit.set.add(b); n++; } });
    S.edit.init = new Set(S.edit.set); toast(n + ' barco(s) adicionados.'); drawEntries();
  }
  else if (a === 'impConfirm') confirmImport();
  else if (a === 'entryDel') {
    if (!confirmOnce('retirar?')) return;
    if (await setEntry(t.dataset.e, id, false)) { toast(S.boats[id].name + ' retirado da prova (continua na base de dados).'); render(); }
  }
  else if (a === 'entryDelAll') {
    const eid = t.dataset.e, raced = new Set(eventRaces(eid).flatMap(r => (r.finishes || []).map(f => f.boatId)));
    const keep = (S.events[eid].entries || []).filter(b => raced.has(b));
    if (!confirmOnce(`Confirmar: retirar ${(S.events[eid].entries || []).length - keep.length}`)) return;
    const ev = clone(S.events[eid]); ev.entries = keep;
    if (await save('events', eid, ev)) { toast(keep.length ? `Inscrições retiradas; ${keep.length} com resultados mantidos.` : 'Todas as inscrições retiradas.'); render(); }
  }
  else if (a === 'entriesSave') {
    const ev = clone(S.events[S.edit.id]); ev.entries = [...S.edit.set].filter(b => S.boats[b]).sort();
    if (await save('events', S.edit.id, ev)) { toast('Inscrições gravadas.'); closeDlg(); }
  }
  else if (a === 'champSave') {
    const c = Object.assign(id ? clone(S.champs[id]) : {}, { name: v('cName'), season: v('cSeason'), clubId: v('cClub'), dateFrom: v('cFrom'), dateTo: v('cTo') || v('cFrom') }, readRules());
    if (!c.name) { toast('O campeonato precisa de nome.'); return; }
    if (!c.dateFrom) { toast('Indique a data de início do campeonato.'); return; }
    if (c.dateTo < c.dateFrom) { toast('A data de fim é anterior à de início.'); return; }
    const cid = id || uniqueId('champs', slug(c.name + ' ' + c.season));
    if (!await save('champs', cid, c)) return;
    S.ctx = 'c:' + cid; try { localStorage.setItem('ctx', S.ctx); } catch (_) {}
    closeDlg(); pickCtx(); if (id) render(); else location.hash = 'regatas';
  }
  else if (a === 'champDel') {
    if (champEvents(id).length) { toast('O campeonato tem provas: mova-as ou apague-as primeiro.'); return; }
    if (!confirmOnce()) return;
    if (await del('champs', id)) { S.ctx = null; closeDlg(); pickCtx(); render(); }
  }
  else if (a === 'eventSave') {
    if (!v('eName') || !v('eFrom')) { toast('Preencha o nome e a data de início.'); return; }
    const ev = Object.assign(id ? clone(S.events[id]) : { entries: [] }, { name: v('eName'), champ: v('eChamp'), dateFrom: v('eFrom'), dateTo: v('eTo') || v('eFrom'), clubId: v('eClub'), venue: v('eVenue') });
    if (ev.dateTo < ev.dateFrom) { toast('A data de fim é anterior à de início.'); return; }
    if (!ev.champ || !S.champs[ev.champ]) { toast('Escolha o campeonato.'); return; }
    ['discards', 'divLimits', 'groups', 'classGroups'].forEach(k => delete ev[k]);
    const eid = id || uniqueId('events', slug(ev.name + ' ' + ev.dateFrom.slice(0, 4)));
    if (await save('events', eid, ev)) { S.ctx = 'c:' + ev.champ; try { localStorage.setItem('ctx', S.ctx); } catch (_) {} closeDlg(); pickCtx(); location.hash = 'prova-' + eid; }
  }
  else if (a === 'eventDel') {
    if (eventRaces(id).length) { toast('A prova tem regatas: apague-as primeiro.'); return; }
    if (!confirmOnce()) return;
    if (await del('events', id)) { closeDlg(); pickCtx(); location.hash = 'regatas'; }
  }
  else if (a === 'raceSave') {
    if (!v('rName') || !v('rDate') || !v('rEvent') || E.secs(v('rStart')) == null) { toast('Preencha nome, prova, data e hora de largada.'); return; }
    if (v('rSys').startsWith('ToD') && !v('rDist')) { toast('Para ToD indique a distância do percurso.'); return; }
    const base = id ? clone(S.races[id]) : { finishes: [] };
    Object.assign(base, { name: v('rName'), event: v('rEvent'), date: v('rDate'), start: v('rStart').replace(/[.,h]/g, ':'), system: v('rSys'), distance: v('rDist') ? Number(v('rDist').replace(',', '.')) : null, timeLimit: v('rLim').replace(/[.,h]/g, ':'), status: v('rStatus') });
    const rid = id || uniqueId('races', slug(v('rEvent') + '-' + v('rName')));
    if (await save('races', rid, base)) {
      const ev = S.events[base.event];
      if (ev && (base.date < ev.dateFrom || base.date > ev.dateTo)) { const e2 = clone(ev); if (base.date < e2.dateFrom) e2.dateFrom = base.date; if (base.date > e2.dateTo) e2.dateTo = base.date; await save('events', base.event, e2); }
      closeDlg(); location.hash = 'race-' + rid;
    }
  }
  else if (a === 'raceDel') { if (!confirmOnce()) return; const eid = S.races[id].event, multi = champEvents((S.events[eid] || {}).champ).length > 1; if (await del('races', id)) { closeDlg(); location.hash = multi ? 'prova-' + eid : 'regatas'; } }
  else if (a === 'boatSave') {
    if (!v('bName')) { toast('O barco precisa de nome.'); return; }
    const skName = v('bSkipName');
    let skipperId = findSkipper(skName) || '';
    if (skName && !skipperId) {
      skipperId = uniqueId('skippers', slug(skName));
      if (!await save('skippers', skipperId, { name: skName, license: v('skLic'), clubId: v('skClub') || v('bClub') })) return;
    }
    const pick = (document.querySelector('input[name=certPick]:checked') || {}).value || 'none';
    const b = id ? clone(S.boats[id]) : { certs: [] };
    Object.assign(b, { name: v('bName').toUpperCase(), sail: v('bSail'), type: v('bType'), clubId: v('bClub'), skipperId, aka: v('bAka') ? v('bAka').split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [], div: v('bDiv'), note: $('#bNote').value.trim() });
    if (v('bCls')) b.classRef = v('bCls'); else delete b.classRef;
    if (pick !== 'none' && !b.classRef) {
      const [kind, ref] = [pick.slice(0, pick.indexOf(':')), pick.slice(pick.indexOf(':') + 1)];
      const r = S.catalog && S.catalog.rows.find(x => x[10] === ref);
      if (r) b.certs = (b.certs || []).concat([catCert(r, kind)]);
    }
    const bid = id || slug(v('bName'));
    if (!id && S.boats[bid]) { toast('Já existe um barco com esse nome.'); return; }
    if (!await save('boats', bid, b)) return;
    const enter = t.dataset.e;
    if (!id && enter && S.events[enter]) { const ev = clone(S.events[enter]); ev.entries = [...new Set((ev.entries || []).concat([bid]))].sort(); await save('events', enter, ev); toast('Barco criado e inscrito.'); closeDlg(); S.fleetTab = 'champ'; location.hash = 'frota'; render(); return; }
    closeDlg(); location.hash = 'boat-' + bid;
  }
  else if (a === 'boatDel') {
    if (Object.values(S.races).some(r => (r.finishes || []).some(f => f.boatId === id))) { toast('Este barco tem regatas: não pode ser apagado.'); return; }
    if (Object.values(S.events).some(e => (e.entries || []).includes(id))) { toast('Este barco está inscrito em provas: retire as inscrições primeiro.'); return; }
    if (!confirmOnce()) return;
    if (await del('boats', id)) { closeDlg(); location.hash = 'frota'; }
  }
  else if (a === 'skipperSave') {
    if (!v('sName')) { toast('O skipper precisa de nome.'); return; }
    const s = Object.assign(id ? clone(S.skippers[id]) : {}, { name: v('sName'), clubId: v('sClub'), license: v('sLic') });
    if (await save('skippers', id || uniqueId('skippers', slug(s.name)), s)) closeDlg();
  }
  else if (a === 'skipperDel') {
    if (Object.values(S.boats).some(b => b.skipperId === id)) { toast('Este skipper está associado a barcos.'); return; }
    if (!confirmOnce()) return;
    if (await del('skippers', id)) closeDlg();
  }
  else if (a === 'clubSave') {
    if (!v('clName')) { toast('O clube precisa de nome.'); return; }
    const c = { name: v('clName'), short: v('clShort') };
    if (await save('clubs', id || uniqueId('clubs', slug(c.short || c.name)), c)) { closeDlg(); pickCtx(); }
  }
  else if (a === 'clubDel') {
    const used = Object.values(S.boats).some(b => b.clubId === id) || Object.values(S.skippers).some(s => s.clubId === id) || Object.values(S.events).some(e => e.clubId === id) || Object.values(S.champs).some(c => c.clubId === id);
    if (used) { toast('Este clube está em uso.'); return; }
    if (!confirmOnce()) return;
    if (await del('clubs', id)) closeDlg();
  }
  else if (a === 'certDel') {
    if (!confirmOnce('apagar?')) return;
    const b = clone(S.boats[t.dataset.b]); b.certs.splice(+t.dataset.i, 1); await save('boats', t.dataset.b, b);
  }
  else if (a === 'catUse') {
    const r = S.catalog.rows.find(x => x[10] === t.dataset.ref); if (!r) return;
    addCert(t.dataset.b, catCert(r, t.dataset.k, v('cFrom')));
  }
  else if (a === 'certManual') {
    const n = x => x ? Number(x.replace(',', '.')) : null;
    let CL = n(v('mCL')), WL = n(v('mWL')); const tCL = n(v('mTodCL')), tWL = n(v('mTodWL')), gph = n(v('mGPH'));
    if (!CL && tCL) CL = Math.round(600 / tCL * 1e4) / 1e4; if (tWL) WL = Math.round(600 / tWL * 1e4) / 1e4;
    if (!CL && !WL && !gph) { toast('Indique pelo menos um ToT, ToD ou GPH.'); return; }
    const c = { from: v('mFrom'), kind: v('mKind'), src: v('mSrc') || v('mKind') }; if (CL) c.ToT_CL = CL; if (WL) c.ToT_WL = WL; if (tCL) c.ToD_CL = tCL; if (tWL) c.ToD_WL = tWL; if (gph) c.GPH = gph; if (n(v('mCDL'))) c.CDL = n(v('mCDL'));
    addCert(t.dataset.b, c);
  }
  else if (a === 'certDeriv') {
    const ref = S.boats[v('dRef')], target = Number(v('dTarget').replace(',', '.')), from = v('dFrom');
    const rc = ref && E.certAt(ref, from, dbState(), 'ToT_CL');
    if (!rc || !target) { toast('Escolha a referência e o ToT pretendido.'); return; }
    const f = target / rc.ToT_CL, r4 = x => Math.round(x * 1e4) / 1e4;
    const c = { from, kind: 'derivado', ToT_CL: target, src: `derivado de ${ref.name} (${rc.src || ''}) × ${f.toFixed(5)}` };
    if (rc.ToT_WL) c.ToT_WL = r4(rc.ToT_WL * f);
    if (rc.GPH) c.GPH = Math.round(rc.GPH / f * 10) / 10;
    addCert(t.dataset.b, c);
  }
  else if (a === 'copyRace') {
    const race = Object.assign({ id }, S.races[id]); const { rows } = E.raceResults(race, dbState());
    copy(`${race.name} — ${dPT(race.date)} (${E.SYSTEMS[race.system]})\n` + rows.map(x => x.code ? `-  ${x.name}  ${x.code}  ${ptsF(x.pts)} pts` : `${x.pos}. ${x.name}  ${E.hms2(x.elapsed)}  corr ${E.hms2(x.corrected)}  +${E.hms(x.delta)}`).join('\n'));
  }
  else if (a === 'export') {
    const rules = ctxRules(), g = groupsOf(rules).find(x => x.k === S.group) || { t: 'Geral' };
    dialog('Exportar classificação', `<div class="small muted">Para enviar aos velejadores: ${STATIC ? 'partilhe o endereço deste site' : 'publique no site público'}, copie o texto ou descarregue um ficheiro HTML para imprimir ou publicar.</div>
      <div class="row"><button class="btn" data-a="expTxt">Copiar texto (${esc(g.t)})</button>${DOWN || STATIC ? '<button class="btn pri" data-a="expHtml">Descarregar HTML completo</button>' : ''}</div>`);
  }
  else if (a === 'expTxt') { const k = S.group === 'PROVAS' ? 'GERAL' : S.group; const { st, rs, rules } = ctxSeries(k); copy(standingsText(st, rs, ctxName() + ' — ' + (groupsOf(rules).find(g => g.k === k) || { t: 'Geral' }).t)); }
  else if (a === 'expHtml' && STATIC) downloadFile(slug(ctxName()) + '.html', standingsHTML());
  else if (a === 'expHtml') { try { await DOWN.save({ filename: slug(ctxName()) + '.html', data: standingsHTML() }); } catch (_) { toast('Descarga cancelada.'); } }
}
document.addEventListener('input', e => { if (e.target.id === 'fleetQ') { S.fleetQ = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#fleetQ'); q.focus(); q.setSelectionRange(pos, pos); } });
/* ---------- importar inscritos ---------- */
function loadScript(src) { return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('não carregou ' + src)); document.head.appendChild(s); }); }
async function readSheetRows(file) {
  if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
}
const COLMAP = [
  ['name', /^(barco|nome|nome do barco|embarcacao|yacht|boat|boat name|yacht name)$/],
  ['sail', /(vela|sail)/], ['type', /(modelo|tipo|type|model|design|classe)/],
  ['skipper', /(skipper|timoneiro|responsavel|owner|armador|helm)/], ['license', /(licen|license|licence)/], ['club', /(clube|club)/],
];
function parseEntries(rows) {
  const key = c => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
  const hi = rows.findIndex(r => r.some(c => COLMAP[0][1].test(key(c))));
  if (hi < 0) throw new Error('não encontrei a coluna do nome do barco (ex.: "Barco")');
  const cols = {};
  rows[hi].forEach((c, i) => { const k = key(c); const m = COLMAP.find(([f, re]) => cols[f] == null && re.test(k)); if (m) cols[m[0]] = i; });
  return rows.slice(hi + 1).map(r => Object.fromEntries(COLMAP.map(([f]) => [f, cols[f] == null ? '' : String(r[cols[f]] || '').trim()]))).filter(x => x.name);
}
function findBoat(x) {
  const sl = norm(x.sail), n = norm(x.name);
  return (Object.entries(S.boats).find(([, b]) => sl.length >= 3 && norm(b.sail) === sl)
    || Object.entries(S.boats).find(([, b]) => norm(b.name) === n || (b.aka || []).some(a => norm(a) === n)) || [null])[0];
}
function findClub(name) { const n = norm(name); return n ? (Object.entries(S.clubs).find(([, c]) => norm(c.short) === n || norm(c.name) === n) || [null])[0] : null; }
async function importEntries(file, eid) {
  dialog('Importar inscritos', '<div class="info">A ler o ficheiro…</div>');
  try {
    const [rows] = await Promise.all([readSheetRows(file), loadCatalog()]);
    const list = parseEntries(rows).map(x => {
      const boatId = findBoat(x), m = boatId ? null : certMatches(x.name, x.sail, x.type);
      return Object.assign(x, { boatId, cert: m && m.own[0] ? m.own[0][10] : null, modelN: m ? m.model.length : 0 });
    });
    if (!list.length) throw new Error('o ficheiro não tem linhas com nome de barco');
    S.edit = { kind: 'import', id: eid, list };
    const ev = S.events[eid];
    const row = (x, i) => `<tr><td><input type="checkbox" class="impChk" data-i="${i}" checked></td><td class="boat">${esc(x.name.toUpperCase())}<span class="sub">${esc([x.sail, x.type].filter(Boolean).join(' · '))}</span></td><td>${esc(x.skipper)}${x.skipper && !findSkipper(x.skipper) ? ' <span class="chip">novo</span>' : ''}</td><td>${esc(x.club)}${x.club && !findClub(x.club) ? ' <span class="chip">novo</span>' : ''}</td>
      <td>${x.boatId ? `<span class="chip k-orc">na BD</span>${(ev.entries || []).includes(x.boatId) ? ' <span class="chip">já inscrito</span>' : ''}` : '<span class="chip k-teste">novo</span>'}</td>
      <td>${x.boatId ? (E.certAt(S.boats[x.boatId], ev.dateFrom || today(), dbState()) ? 'tem' : '<span class="chip">sem</span>') : x.cert ? '<span class="chip k-orc">ORC encontrado</span>' : `<span class="chip">sem${x.modelN ? ' · ' + x.modelN + ' do modelo' : ''}</span>`}</td></tr>`;
    dialog('Importar inscritos · ' + ev.name, `<div class="small muted">${list.length} linhas lidas. Barcos já na base de dados (mesma vela ou nome) são reaproveitados; os novos são criados com o certificado ORC próprio quando é encontrado. Para os "sem", escolha depois em Inscritos → "sem certificado".</div>
      <div class="scroll"><table><thead><tr><th></th><th>Barco</th><th>Skipper</th><th>Clube</th><th>Estado</th><th>Cert.</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
      <div class="row spread"><button class="btn" data-a="finCancel">Cancelar</button><button class="btn pri" data-a="impConfirm">Importar e inscrever</button></div>`);
  } catch (err) { dialog('Importar inscritos', `<div class="warn">Não foi possível importar: ${esc(err.message || err)}.</div><div class="small muted">Use um ficheiro .xlsx ou .csv com uma linha de títulos: Barco, Vela, Modelo, Skipper, Licença, Clube (só "Barco" é obrigatório).</div>`); }
}
async function confirmImport() {
  const { id: eid, list } = S.edit;
  const chosen = [...document.querySelectorAll('.impChk:checked')].map(x => list[+x.dataset.i]);
  toast('A importar ' + chosen.length + ' barco(s)…');
  const ids = [];
  for (const x of chosen) {
    let clubId = findClub(x.club) || '';
    if (x.club && !clubId) { clubId = uniqueId('clubs', slug(x.club)); if (!await save('clubs', clubId, { name: x.club, short: x.club.length <= 12 ? x.club : '' })) return; }
    let skipperId = findSkipper(x.skipper) || '';
    if (x.skipper && !skipperId) { skipperId = uniqueId('skippers', slug(x.skipper)); if (!await save('skippers', skipperId, { name: x.skipper, license: x.license, clubId })) return; }
    else if (skipperId && x.license && !S.skippers[skipperId].license) await save('skippers', skipperId, Object.assign(clone(S.skippers[skipperId]), { license: x.license }));
    let bid = x.boatId;
    if (!bid) {
      bid = uniqueId('boats', slug(x.name));
      const r = x.cert && S.catalog.rows.find(c => c[10] === x.cert);
      const b = { name: x.name.toUpperCase(), sail: x.sail, type: x.type, clubId, skipperId, aka: [], div: '', note: '', certs: r ? [catCert(r, 'orc')] : [] };
      if (!await save('boats', bid, b)) return;
    }
    ids.push(bid);
  }
  const ev = clone(S.events[eid]); ev.entries = [...new Set((ev.entries || []).concat(ids))].sort();
  if (await save('events', eid, ev)) { toast(ids.length + ' barco(s) inscritos.'); closeDlg(); }
}
document.addEventListener('change', async e => {
  if (e.target.id === 'impFile' && e.target.files[0]) { const f = e.target.files[0], d = e.target.dataset; e.target.value = ''; const eid = d.e || await ensureEvent(d.c); return eid && importEntries(f, eid); }
  if (e.target.id !== 'photoIn' || !e.target.files[0]) return;
  if (!ASSETS) { toast('Só os editores podem guardar fotografias.'); return; }
  const id = e.target.dataset.id; toast('A enviar fotografia…');
  try {
    const up = await ASSETS.upload(await shrink(e.target.files[0]));
    const r = clone(S.races[id]); r.photos = (r.photos || []).concat([up.id]);
    if (await save('races', id, r)) toast('Fotografia guardada.');
  } catch (err) { toast('Não foi possível guardar a foto (' + (err.code || err.message) + ').'); }
});
$('#dlg') && $('#dlg').addEventListener('close', () => { if (S.edit) { S.edit = null; render(); } });
init();
