// Draft Day Pick 4 (SPEC 005): a zero-dependency node:vm harness for the War Room's browser code.
// Commit byte-identical as test/fixtures/phone/dom-harness.mjs. Tests import it relatively; it reads
// the <script src> files that src/ui/index.html lists (in that order: timeline.js, then lessons.js when
// Pick 3 is in the stack, then app.js) as text (readFile is not an import, so the A15 guard and the
// import-boundary test are unaffected). It never opens a socket: fetch and EventSource are fakes.
//
// Contract (SPEC 005 "DOM budget"): app.js must load and run with only the globals created below
// (document, Node, EventSource, window, location, fetch, URLSearchParams, AbortController, matchMedia,
// requestAnimationFrame, setTimeout, clearTimeout, queueMicrotask, console). There is no localStorage,
// sessionStorage, cookie, XMLHttpRequest, WebSocket or navigator.sendBeacon on purpose.
// Nodes support: setAttribute/getAttribute/removeAttribute/hasAttribute, className, classList, dataset,
// style, hidden, id, textContent, value, disabled, checked, selected, append, appendChild, prepend,
// replaceChildren, replaceWith, remove, contains, addEventListener/removeEventListener, dispatchEvent,
// requestSubmit, focus, blur, querySelector(All) with one compound selector (tag, #id, .class,
// [attr] or [attr="v"]; no combinators), and the read-only children/childNodes/parentNode/tagName.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";

class FakeNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; }
  get parentElement() { return this.parentNode; }
  remove() { if (this.parentNode) this.parentNode._detach(this); }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.childNodes.indexOf(this);
    parent._detach(this);
    const fresh = nodes.map((n) => (n instanceof FakeNode ? n : this.ownerDocument.createTextNode(String(n))));
    for (const n of fresh) if (n.parentNode) n.parentNode._detach(n);
    parent.childNodes.splice(at, 0, ...fresh);
    for (const n of fresh) n.parentNode = parent;
  }
}

class FakeText extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this._value = undefined;
    this._disabled = undefined;
    this._checked = undefined;
  }
  get children() { return this.childNodes.filter((n) => n instanceof FakeElement); }
  setAttribute(k, v) {
    this.attributes.set(String(k).toLowerCase(), String(v));
    this.ownerDocument._attrLog.push({ node: this, name: String(k).toLowerCase(), value: String(v) });
  }
  getAttribute(k) { const v = this.attributes.get(String(k).toLowerCase()); return v === undefined ? null : v; }
  hasAttribute(k) { return this.attributes.has(String(k).toLowerCase()); }
  removeAttribute(k) { this.attributes.delete(String(k).toLowerCase()); }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v) { this.setAttribute("class", v); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get classList() {
    const node = this;
    const list = () => node.className.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { node.className = [...new Set([...list(), ...c])].join(" "); },
      remove: (...c) => { node.className = list().filter((x) => !c.includes(x)).join(" "); },
      toggle: (c, force) => { const on = force ?? !list().includes(c); if (on) node.classList.add(c); else node.classList.remove(c); return on; },
      contains: (c) => list().includes(c),
    };
  }
  get dataset() {
    const node = this;
    const attr = (k) => "data-" + String(k).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    return new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? node.getAttribute(attr(k)) ?? undefined : undefined),
      set: (_, k, v) => { node.setAttribute(attr(k), v); return true; },
      deleteProperty: (_, k) => { node.removeAttribute(attr(k)); return true; },
    });
  }
  get style() { if (!this._style) this._style = {}; return this._style; }
  get checked() { return this._checked ?? this.hasAttribute("checked"); }
  set checked(v) { this._checked = Boolean(v); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === "TEXTAREA") return this.textContent;
    if (this.tagName === "SELECT") {
      const options = findAll(this, (n) => n.tagName === "OPTION");
      const chosen = options.find((o) => o._selected ?? o.hasAttribute("selected")) ?? options[0];
      return chosen ? chosen.value : "";
    }
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    return this.getAttribute("value") ?? "";
  }
  set value(v) {
    if (this.tagName === "SELECT") {
      for (const o of findAll(this, (n) => n.tagName === "OPTION")) o._selected = o.value === String(v);
      return;
    }
    this._value = String(v);
  }
  get selected() { return this._selected ?? this.hasAttribute("selected"); }
  set selected(v) { this._selected = Boolean(v); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.replaceChildren(); if (String(v) !== "") this.append(String(v)); }
  requestSubmit() { this.dispatch("submit"); }
  dispatchEvent(event) { const e = this.dispatch(event.type, { ...event }); return !e.defaultPrevented; }
  querySelectorAll(sel) { return findAll(this, (n) => n !== this && matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  _detach(child) { const i = this.childNodes.indexOf(child); if (i >= 0) this.childNodes.splice(i, 1); child.parentNode = null; }
  _adopt(items) {
    return items.map((c) => {
      const n = c instanceof FakeNode ? c : this.ownerDocument.createTextNode(String(c));
      if (n.parentNode) n.parentNode._detach(n);
      n.parentNode = this;
      return n;
    });
  }
  append(...items) { this.childNodes.push(...this._adopt(items)); }
  appendChild(n) { this.append(n); return n; }
  prepend(...items) { this.childNodes.unshift(...this._adopt(items)); }
  replaceChildren(...items) { for (const c of [...this.childNodes]) this._detach(c); this.append(...items); }
  contains(n) { for (let cur = n; cur; cur = cur.parentNode) if (cur === this) return true; return false; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  // Harness-side only (tests call these; app.js need not): fire listeners on this node, then bubble.
  dispatch(type, extra = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let cur = this; cur; cur = cur.parentNode) {
      if (!(cur instanceof FakeElement)) continue;
      event.currentTarget = cur;
      for (const fn of [...(cur.listeners.get(type) || [])]) fn.call(cur, event);
    }
    return event;
  }
}

function matches(node, selector) {
  const m = /^([a-z0-9]*)((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(String(selector).trim());
  if (!m) throw new Error(`dom-harness: unsupported selector ${selector}`);
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (part[0] === "#" && node.getAttribute("id") !== part.slice(1)) return false;
    if (part[0] === "." && !node.className.split(/\s+/).includes(part.slice(1))) return false;
    if (part[0] === "[") {
      const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (!node.hasAttribute(a[1])) return false;
      if (a[2] !== undefined && node.getAttribute(a[1]) !== a[2]) return false;
    }
  }
  return true;
}

export function walk(root, visit) {
  if (!root) return;
  visit(root);
  for (const c of root.childNodes || []) walk(c, visit);
}
export function findAll(root, pred) { const out = []; walk(root, (n) => { if (n instanceof FakeElement && pred(n)) out.push(n); }); return out; }
export function find(root, pred) { return findAll(root, pred)[0] ?? null; }
export function text(node) { return node ? node.textContent.replace(/\s+/g, " ").trim() : ""; }

/** The accessible name the way SPEC 005 uses it: aria-label, else <label for=id> text, else own text. */
export function accessibleName(root, node) {
  if (!node) return "";
  const aria = node.getAttribute("aria-label");
  if (aria) return aria;
  const id = node.getAttribute("id");
  if (id) {
    const label = find(root, (n) => n.tagName === "LABEL" && n.getAttribute("for") === id);
    if (label) return text(label);
  }
  for (let cur = node.parentNode; cur; cur = cur.parentNode) if (cur.tagName === "LABEL") return text(cur);
  return text(node);
}
export function byName(root, name, tags) {
  return find(root, (n) => (!tags || tags.includes(n.tagName)) && accessibleName(root, n) === name);
}

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

/** A fetch Response stand-in. body may be an object (JSON) or a string (raw text). */
export function response(status, body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const type = typeof body === "string" ? "text/html; charset=utf-8" : "application/json";
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? type : null) },
    json: async () => JSON.parse(raw),
    text: async () => raw,
  };
}

export const SAMPLE_BOARD = {
  picks: [
    { id: "p-20261017-01", idea: "Add a status legend to the War Room", status: "drafted", stage: "Draft Pick", target: "BoydVC/draft-day", runs: 7, failReason: null, updatedAt: "2026-10-17T14:00:00.000Z", walkover: false },
    { id: "p-20261017-02", idea: "Refused by the policy screen (fixture text)", status: "failed", stage: "Failed", target: "BoydVC/draft-day", runs: 0, failReason: "policy", updatedAt: "2026-10-17T14:00:01.000Z", walkover: false },
  ],
  inbox: [],
};

/**
 * Load the War Room into a fresh vm context.
 * options.root      repo root holding src/ui (default process.cwd())
 * options.board     the JSON GET /api/board returns (default SAMPLE_BOARD)
 * options.intake    "ok" | "policy" | "error" | "reject" | "badjson" | "defer"  (default "ok")
 * options.hash      initial location.hash (default "")
 * options.errorText the error string a 400 intake answer carries in "error" mode (default "target is not in targets.json")
 * Scripts: every <script src="/x.js"> in src/ui/index.html, in document order (throws when app.js is absent).
 * Returns { ctx, document, app, calls, posts, sources, emit, flush, settle, idle, rendered }.
 *   posts()     the POST /api/intake calls so far ({url, method, headers, body, json})
 *   settle(r)   resolve the oldest deferred intake with response r (use response())
 *   emit()      fire an SSE "update" on every EventSource the page opened
 *   idle()      blur everything (document.activeElement = body), like iOS Safari after a tap
 */
export async function loadWarRoom(options = {}) {
  const root = options.root ?? process.cwd();
  const board = options.board ?? SAMPLE_BOARD;
  const mode = options.intake ?? "ok";
  const calls = [];
  const pendingIntake = [];
  const sources = [];
  const doc = {
    _attrLog: [],
    createElement: (tag) => new FakeElement(doc, tag),
    createTextNode: (data) => new FakeText(doc, data),
    getElementById: (id) => find(doc.documentElement, (n) => n.getAttribute("id") === id),
    querySelector: (sel) => doc.documentElement.querySelector(sel),
    querySelectorAll: (sel) => doc.documentElement.querySelectorAll(sel),
  };
  doc.documentElement = new FakeElement(doc, "html");
  doc.body = new FakeElement(doc, "body");
  doc.documentElement.append(doc.body);
  const app = new FakeElement(doc, "main");
  app.setAttribute("id", "app");
  doc.body.append(app);
  doc.activeElement = doc.body;
  const winListeners = new Map();
  const location = { hash: options.hash ?? "" };

  async function fakeFetch(url, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const call = { url: String(url), method, headers: init.headers ?? null, body: init.body ?? null, json: null };
    if (typeof init.body === "string") { try { call.json = JSON.parse(init.body); } catch { call.json = undefined; } }
    calls.push(call);
    if (method === "GET" && call.url === "/api/board") return response(200, board);
    if (method === "POST" && call.url === "/api/intake") {
      if (mode === "ok") return response(200, { ok: true, inboxOffset: 1, policy: null });
      if (mode === "policy") return response(200, { ok: true, inboxOffset: 1, policy: "fixture-rule" });
      if (mode === "error") return response(400, { error: options.errorText ?? "target is not in targets.json" });
      if (mode === "badjson") return response(502, "<html>Bad Gateway</html>");
      if (mode === "reject") throw new TypeError("Load failed");
      const d = deferred();
      pendingIntake.push(d);
      return d.promise;
    }
    if (method === "GET" && call.url.startsWith("/api/picks/")) return response(404, { error: "pick not found" });
    if (method === "GET" && call.url.startsWith("/api/lessons")) return response(200, { window: { since: null, until: null }, picks: 0, findings: 0, lessons: [], oneOffs: [], skipped: [], summary: "0 lessons from 0 picks · 0 findings · 0 one-offs" });
    return response(404, { error: "not found" });
  }

  class FakeEventSource {
    constructor(url) { this.url = String(url); this.listeners = new Map(); sources.push(this); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    close() {}
  }

  const sandbox = {
    document: doc,
    Node: FakeNode,
    EventSource: FakeEventSource,
    location,
    fetch: fakeFetch,
    URLSearchParams,
    AbortController,
    matchMedia: () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    JSON,
  };
  sandbox.window = { addEventListener: (t, fn) => { if (!winListeners.has(t)) winListeners.set(t, []); winListeners.get(t).push(fn); }, location, document: doc, matchMedia: sandbox.matchMedia };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // Load the page's own scripts in the order index.html lists them (same-origin "/name.js" only).
  const html = await readFile(join(root, "src", "ui", "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([a-z]+\.js)"[^>]*><\/script>/gi)].map((m) => m[1]);
  if (!scripts.includes("app.js")) throw new Error("dom-harness: index.html does not load /app.js");
  for (const file of scripts) {
    const code = await readFile(join(root, "src", "ui", file), "utf8");
    vm.runInContext(code, ctx, { filename: `src/ui/${file}` });
  }
  const flush = async (rounds = 8) => { for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r)); };
  await flush();
  return {
    ctx, document: doc, app, calls, sources,
    posts: () => calls.filter((c) => c.method === "POST" && c.url === "/api/intake"),
    settle: async (r) => { const d = pendingIntake.shift(); if (!d) throw new Error("no deferred intake"); d.resolve(r); await flush(); },
    fail: async (error = new TypeError("Load failed")) => { const d = pendingIntake.shift(); if (!d) throw new Error("no deferred intake"); d.reject(error); await flush(); },
    emit: async () => { for (const s of sources) for (const fn of s.listeners.get("update") || []) fn({ type: "update", data: "{}" }); await flush(); },
    hashchange: async (hash) => { location.hash = hash; for (const fn of winListeners.get("hashchange") || []) fn({ type: "hashchange" }); await flush(); },
    idle: () => { doc.activeElement = doc.body; },
    flush,
    form: () => byName(app, "New pick", ["FORM"]),
    control: (name) => byName(app, name, ["INPUT", "TEXTAREA", "SELECT"]),
    button: (name) => byName(app, name, ["BUTTON"]),
    // The form status: the role=status node inside the region named New pick (section or form).
    status: () => find(byName(app, "New pick", ["SECTION"]) ?? byName(app, "New pick", ["FORM"]) ?? app, (n) => n.getAttribute("role") === "status"),
  };
}
