// Draft Day Pick 4 (SPEC 005): the in-page phone probe. Commit byte-identical as test/fixtures/phone/probe.js.
// Paste or inject it into an open War Room page (devtools console, CDP Runtime.evaluate, or
// test/fixtures/phone/cdp-shot.mjs), then call ddPhoneProbe(). It reads layout and computed styles only:
// no request (it reads the Resource Timing list the page already has), no storage, and the only DOM write is a hidden scratch row of chips it removes again.
(function () {
  const STATUSES = ["intake", "scouting", "awaiting_go", "combine", "judging", "grafting", "physical", "drafted", "failed", "cancelled"];
  const TARGETS = 'a[href], button, input, select, textarea, summary, [role="button"]';
  const EXEMPT = ".dd-event"; // inline links inside a Decision log sentence (WCAG 2.5.5 inline exception)

  function rgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function backdrop(el) {
    for (let cur = el; cur; cur = cur.parentElement) {
      const c = rgb(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  }
  function shown(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden]");
  }
  function label(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
    return (el.textContent || el.value || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  }
  function chipFacts(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const fg = rgb(cs.color), bg = backdrop(el);
    return {
      status: el.getAttribute("data-status"), text: el.textContent.trim(),
      fontSize: parseFloat(cs.fontSize), height: Math.round(r.height * 10) / 10,
      ratio: fg && bg ? Math.round(ratio(fg, bg) * 100) / 100 : null,
    };
  }

  globalThis.ddPhoneProbe = function ddPhoneProbe() {
    const problems = [];
    // The layout viewport. A mobile browser zooms out to fit an over-wide page, which grows innerWidth,
    // so innerWidth alone would hide the very overflow W7 looks for.
    const width = Math.min(document.documentElement.clientWidth, screen.width || Infinity), height = innerHeight;
    const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > width) problems.push(`W7 page scrolls sideways: scrollWidth ${scrollWidth} > ${width}`);

    const targets = [...document.querySelectorAll(TARGETS)].filter(shown).filter((el) => !el.closest(EXEMPT));
    const small = [];
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) small.push({ tag: el.tagName.toLowerCase(), name: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    for (const s of small) problems.push(`W8 ${s.tag} "${s.name}" is ${s.w}x${s.h} (< 44x44)`);

    const fields = [...document.querySelectorAll("input, select, textarea")].filter(shown);
    const tinyFields = fields.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => ({ name: label(el), fontSize: parseFloat(getComputedStyle(el).fontSize) }));
    for (const f of tinyFields) problems.push(`W8 field "${f.name}" font-size ${f.fontSize}px < 16px (iOS zooms on focus)`);

    const gutters = [];
    for (const el of [...document.querySelectorAll("h1, .panel")].filter(shown)) {
      const r = el.getBoundingClientRect();
      if (r.left < 12 || r.right > width - 12) gutters.push({ tag: el.tagName.toLowerCase(), name: label(el), left: Math.round(r.left), right: Math.round(width - r.right) });
    }
    for (const g of gutters) problems.push(`W10 ${g.tag} "${g.name}" sits ${g.left}px from the left and ${g.right}px from the right edge (want >= 12px each)`);

    const phone = width <= 480;
    const chips = [...document.querySelectorAll(".chip")].filter(shown).map(chipFacts);
    let synthetic = [];
    if (typeof globalThis.chip === "function") {
      const row = document.createElement("div");
      row.setAttribute("aria-hidden", "true");
      row.style.cssText = "position:absolute;left:0;top:0;visibility:visible;pointer-events:none;";
      document.body.append(row);
      for (const s of STATUSES) row.append(globalThis.chip(s));
      synthetic = [...row.children].map(chipFacts);
      row.remove();
    } else {
      problems.push("W9 chip(status) is not a global function");
    }
    for (const c of [...chips, ...synthetic]) {
      if (c.ratio !== null && c.ratio < 4.5) problems.push(`W9 chip ${c.status ?? c.text} contrast ${c.ratio} < 4.5`);
      if (phone && (c.fontSize < 16 || c.height < 32)) problems.push(`W9 chip ${c.status ?? c.text} is ${c.fontSize}px / ${c.height}px tall at ${width}px (want >= 16px / 32px)`);
    }
    for (const c of synthetic) if (c.text !== c.status) problems.push(`W9 chip(${c.status}) text is "${c.text}"`);

    // Every resource the page loaded (styles, scripts, fonts, images, fetches, the event stream) is same-origin.
    const offOrigin = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => new URL(u, location.href).origin !== location.origin);
    for (const u of offOrigin) problems.push(`W17 off-origin resource ${u.slice(0, 120)}`);

    return { url: location.href, width, height, innerWidth, screenWidth: screen.width, scheme, scrollWidth, targets: targets.length, small, tinyFields, gutters, chips, synthetic, offOrigin, problems, ok: problems.length === 0 };
  };
})();
