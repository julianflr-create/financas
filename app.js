/* app.js — Finanças 2026 (PWA) */
'use strict';
const X = window.XCore;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (n < 0 ? '−' : '') + 'R$ ' + X.fmtBR(Math.abs(n));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mesDeData = (iso) => { const [y, m] = iso.split('-').map(Number); const i = (y - 2026) * 12 + (m - 1); return i >= 0 && i < 15 ? i : null; };

const CATS_CARTAO = ['Restaurantes', 'Supermercados', 'Serviços', 'Transporte', 'Saúde', 'Lazer', 'Vestuário', 'Viagens', 'Compras parceladas', 'Outros lançamentos'];
const KINDS = { despesa: 'Despesa', cartao: 'Cartão', receita: 'Receita', emprestimo: 'Empréstimo', viagem: 'Viagem' };
const LOG_NAME = 'Lancamentos_App.csv';

/* ---------------- Estado persistente ---------------- */
const LS = 'fin2026.v1';
const st = Object.assign({
  settings: { mode: '', clientId: '', filePath: 'Anexos/Planilha com IA/FINANCAS_2026.xlsx', itemId: '', fileName: '', parentId: '', notes: true, csv: true, account: '' },
  queue: [], history: [], prefs: {}, auth: null,
}, JSON.parse(localStorage.getItem(LS) || '{}'));
const save = () => localStorage.setItem(LS, JSON.stringify(st));

/* IndexedDB: cópia local da planilha */
const idb = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('fin2026', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(k) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); }); },
};

/* ---------------- Interface: estado de tela ---------------- */
const ui = { tela: 'lancar', kind: st.prefs.kind || 'despesa', month: Math.min(14, Math.max(0, mesDeData(hoje()) ?? 10)), neg: false, f: {}, syncing: false, lastErr: '' };
let cache = null; // { bytes, etag, at }
let wbView = null, model = null;

function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (erro ? ' erro' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, erro ? 6000 : 3200);
}

/* ---------------- Autenticação Microsoft (OAuth 2 + PKCE) ---------------- */
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPES = 'Files.ReadWrite offline_access User.Read openid profile';
const redirectUri = () => location.origin + location.pathname;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
class NeedLogin extends Error {}

async function login() {
  if (!st.settings.clientId) { toast('Informe o ID do aplicativo (Client ID) em Ajustes.', true); irTela('ajustes'); return; }
  const verifier = rnd(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = rnd(16);
  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }));
  const p = new URLSearchParams({ client_id: st.settings.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPES, code_challenge: challenge, code_challenge_method: 'S256', state });
  if (st.settings.account) p.set('login_hint', st.settings.account);
  location.assign(`${AUTH}/authorize?${p}`);
}
async function tokenRequest(body) {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: st.settings.clientId, scope: SCOPES, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'Falha na autenticação');
  st.auth = { access: j.access_token, refresh: j.refresh_token || st.auth?.refresh, exp: Date.now() + (j.expires_in - 90) * 1000 };
  save();
}
async function handleRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return;
  history.replaceState(null, '', redirectUri());
  if (p.has('error')) { toast('Login não concluído: ' + (p.get('error_description') || p.get('error')), true); return; }
  const saved = JSON.parse(sessionStorage.getItem('pkce') || '{}');
  sessionStorage.removeItem('pkce');
  if (!saved.state || saved.state !== p.get('state')) { toast('Login inválido (estado não confere). Tente de novo.', true); return; }
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    st.settings.mode = 'onedrive'; save();
    const me = await graphJson('/me?$select=displayName,userPrincipalName,mail');
    st.settings.account = me.userPrincipalName || me.mail || ''; st.settings.accountName = me.displayName || ''; save();
    toast('Conectado como ' + (me.displayName || st.settings.account));
  } catch (e) { toast(e.message, true); }
}
async function accessToken() {
  if (st.auth?.access && st.auth.exp > Date.now()) return st.auth.access;
  if (st.auth?.refresh) {
    try { await tokenRequest({ grant_type: 'refresh_token', refresh_token: st.auth.refresh }); return st.auth.access; } catch (e) { st.auth = null; save(); }
  }
  throw new NeedLogin('Entre na sua conta Microsoft para sincronizar.');
}
function logout() { st.auth = null; st.settings.account = ''; st.settings.accountName = ''; save(); render(); toast('Conta desconectada.'); }

/* ---------------- Microsoft Graph / OneDrive ---------------- */
const G = 'https://graph.microsoft.com/v1.0';
async function graph(path, opts = {}) {
  const t = await accessToken();
  const r = await fetch(path.startsWith('http') ? path : G + path, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401) { st.auth = null; save(); throw new NeedLogin('Sessão expirada. Entre novamente.'); }
  return r;
}
async function graphJson(path, opts) {
  const r = await graph(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `Erro ${r.status} no OneDrive`); e.status = r.status; e.code = j.error?.code; throw e; }
  return j;
}
const encPath = (p) => p.replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/');
async function localizarArquivo() {
  if (st.settings.itemId) {
    try { return await graphJson(`/me/drive/items/${st.settings.itemId}`); } catch (e) { if (e.status !== 404) throw e; }
  }
  try {
    const it = await graphJson(`/me/drive/root:/${encPath(st.settings.filePath)}`);
    escolherArquivo(it); return it;
  } catch (e) { if (e.status !== 404) throw e; }
  const e = new Error(`Não encontrei "${st.settings.filePath}" no OneDrive. Use "Procurar no OneDrive" em Ajustes.`); e.notFound = true; throw e;
}
function escolherArquivo(it) {
  st.settings.itemId = it.id; st.settings.fileName = it.name; st.settings.parentId = it.parentReference?.id || '';
  const pp = (it.parentReference?.path || '').replace(/^\/drive\/root:?/, '').replace(/^\//, '');
  if (pp) st.settings.filePath = decodeURIComponent(pp) + '/' + it.name;
  save();
}
async function buscarArquivos(q) {
  const j = await graphJson(`/me/drive/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?$top=25`);
  return (j.value || []).filter((x) => x.file && /\.xlsx$/i.test(x.name));
}

/* Backends: OneDrive ou arquivo local (modo de teste) */
const backend = {
  async latest() {
    if (st.settings.mode === 'local') { const c = await idb.get('wb'); if (!c) throw new Error('Abra um arquivo .xlsx em Ajustes.'); return c; }
    const it = await localizarArquivo();
    if (cache && cache.etag === it.eTag) return cache;
    const url = it['@microsoft.graph.downloadUrl'];
    const r = url ? await fetch(url) : await graph(`/me/drive/items/${it.id}/content`);
    if (!r.ok) throw new Error(`Não consegui baixar a planilha (erro ${r.status}).`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const c = { bytes, etag: it.eTag, at: Date.now(), name: it.name };
    await guardarCache(c);
    return c;
  },
  async upload(bytes, etag) {
    if (st.settings.mode === 'local') { const c = { bytes, etag: 'local-' + Date.now(), at: Date.now(), name: cache?.name || 'FINANCAS_2026.xlsx' }; return c; }
    const r = await graph(`/me/drive/items/${st.settings.itemId}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'If-Match': etag }, body: bytes });
    if (r.status === 412) return { conflict: true };
    if (r.status === 423) throw new Error('A planilha está bloqueada para edição (aberta em outro lugar). Feche-a no Excel e toque em sincronizar.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Falha ao enviar a planilha (erro ${r.status}).`);
    return { bytes, etag: j.eTag, at: Date.now(), name: j.name };
  },
  async log(rows) {
    if (!st.settings.csv || !rows.length) return;
    const head = 'gravado_em;tipo;mes;onde;valor;descricao;data;celulas\r\n';
    const csv = rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n') + '\r\n';
    if (st.settings.mode === 'local') { const old = (await idb.get('log')) || '﻿' + head; await idb.set('log', old + csv); return; }
    if (!st.settings.parentId) return;
    const p = `/me/drive/items/${st.settings.parentId}:/${encodeURIComponent(LOG_NAME)}:/content`;
    let old = '';
    try { const r = await graph(p); if (r.ok) old = await r.text(); } catch (e) { /* novo */ }
    if (!old) old = '﻿' + head;
    await graph(p, { method: 'PUT', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: old + csv });
  },
};

async function guardarCache(c) {
  cache = c; await idb.set('wb', c);
  wbView = await X.Workbook.open(c.bytes);
  model = await X.readModel(wbView);
}

/* ---------------- Sincronização ---------------- */
function statusUI() {
  const el = $('#status'), tx = $('#statusTxt');
  const n = st.queue.length, ne = st.queue.filter((e) => e.error).length;
  let s = 'ok', t = 'Sincronizado';
  if (!st.settings.mode) { s = 'off'; t = 'Configurar'; }
  else if (ui.syncing) { s = 'sync'; t = 'Gravando…'; }
  else if (st.settings.mode === 'onedrive' && !st.auth) { s = 'erro'; t = 'Entrar'; }
  else if (ne) { s = 'erro'; t = `${ne} com erro`; }
  else if (n) { s = 'pend'; t = navigator.onLine ? `${n} na fila` : `Offline · ${n}`; }
  else if (st.settings.mode === 'local') t = 'Modo teste';
  el.dataset.s = s; tx.textContent = t;
  const b = $('#badge'); b.hidden = !n; b.textContent = n;
}

async function sincronizar(manual) {
  if (ui.syncing || !st.settings.mode) return;
  if (!st.queue.length && !manual) return;
  if (st.settings.mode === 'onedrive' && !navigator.onLine) { statusUI(); if (manual) toast('Sem internet. Os lançamentos ficam na fila e são gravados quando a conexão voltar.'); return; }
  ui.syncing = true; statusUI();
  try {
    if (!st.queue.length) { await backend.latest(); if (manual) toast('Planilha atualizada.'); return; }
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const c = await backend.latest();
      const wb = await X.Workbook.open(c.bytes);
      const fila = st.queue.slice();
      const res = await X.applyAll(wb, fila, { notes: st.settings.notes });
      const ok = res.filter((r) => r.ok);
      for (const r of res) { const e = st.queue.find((q) => q.id === r.id); if (e) e.error = r.ok ? '' : r.error; }
      if (!ok.length) { save(); toast('Nenhum lançamento pôde ser gravado. Veja os erros no Histórico.', true); return; }
      const bytes = await wb.save();
      const up = await backend.upload(bytes, c.etag);
      if (up.conflict) { cache = null; continue; }
      await guardarCache(up);
      const agora = new Date().toISOString();
      const logRows = [];
      for (const r of ok) {
        const e = fila.find((q) => q.id === r.id);
        st.queue = st.queue.filter((q) => q.id !== r.id);
        st.history.unshift({ id: r.id, entry: e, lines: r.lines, warnings: r.warnings, changes: r.changes, notes: r.notes, at: agora });
        for (const l of r.lines.filter((l) => l.ref)) logRows.push([agora, KINDS[e.kind] || e.kind, X.MONTHS[e.month]?.label, l.label, X.fmtBR(l.after - (l.before || 0)), e.desc || '', e.date || '', `${l.sheet}!${l.ref}`]);
        if (e.kind === 'renomear') logRows.push([agora, 'Renomear', '', r.lines[0].label, '', '', '', '']);
      }
      st.history = st.history.slice(0, 300);
      save();
      const avisos = ok.flatMap((r) => r.warnings);
      toast(`${ok.length} lançamento${ok.length > 1 ? 's' : ''} gravado${ok.length > 1 ? 's' : ''} na planilha.` + (avisos.length ? ' ' + avisos.join(' ') : ''), res.length !== ok.length);
      backend.log(logRows).catch(() => {});
      return;
    }
    throw new Error('A planilha mudou várias vezes durante a gravação. Tente de novo em instantes.');
  } catch (e) {
    if (e instanceof NeedLogin) { toast(e.message + ' Toque em "Entrar".', true); }
    else toast(e.message || String(e), true);
  } finally { ui.syncing = false; render(); }
}

async function desfazer(id) {
  const rec = st.history.find((r) => r.id === id);
  if (!rec || rec.undone) return;
  if (!(await confirmar('Desfazer este lançamento?', `${rec.lines.map((l) => l.label).join('<br>')}<br><br>O valor e o comentário serão retirados da planilha.`, 'Desfazer'))) return;
  ui.syncing = true; statusUI();
  try {
    for (let t = 1; t <= 3; t++) {
      const c = await backend.latest();
      const wb = await X.Workbook.open(c.bytes);
      await X.undoEntry(wb, rec);
      const up = await backend.upload(await wb.save(), c.etag);
      if (up.conflict) { cache = null; continue; }
      await guardarCache(up);
      rec.undone = new Date().toISOString(); save();
      backend.log([[rec.undone, 'DESFEITO', X.MONTHS[rec.entry.month]?.label, rec.lines.map((l) => l.label).join(' | '), '', rec.entry.desc || '', rec.entry.date || '', rec.changes.map((c) => `${c.sheet}!${c.ref}`).join(' ')]]).catch(() => {});
      toast('Lançamento desfeito na planilha.');
      return;
    }
  } catch (e) { toast(e.message, true); } finally { ui.syncing = false; render(); }
}

/* ---------------- Formulário de lançamento ---------------- */
function parseValor(s) {
  s = String(s || '').replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}
const field = (id, label, inner, extra = '') => `<label class="f" ${extra}><span>${label}</span>${inner}</label>`;
const opts = (arr, sel) => arr.map((o) => { const v = typeof o === 'object' ? o.v : o, t = typeof o === 'object' ? o.t : o; return `<option value="${h(v)}"${String(v) === String(sel) ? ' selected' : ''}>${h(t)}</option>`; }).join('');
const seg = (name, items, sel) => `<div class="seg" role="group" data-seg="${name}">${items.map(([v, t]) => `<button type="button" data-v="${h(v)}" aria-pressed="${String(v) === String(sel)}">${h(t)}</button>`).join('')}</div>`;

function formHTML() {
  const f = ui.f, p = st.prefs, k = ui.kind;
  const data = field('data', 'Data', `<input type="date" data-f="date" value="${h(f.date || hoje())}">`);
  const desc = (ph) => field('desc', 'Descrição <small>(vira comentário na célula)</small>', `<input data-f="desc" value="${h(f.desc || '')}" placeholder="${h(ph)}" autocomplete="off" enterkeyhint="done">`);
  if (k === 'despesa') {
    const cats = model.despesas.cats;
    const cat = cats.find((c) => c.name === f.cat) || cats.find((c) => c.name === p.despCat) || cats[0];
    f.cat = cat.name;
    const item = cat.items.find((i) => i.label === f.item) || cat.items.find((i) => i.label === p['despItem:' + cat.name]) || cat.items[0];
    f.item = item.label;
    return field('cat', 'Categoria', `<select data-f="cat">${opts(cats.map((c) => ({ v: c.name, t: cap(c.name) })), cat.name)}</select>`)
      + field('item', 'Item', `<select data-f="item">${opts(cat.items.map((i) => i.label), item.label)}</select>`)
      + `<div class="linha2">${data}${field('m', 'Mês na planilha', `<input value="${h(X.MONTHS[ui.month].label)}" readonly tabindex="-1">`)}</div>`
      + desc('ex.: Restaurante Madrecita');
  }
  if (k === 'cartao') {
    const blk = model.cartoes.blocks[ui.month];
    const nomes = [...new Set([...blk.cards.map((c) => c.name), ...model.cartoes.names])];
    if (!f.card) f.card = p.card && nomes.includes(p.card) ? p.card : (blk.cards[0]?.name || nomes[0]);
    if (!f.cat) f.cat = p.cardCat || 'Restaurantes';
    if (!f.parcelas) f.parcelas = 1;
    const outro = f.card === '__outro';
    return field('card', 'Cartão', `<select data-f="card">${opts([...nomes, { v: '__outro', t: 'Outro cartão…' }], f.card)}</select>`)
      + (outro ? field('cardNovo', 'Nome do novo cartão', `<input data-f="cardNovo" value="${h(f.cardNovo || '')}" placeholder="ex.: Visa Nubank">`) : '')
      + (blk.cards.length && !outro && !blk.cards.some((c) => X.norm(c.name) === X.norm(f.card)) ? `<p class="dica">Este cartão ainda não aparece na fatura de ${h(X.MONTHS[ui.month].label)}; ele será adicionado numa linha livre.</p>` : '')
      + field('cat', 'Categoria', `<select data-f="cat">${opts(CATS_CARTAO, f.cat)}</select>`)
      + desc('Estabelecimento, ex.: Taishi Sushi Porto Alegre')
      + `<div class="linha2">${field('date', 'Data da compra', `<input type="date" data-f="date" value="${h(f.date || hoje())}">`)}${field('fat', 'Fatura de', `<input value="${h(X.MONTHS[ui.month].label)}" readonly tabindex="-1">`)}</div>`
      + `<div class="f"><span>Parcelas</span><div class="stepper"><button type="button" data-step="-1" aria-label="Menos parcelas">−</button><output>${f.parcelas}x</output><button type="button" data-step="1" aria-label="Mais parcelas">+</button></div></div>`
      + `<p class="dica">Escolha a fatura no topo (‹ ›). Compras parceladas entram nas faturas seguintes, até Mar/2027.</p>`;
  }
  if (k === 'receita') {
    if (!f.col) f.col = p.recCol || 'B';
    return `<div class="f"><span>Tipo</span>${seg('col', model.receitas.cols.map((c) => [c.col, c.label]), f.col)}</div>`
      + `<p class="dica">${h(model.receitas.cols.find((c) => c.col === f.col)?.group || '')}</p>`
      + `<div class="linha2">${data}${field('m', 'Mês na planilha', `<input value="${h(X.MONTHS[ui.month].label)}" readonly tabindex="-1">`)}</div>`
      + desc('ex.: Reembolso consulta');
  }
  if (k === 'emprestimo') {
    if (!f.section) f.section = p.empSec || 'receber';
    if (f.person == null) f.person = p.empPerson ?? 0;
    if (!f.op) f.op = 'valor';
    const nomes = model.emprestimo[f.section];
    const ops = f.section === 'receber' ? [['valor', 'Emprestei'], ['pago', 'Recebi de volta']] : [['valor', 'Peguei emprestado'], ['pago', 'Paguei']];
    return `<div class="f"><span>Seção</span>${seg('section', [['receber', 'A receber'], ['pagar', 'A pagar']], f.section)}</div>`
      + field('person', 'Pessoa', `<select data-f="person">${opts(nomes.map((n, i) => ({ v: i, t: n })), f.person)}</select>`)
      + `<button type="button" class="link" id="renomear">Renomear esta pessoa</button>`
      + `<div class="f"><span>Operação</span>${seg('op', ops, f.op)}</div>`
      + `<div class="linha2">${data}${field('m', 'Mês na planilha', `<input value="${h(X.MONTHS[ui.month].label)}" readonly tabindex="-1">`)}</div>`
      + (ui.month > 11 ? '<p class="dica" style="color:var(--vermelho)">A aba Empréstimo vai só até Dez/2026.</p>' : '')
      + desc('ex.: Pix para o Jean');
  }
  if (k === 'viagem') {
    if (!f.item || !model.viagem.items.includes(f.item)) f.item = p.viaItem && model.viagem.items.includes(p.viaItem) ? p.viaItem : model.viagem.items[0];
    return (model.viagem.destino ? `<p class="dica">Destino na planilha: ${h(model.viagem.destino)}</p>` : '')
      + field('item', 'Item', `<select data-f="item">${opts(model.viagem.items, f.item)}</select>`)
      + `<div class="linha2">${data}${field('m', 'Mês na planilha', `<input value="${h(X.MONTHS[ui.month].label)}" readonly tabindex="-1">`)}</div>`
      + desc('ex.: Hotel em Maceió');
  }
  return '';
}
const cap = (s) => { s = String(s).trim(); return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s; };

function entradaAtual() {
  const f = ui.f, v = parseValor($('#valor').value);
  const e = { id: uid(), kind: ui.kind, month: ui.month, value: ui.neg ? -Math.abs(v) : v, date: f.date || hoje(), desc: (f.desc || '').trim(), createdAt: new Date().toISOString() };
  if (ui.kind === 'despesa') Object.assign(e, { cat: f.cat, item: f.item });
  if (ui.kind === 'cartao') {
    const card = f.card === '__outro' ? (f.cardNovo || '').trim() : f.card;
    const day = model.cartoes.blocks.flatMap((b) => b.cards).find((c) => X.norm(c.name) === X.norm(card))?.day || '';
    Object.assign(e, { card, cat: f.cat, parcelas: f.parcelas || 1, cardDay: day });
  }
  if (ui.kind === 'receita') e.col = f.col;
  if (ui.kind === 'emprestimo') Object.assign(e, { section: f.section, person: +f.person, op: f.op });
  if (ui.kind === 'viagem') e.item = f.item;
  return e;
}

let previaT;
function atualizarPrevia() {
  clearTimeout(previaT);
  previaT = setTimeout(async () => {
    const el = $('#previa'); const v = parseValor($('#valor').value);
    $('#valorCampo').classList.toggle('cheio', !!$('#valor').value);
    const pi = $('#parcelinfo');
    pi.textContent = ui.kind === 'cartao' && (ui.f.parcelas || 1) > 1 && v > 0 ? `${ui.f.parcelas}x de ${brl(Math.floor(v / ui.f.parcelas * 100) / 100)}` : '';
    const e = entradaAtual();
    let ok = isFinite(v) && v > 0 && !(ui.kind === 'cartao' && !e.card) && !(ui.kind === 'emprestimo' && ui.month > 11);
    $('#gravar').disabled = !ok;
    if (!ok || !wbView) { el.innerHTML = ''; return; }
    try {
      const r = await X.preview(wbView, e, { notes: false });
      const pend = st.queue.length ? ` <span class="ref">(+${st.queue.length} na fila, ainda não somado${st.queue.length > 1 ? 's' : ''})</span>` : '';
      el.innerHTML = r.lines.slice(0, 4).map((l) => `<p>${h(l.label)}<br><span class="ref">${h(l.sheet)}!${h(l.ref)}</span> · <span class="de">${l.before == null ? 'célula nova' : brl(l.before)} → <b>${brl(l.after)}</b></span></p>`).join('')
        + (r.lines.length > 4 ? `<p class="ref">+ ${r.lines.length - 4} parcelas</p>` : '')
        + r.warnings.map((w) => `<p class="aviso">${h(w)}</p>`).join('') + (pend ? `<p>${pend}</p>` : '');
    } catch (err) { el.innerHTML = `<p class="aviso">${h(err.message)}</p>`; $('#gravar').disabled = true; }
  }, 120);
}

function renderForm() {
  $$('#abas button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === ui.kind));
  $('#form').innerHTML = formHTML();
  $('#sinal').hidden = ui.kind === 'cartao' && (ui.f.parcelas || 1) > 1;
  atualizarPrevia();
}

async function gravar() {
  const e = entradaAtual();
  if (!(Math.abs(e.value) > 0)) return;
  if (ui.kind === 'cartao' && ui.f.card === '__outro' && !e.card) { toast('Digite o nome do novo cartão.', true); return; }
  st.queue.push(e);
  const p = st.prefs; p.kind = ui.kind;
  if (e.kind === 'despesa') { p.despCat = e.cat; p['despItem:' + e.cat] = e.item; }
  if (e.kind === 'cartao') { p.card = e.card; p.cardCat = e.cat; }
  if (e.kind === 'receita') p.recCol = e.col;
  if (e.kind === 'emprestimo') { p.empSec = e.section; p.empPerson = e.person; }
  if (e.kind === 'viagem') p.viaItem = e.item;
  save();
  $('#valor').value = ''; ui.neg = false; $('#sinal').setAttribute('aria-pressed', 'false');
  ui.f = { ...ui.f, desc: '', parcelas: 1, cardNovo: '' };
  if (ui.f.card === '__outro') ui.f.card = e.card;
  renderForm(); statusUI();
  if (st.settings.mode === 'onedrive' && (!navigator.onLine || !st.auth)) toast('Lançamento guardado na fila. Será gravado quando você estiver conectado.');
  sincronizar();
}

/* ---------------- Telas ---------------- */
function renderResumo() {
  const el = $('#resumo');
  if (!wbView) { el.innerHTML = '<p class="vazio">Sem planilha carregada ainda.</p>'; return; }
  X.monthSummary(wbView, model, ui.month).then((s) => {
    const max = Math.max(1, ...s.cats.map((c) => c.total));
    const saidas = s.despesasTotal + s.cartoesTotal + s.viagem + s.empPago;
    el.innerHTML = `<h2>${h(X.MONTHS[ui.month].label)}</h2>
      <div class="totais">
        <div><span>Receitas</span><b style="color:var(--verde)">${brl(s.receitasTotal + s.empRecebido)}</b></div>
        <div><span>Saídas lançadas</span><b style="color:var(--vermelho)">${brl(saidas)}</b></div>
      </div>
      <h3>Despesas por categoria · ${brl(s.despesasTotal)}</h3>
      <ul class="barras">${s.cats.filter((c) => c.total).map((c) => `<li><span>${h(cap(c.name))}</span><b>${brl(c.total)}</b><span class="b"><i style="width:${(c.total / max * 100).toFixed(1)}%"></i></span></li>`).join('') || '<li class="vazio">Nenhuma despesa neste mês.</li>'}</ul>
      <h3>Faturas de cartão · ${brl(s.cartoesTotal)}</h3>
      <ul class="lista cartao">${s.cards.map((c) => `<li><span class="t">${h(c.name)}</span><span class="v">${brl(c.total)}</span></li>`).join('') || '<li class="vazio">Sem cartões nesta fatura.</li>'}</ul>
      <h3>Outros</h3>
      <ul class="lista cartao">
        ${s.receitas.map((r) => `<li><span class="t">${h(r.label)}</span><span class="v pos">${brl(r.total)}</span></li>`).join('')}
        <li><span class="t">Viagem</span><span class="v">${brl(s.viagem)}</span></li>
        <li><span class="t">Empréstimos pagos</span><span class="v">${brl(s.empPago)}</span></li>
        <li><span class="t">Empréstimos recebidos</span><span class="v pos">${brl(s.empRecebido)}</span></li>
      </ul>
      <p class="nota-res">Calculado a partir das abas Receitas, Despesas, Cartões, Empréstimo e Viagem na última versão sincronizada${cache?.at ? ' (' + new Date(cache.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + ')' : ''}. Saldo, aplicações e transferências continuam na aba Plan1.</p>`;
  }).catch((e) => { el.innerHTML = `<p class="vazio">${h(e.message)}</p>`; });
}

function descEntrada(e) {
  if (e.kind === 'renomear') return { t: `Renomear pessoa ${e.person + 1} → ${e.name}`, s: 'Empréstimo' };
  const m = X.MONTHS[e.month]?.label || '';
  let t = '';
  if (e.kind === 'despesa') t = `${cap(e.cat)} › ${e.item}`;
  if (e.kind === 'cartao') t = `${e.card} · ${e.cat}${e.parcelas > 1 ? ` · ${e.parcelas}x` : ''}`;
  if (e.kind === 'receita') t = `Receita › ${model?.receitas.cols.find((c) => c.col === e.col)?.label || e.col}`;
  if (e.kind === 'emprestimo') t = `${e.section === 'receber' ? 'A receber' : 'A pagar'} › ${model?.emprestimo[e.section][e.person] || 'Pessoa ' + (e.person + 1)} › ${e.op === 'pago' ? (e.section === 'receber' ? 'recebi' : 'paguei') : (e.section === 'receber' ? 'emprestei' : 'peguei')}`;
  if (e.kind === 'viagem') t = `Viagem › ${e.item}`;
  return { t, s: [KINDS[e.kind], m, e.desc].filter(Boolean).join(' · ') };
}
function renderHistorico() {
  const el = $('#historico');
  const fila = st.queue.map((e) => { const d = descEntrada(e); return `<li><span class="t">${h(d.t)}</span><span class="v ${e.value < 0 ? 'pos' : ''}">${e.value != null ? brl(e.value) : ''}</span><span class="s">${h(d.s)}</span>${e.error ? `<span class="err">${h(e.error)}</span>` : ''}<span class="acts"><button data-rem="${e.id}">Remover da fila</button></span></li>`; }).join('');
  const hist = st.history.slice(0, 100).map((r) => { const d = descEntrada(r.entry); const quando = new Date(r.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    return `<li class="${r.undone ? 'riscado' : ''}"><span class="t">${h(d.t)}</span><span class="v">${r.entry.value != null ? brl(r.entry.value) : ''}</span><span class="s">${h(d.s)} · gravado ${h(quando)}${r.lines[0]?.ref ? ' · ' + h(r.lines.map((l) => l.ref).filter(Boolean).join(', ')) : ''}</span>${r.undone ? '<span class="s">Desfeito</span>' : `<span class="acts"><button data-undo="${r.id}">Desfazer</button></span>`}</li>`; }).join('');
  el.innerHTML = `<h2>Na fila</h2>${fila ? `<ul class="lista cartao">${fila}</ul><div class="btns"><button class="btn cheio" id="syncAgora">Gravar agora</button></div>` : '<p class="vazio">Nada pendente. Tudo o que você lançou já está na planilha.</p>'}
    <h2 style="margin-top:22px">Gravados</h2>${hist ? `<ul class="lista cartao">${hist}</ul>` : '<p class="vazio">Os lançamentos gravados aparecem aqui, com a opção de desfazer.</p>'}`;
}

function renderAjustes() {
  const s = st.settings, el = $('#ajustes');
  const conta = st.auth ? `Conectado${s.accountName ? ' como <b>' + h(s.accountName) + '</b>' : ''}${s.account ? ' (' + h(s.account) + ')' : ''}.` : 'Não conectado.';
  el.innerHTML = `
  <h2>Planilha no OneDrive</h2>
  <div class="cartao">
    <p style="margin:0 0 12px">${conta}</p>
    <label class="f"><span>ID do aplicativo (Client ID)</span><input id="cfgClient" value="${h(s.clientId)}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false"></label>
    <p class="dica" style="margin-top:10px">Endereço de redirecionamento para cadastrar no portal da Microsoft (tipo "Aplicativo de página única"):</p>
    <div class="copiar"><code id="redir">${h(redirectUri())}</code><button class="btn" id="copiarRedir">Copiar</button></div>
    <label class="f" style="margin-top:12px"><span>Caminho do arquivo no OneDrive</span><input id="cfgPath" value="${h(s.filePath)}" spellcheck="false"></label>
    ${s.itemId && s.mode === 'onedrive' ? `<p class="dica" style="margin-top:6px">Arquivo vinculado: ${h(s.fileName || s.filePath)}</p>` : ''}
    <div class="btns">
      ${st.auth ? '<button class="btn cheio" id="procurar">Procurar no OneDrive</button><button class="btn" id="sair">Sair da conta</button>' : '<button class="btn cheio" id="entrar">Entrar com a conta Microsoft</button>'}
    </div>
  </div>
  <h2 style="margin-top:22px">Gravação</h2>
  <div class="cartao">
    <label class="chk"><input type="checkbox" id="cfgNotes" ${s.notes ? 'checked' : ''}><span>Gravar a descrição como comentário na célula<small>Como você já faz: "Restaurantes - 25/11 / Madrecita…" nos cartões e "07/01 descrição" nas despesas.</small></span></label>
    <label class="chk"><input type="checkbox" id="cfgCsv" ${s.csv ? 'checked' : ''}><span>Manter um registro dos lançamentos<small>Arquivo ${LOG_NAME} na mesma pasta da planilha, com data, valor, descrição e células alteradas.</small></span></label>
  </div>
  <h2 style="margin-top:22px">Modo de teste</h2>
  <div class="cartao">
    <p class="dica" style="margin:0">Abra uma cópia do .xlsx salva no celular para experimentar o app sem conectar ao OneDrive. Depois baixe a cópia alterada e confira no Excel.</p>
    <div class="btns"><button class="btn" id="abrirLocal2">Abrir arquivo</button>${cache ? '<button class="btn" id="baixar">Baixar cópia da planilha</button>' : ''}</div>
    ${s.mode === 'local' ? '<p class="dica" style="margin-top:10px">Você está no modo de teste: nada é enviado ao OneDrive.</p>' : ''}
  </div>
  <div class="btns" style="margin-top:22px"><button class="btn perigo" id="limpar">Apagar dados do app neste celular</button></div>
  <p class="dica" style="margin:14px 0 0">Seus dados vão direto do celular para o seu OneDrive; o app não usa nenhum servidor intermediário.</p>`;
}

function render() {
  statusUI();
  $('#mesTxt').textContent = X.MONTHS[ui.month].label;
  $('#mesSub').textContent = ui.kind === 'cartao' && ui.tela === 'lancar' ? 'fatura' : 'mês da planilha';
  $('#mesAnt').disabled = ui.month <= 0; $('#mesProx').disabled = ui.month >= 14;
  document.body.dataset.tela = ui.tela;
  $$('section.tela').forEach((s) => s.classList.toggle('ativa', s.id === 't-' + ui.tela));
  $$('nav.baixo button').forEach((b) => { if (b.dataset.tela === ui.tela) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (ui.tela === 'lancar') {
    $('#semPlanilha').hidden = !!model; $('#comPlanilha').hidden = !model;
    $('.acao').style.display = model ? '' : 'none';
    if (model) renderForm();
  }
  if (ui.tela === 'resumo') renderResumo();
  if (ui.tela === 'historico') renderHistorico();
  if (ui.tela === 'ajustes') renderAjustes();
}
function irTela(t) { ui.tela = t; render(); window.scrollTo(0, 0); }

/* Diálogos */
function confirmar(titulo, corpo, ok = 'Confirmar') {
  return new Promise((res) => {
    const d = $('#dlg');
    $('#dlgForm').innerHTML = `<h2>${h(titulo)}</h2><p class="dica" style="font-size:15px">${corpo}</p><div class="btns" style="justify-content:flex-end"><button class="btn" value="n">Cancelar</button><button class="btn cheio" value="s">${h(ok)}</button></div>`;
    d.onclose = () => res(d.returnValue === 's');
    d.showModal();
  });
}
function perguntar(titulo, label, valor = '') {
  return new Promise((res) => {
    const d = $('#dlg');
    $('#dlgForm').innerHTML = `<h2>${h(titulo)}</h2><label class="f"><span>${h(label)}</span><input id="dlgIn" value="${h(valor)}" autocomplete="off"></label><div class="btns" style="justify-content:flex-end"><button class="btn" value="n">Cancelar</button><button class="btn cheio" value="s">Salvar</button></div>`;
    d.onclose = () => res(d.returnValue === 's' ? $('#dlgIn').value.trim() : null);
    d.showModal(); setTimeout(() => $('#dlgIn').select(), 50);
  });
}
async function escolherDaLista(itens) {
  return new Promise((res) => {
    const d = $('#dlg');
    $('#dlgForm').innerHTML = `<h2>Escolha a planilha</h2><ul class="lista">${itens.map((it, i) => `<li><span class="t">${h(it.name)}</span><span class="s">${h(decodeURIComponent((it.parentReference?.path || '').replace(/^\/drive\/root:?/, '')) || '/')}</span><span class="acts"><button value="${i}">Usar esta</button></span></li>`).join('')}</ul><div class="btns" style="justify-content:flex-end"><button class="btn" value="n">Cancelar</button></div>`;
    d.onclose = () => res(/^\d+$/.test(d.returnValue) ? itens[+d.returnValue] : null);
    d.showModal();
  });
}

/* ---------------- Eventos ---------------- */
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tela) return irTela(b.dataset.tela);
  if (b.dataset.ir) return irTela(b.dataset.ir);
  if (b.closest('#abas') && b.dataset.k) { ui.kind = b.dataset.k; ui.f = { date: ui.f.date }; render(); return; }
  const sg = b.closest('[data-seg]');
  if (sg) { ui.f[sg.dataset.seg] = b.dataset.v; if (sg.dataset.seg === 'section') { ui.f.person = 0; ui.f.op = 'valor'; } renderForm(); return; }
  if (b.dataset.step) { ui.f.parcelas = Math.max(1, Math.min(24, (ui.f.parcelas || 1) + +b.dataset.step)); if (ui.f.parcelas > 1) { ui.neg = false; $('#sinal').setAttribute('aria-pressed', 'false'); } renderForm(); return; }
  if (b.dataset.rem) { st.queue = st.queue.filter((e) => e.id !== b.dataset.rem); save(); render(); return; }
  if (b.dataset.undo) return desfazer(b.dataset.undo);
  switch (b.id) {
    case 'mesAnt': if (ui.month > 0) { ui.month--; render(); } break;
    case 'mesProx': if (ui.month < 14) { ui.month++; render(); } break;
    case 'sinal': ui.neg = !ui.neg; b.setAttribute('aria-pressed', ui.neg); atualizarPrevia(); break;
    case 'gravar': gravar(); break;
    case 'status':
      if (!st.settings.mode) irTela('ajustes');
      else if (st.settings.mode === 'onedrive' && !st.auth) login();
      else sincronizar(true);
      break;
    case 'syncAgora': sincronizar(true); break;
    case 'entrar': guardarCfg(); login(); break;
    case 'sair': logout(); break;
    case 'copiarRedir': navigator.clipboard?.writeText(redirectUri()).then(() => toast('Endereço copiado.')); break;
    case 'procurar': {
      guardarCfg();
      try {
        const itens = await buscarArquivos(st.settings.filePath.split('/').pop().replace(/\.xlsx$/i, '') || 'FINANCAS');
        if (!itens.length) { toast('Nenhuma planilha com esse nome no OneDrive.', true); break; }
        const it = itens.length === 1 ? itens[0] : await escolherDaLista(itens);
        if (!it) break;
        escolherArquivo(it); st.settings.mode = 'onedrive'; save(); cache = null;
        await sincronizar(true); toast('Planilha vinculada: ' + it.name);
      } catch (e) { toast(e.message, true); }
      break;
    }
    case 'abrirLocal1': case 'abrirLocal2': $('#arquivoLocal').click(); break;
    case 'baixar': {
      const c = cache || await idb.get('wb'); if (!c) break;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = c.name || 'FINANCAS_2026.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      break;
    }
    case 'renomear': {
      const k = +ui.f.person; const atual = model.emprestimo[ui.f.section][k];
      const nome = await perguntar('Renomear pessoa', `Novo nome para "${atual}" (vale para A receber e A pagar)`, /^[A-F]$|^Pessoa/.test(atual) ? '' : atual);
      if (nome) { st.queue.push({ id: uid(), kind: 'renomear', person: k, name: nome, createdAt: new Date().toISOString() }); save(); sincronizar(); toast('Renomeação enviada para a planilha.'); }
      break;
    }
    case 'limpar':
      if (await confirmar('Apagar dados do app?', 'Remove a conexão, a fila e o histórico deste celular. A planilha no OneDrive não é alterada.', 'Apagar')) {
        localStorage.removeItem(LS); await idb.del('wb'); await idb.del('log'); location.reload();
      }
      break;
  }
});
function guardarCfg() {
  const c = $('#cfgClient'), p = $('#cfgPath');
  if (c) st.settings.clientId = c.value.trim();
  if (p && p.value.trim() !== st.settings.filePath) { st.settings.filePath = p.value.trim(); st.settings.itemId = ''; }
  save();
}
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.f) {
    ui.f[t.dataset.f] = t.value;
    if (t.dataset.f === 'cat' && ui.kind === 'despesa') ui.f.item = '';
    if (t.dataset.f === 'date' && ui.kind !== 'cartao') { const m = mesDeData(t.value); if (m != null) ui.month = m; render(); return; }
    if (['cat', 'card', 'section', 'person'].includes(t.dataset.f)) { renderForm(); return; }
    atualizarPrevia();
  }
  if (t.id === 'cfgClient' || t.id === 'cfgPath') guardarCfg();
  if (t.id === 'cfgNotes') { st.settings.notes = t.checked; save(); }
  if (t.id === 'cfgCsv') { st.settings.csv = t.checked; save(); }
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'valor') atualizarPrevia();
  if (t.dataset.f === 'desc' || t.dataset.f === 'cardNovo') { ui.f[t.dataset.f] = t.value; if (t.dataset.f === 'cardNovo') atualizarPrevia(); }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.target.id === 'valor' || ev.target.dataset.f === 'desc') && !$('#gravar').disabled) { ev.preventDefault(); gravar(); } });
$('#arquivoLocal').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await guardarCache({ bytes, etag: 'local-' + Date.now(), at: Date.now(), name: f.name });
    st.settings.mode = 'local'; save(); ui.tela = 'lancar'; render();
    toast('Arquivo aberto no modo de teste.');
  } catch (e) { toast('Não consegui ler este arquivo: ' + e.message, true); }
  ev.target.value = '';
});
window.addEventListener('online', () => { statusUI(); sincronizar(); });
window.addEventListener('offline', statusUI);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });

/* ---------------- Início ---------------- */
(async function init() {
  try {
    await handleRedirect();
    const c = await idb.get('wb');
    if (c) await guardarCache(c);
  } catch (e) { console.error(e); }
  render();
  if (st.settings.mode === 'onedrive' && st.auth) sincronizar(true).then(() => { if (!st.queue.length) render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
