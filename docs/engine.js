// Motor de scoring ORC — ToT/ToD, pontuação baixa (RRS Apêndice A), descartes, desempates A8.
(function (root) {
  const IN_RACE_CODES = ['DNF', 'DNS', 'OCS', 'BFD', 'UFD', 'RET', 'DSQ', 'NSC', 'DNE'];
  const SYSTEMS = {
    ToT_CL: 'ToT Costeiro / Long Distance',
    ToT_WL: 'ToT Barlavento / Sotavento',
    ToD_CL: 'ToD Costeiro / Long Distance',
    ToD_WL: 'ToD Barlavento / Sotavento',
    ToT_GPH: 'ToT GPH (600 ÷ GPH)',
    ToD_GPH: 'ToD GPH',
  };

  function secs(t) {
    if (t == null || t === '') return null;
    const p = String(t).trim().replace(/[.,h]/g, ':').split(':').map(Number);
    if (p.some(isNaN)) return null;
    while (p.length < 3) p.push(0);
    return p[0] * 3600 + p[1] * 60 + p[2];
  }
  function hms(x, signed) {
    if (x == null) return '';
    const s = x < 0 ? '-' : '';
    x = Math.abs(Math.round(x));
    const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), ss = x % 60;
    return s + (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  }
  function hms2(x) { // sempre h:mm:ss
    if (x == null) return '';
    const s = x < 0 ? '-' : ''; x = Math.abs(Math.round(x));
    return s + Math.floor(x / 3600) + ':' + String(Math.floor((x % 3600) / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  }

  // valor de um campo do certificado em vigor numa data
  function certValue(cert, field) {
    if (!cert) return null;
    if (cert[field] != null && cert[field] !== '') return Number(cert[field]);
    if (field === 'ToD_CL' && cert.ToT_CL) return Math.round(6000 / cert.ToT_CL) / 10;
    if (field === 'ToD_WL' && cert.ToT_WL) return Math.round(6000 / cert.ToT_WL) / 10;
    if (field === 'ToD_GPH' && cert.GPH) return Number(cert.GPH);
    if (field === 'ToT_GPH' && cert.GPH) return Math.round(600 / cert.GPH * 1e4) / 1e4;
    return null;
  }
  function certsOf(boat, db) {
    if (boat.classRef && db.classes && db.classes[boat.classRef]) return db.classes[boat.classRef].certs || [];
    return boat.certs || [];
  }
  function certAt(boat, day, db, field) {
    const list = certsOf(boat, db).filter(c => (c.from || '0000') <= day && (!field || certValue(c, field) != null));
    if (!list.length) return null;
    return list.reduce((a, b) => ((b.from || '') > (a.from || '') ? b : a));
  }
  function ratingAt(boat, day, field, db) {
    const c = certAt(boat, day, db, field);
    return c ? { value: certValue(c, field), cert: c } : null;
  }

  // divisão: override manual > SB > CDL
  function divisionOf(boat, day, db, champ) {
    if (boat.div) return boat.div;
    if (boat.sb) return 'SB';
    const c = certAt(boat, day || '9999', db, 'CDL');
    const cdl = c ? Number(c.CDL) : null;
    if (cdl == null) return '?';
    const lim = (champ && champ.divLimits) || { A: 9.9, B: 8.8 };
    return cdl >= lim.A ? 'A' : cdl >= lim.B ? 'B' : 'C';
  }

  // ---- uma regata ----
  function scoreRace(race, db) {
    const st = secs(race.start);
    const sys = race.system;
    const rows = [];
    const problems = [];
    // sem hora de largada ainda não se pode calcular: devolve as chegadas como pendentes
    if (st == null) {
      if ((race.finishes || []).length) problems.push('Falta a hora de largada: leia-a da folha de chegadas ou escreva-a no editor de chegadas.');
      for (const f of race.finishes || []) { const boat = db.boats[f.boatId]; if (boat) rows.push({ boatId: f.boatId, name: boat.name, note: f.note || '', finish: f.finish || '', code: f.code && f.code !== 'FIN' ? f.code : undefined, pending: true }); }
      return { rows, problems, pending: true };
    }
    // tempo limite: duração após a largada (timeLimitDur) ou hora absoluta (timeLimit)
    const limDur = race.timeLimitDur ? secs(race.timeLimitDur) : null;
    for (const f of race.finishes || []) {
      const boat = db.boats[f.boatId];
      if (!boat) continue;
      const row = { boatId: f.boatId, name: boat.name, note: f.note || '' };
      if (f.code && f.code !== 'FIN') { row.code = f.code; rows.push(row); continue; }
      let fin = secs(f.finish);
      if (fin == null) { row.code = 'DNF'; row.note = 'sem hora de chegada'; rows.push(row); continue; }
      if (f.dayOffset) fin += 86400 * f.dayOffset;
      const el = fin - st;
      row.finish = f.finish; row.elapsed = el;
      if ((limDur != null && el > limDur) || (limDur == null && race.timeLimit && secs(race.timeLimit) != null && fin > secs(race.timeLimit) + 86400 * (f.dayOffset || 0))) {
        row.code = 'DNF'; row.note = 'chegou fora do tempo limite'; rows.push(row); continue;
      }
      if (el <= 0 || el > 36 * 3600) problems.push(`${boat.name}: tempo decorrido estranho (${hms2(el)})`);
      const r = ratingAt(boat, race.date, sys, db);
      if (!r) { row.code = 'DNF'; row.note = 'SEM RATING ' + sys; problems.push(`${boat.name}: sem rating ${sys} em ${race.date}`); rows.push(row); continue; }
      row.rating = r.value; row.certSrc = r.cert.src || '';
      if (sys.startsWith('ToT')) row.corrected = Math.round(el * r.value);
      else row.corrected = Math.round(el - r.value * Number(race.distance || 0));
      if (sys.startsWith('ToD') && !race.distance) problems.push('ToD sem distância definida');
      rows.push(row);
    }
    if (f_dupes(race)) problems.push('Há barcos repetidos na regata');
    return { rows, problems };
  }
  function f_dupes(race) {
    const ids = (race.finishes || []).map(f => f.boatId);
    return new Set(ids).size !== ids.length;
  }

  // pontua um conjunto de linhas (geral ou grupo)
  function placeRows(rows) {
    const fin = rows.filter(r => r.code == null).sort((a, b) => a.corrected - b.corrected);
    const best = fin.length ? fin[0].corrected : 0;
    let i = 0;
    while (i < fin.length) {
      let j = i;
      while (j + 1 < fin.length && fin[j + 1].corrected === fin[i].corrected) j++;
      const pts = (i + 1 + j + 1) / 2;
      for (let k = i; k <= j; k++) { fin[k].pos = i + 1; fin[k].pts = pts; fin[k].delta = fin[k].corrected - best; }
      i = j + 1;
    }
    const n = rows.length;
    const pen = rows.filter(r => r.code != null).map(r => Object.assign(r, { pts: n + 1 }));
    return fin.concat(pen);
  }

  function raceResults(race, db, filterFn) {
    const { rows, problems, pending } = scoreRace(race, db);
    const sel = rows.filter(r => !filterFn || filterFn(db.boats[r.boatId], r.boatId)).map(r => Object.assign({}, r));
    return { rows: pending ? sel : placeRows(sel), problems, pending: !!pending };
  }

  function nDiscards(champ, nRaces) {
    const rules = (champ && champ.discards) || [];
    for (const r of rules) if (nRaces <= r.upTo) return r.n;
    return 0;
  }

  // classificação de série (campeonato, divisão, classe ou prova)
  function seriesStandings(races, db, opts) {
    opts = opts || {};
    // opts.boats: lista de inscritos — só estes entram, e quem não tem resultado numa regata fica DNC
    const entrants = opts.boats ? new Set(opts.boats) : null;
    const filterFn = entrants
      ? ((b, id) => entrants.has(id) && (!opts.filter || opts.filter(b, id)))
      : opts.filter;
    const perRace = [];
    const order = [];
    if (entrants) for (const id of opts.boats) if (db.boats[id] && (!opts.filter || opts.filter(db.boats[id]))) order.push(id);
    for (const race of races) {
      const { rows } = raceResults(race, db, filterFn);
      const map = {};
      for (const r of rows) { map[r.boatId] = r; if (!order.includes(r.boatId)) order.push(r.boatId); }
      perRace.push(map);
    }
    const dnc = order.length + 1;
    const nd = opts.discards != null ? opts.discards : nDiscards(opts.champ, races.length);
    const table = order.map(id => {
      const cells = perRace.map(m => m[id] ? { pts: m[id].pts, code: m[id].code || '', pos: m[id].pos } : { pts: dnc, code: 'DNC' });
      const pts = cells.map(c => c.pts);
      const idx = pts.map((p, i) => i).sort((a, b) => pts[b] - pts[a] || b - a).slice(0, nd);
      idx.forEach(i => cells[i].disc = true);
      const total = pts.reduce((a, b) => a + b, 0);
      const net = total - idx.reduce((a, i) => a + pts[i], 0);
      const kept = pts.filter((p, i) => !idx.includes(i)).sort((a, b) => a - b);
      return { boatId: id, name: db.boats[id].name, cells, total, net, kept, rev: pts.slice().reverse() };
    });
    const cmpArr = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    table.sort((a, b) => a.net - b.net || cmpArr(a.kept, b.kept) || cmpArr(a.rev, b.rev));
    let rank = 0;
    table.forEach((r, i) => {
      const prev = table[i - 1];
      if (!prev || r.net !== prev.net || cmpArr(r.kept, prev.kept) || cmpArr(r.rev, prev.rev)) rank = i + 1;
      r.rank = rank;
    });
    return { table, dnc, nDiscards: nd };
  }

  // uma regata só conta para classificações quando tem largada e chegadas
  function isScored(race) { return secs(race.start) != null && (race.finishes || []).length > 0; }
  const api = { isScored, secs, hms, hms2, certValue, certAt, ratingAt, divisionOf, scoreRace, raceResults, seriesStandings, nDiscards, IN_RACE_CODES, SYSTEMS };
  if (typeof module !== 'undefined') module.exports = api; else root.ORC = api;
})(this);
