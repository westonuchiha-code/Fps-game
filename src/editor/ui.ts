// Tiny DOM toolkit for the editor panels: element builder, form widgets that know how to refresh
// themselves from the document, modal dialogs and toasts.

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface Widget {
  el: HTMLElement;
  refresh(): void;
}

/** A registry the inspector keeps so it can refresh every widget after a change. */
export class Widgets {
  list: Widget[] = [];
  add<T extends Widget>(w: T): T {
    this.list.push(w);
    return w;
  }
  refresh() {
    for (const w of this.list) w.refresh();
  }
  clear() {
    this.list = [];
  }
}

const isFocused = (el: Element) => document.activeElement === el;

/** Evaluate a typed number: allows simple arithmetic like "4*2" or "10/3". */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/,/g, '.');
  if (!t) return null;
  if (!/^[-+*/().\d\s e]+$/i.test(t)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function('"use strict";return (' + t + ')')();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export interface NumOpts {
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  placeholder?: string;
  title?: string;
  /** allow clearing the field (set(undefined)) */
  optional?: boolean;
  integer?: boolean;
}

export function num(get: () => number | undefined, set: (v: number | undefined) => void, o: NumOpts = {}): Widget {
  const input = h('input', { class: 'num', type: 'text', inputmode: 'decimal', spellcheck: false, placeholder: o.placeholder ?? '', title: o.title ?? '' }) as HTMLInputElement;
  const prec = o.precision ?? 3;
  const fmt = (v: number | undefined) => (v === undefined ? '' : String(+v.toFixed(prec)));
  const clampv = (v: number) => {
    if (o.integer) v = Math.round(v);
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    return v;
  };
  const commit = () => {
    const t = input.value;
    if (!t.trim() && o.optional) {
      set(undefined);
      return;
    }
    const v = parseNum(t);
    if (v === null) {
      input.classList.add('bad');
      return;
    }
    input.classList.remove('bad');
    const c = clampv(v);
    if (c !== get()) set(c);
    input.value = fmt(get());
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.select();
    } else if (e.key === 'Escape') {
      input.value = fmt(get());
      input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (o.step ?? 0.1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      const cur = parseNum(input.value) ?? get() ?? 0;
      const v = clampv(+(cur + (e.key === 'ArrowUp' ? step : -step)).toFixed(6));
      set(v);
      input.value = fmt(get());
    }
    e.stopPropagation();
  });
  input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
  const w = {
    el: input,
    refresh() {
      if (!isFocused(input)) {
        input.value = fmt(get());
        input.classList.remove('bad');
      }
    },
  };
  w.refresh();
  return w;
}

export function text(get: () => string | undefined, set: (v: string) => void, o: { placeholder?: string; list?: string[]; listLabels?: Record<string, string>; multiline?: boolean; title?: string; pattern?: RegExp } = {}): Widget {
  const input = (o.multiline ? h('textarea', { rows: 2 }) : h('input', { type: 'text' })) as HTMLInputElement;
  input.className = 'txt';
  input.spellcheck = false;
  input.placeholder = o.placeholder ?? '';
  if (o.title) input.title = o.title;
  let dl: HTMLDataListElement | null = null;
  if (o.list) {
    dl = h('datalist', { id: 'dl' + Math.random().toString(36).slice(2) });
    for (const v of o.list) dl.append(h('option', { value: v, label: o.listLabels?.[v] ?? '' }));
    input.setAttribute('list', dl.id);
  }
  const commit = () => {
    if (o.pattern && input.value && !o.pattern.test(input.value)) {
      input.classList.add('bad');
      return;
    }
    input.classList.remove('bad');
    if (input.value !== (get() ?? '')) set(input.value);
  };
  input.addEventListener('input', () => {
    if (o.pattern) input.classList.toggle('bad', !!input.value && !o.pattern.test(input.value));
    // live update for text, merged into one undo step by the caller
    if (!o.pattern || !input.value || o.pattern.test(input.value)) commit();
  });
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !o.multiline) input.blur();
    if (e.key === 'Escape') {
      input.value = get() ?? '';
      input.blur();
    }
    e.stopPropagation();
  });
  const wrap = dl ? h('span', { class: 'txtwrap' }, input, dl) : input;
  const w = {
    el: wrap,
    refresh() {
      if (!isFocused(input)) input.value = get() ?? '';
    },
  };
  w.refresh();
  return w;
}

export function select<T extends string | number | null | undefined>(
  get: () => T,
  set: (v: T) => void,
  options: { value: T; label: string; group?: string }[],
  o: { title?: string } = {},
): Widget {
  const sel = h('select', { class: 'sel', title: o.title ?? '' }) as HTMLSelectElement;
  const enc = (v: T) => (v === undefined ? '\u0000u' : v === null ? '\u0000n' : typeof v + ':' + v);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const opt of options) {
    const el = h('option', { value: enc(opt.value), text: opt.label });
    if (opt.group) {
      let g = groups.get(opt.group);
      if (!g) {
        g = h('optgroup', { label: opt.group });
        groups.set(opt.group, g);
        sel.append(g);
      }
      g.append(el);
    } else sel.append(el);
  }
  sel.addEventListener('change', () => {
    const opt = options.find((x) => enc(x.value) === sel.value);
    // hand the keyboard back to the editor so shortcuts keep working after picking a value
    sel.blur();
    if (opt) set(opt.value);
  });
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  const w = {
    el: sel,
    refresh() {
      const v = enc(get());
      if (![...sel.options].some((op) => op.value === v)) {
        // value not in the list (hand-edited file): show it anyway
        sel.append(h('option', { value: v, text: String(get()) + ' (?)' }));
      }
      sel.value = v;
    },
  };
  w.refresh();
  return w;
}

export function check(get: () => boolean, set: (v: boolean) => void, label = '', title = ''): Widget {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.addEventListener('change', () => set(input.checked));
  const el = h('label', { class: 'chk', title }, input, label ? h('span', { text: label }) : null);
  const w = {
    el,
    refresh() {
      input.checked = !!get();
    },
  };
  w.refresh();
  return w;
}

export function color(get: () => string | undefined, set: (v: string | undefined) => void, swatches: string[], o: { resettable?: boolean; fallback?: string } = {}): Widget {
  const input = h('input', { type: 'color', class: 'colr' }) as HTMLInputElement;
  const hex = h('input', { type: 'text', class: 'hex', spellcheck: false, maxLength: 7 }) as HTMLInputElement;
  input.addEventListener('input', () => set(input.value));
  hex.addEventListener('change', () => {
    const v = hex.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) set((v.startsWith('#') ? v : '#' + v).toLowerCase());
    else w.refresh();
  });
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hex.blur();
    e.stopPropagation();
  });
  const sw = h('div', { class: 'swatches' });
  for (const s of swatches) sw.append(h('button', { class: 'sw', style: { background: s }, title: s, onclick: () => set(s) }));
  const reset = o.resettable ? h('button', { class: 'mini', text: 'default', title: 'Use the default colour', onclick: () => set(undefined) }) : null;
  const el = h('div', { class: 'colorfield' }, h('div', { class: 'colrow' }, input, hex, reset), sw);
  const w = {
    el,
    refresh() {
      const v = get() ?? o.fallback ?? '#ffffff';
      input.value = v;
      if (!isFocused(hex)) hex.value = v;
      for (const b of sw.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).title.toLowerCase() === v.toLowerCase());
    },
  };
  w.refresh();
  return w;
}

/** Labelled form row. */
export function row(label: string, ...content: Child[]) {
  return h('div', { class: 'row' }, h('label', { class: 'lbl', text: label }), h('div', { class: 'val' }, ...content));
}

export function section(title: string, open = true, ...content: Child[]) {
  const body = h('div', { class: 'sec-body' }, ...content);
  const head = h('button', { class: 'sec-head' + (open ? ' open' : ''), text: title });
  const el = h('div', { class: 'sec' }, head, body);
  if (!open) body.style.display = 'none';
  head.addEventListener('click', () => {
    const o = body.style.display === 'none';
    body.style.display = o ? '' : 'none';
    head.classList.toggle('open', o);
  });
  return { el, body };
}

// ---- modal + toast -------------------------------------------------------------------------------

export function modal(o: { title: string; body: Node | string; buttons: { id: string; label: string; primary?: boolean; danger?: boolean }[]; wide?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const close = (id: string) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(id);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close('cancel');
      }
    };
    const box = h(
      'div',
      { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog' },
      h('h2', { text: o.title }),
      h('div', { class: 'modal-body' }, typeof o.body === 'string' ? h('p', { text: o.body }) : o.body),
      h('div', { class: 'modal-buttons' }, ...o.buttons.map((b) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), 'data-id': b.id, text: b.label, onclick: () => close(b.id) }))),
    );
    const back = h('div', { class: 'modal-back', onmousedown: (e: MouseEvent) => e.target === back && close('cancel') }, box);
    document.body.append(back);
    document.addEventListener('keydown', key, true);
    (box.querySelector('.btn.primary') as HTMLElement | null)?.focus();
    (back as any).__close = close;
  });
}

let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'ok' | 'warn' | 'err' | 'info' = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast ' + kind, text: msg });
  toastHost.append(t);
  // never more than three at once: drop the oldest
  while (toastHost.children.length > 3) toastHost.firstElementChild!.remove();
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
