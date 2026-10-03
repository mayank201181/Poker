// Tiny DOM builder: h('button.primary', { onClick }, 'Text', child, ...).
// Text always goes in as text nodes, so player names can't inject markup.
// Handlers are set as onclick-style properties so morph() can carry them over.

export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m[1] || 'div');
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') addClasses(el, v);
    else if (k === 'style') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el[k.toLowerCase()] = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function addClasses(el, v) {
  if (typeof v === 'string') v.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
  else if (Array.isArray(v)) v.forEach((c) => c && addClasses(el, c));
  else for (const [c, on] of Object.entries(v)) if (on) el.classList.add(c);
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const HANDLERS = ['onclick', 'oninput', 'onchange', 'onsubmit', 'onkeydown'];

// Patch `from` in place until it matches `to` (attributes, text, handlers,
// children), instead of replacing it. Elements under a finger, focus, scroll
// positions and running CSS animations all survive a redraw this way.
export function morph(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.replaceWith(to);
    return to;
  }
  if (from.nodeType === Node.TEXT_NODE) {
    if (from.data !== to.data) from.data = to.data;
    return from;
  }
  if (from.nodeType !== Node.ELEMENT_NODE) return from;
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  for (const p of HANDLERS) if (from[p] !== to[p]) from[p] = to[p];
  if (from.tagName === 'INPUT') {
    if (from.checked !== to.checked) from.checked = to.checked;
    if (from.value !== to.value && document.activeElement !== from) from.value = to.value;
  }
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  b.forEach((child, i) => (i < a.length ? morph(a[i], child) : from.appendChild(child)));
  for (let i = b.length; i < a.length; i++) a[i].remove();
  return from;
}
