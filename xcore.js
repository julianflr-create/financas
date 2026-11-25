/* xcore.js — núcleo de leitura/edição cirúrgica do FINANCAS_2026.xlsx
 * Não depende de bibliotecas externas: usa CompressionStream/DecompressionStream
 * (Chrome/Android) para o zip e edita apenas os trechos de XML necessários,
 * preservando formatação, fórmulas, comentários e as demais abas byte a byte.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* ZIP                                                                 */
  /* ------------------------------------------------------------------ */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function through(u8, ts) {
    const s = new Blob([u8]).stream().pipeThrough(ts);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const inflate = (u8) => through(u8, new DecompressionStream('deflate-raw'));
  const deflate = (u8) => through(u8, new CompressionStream('deflate-raw'));

  function dosNow() {
    const d = new Date();
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  function readZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('O arquivo não é um .xlsx válido.');
    const count = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOffset === 0xFFFFFFFF) throw new Error('Formato ZIP64 não suportado.');
    const dec = new TextDecoder();
    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Estrutura interna do .xlsx corrompida.');
      const method = dv.getUint16(p + 10, true);
      const time = dv.getUint16(p + 12, true);
      const date = dv.getUint16(p + 14, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      entries.push({ name, method, time, date, crc, usize, raw: u8.subarray(start, start + csize) });
      p += 46 + nlen + elen + clen;
    }
    return entries;
  }

  function writeZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const nb = enc.encode(e.name);
      const flags = /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
      const lh = new Uint8Array(30 + nb.length);
      const d = new DataView(lh.buffer);
      d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, flags, true);
      d.setUint16(8, e.method, true); d.setUint16(10, e.time, true); d.setUint16(12, e.date, true);
      d.setUint32(14, e.crc, true); d.setUint32(18, e.raw.length, true); d.setUint32(22, e.usize, true);
      d.setUint16(26, nb.length, true); d.setUint16(28, 0, true);
      lh.set(nb, 30);
      parts.push(lh, e.raw);
      const ch = new Uint8Array(46 + nb.length);
      const c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, flags, true); c.setUint16(10, e.method, true); c.setUint16(12, e.time, true);
      c.setUint16(14, e.date, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.raw.length, true);
      c.setUint32(24, e.usize, true); c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + e.raw.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const eo = new Uint8Array(22);
    const ed = new DataView(eo.buffer);
    ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, entries.length, true);
    ed.setUint16(10, entries.length, true); ed.setUint32(12, cdSize, true); ed.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22);
    let q = 0;
    for (const x of parts) { out.set(x, q); q += x.length; }
    for (const x of central) { out.set(x, q); q += x.length; }
    out.set(eo, q);
    return out;
  }

  const LATIN1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; };
  const fromLatin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

  class Pkg {
    static async open(buf) {
      const p = new Pkg();
      p.entries = readZip(buf);
      p.texts = new Map();
      p.dirty = new Set();
      return p;
    }
    has(name) { return this.texts.has(name) || this.entries.some((e) => e.name === name); }
    names() { const s = new Set(this.entries.map((e) => e.name)); for (const k of this.texts.keys()) s.add(k); return [...s]; }
    isLatin1(name) { return /\.vml$/i.test(name); }
    async text(name) {
      if (this.texts.has(name)) return this.texts.get(name);
      const e = this.entries.find((x) => x.name === name);
      if (!e) return null;
      const data = e.method === 8 ? await inflate(e.raw) : e.raw;
      const t = this.isLatin1(name) ? fromLatin1(data) : new TextDecoder().decode(data);
      this.texts.set(name, t);
      return t;
    }
    set(name, text) { this.texts.set(name, text); this.dirty.add(name); }
    snapshot() { return { texts: new Map(this.texts), dirty: new Set(this.dirty) }; }
    restore(s) { this.texts = new Map(s.texts); this.dirty = new Set(s.dirty); }
    async save() {
      const enc = new TextEncoder();
      const now = dosNow();
      const out = [];
      const done = new Set();
      const pack = async (name, base) => {
        const t = this.texts.get(name);
        const u = this.isLatin1(name) ? LATIN1(t) : enc.encode(t);
        const raw = await deflate(u);
        return { ...(base || {}), name, method: 8, crc: crc32(u), usize: u.length, raw, time: now.time, date: now.date };
      };
      for (const e of this.entries) {
        done.add(e.name);
        out.push(this.dirty.has(e.name) ? await pack(e.name, e) : e);
      }
      for (const name of this.dirty) if (!done.has(name)) out.push(await pack(name));
      return writeZip(out);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Utilitários XML / referências                                       */
  /* ------------------------------------------------------------------ */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
  function parseAttrs(s) { const o = {}; String(s || '').replace(/([\w:.-]+)="([^"]*)"/g, (m, k, v) => { o[k] = unesc(v); }); return o; }
  function attrStr(o) { return Object.entries(o).map(([k, v]) => ` ${k}="${esc(v)}"`).join(''); }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function colNum(col) { let n = 0; for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function parseRef(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) throw new Error('Referência inválida: ' + ref); return { c: colNum(m[1]), r: +m[2], col: m[1] }; }
  const ref = (c, r) => (typeof c === 'number' ? colName(c) : c) + r;

  function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function baseOf(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function resolvePath(baseDir, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (baseDir ? baseDir.split('/') : []);
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  }
  function relTarget(fromDir, toPath) {
    const a = fromDir.split('/').filter(Boolean); const b = toPath.split('/').filter(Boolean);
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return '../'.repeat(a.length - i) + b.slice(i).join('/');
  }

  /* ------------------------------------------------------------------ */
  /* Números e fórmulas simples                                         */
  /* ------------------------------------------------------------------ */
  const round2 = (x) => Math.round((+x + Number.EPSILON) * 100) / 100;
  const clean = (x) => Number((+x).toPrecision(12));
  function numLit(n) {
    const v = clean(n);
    let s = String(v);
    if (/e/i.test(s)) s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  const numXml = (n) => String(Number((+n).toPrecision(15)));
  const isSimple = (f) => /^[\d.\s+\-*/()]+$/.test(f);
  function evalSimple(f) {
    const s = f.replace(/\s+/g, '');
    let i = 0;
    const peek = () => s[i];
    function num() {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\./.exec(s.slice(i));
      if (!m) throw new Error('expr');
      i += m[0].length; return parseFloat(m[0]);
    }
    function factor() {
      if (peek() === '+') { i++; return factor(); }
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '(') { i++; const v = expr(); if (s[i] !== ')') throw new Error('expr'); i++; return v; }
      return num();
    }
    function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const op = s[i++]; const w = factor(); v = op === '*' ? v * w : v / w; } return v; }
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const w = term(); v = op === '+' ? v + w : v - w; } return v; }
    const v = expr();
    if (i !== s.length) throw new Error('expr');
    return v;
  }
  function trySimple(f) { if (!isSimple(f)) return null; try { return evalSimple(f); } catch (e) { return null; } }

  /* ------------------------------------------------------------------ */
  /* Planilha                                                            */
  /* ------------------------------------------------------------------ */
  const CELL_RE = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  const ROW_RE = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;

  function parseCell(raw, attrsS, inner) {
    const a = parseAttrs(attrsS);
    const cell = { raw, a, ref: a.r, t: a.t || null, s: a.s || null, f: null, ft: null, v: null, is: null };
    if (inner) {
      let m = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      if (m) { cell.ft = parseAttrs(m[1]); cell.f = m[2] != null ? unesc(m[2]) : ''; }
      m = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (m) cell.v = unesc(m[1]);
      m = /<is>([\s\S]*?)<\/is>/.exec(inner);
      if (m) { let t = ''; m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (x, y) => { t += unesc(y); }); cell.is = t; }
    }
    return cell;
  }

  class Sheet {
    constructor(wb, name, path, xml) { this.wb = wb; this.name = name; this.path = path; this._xml = xml; this._cells = null; }
    get xml() { return this._xml; }
    set xml(x) { this._xml = x; this._cells = null; this.wb.pkg.set(this.path, x); }
    cells() {
      if (this._cells) return this._cells;
      const map = new Map();
      const sd = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(this._xml);
      if (sd) {
        let m; CELL_RE.lastIndex = 0;
        while ((m = CELL_RE.exec(sd[1]))) { const c = parseCell(m[0], m[1], m[3]); if (c.ref) map.set(c.ref, c); }
      }
      this._cells = map;
      return map;
    }
    cell(r) { return this.cells().get(r) || null; }
    isEmpty(r) { const c = this.cell(r); return !c || (c.f == null && (c.v == null || c.v === '') && c.is == null); }
    text(r) {
      const c = this.cell(r); if (!c) return '';
      if (c.t === 's') return (this.wb.ss[+c.v] ?? '').toString();
      if (c.t === 'inlineStr') return c.is ?? '';
      if (c.v != null) return String(c.v);
      return '';
    }
    num(r) {
      const c = this.cell(r); if (!c) return 0;
      if (c.t === 's' || c.t === 'inlineStr' || c.t === 'str' || c.t === 'e' || c.t === 'b') return 0;
      if (c.f != null && !(c.ft && c.ft.t)) { const v = trySimple(c.f); if (v != null) return v; }
      const n = parseFloat(c.v); return isFinite(n) ? n : 0;
    }
    formulaText(r) { const c = this.cell(r); return c && c.f != null ? c.f : null; }
    colStyle(c) {
      const m = /<cols>([\s\S]*?)<\/cols>/.exec(this._xml); if (!m) return null;
      let st = null;
      m[1].replace(/<col\b([^>]*)\/?>/g, (x, a) => { const o = parseAttrs(a); if (+o.min <= c && c <= +o.max && o.style) st = o.style; });
      return st;
    }
    /** Substitui o XML bruto de uma célula (cellXml=null remove a célula). */
    setRaw(r, cellXml) {
      const { c, r: row } = parseRef(r);
      let xml = this._xml;
      const sdm = /<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/.exec(xml);
      if (!sdm) throw new Error('Aba sem sheetData: ' + this.name);
      let sd = sdm[1] || '';
      let found = null; let m; ROW_RE.lastIndex = 0;
      const rows = [];
      while ((m = ROW_RE.exec(sd))) { const a = parseAttrs(m[1]); rows.push({ idx: m.index, len: m[0].length, r: +a.r, attrs: m[1], inner: m[3] || '', a }); }
      found = rows.find((x) => x.r === row);
      if (!found) {
        if (cellXml == null) return;
        const nr = `<row r="${row}">${cellXml}</row>`;
        const after = rows.find((x) => x.r > row);
        const pos = after ? after.idx : sd.length;
        sd = sd.slice(0, pos) + nr + sd.slice(pos);
      } else {
        let inner = found.inner;
        const list = []; CELL_RE.lastIndex = 0;
        while ((m = CELL_RE.exec(inner))) { const a = parseAttrs(m[1]); list.push({ idx: m.index, len: m[0].length, c: parseRef(a.r).c }); }
        const same = list.find((x) => x.c === c);
        if (same) inner = inner.slice(0, same.idx) + (cellXml || '') + inner.slice(same.idx + same.len);
        else if (cellXml != null) {
          const after = list.find((x) => x.c > c);
          const pos = after ? after.idx : inner.length;
          inner = inner.slice(0, pos) + cellXml + inner.slice(pos);
        }
        let attrs = found.attrs.replace(/\s*\/$/, '');
        const sp = /\bspans="(\d+):(\d+)"/.exec(attrs);
        if (sp && cellXml != null && (c < +sp[1] || c > +sp[2])) {
          attrs = attrs.replace(sp[0], `spans="${Math.min(c, +sp[1])}:${Math.max(c, +sp[2])}"`);
        }
        const nr = `<row${attrs}>${inner}</row>`;
        sd = sd.slice(0, found.idx) + nr + sd.slice(found.idx + found.len);
      }
      xml = xml.slice(0, sdm.index) + `<sheetData>${sd}</sheetData>` + xml.slice(sdm.index + sdm[0].length);
      // dimensão
      const dm = /<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/.exec(xml);
      if (dm && cellXml != null) {
        const c1 = colNum(dm[1]), r1 = +dm[2], c2 = dm[3] ? colNum(dm[3]) : c1, r2 = dm[4] ? +dm[4] : r1;
        const nc1 = Math.min(c1, c), nr1 = Math.min(r1, row), nc2 = Math.max(c2, c), nr2 = Math.max(r2, row);
        if (nc1 !== c1 || nr1 !== r1 || nc2 !== c2 || nr2 !== r2) xml = xml.replace(dm[0], `<dimension ref="${colName(nc1)}${nr1}:${colName(nc2)}${nr2}"/>`);
      }
      this.xml = xml;
    }
    buildCell(r, spec) {
      const old = this.cell(r);
      const a = { r };
      let s = old && old.s;
      if (!old) {
        const { c, r: row } = parseRef(r);
        const rm = new RegExp(`<row\\b[^>]*?\\br="${row}"[^>]*>`).exec(this._xml);
        if (rm) { const ra = parseAttrs(rm[0]); if (ra.customFormat === '1' && ra.s) s = ra.s; }
        if (!s) s = this.colStyle(c);
      }
      if (s) a.s = s;
      if (spec.str != null) { a.t = 'inlineStr'; return `<c${attrStr(a)}><is><t xml:space="preserve">${esc(spec.str)}</t></is></c>`; }
      if (spec.formula != null) return `<c${attrStr(a)}><f>${esc(spec.formula)}</f><v>${numXml(spec.cached)}</v></c>`;
      if (spec.num != null) return `<c${attrStr(a)}><v>${numXml(spec.num)}</v></c>`;
      return `<c${attrStr(a)}/>`;
    }
    /** Grava e devolve o registro de alteração (para desfazer). */
    write(r, spec) {
      const old = this.cell(r);
      const before = old ? old.raw : null;
      const after = this.buildCell(r, spec);
      this.setRaw(r, after);
      return { sheet: this.name, ref: r, before, after };
    }
    /** Soma x ao conteúdo atual da célula, mantendo o histórico em forma de fórmula (=a+b+c). */
    addValue(r, x) {
      x = round2(x);
      if (!x) throw new Error('Valor zero.');
      const c = this.cell(r);
      const empty = !c || (c.f == null && (c.v == null || c.v === ''));
      let spec;
      if (empty) spec = { num: x };
      else {
        if (c.t === 's' || c.t === 'inlineStr' || (c.t === 'str' && c.f == null)) throw new Error(`A célula ${this.name}!${r} contém texto; nada foi gravado.`);
        if (c.f != null) {
          if (c.ft && (c.ft.t === 'shared' || c.ft.t === 'array')) throw new Error(`A célula ${this.name}!${r} tem fórmula compartilhada; ajuste-a no Excel.`);
          const f = c.f.trim();
          const simple = isSimple(f) && trySimple(f) != null;
          const nf = (simple ? f : `(${f})`) + (x < 0 ? '-' + numLit(-x) : '+' + numLit(x));
          const cached = simple ? evalSimple(nf) : (parseFloat(c.v) || 0) + x;
          spec = { formula: nf, cached };
        } else {
          const n = parseFloat(c.v);
          if (!isFinite(n)) throw new Error(`Conteúdo inesperado em ${this.name}!${r}.`);
          if (n === 0) spec = { num: x };
          else { const nf = numLit(n) + (x < 0 ? '-' + numLit(-x) : '+' + numLit(x)); spec = { formula: nf, cached: evalSimple(nf) }; }
        }
      }
      const before = this.num(r);
      const ch = this.write(r, spec);
      ch.valueBefore = empty ? 0 : before;
      ch.valueAfter = this.num(r);
      ch.formula = this.formulaText(r);
      return ch;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pasta de trabalho                                                   */
  /* ------------------------------------------------------------------ */
  const NOTE_AUTHOR = 'App Finanças';
  const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml';
  const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
  const REL_VML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';
  const RUN_PR = '<rPr><sz val="10"/><rFont val="Arial"/><family val="2"/></rPr>';

  class Workbook {
    static async open(buf) { const wb = new Workbook(); wb.pkg = await Pkg.open(buf); await wb._init(); return wb; }
    async _init() {
      const wbx = await this.pkg.text('xl/workbook.xml');
      const rels = await this.pkg.text('xl/_rels/workbook.xml.rels');
      if (!wbx || !rels) throw new Error('Arquivo .xlsx sem workbook.xml.');
      const relMap = {};
      rels.replace(/<Relationship\b([^>]*?)\/?>/g, (m, a) => { const o = parseAttrs(a); relMap[o.Id] = o; });
      this.sheetFiles = {};
      wbx.replace(/<sheet\b([^>]*?)\/?>/g, (m, a) => {
        const o = parseAttrs(a); const rel = relMap[o['r:id']];
        if (rel) this.sheetFiles[o.name] = resolvePath('xl', rel.Target);
      });
      const ssRel = Object.values(relMap).find((r) => /\/sharedStrings$/.test(r.Type));
      this.ss = [];
      if (ssRel) {
        const ssx = await this.pkg.text(resolvePath('xl', ssRel.Target));
        if (ssx) ssx.replace(/<si>([\s\S]*?)<\/si>|<si\/>/g, (m, inner) => {
          let t = '';
          if (inner) inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\/>/g, (x, y) => { t += y ? unesc(y) : ''; });
          this.ss.push(t);
        });
      }
      this.sheets = {};
    }
    sheetNames() { return Object.keys(this.sheetFiles); }
    async sheet(name) {
      if (this.sheets[name]) return this.sheets[name];
      const path = this.sheetFiles[name];
      if (!path) throw new Error(`Aba "${name}" não encontrada na planilha.`);
      const sh = new Sheet(this, name, path, await this.pkg.text(path));
      this.sheets[name] = sh;
      return sh;
    }
    snapshot() { return { pkg: this.pkg.snapshot(), xml: Object.fromEntries(Object.entries(this.sheets).map(([k, s]) => [k, s._xml])) }; }
    restore(s) {
      this.pkg.restore(s.pkg);
      for (const [k, sh] of Object.entries(this.sheets)) { if (k in s.xml) { sh._xml = s.xml[k]; sh._cells = null; } else delete this.sheets[k]; }
    }
    async forceRecalc() {
      let x = await this.pkg.text('xl/workbook.xml');
      if (/<calcPr\b[^>]*fullCalcOnLoad="1"/.test(x)) return;
      if (/<calcPr\b/.test(x)) x = x.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, sl) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sl}>`);
      else if (/<\/definedNames>/.test(x)) x = x.replace('</definedNames>', '</definedNames><calcPr fullCalcOnLoad="1"/>');
      else x = x.replace('</sheets>', '</sheets><calcPr fullCalcOnLoad="1"/>');
      this.pkg.set('xl/workbook.xml', x);
    }
    async save() { await this.forceRecalc(); return this.pkg.save(); }

    /* ---------- comentários (notas) ---------- */
    async _rels(path) {
      const rp = dirOf(path) + '/_rels/' + baseOf(path) + '.rels';
      let x = await this.pkg.text(rp);
      if (!x) x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      const list = [];
      x.replace(/<Relationship\b([^>]*?)\/?>/g, (m, a) => { list.push(parseAttrs(a)); });
      return { rp, x, list };
    }
    _addRel(R, type, target) {
      let n = 1; const ids = new Set(R.list.map((r) => r.Id));
      while (ids.has('rId' + n)) n++;
      const id = 'rId' + n;
      const rel = `<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"/>`;
      R.x = /<Relationships\b[^>]*\/>/.test(R.x)
        ? R.x.replace(/<Relationships\b([^>]*)\/>/, `<Relationships$1>${rel}</Relationships>`)
        : R.x.replace('</Relationships>', rel + '</Relationships>');
      R.list.push({ Id: id, Type: type, Target: target });
      this.pkg.set(R.rp, R.x);
      return id;
    }
    _freeName(prefix, ext) { let n = 1; while (this.pkg.has(`${prefix}${n}.${ext}`)) n++; return `${prefix}${n}.${ext}`; }
    async _nextVmlBlock() {
      let max = 0;
      for (const n of this.pkg.names()) if (/\.vml$/i.test(n)) {
        const t = await this.pkg.text(n);
        const m = /<o:idmap\b[^>]*data="([^"]*)"/.exec(t || '');
        if (m) for (const d of m[1].split(',')) max = Math.max(max, parseInt(d, 10) || 0);
      }
      return max + 1;
    }
    async _noteParts(sh, create) {
      const R = await this._rels(sh.path);
      const base = dirOf(sh.path);
      let cRel = R.list.find((r) => r.Type === REL_COMMENTS);
      let vRel = R.list.find((r) => r.Type === REL_VML);
      if (!create && (!cRel || !vRel)) return null;
      if (!cRel) {
        const p = this._freeName('xl/comments', 'xml');
        this.pkg.set(p, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>${esc(NOTE_AUTHOR)}</author></authors><commentList></commentList></comments>`);
        this._addRel(R, REL_COMMENTS, relTarget(base, p));
        let ct = await this.pkg.text('[Content_Types].xml');
        ct = ct.replace('</Types>', `<Override PartName="/${p}" ContentType="${CT_COMMENTS}"/></Types>`);
        this.pkg.set('[Content_Types].xml', ct);
        cRel = R.list[R.list.length - 1];
      }
      if (!vRel) {
        const p = this._freeName('xl/drawings/vmlDrawing', 'vml');
        const block = await this._nextVmlBlock();
        this.pkg.set(p, `<xml xmlns:v="urn:schemas-microsoft-com:vml"\n xmlns:o="urn:schemas-microsoft-com:office:office"\n xmlns:x="urn:schemas-microsoft-com:office:excel">\n <o:shapelayout v:ext="edit">\n  <o:idmap v:ext="edit" data="${block}"/>\n </o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202"\n  path="m,l,21600r21600,l21600,xe">\n  <v:stroke joinstyle="miter"/>\n  <v:path gradientshapeok="t" o:connecttype="rect"/>\n </v:shapetype></xml>`);
        const id = this._addRel(R, REL_VML, relTarget(base, p));
        let ct = await this.pkg.text('[Content_Types].xml');
        if (!/Extension="vml"/i.test(ct)) {
          ct = ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>');
          this.pkg.set('[Content_Types].xml', ct);
        }
        vRel = R.list[R.list.length - 1];
        let x = sh.xml;
        if (/<legacyDrawing\b/.test(x)) throw new Error('Estrutura de desenhos inesperada na aba ' + sh.name);
        const tag = `<legacyDrawing r:id="${id}"/>`;
        const later = ['legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
        let pos = -1;
        for (const t of later) { const i = x.search(new RegExp(`<${t}\\b`)); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
        if (pos < 0) pos = x.lastIndexOf('</worksheet>');
        if (!/xmlns:r="/.test(x.slice(0, x.indexOf('>', x.indexOf('<worksheet')))))
          x = x.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
        sh.xml = x.slice(0, pos) + tag + x.slice(pos);
      }
      return { commentsPath: resolvePath(base, cRel.Target), vmlPath: resolvePath(base, vRel.Target) };
    }

    /** Acrescenta uma linha de texto à nota da célula (cria a nota se não existir). */
    async addNote(sheetName, r, text) {
      const sh = await this.sheet(sheetName);
      const parts = await this._noteParts(sh, true);
      let cx = await this.pkg.text(parts.commentsPath);
      cx = cx.replace(/<commentList\s*\/>/, '<commentList></commentList>');
      // autor
      const authors = []; const am = /<authors>([\s\S]*?)<\/authors>|<authors\s*\/>/.exec(cx);
      if (am && am[1]) am[1].replace(/<author>([\s\S]*?)<\/author>|<author\/>/g, (m, a) => { authors.push(unesc(a || '')); });
      let aid = authors.indexOf(NOTE_AUTHOR);
      if (aid < 0) {
        aid = authors.length;
        cx = am ? (am[1] != null ? cx.replace('</authors>', `<author>${esc(NOTE_AUTHOR)}</author></authors>`) : cx.replace(am[0], `<authors><author>${esc(NOTE_AUTHOR)}</author></authors>`))
          : cx.replace(/(<comments\b[^>]*>)/, `$1<authors><author>${esc(NOTE_AUTHOR)}</author></authors>`);
      }
      const re = new RegExp(`<comment\\b[^>]*\\bref="${reEsc(r)}"[^>]*>([\\s\\S]*?)<\\/comment>`);
      const m = re.exec(cx);
      let created = false;
      if (m) {
        const inner = m[1];
        let ni;
        if (/<r>/.test(inner)) ni = inner.replace(/<\/text>\s*$/, () => `<r>${RUN_PR}<t xml:space="preserve">\n${esc(text)}</t></r></text>`);
        else ni = inner.replace(/<t\b[^>]*>([\s\S]*?)<\/t>(?![\s\S]*<t\b)/, (x, y) => `<t xml:space="preserve">${y}\n${esc(text)}</t>`);
        cx = cx.slice(0, m.index) + m[0].replace(inner, () => ni) + cx.slice(m.index + m[0].length);
      } else {
        created = true;
        const el = `<comment ref="${r}" authorId="${aid}" shapeId="0"><text><r>${RUN_PR}<t xml:space="preserve">${esc(text)}</t></r></text></comment>`;
        const me = parseRef(r);
        let pos = -1; let mm; const cre = /<comment\b[^>]*\bref="([A-Z]+\d+)"/g;
        while ((mm = cre.exec(cx))) { const o = parseRef(mm[1]); if (o.r > me.r || (o.r === me.r && o.c > me.c)) { pos = mm.index; break; } }
        if (pos < 0) pos = cx.indexOf('</commentList>');
        cx = cx.slice(0, pos) + el + cx.slice(pos);
        await this._addShape(parts.vmlPath, me);
      }
      this.pkg.set(parts.commentsPath, cx);
      return { sheet: sheetName, ref: r, text, created };
    }
    async _addShape(vmlPath, me) {
      let vx = await this.pkg.text(vmlPath);
      const im = /<o:idmap\b[^>]*data="([^"]*)"/.exec(vx);
      const blocks = im ? im[1].split(',').map((d) => parseInt(d, 10)).filter((n) => !isNaN(n)) : [1];
      let max = 0; vx.replace(/_x0000_s(\d+)/g, (x, n) => { max = Math.max(max, +n); });
      let id = Math.max(max + 1, Math.min(...blocks) * 1024 + 1);
      const inBlock = (n) => blocks.includes(Math.floor(n / 1024));
      if (!inBlock(id)) {
        const nb = await this._nextVmlBlock(); blocks.push(nb); id = nb * 1024 + 1;
        vx = vx.replace(im[0], im[0].replace(/data="[^"]*"/, `data="${blocks.join(',')}"`));
      }
      if (!/_x0000_t202/.test(vx)) {
        vx = vx.replace('</xml>', `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202"\n  path="m,l,21600r21600,l21600,xe">\n  <v:stroke joinstyle="miter"/>\n  <v:path gradientshapeok="t" o:connecttype="rect"/>\n </v:shapetype></xml>`);
      }
      let z = 0; vx.replace(/z-index:(\d+)/g, (x, n) => { z = Math.max(z, +n); });
      const r0 = me.r - 1, c0 = me.c - 1;
      const shape = `<v:shape id="_x0000_s${id}" type="#_x0000_t202" style='position:absolute;\n  margin-left:60pt;margin-top:2pt;width:150pt;height:60pt;z-index:${z + 1};\n  visibility:hidden' fillcolor="#ffffe1" o:insetmode="auto">\n  <v:fill color2="#ffffe1"/>\n  <v:shadow on="t" color="black" obscured="t"/>\n  <v:path o:connecttype="none"/>\n  <v:textbox style='mso-direction-alt:auto'>\n   <div style='text-align:left'></div>\n  </v:textbox>\n  <x:ClientData ObjectType="Note">\n   <x:MoveWithCells/>\n   <x:SizeWithCells/>\n   <x:Anchor>\n    ${c0 + 1}, 15, ${r0}, 10, ${c0 + 3}, 15, ${r0 + 4}, 4</x:Anchor>\n   <x:AutoFill>False</x:AutoFill>\n   <x:Row>${r0}</x:Row>\n   <x:Column>${c0}</x:Column>\n  </x:ClientData>\n </v:shape>`;
      vx = vx.replace(/<\/xml>\s*$/, shape + '</xml>');
      this.pkg.set(vmlPath, vx);
    }
    /** Remove o texto acrescentado por addNote (desfazer). */
    async removeNote(note) {
      const sh = await this.sheet(note.sheet);
      const parts = await this._noteParts(sh, false);
      if (!parts) return false;
      let cx = await this.pkg.text(parts.commentsPath);
      const re = new RegExp(`<comment\\b[^>]*\\bref="${reEsc(note.ref)}"[^>]*>([\\s\\S]*?)<\\/comment>`);
      const m = re.exec(cx);
      if (!m) return false;
      if (note.created) {
        cx = cx.slice(0, m.index) + cx.slice(m.index + m[0].length);
        let vx = await this.pkg.text(parts.vmlPath);
        const me = parseRef(note.ref);
        const sre = /<v:shape\b[\s\S]*?<\/v:shape>/g; let sm;
        while ((sm = sre.exec(vx))) {
          const row = /<x:Row>(\d+)<\/x:Row>/.exec(sm[0]); const col = /<x:Column>(\d+)<\/x:Column>/.exec(sm[0]);
          if (row && col && +row[1] === me.r - 1 && +col[1] === me.c - 1 && /ObjectType="Note"/.test(sm[0])) {
            vx = vx.slice(0, sm.index) + vx.slice(sm.index + sm[0].length); break;
          }
        }
        this.pkg.set(parts.vmlPath, vx);
      } else {
        const t = esc(note.text);
        const run = `<r>${RUN_PR}<t xml:space="preserve">\n${t}</t></r>`;
        let inner = m[1];
        if (inner.includes(run)) inner = inner.replace(run, '');
        else if (inner.includes('\n' + t + '</t>')) inner = inner.replace('\n' + t + '</t>', '</t>');
        else return false;
        cx = cx.slice(0, m.index) + m[0].replace(m[1], () => inner) + cx.slice(m.index + m[0].length);
      }
      this.pkg.set(parts.commentsPath, cx);
      return true;
    }
    async noteText(sheetName, r) {
      const sh = await this.sheet(sheetName);
      const parts = await this._noteParts(sh, false);
      if (!parts) return '';
      const cx = await this.pkg.text(parts.commentsPath);
      const m = new RegExp(`<comment\\b[^>]*\\bref="${reEsc(r)}"[^>]*>([\\s\\S]*?)<\\/comment>`).exec(cx);
      if (!m) return '';
      let t = ''; m[1].replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (x, y) => { t += unesc(y); });
      return t;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mapeamento do FINANCAS_2026                                        */
  /* ------------------------------------------------------------------ */
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MONTHS = Array.from({ length: 15 }, (_, i) => {
    const y = 2026 + Math.floor(i / 12); const m = i % 12;
    return { i, y, m, label: `${MES[m]}/${y}`, short: `${MES[m].toLowerCase()}/${String(y).slice(2)}` };
  });
  const S = { rec: 'Receitas', des: 'Despesas', car: 'Cartões', emp: 'Empréstimo', via: 'Viagem', inv: 'Investimento', plan: 'Plan1' };
  /* Grupos editáveis da aba Investimento: título na coluna "col" (Entrada) e col+1 (Saída). */
  const INV_GROUPS = [
    { label: 'Poupança Poupex', col: 'G', titles: ['poupanca', 'poupanca poupex', 'poupex'] },
    { label: 'Poupança Ouro', col: 'G', titles: ['poupanca ouro'] },
    { label: 'BB RF LP High', col: 'G', titles: ['bb rf lp high'] },
    { label: 'Tesouro Selic 2031', col: 'G', titles: ['tesouro selic 2031'] },
    { label: 'Conta XP', col: 'N', titles: ['xp e clear (saldo financeiro)', 'conta xp', 'xp e clear'], fuzzy: /\bxp\b/ },
    { label: 'Criptomoedas', col: 'N', titles: ['criptomoedas'] },
    { label: 'Ações no Banco do Brasil', col: 'N', titles: ['acoes no banco do brasil'] },
  ];
  const monthCol = (i) => (i < 12 ? colName(2 + i) : colName(15 + i - 12)); // Despesas/Plan1: B..M, O..Q
  const recRow = (i) => (i < 12 ? 5 + i : 18 + i - 12);
  const carHeader = (i) => 2 + 8 * i;
  const CAR_FIRST = 4, CAR_LAST = colNum('CZ');
  function viaBlock(i) {
    if (i < 6) return { header: 3, first: 5, last: 15, itemCol: 1 + 3 * i };
    if (i < 12) return { header: 18, first: 20, last: 30, itemCol: 1 + 3 * (i - 6) };
    return { header: 33, first: 34, last: 44, itemCol: 1 + 3 * (i - 12) };
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmtBR = (n) => (+n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ddmm = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
  const pad2 = (n) => String(n).padStart(2, '0');

  function structErr(aba, msg) { return new Error(`A estrutura da aba ${aba} não é a esperada (${msg}). Nada foi gravado.`); }

  async function readModel(wb) {
    const model = { months: MONTHS };
    // Receitas
    const rec = await wb.sheet(S.rec);
    model.receitas = {
      cols: ['B', 'C', 'D', 'E'].map((c) => ({ col: c, label: rec.text(c + '4').trim(), group: (c === 'B' || c === 'C') ? rec.text('B2').trim() : rec.text('D2').trim() })),
    };
    // Despesas
    const des = await wb.sheet(S.des);
    const cats = []; let cur = null;
    for (let r = 3; r <= 200; r++) {
      const label = des.text('A' + r).trim();
      const fb = des.formulaText('B' + r);
      if (fb && /^SUM\(/i.test(fb.trim())) { cur = { name: label, row: r, items: [] }; cats.push(cur); continue; }
      if (!label) { if (r > 70) break; continue; }
      if (cur) cur.items.push({ label, row: r });
    }
    if (!cats.length) throw structErr(S.des, 'categorias não encontradas');
    model.despesas = { cats };
    // Cartões
    const car = await wb.sheet(S.car);
    const blocks = []; const names = [];
    for (const mo of MONTHS) {
      const h = carHeader(mo.i);
      const ok = norm(car.text('D' + h)) === 'itens';
      const cards = [];
      if (ok) for (let r = h + 1; r <= h + 5; r++) {
        const name = car.text('A' + r).trim();
        if (name) { cards.push({ row: r, name, day: car.text('B' + r).trim() }); if (!names.some((n) => norm(n) === norm(name))) names.push(name); }
      }
      blocks.push({ i: mo.i, header: h, ok, cards });
    }
    model.cartoes = { blocks, names };
    // Empréstimo
    const emp = await wb.sheet(S.emp);
    const people = (row) => Array.from({ length: 6 }, (_, k) => emp.text(colName(2 + 6 * k) + row).trim() || `Pessoa ${k + 1}`);
    model.emprestimo = { receber: people(2), pagar: people(18) };
    // Viagem
    const via = await wb.sheet(S.via);
    model.viagem = {
      items: (() => { const b = viaBlock(0); const out = []; for (let r = b.first; r <= b.last; r++) out.push(via.text(colName(b.itemCol) + r).trim()); return out.filter(Boolean); })(),
      destino: via.text('S3').trim(),
    };
    // Investimento
    model.investimento = { groups: [] };
    if (wb.sheetFiles[S.inv]) {
      const inv = await wb.sheet(S.inv);
      for (const g of INV_GROUPS) { const f = invFind(inv, g); if (f) model.investimento.groups.push({ label: g.label, ...f }); }
    }
    return model;
  }

  /** Localiza o bloco de um grupo de investimento pelo título; devolve colunas e linha de janeiro. */
  function invFind(sh, g) {
    const c = colNum(g.col);
    for (let r = 1; r <= 400; r++) {
      const t = norm(sh.text(g.col + r));
      if (!g.titles.includes(t) && !(g.fuzzy && g.fuzzy.test(t))) continue;
      const hr = r + 1;
      if (norm(sh.text(g.col + hr)) !== 'entrada' || norm(sh.text(colName(c + 1) + hr)) !== 'saida') continue;
      return { inCol: g.col, outCol: colName(c + 1), dateCol: colName(c - 1), title: r, jan: r + 3 };
    }
    return null;
  }

  function noteLine(e) {
    const d = ddmm(e.date);
    return [d, (e.desc || '').trim()].filter(Boolean).join(' ');
  }

  /** Aplica um lançamento. Devolve { changes, notes, lines, warnings }. */
  async function applyEntry(wb, e, opts = {}) {
    const useNotes = opts.notes !== false;
    const out = { changes: [], notes: [], lines: [], warnings: [] };
    const val = round2(e.value);
    if (!isFinite(val) || val === 0) throw new Error('Informe um valor diferente de zero.');
    const mo = MONTHS[e.month];
    if (!mo) throw new Error('Mês inválido.');
    const add = async (sh, r, x, label, note) => {
      const ch = sh.addValue(r, x);
      out.changes.push(ch);
      out.lines.push({ sheet: sh.name, ref: r, label, before: ch.valueBefore, after: ch.valueAfter, formula: ch.formula });
      if (useNotes && note) out.notes.push(await wb.addNote(sh.name, r, note));
    };

    if (e.kind === 'receita') {
      const sh = await wb.sheet(S.rec);
      const row = recRow(e.month);
      if (!/Plan1!/i.test(sh.formulaText('A' + row) || '')) throw structErr(S.rec, `linha ${row}`);
      if (!['B', 'C', 'D', 'E'].includes(e.col)) throw new Error('Tipo de receita inválido.');
      const lab = sh.text(e.col + '4').trim();
      await add(sh, e.col + row, val, `Receitas › ${lab} › ${mo.label}`, e.desc ? noteLine(e) : '');
    } else if (e.kind === 'despesa') {
      const sh = await wb.sheet(S.des);
      const m = await readModel(wb);
      const cat = m.despesas.cats.find((c) => norm(c.name) === norm(e.cat));
      if (!cat) throw new Error(`Categoria "${e.cat}" não encontrada em Despesas.`);
      const it = cat.items.find((x) => norm(x.label) === norm(e.item));
      if (!it) throw new Error(`Item "${e.item}" não encontrado em ${cat.name}.`);
      await add(sh, monthCol(e.month) + it.row, val, `Despesas › ${cat.name.trim()} › ${it.label} › ${mo.label}`, e.desc ? noteLine(e) : '');
    } else if (e.kind === 'cartao') {
      const sh = await wb.sheet(S.car);
      const n = Math.max(1, Math.min(48, parseInt(e.parcelas || 1, 10)));
      const total = val;
      const base = Math.floor((total / n) * 100) / 100;
      const first = round2(total - base * (n - 1));
      const cat = (e.cat || 'Outros lançamentos').trim();
      for (let k = 0; k < n; k++) {
        const mi = e.month + k;
        const pv = k === 0 ? first : base;
        if (mi >= MONTHS.length) { out.warnings.push(`Parcelas ${k + 1} a ${n} cairiam depois de ${MONTHS[MONTHS.length - 1].label} e não foram lançadas (a planilha vai só até lá).`); break; }
        const h = carHeader(mi);
        if (norm(sh.text('D' + h)) !== 'itens') throw structErr(S.car, `cabeçalho do mês ${MONTHS[mi].label}`);
        let row = null;
        for (let r = h + 1; r <= h + 5; r++) if (norm(sh.text('A' + r)) === norm(e.card)) { row = r; break; }
        if (!row) {
          for (let r = h + 1; r <= h + 5; r++) if (!sh.text('A' + r).trim()) { row = r; break; }
          if (!row) throw new Error(`Não há linha livre para o cartão "${e.card}" em ${MONTHS[mi].label}.`);
          out.changes.push(sh.write('A' + row, { str: e.card }));
          const day = (e.cardDay || '').trim();
          if (day) out.changes.push(sh.write('B' + row, { str: day }));
          out.warnings.push(`Cartão "${e.card}" adicionado na fatura de ${MONTHS[mi].label}.`);
        }
        let last = CAR_FIRST - 1;
        for (let c = CAR_FIRST; c <= CAR_LAST; c++) if (!sh.isEmpty(colName(c) + row)) last = c;
        const col = last + 1;
        if (col > CAR_LAST) throw new Error(`A linha do cartão em ${MONTHS[mi].label} está cheia (coluna CZ).`);
        const r = colName(col) + row;
        const ch = sh.write(r, { num: pv });
        ch.valueBefore = 0; ch.valueAfter = pv;
        out.changes.push(ch);
        out.lines.push({ sheet: S.car, ref: r, label: `Cartões › ${e.card} › fatura ${MONTHS[mi].label}${n > 1 ? ` (parcela ${k + 1}/${n})` : ''}`, before: null, after: pv });
        if (useNotes) {
          const desc = (e.desc || '').trim() + (n > 1 ? ` PARC ${pad2(k + 1)}/${pad2(n)}` : '');
          const note = `${n > 1 ? 'Compras parceladas' : cat} - ${ddmm(e.date)}` + (desc.trim() ? `\n${desc.trim()}` : '') + (n > 1 && cat !== 'Compras parceladas' ? ` (${cat})` : '');
          out.notes.push(await wb.addNote(S.car, r, note));
        }
      }
    } else if (e.kind === 'emprestimo') {
      if (e.month > 11) throw new Error('A aba Empréstimo vai só até Dez/2026.');
      const sh = await wb.sheet(S.emp);
      const sec = e.section === 'pagar' ? 'pagar' : 'receber';
      const hdr = sec === 'receber' ? 3 : 19;
      const k = +e.person; if (!(k >= 0 && k < 6)) throw new Error('Pessoa inválida.');
      const vc = colName(1 + 6 * k), pc = colName(3 + 6 * k);
      if (norm(sh.text(vc + hdr)) !== 'valor') throw structErr(S.emp, `cabeçalho ${vc}${hdr}`);
      const row = (sec === 'receber' ? 4 : 20) + e.month;
      const col = e.op === 'pago' ? pc : vc;
      const who = sh.text(colName(2 + 6 * k) + (sec === 'receber' ? 2 : 18)).trim();
      const opLabel = sec === 'receber' ? (e.op === 'pago' ? 'recebi de volta' : 'emprestei') : (e.op === 'pago' ? 'paguei' : 'peguei emprestado');
      await add(sh, col + row, val, `Empréstimo › ${sec === 'receber' ? 'A receber' : 'A pagar'} › ${who} › ${opLabel} › ${mo.label}`, e.desc ? noteLine(e) : '');
    } else if (e.kind === 'viagem') {
      const sh = await wb.sheet(S.via);
      const b = viaBlock(e.month);
      let row = null;
      for (let r = b.first; r <= b.last; r++) if (norm(sh.text(colName(b.itemCol) + r)) === norm(e.item)) { row = r; break; }
      if (!row) throw new Error(`Item de viagem "${e.item}" não encontrado em ${mo.label}.`);
      await add(sh, colName(b.itemCol + 1) + row, val, `Viagem › ${e.item} › ${mo.label}`, e.desc ? noteLine(e) : '');
    } else if (e.kind === 'investimento') {
      if (e.month > 11) throw new Error('A aba Investimento vai só até Dez/2026.');
      const sh = await wb.sheet(S.inv);
      const g = INV_GROUPS.find((x) => norm(x.label) === norm(e.group));
      if (!g) throw new Error(`Grupo de investimento "${e.group}" não é editável pelo app.`);
      const f = invFind(sh, g);
      if (!f) throw structErr(S.inv, `grupo ${g.label} não encontrado`);
      const row = f.jan + e.month;
      const pc = colName(2 + e.month) + '2';
      if (!new RegExp(`Plan1!\\$?${pc.replace(/\d+$/, '')}\\$?2\\b`).test(sh.formulaText(f.dateCol + row) || '')) throw structErr(S.inv, `linha de ${mo.label} em ${g.label}`);
      const col = e.op === 'resgate' ? f.outCol : f.inCol;
      await add(sh, col + row, val, `Investimento › ${g.label} › ${e.op === 'resgate' ? 'resgate' : 'aplicação'} › ${mo.label}`, e.desc ? noteLine(e) : '');
    } else {
      throw new Error('Tipo de lançamento desconhecido: ' + e.kind);
    }
    return out;
  }

  /** Renomeia uma pessoa na aba Empréstimo (nas duas seções). */
  async function renamePerson(wb, k, name) {
    const sh = await wb.sheet(S.emp);
    const changes = [];
    for (const row of [2, 18]) changes.push(sh.write(colName(2 + 6 * k) + row, { str: name }));
    return { changes, notes: [], lines: [{ label: `Empréstimo › pessoa ${k + 1} → ${name}` }], warnings: [] };
  }

  /** Aplica vários lançamentos; cada um é atômico (erro desfaz só aquele). */
  async function applyAll(wb, entries, opts) {
    const results = [];
    for (const e of entries) {
      const snap = wb.snapshot();
      try {
        const r = e.kind === 'renomear' ? await renamePerson(wb, +e.person, e.name) : await applyEntry(wb, e, opts);
        results.push({ id: e.id, ok: true, ...r });
      } catch (err) {
        wb.restore(snap);
        results.push({ id: e.id, ok: false, error: err.message || String(err) });
      }
    }
    return results;
  }

  /** Desfaz um lançamento já gravado, se as células não mudaram desde então. */
  async function undoEntry(wb, rec) {
    const snap = wb.snapshot();
    try {
      for (const ch of [...rec.changes].reverse()) {
        const sh = await wb.sheet(ch.sheet);
        const cur = sh.cell(ch.ref);
        if ((cur ? cur.raw : null) !== ch.after) throw new Error(`A célula ${ch.sheet}!${ch.ref} foi alterada depois deste lançamento; desfaça manualmente no Excel.`);
        sh.setRaw(ch.ref, ch.before);
      }
      for (const n of [...(rec.notes || [])].reverse()) await wb.removeNote(n);
      return true;
    } catch (err) { wb.restore(snap); throw err; }
  }

  /** Resumo do mês calculado a partir das 5 abas editáveis. */
  async function monthSummary(wb, model, i) {
    const rec = await wb.sheet(S.rec), des = await wb.sheet(S.des), car = await wb.sheet(S.car), via = await wb.sheet(S.via), emp = await wb.sheet(S.emp);
    const rr = recRow(i);
    const receitas = model.receitas.cols.map((c) => ({ label: c.label, total: rec.num(c.col + rr) }));
    const mc = monthCol(i);
    const cats = model.despesas.cats.map((c) => ({ name: c.name.trim(), total: c.items.reduce((a, it) => a + des.num(mc + it.row), 0) }));
    const blk = model.cartoes.blocks[i];
    const cards = blk.cards.map((cd) => { let t = 0; for (let c = CAR_FIRST; c <= CAR_LAST; c++) t += car.num(colName(c) + cd.row); return { name: cd.name, total: t }; });
    const b = viaBlock(i); let vt = 0; for (let r = b.first; r <= b.last; r++) vt += via.num(colName(b.itemCol + 1) + r);
    let empRec = 0, empPag = 0;
    if (i < 12) for (let k = 0; k < 6; k++) { empRec += emp.num(colName(3 + 6 * k) + (4 + i)); empPag += emp.num(colName(3 + 6 * k) + (20 + i)); }
    const sum = (a) => a.reduce((x, y) => x + y.total, 0);
    let aportes = 0, resgates = 0;
    if (i < 12 && model.investimento && model.investimento.groups.length) {
      const inv = await wb.sheet(S.inv);
      for (const g of model.investimento.groups) { aportes += inv.num(g.inCol + (g.jan + i)); resgates += inv.num(g.outCol + (g.jan + i)); }
    }
    return { receitas, receitasTotal: sum(receitas), cats, despesasTotal: sum(cats), cards, cartoesTotal: sum(cards), viagem: vt, empRecebido: empRec, empPago: empPag, aportes, resgates };
  }

  /* ------------------------------------------------------------------ */
  /* Calculadora de fórmulas (para o Saldo da Plan1)                     */
  /* ------------------------------------------------------------------ */
  const SERIAL0 = Date.UTC(1899, 11, 30);
  const toSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - SERIAL0) / 86400000);
  class XErr { constructor(e) { this.e = e; } }
  const isErr = (v) => v instanceof XErr;
  class Unsupported extends Error {}
  const REF_SRC = "(?:(?:'((?:[^']|'')+)'|([A-Za-z_\\u00C0-\\u024F][\\w.\\u00C0-\\u024F]*))!)?(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Z]{1,3})(\\$?)(\\d+))?";

  function tokenize(f) {
    const out = []; let i = 0;
    const refRe = new RegExp('^' + REF_SRC + '(?![\\w(])');
    while (i < f.length) {
      const ch = f[i]; const rest = f.slice(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') { let j = i + 1, v = ''; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += f[j++]; } out.push({ t: 'str', v }); i = j + 1; continue; }
      let m = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(rest);
      if (m) { out.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
      m = /^(_xlfn\.)?([A-Za-z][A-Za-z0-9.]*)\(/.exec(rest);
      if (m) { out.push({ t: 'fn', v: m[2].toUpperCase() }); i += m[0].length; continue; }
      m = refRe.exec(rest);
      if (m) {
        const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2] || null;
        out.push(m[8] ? { t: 'range', sheet, c1: colNum(m[4]), r1: +m[6], c2: colNum(m[8]), r2: +m[10] } : { t: 'ref', sheet, c: colNum(m[4]), r: +m[6] });
        i += m[0].length; continue;
      }
      m = /^(TRUE|FALSE)(?![\w(])/i.exec(rest);
      if (m) { out.push({ t: 'bool', v: m[1].toUpperCase() === 'TRUE' }); i += m[1].length; continue; }
      m = /^(<=|>=|<>|[-+*/^&=<>%(),;])/.exec(rest);
      if (m) { out.push({ t: 'op', v: m[1] === ';' ? ',' : m[1] }); i += m[1].length; continue; }
      if (rest.startsWith('#')) { m = /^#[A-Z0-9/!?]+/.exec(rest); out.push({ t: 'err', v: m ? m[0] : '#ERR' }); i += m ? m[0].length : 1; continue; }
      throw new Unsupported('Token: ' + rest.slice(0, 12));
    }
    return out;
  }
  /** Desloca referências relativas (fórmulas compartilhadas do Excel). */
  function shiftFormula(f, dr, dc) {
    const re = new RegExp(REF_SRC + '(?![\\w(])', 'g');
    let out = '', last = 0, inStr = false;
    // percorre fora de strings
    const parts = f.split('"');
    return parts.map((seg, k) => (k % 2 ? seg : seg.replace(re, (all, q, sn, d1, c1, d2, r1, d3, c2, d4, r2, off, whole) => {
      const prev = whole[off - 1];
      if (prev && /[A-Za-z0-9_.]/.test(prev) && !q && !sn) return all;
      const sp = all.slice(0, all.length - (all.length - all.indexOf(d1 + c1 + d2 + r1, all.lastIndexOf('!') + 1)));
      const one = (d, c, e, r) => (d ? '$' + c : colName(colNum(c) + dc)) + (e ? '$' + r : String(+r + dr));
      return sp + one(d1, c1, d2, r1) + (c2 ? ':' + one(d3, c2, d4, r2) : '');
    }))).join('"');
  }
  function parseFormula(f) {
    const tk = tokenize(f); let p = 0;
    const peek = () => tk[p]; const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
    function primary() {
      const t = tk[p++];
      if (!t) throw new Unsupported('Fim inesperado');
      if (t.t === 'num' || t.t === 'str' || t.t === 'bool') return { k: 'lit', v: t.v };
      if (t.t === 'err') return { k: 'lit', v: new XErr(t.v) };
      if (t.t === 'ref' || t.t === 'range') return { k: t.t, ...t };
      if (t.t === 'fn') {
        const args = [];
        if (isOp(')')) { p++; return { k: 'fn', name: t.v, args }; }
        for (;;) {
          if (isOp(',')) { args.push({ k: 'lit', v: null }); p++; continue; }
          args.push(cmp());
          if (isOp(',')) { p++; if (isOp(')')) { args.push({ k: 'lit', v: null }); } continue; }
          if (isOp(')')) { p++; break; }
          throw new Unsupported('Função mal formada');
        }
        return { k: 'fn', name: t.v, args };
      }
      if (t.t === 'op' && t.v === '(') { const e = cmp(); if (!isOp(')')) throw new Unsupported('Parêntese'); p++; return e; }
      throw new Unsupported('Token inesperado ' + t.v);
    }
    function postfix() { let e = primary(); while (isOp('%')) { p++; e = { k: 'pct', a: e }; } return e; }
    function unary() { if (isOp('-')) { p++; return { k: 'neg', a: unary() }; } if (isOp('+')) { p++; return unary(); } return postfix(); }
    function pow() { let e = unary(); while (isOp('^')) { p++; e = { k: 'bin', op: '^', a: e, b: unary() }; } return e; }
    function mul() { let e = pow(); while (isOp('*') || isOp('/')) { const op = tk[p++].v; e = { k: 'bin', op, a: e, b: pow() }; } return e; }
    function add() { let e = mul(); while (isOp('+') || isOp('-')) { const op = tk[p++].v; e = { k: 'bin', op, a: e, b: mul() }; } return e; }
    function cat() { let e = add(); while (isOp('&')) { p++; e = { k: 'bin', op: '&', a: e, b: add() }; } return e; }
    function cmp() { let e = cat(); while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = tk[p++].v; e = { k: 'bin', op, a: e, b: cat() }; } return e; }
    const e = cmp();
    if (p !== tk.length) throw new Unsupported('Sobra na fórmula');
    return e;
  }

  class Calc {
    constructor(wb, today) {
      this.wb = wb; this.vals = new Map(); this.busy = new Set(); this.ast = new Map(); this.masters = new Map();
      const d = today || new Date();
      this.today = toSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    static async create(wb, today) {
      for (const n of wb.sheetNames()) await wb.sheet(n);
      return new Calc(wb, today);
    }
    sheet(n) { const s = this.wb.sheets[n]; if (!s) throw new Unsupported('Aba ' + n); return s; }
    master(sh, si) {
      const key = sh.name + '|' + si;
      if (!this.masters.has(key)) {
        let m = null;
        for (const c of sh.cells().values()) if (c.ft && c.ft.t === 'shared' && c.ft.si === si && c.ft.ref && c.f) { m = c; break; }
        this.masters.set(key, m);
      }
      return this.masters.get(key);
    }
    formulaOf(sh, c) {
      if (c.ft && c.ft.t === 'shared' && !c.f) {
        const m = this.master(sh, c.ft.si); if (!m) throw new Unsupported('Fórmula compartilhada sem origem em ' + sh.name + '!' + c.ref);
        const a = parseRef(m.ref), b = parseRef(c.ref);
        return shiftFormula(m.f, b.r - a.r, b.c - a.c);
      }
      if (c.ft && c.ft.t === 'array') throw new Unsupported('Fórmula matricial');
      return c.f;
    }
    value(sheetName, c, r) {
      const ref = colName(c) + r; const key = sheetName + '!' + ref;
      if (this.vals.has(key)) return this.vals.get(key);
      if (this.busy.has(key)) throw new Unsupported('Referência circular em ' + key);
      const sh = this.sheet(sheetName); const cell = sh.cell(ref);
      let v = null;
      if (cell) {
        if (cell.f != null) {
          this.busy.add(key);
          try {
            const f = this.formulaOf(sh, cell);
            let ast = this.ast.get(f); if (!ast) { ast = parseFormula(f); this.ast.set(f, ast); }
            v = this.ev(ast, sheetName);
            if (Array.isArray(v)) v = v[0] ?? null;
            if (v == null) v = 0;
          } finally { this.busy.delete(key); }
        } else if (cell.t === 's') v = this.wb.ss[+cell.v] ?? '';
        else if (cell.t === 'inlineStr') v = cell.is ?? '';
        else if (cell.t === 'b') v = cell.v === '1';
        else if (cell.t === 'e') v = new XErr(cell.v);
        else if (cell.t === 'str') v = cell.v ?? '';
        else if (cell.v != null && cell.v !== '') v = parseFloat(cell.v);
      }
      this.vals.set(key, v);
      return v;
    }
    num(v) {
      if (isErr(v)) return v; if (v == null) return 0; if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return v;
      const n = Number(String(v).trim()); return v !== '' && isFinite(n) ? n : new XErr('#VALUE!');
    }
    bool(v) {
      if (isErr(v)) return v; if (v == null) return false; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0;
      const s = String(v).toUpperCase(); if (s === 'TRUE') return true; if (s === 'FALSE') return false; return new XErr('#VALUE!');
    }
    flat(node, sheet) {
      if (node.k === 'range') {
        const sn = node.sheet || sheet; const out = [];
        for (let r = Math.min(node.r1, node.r2); r <= Math.max(node.r1, node.r2); r++) for (let c = Math.min(node.c1, node.c2); c <= Math.max(node.c1, node.c2); c++) out.push({ v: this.value(sn, c, r), fromRange: true });
        return out;
      }
      const v = this.ev(node, sheet);
      return [{ v, fromRange: node.k === 'ref' }];
    }
    ev(n, sheet) {
      switch (n.k) {
        case 'lit': return n.v;
        case 'ref': return this.value(n.sheet || sheet, n.c, n.r);
        case 'range': return new XErr('#VALUE!');
        case 'neg': { const a = this.num(this.ev(n.a, sheet)); return isErr(a) ? a : -a; }
        case 'pct': { const a = this.num(this.ev(n.a, sheet)); return isErr(a) ? a : a / 100; }
        case 'bin': {
          const A = this.ev(n.a, sheet), B = this.ev(n.b, sheet);
          if (isErr(A)) return A; if (isErr(B)) return B;
          if (n.op === '&') return (A == null ? '' : String(typeof A === 'boolean' ? String(A).toUpperCase() : A)) + (B == null ? '' : String(typeof B === 'boolean' ? String(B).toUpperCase() : B));
          if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
            const norm1 = (x, o) => (x == null ? (typeof o === 'string' ? '' : typeof o === 'boolean' ? false : 0) : x);
            let a = norm1(A, B), b = norm1(B, A);
            const rank = (x) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
            let c;
            if (rank(a) !== rank(b)) c = rank(a) - rank(b);
            else if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); c = a < b ? -1 : a > b ? 1 : 0; }
            else { a = +a; b = +b; c = Math.abs(a - b) < 1e-12 ? 0 : a < b ? -1 : 1; }
            return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[n.op];
          }
          const a = this.num(A), b = this.num(B); if (isErr(a)) return a; if (isErr(b)) return b;
          if (n.op === '+') return a + b; if (n.op === '-') return a - b; if (n.op === '*') return a * b;
          if (n.op === '/') return b === 0 ? new XErr('#DIV/0!') : a / b;
          if (n.op === '^') return Math.pow(a, b);
          throw new Unsupported(n.op);
        }
        case 'fn': return this.fn(n.name, n.args, sheet);
      }
      throw new Unsupported(n.k);
    }
    nums(args, sheet) {
      const out = [];
      for (const a of args) for (const x of this.flat(a, sheet)) {
        if (isErr(x.v)) return x.v;
        if (x.fromRange) { if (typeof x.v === 'number') out.push(x.v); }
        else { const v = this.num(x.v); if (isErr(v)) return v; out.push(v); }
      }
      return out;
    }
    fn(name, args, sheet) {
      const E = (i) => (args[i] ? this.ev(args[i], sheet) : null);
      switch (name) {
        case 'IF': { const c = this.bool(E(0)); if (isErr(c)) return c; return c ? (args.length > 1 ? E(1) : true) : (args.length > 2 ? E(2) : false); }
        case 'IFERROR': { const v = E(0); return isErr(v) ? E(1) : v; }
        case 'ISERR': case 'ISERROR': { const v = E(0); return isErr(v) && (name === 'ISERROR' || v.e !== '#N/A'); }
        case 'AND': case 'OR': {
          let res = name === 'AND';
          for (const a of args) for (const x of this.flat(a, sheet)) {
            if (isErr(x.v)) return x.v;
            if (x.fromRange && typeof x.v !== 'number' && typeof x.v !== 'boolean') continue;
            const b = this.bool(x.v); if (isErr(b)) return b;
            res = name === 'AND' ? res && b : res || b;
          }
          return res;
        }
        case 'NOT': { const b = this.bool(E(0)); return isErr(b) ? b : !b; }
        case 'SUM': { const v = this.nums(args, sheet); return isErr(v) ? v : v.reduce((a, b) => a + b, 0); }
        case 'MIN': case 'MAX': { const v = this.nums(args, sheet); if (isErr(v)) return v; return v.length ? Math[name.toLowerCase()](...v) : 0; }
        case 'ABS': { const v = this.num(E(0)); return isErr(v) ? v : Math.abs(v); }
        case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': case 'TRUNC': {
          const v = this.num(E(0)); const d = args.length > 1 ? this.num(E(1)) : 0; if (isErr(v)) return v; if (isErr(d)) return d;
          const f = Math.pow(10, d); const x = Number((Math.abs(v) * f).toPrecision(15));
          const r = name === 'ROUND' ? Math.round(x) : name === 'ROUNDUP' ? Math.ceil(x) : Math.floor(x);
          return Math.sign(v) * r / f;
        }
        case 'DATE': { const y = this.num(E(0)), m = this.num(E(1)), d = this.num(E(2)); for (const x of [y, m, d]) if (isErr(x)) return x; return toSerial(Math.trunc(y), Math.trunc(m), Math.trunc(d)); }
        case 'TODAY': return this.today;
        case 'MONTH': case 'YEAR': case 'DAY': {
          const v = this.num(E(0)); if (isErr(v)) return v;
          const d = new Date(SERIAL0 + Math.floor(v) * 86400000);
          return name === 'MONTH' ? d.getUTCMonth() + 1 : name === 'YEAR' ? d.getUTCFullYear() : d.getUTCDate();
        }
      }
      throw new Unsupported('Função ' + name);
    }
  }

  /** Saldo da Plan1 (linha "SALDO") de cada mês, recalculado com os dados atuais. */
  async function plan1Saldos(wb, today) {
    const sh = await wb.sheet(S.plan);
    let row = null;
    for (let r = 1; r <= 80; r++) if (norm(sh.text('A' + r)) === 'saldo') { row = r; break; }
    if (!row) throw new Error('Linha SALDO não encontrada na Plan1.');
    let calc = null, calcErr = null;
    try { calc = await Calc.create(wb, today); } catch (e) { calcErr = e; }
    return MONTHS.map((mo) => {
      const ref = monthCol(mo.i) + row;
      const cached = sh.num(ref);
      let value = cached, live = false;
      if (calc) {
        try { const v = calc.value(S.plan, colNum(monthCol(mo.i)), row); if (typeof v === 'number') { value = v; live = true; } } catch (e) { calcErr = e; }
      }
      return { i: mo.i, label: mo.label, ref: S.plan + '!' + ref, value, cached, live };
    });
  }

  /** Valor atual da célula-alvo de um lançamento (para a prévia). */
  async function preview(wb, e, opts) {
    const snap = wb.snapshot();
    try { return await applyEntry(wb, e, opts); } finally { wb.restore(snap); }
  }

  const api = { INV_GROUPS, Calc, plan1Saldos, parseFormula, shiftFormula, tokenize, crc32, readZip, writeZip, Pkg, Workbook, Sheet, colName, colNum, parseRef, evalSimple, MONTHS, S, readModel, applyEntry, applyAll, undoEntry, monthSummary, preview, renamePerson, fmtBR, round2, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XCore = api;
})(typeof self !== 'undefined' ? self : this);
