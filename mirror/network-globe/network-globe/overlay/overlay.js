/* ==========================================================================
   overlay.js — Root Record globe landing overlay (vanilla, no dependencies)
   2026-09-29 HST. Included by ONE line in index.html:
     <script src="/overlay/overlay.js" defer></script>
   Revert = delete that line. Disable at runtime = "enabled": false in
   /overlay/overlay-config.json, or ?overlay=0 on the URL.
   Data rules: same-origin public JSON only (/healthz or /health, /api/state). Never
   renders hostnames, origin coordinates, AWS account ids, paths or secrets.
   All remote values are written with textContent (no innerHTML).
   ========================================================================== */
(function () {
  "use strict";
  var qs = new URLSearchParams(location.search);
  if (qs.get("overlay") === "0" || qs.get("embed") === "1") return;

  var SCRIPT = document.currentScript;
  var BASE = (SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^/]*$/, "") : "/overlay/");
  var KEY = "rr-globe-overlay:v1:";
  var DEFAULTS = {
    enabled: true, allowUrlOverrides: false,
    rail: { enabled: false, startCollapsed: true },
    legacyHud: "compact",
    cards: {
      signup: { enabled: true, mode: "placeholder", url: "", title: "Join Root Record", blurb: "Accounts are coming soon." },
      home: { enabled: false, url: "", title: "Root Record", blurb: "The public site is the Vercel home page." },
      status: { enabled: true, pollSec: 15, healthUrls: ["/healthz", "/health"], stateUrl: "/api/state", deskHealthUrl: null, staleSec: 90 }
    },
    globe: { spinToggle: true, spinDefault: "on", clickInfo: true, hover: true, pauseSpinWhileInfoOpen: true, showIp: true, showProcess: false, hardenTooltips: true, stableData: true,
      awsNode: { enabled: true, lat: 39.96, lng: -83.0, label: "AWS us-east-2 \u00b7 Ohio", link: true, linkColor: "#38bdf8" } }
  };

  function merge(a, b) {
    var out = {}, k;
    for (k in a) out[k] = a[k];
    for (k in b || {}) {
      if (k.charAt(0) === "_") continue;
      out[k] = (a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) && b[k] && typeof b[k] === "object")
        ? merge(a[k], b[k]) : b[k];
    }
    return out;
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(KEY + k); else localStorage.setItem(KEY + k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    for (k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function safeUrl(u) { return typeof u === "string" && /^(https:\/\/|\/)/.test(u) ? u : null; }
  function fetchJson(url, ms) {
    var ctl = "AbortController" in window ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 6000) : null;
    return fetch(url, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(function () { if (t) clearTimeout(t); });
  }
  function hst(ts) {
    try { return new Date(ts).toLocaleTimeString("en-US", { timeZone: "Pacific/Honolulu", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " HST"; }
    catch (e) { return new Date(ts).toISOString().slice(11, 19) + " UTC"; }
  }
  function dur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m";
  }

  // ---- Pure helpers for globe click-info (exposed as window.RR_OVERLAY_UTIL for tests) ----
  // Visibility policy: private/reserved IPs, the Hawaiʻi desk link IP, origin coordinates,
  // process names (unless showProcess), hostnames, accounts and paths are never shown.
  function ipKind(ip) {
    ip = String(ip == null ? "" : ip).trim().toLowerCase();
    if (!ip) return null;
    var m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      var a = +m[1], b = +m[2];
      if (a > 255 || b > 255 || +m[3] > 255 || +m[4] > 255) return "name";
      if (a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) return "private";
      return "public";
    }
    if (/^[0-9a-f:.]+$/.test(ip) && ip.indexOf(":") >= 0) {
      var v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (v4) return ipKind(v4[1]);
      if (ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return "private";
      return "public";
    }
    return "name";
  }
  var IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi;
  function scrub(s, max) {
    // strip private IPs and path-like tokens from free text; clamp length
    s = String(s == null ? "" : s).replace(IP_RE, function (x) { return ipKind(x) === "private" ? "[private]" : x; })
      .replace(/(^|\s)(~|\/)[^\s]*\/[^\s]*/g, "$1[path]");
    return s.length > (max || 80) ? s.slice(0, (max || 80) - 1) + "\u2026" : s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function r3(n) { return Math.round(Number(n) * 1000) / 1000; }
  function isDeskLink(d) {
    return !!d && (d.protocol === "persistent" || d.sourceNode != null || d.sourceRegion != null || /^hawai/i.test(String(d.endpoint || "")));
  }
  function arcIp(d) {
    if (d.ip) return String(d.ip);
    return ipKind(d.endpoint) === "public" || ipKind(d.endpoint) === "private" ? String(d.endpoint) : null;
  }
  function arcKey(d) {
    return ["a", r3(d.startLat), r3(d.startLng), r3(d.endLat), r3(d.endLng), d.protocol || "", d.port || "", arcIp(d) || d.endpoint || ""].join("|");
  }
  function pointKey(d) { return ["p", d.type || "", r3(d.lat), r3(d.lng)].join("|"); }
  function near(a, b) { return Math.abs(Number(a) - Number(b)) < 0.01; }
  function fmtBytes(n) {
    n = Number(n); if (!isFinite(n)) return null;
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : Math.round(n)) + " " + u[i];
  }
  function shownIp(d, opt) {
    var ip = arcIp(d);
    if (!ip || !opt.showIp) return null;
    if (isDeskLink(d)) return "hidden (desk link)";
    var k = ipKind(ip);
    return k === "public" ? ip : k === "private" ? "private (hidden)" : null;
  }
  function asnText(a) { if (a == null || a === "") return null; a = String(a); return /^\d+$/.test(a) ? "AS" + a : scrub(a, 40); }
  function place(d) { var s = [d.city, d.country].filter(Boolean).join(", "); return s ? scrub(s, 60) : null; }
  function traffic(d) {
    var p = [];
    if (d.bytesPerSec != null && isFinite(d.bytesPerSec)) p.push(fmtBytes(d.bytesPerSec) + "/s");
    if (d.bytes != null && Number(d.bytes) > 0) p.push(fmtBytes(d.bytes) + " total");
    if (d.packets != null && Number(d.packets) > 0) p.push(Number(d.packets).toLocaleString("en-US") + " pkts");
    return p.length ? p.join(" \u00b7 ") : null;
  }
  // -> { kind, title, subtitle, rows: [[label, value], ...] } ; values are plain text (caller uses textContent)
  function describeArc(d, ctx) {
    ctx = ctx || {}; var opt = ctx.opt || {}, arcs = ctx.arcs || [], rows = [];
    var desk = isDeskLink(d);
    var same = arcs.filter(function (a) { return near(a.endLat, d.endLat) && near(a.endLng, d.endLng); }).length;
    var proto = [d.protocol && d.protocol !== "persistent" ? String(d.protocol).toUpperCase() : null, d.port ? "port " + d.port : null].filter(Boolean).join(" \u00b7 ");
    rows.push(["Location", desk ? "Hawai\u02bbi \u2194 Mainland" : place(d) || "unknown"]);
    if (d.org) rows.push(["Network", scrub(d.org, 60)]);
    if (asnText(d.asn)) rows.push(["ASN", asnText(d.asn)]);
    var ip = shownIp(d, opt); if (ip) rows.push(["IP", ip]);
    if (proto) rows.push(["Protocol", proto]);
    if (d.awsRegion) rows.push(["AWS", scrub(d.awsRegion, 30) + (d.awsCount ? " \u00b7 " + d.awsCount : "")]);
    var t = traffic(d); if (t) rows.push(["Traffic", t]);
    if (same > 0) rows.push(["Flows here", String(same)]);
    if (opt.showProcess && d.process) rows.push(["Process", scrub(d.process, 40)]);
    if (d.synthetic) rows.push(["Source", "desk \u2192 AWS feed (topology)"]);
    if (ctx.lastSeen) rows.push(["Last seen", ctx.lastSeen]);
    return { kind: "arc", title: desk ? "Desk link" : "Connection", subtitle: desk ? (d.synthetic ? "Hawai\u02bbi desk \u2192 AWS Ohio" : "persistent Hawai\u02bbi feed") : (d.org ? scrub(d.org, 50) : place(d) || "network flow"), rows: rows };
  }
  function describePoint(d, ctx) {
    ctx = ctx || {}; var arcs = ctx.arcs || [], rows = [];
    var origin = d.type === "origin";
    var here = arcs.filter(function (a) { return (near(a.endLat, d.lat) && near(a.endLng, d.lng)) || (near(a.startLat, d.lat) && near(a.startLng, d.lng)); });
    var uniq = function (f, n) { var s = {}, out = []; here.forEach(function (a) { var v = f(a); if (v && !s[v]) { s[v] = 1; out.push(v); } }); return out.slice(0, n); };
    if (!origin) rows.push(["Coordinates", (Math.round(d.lat * 10) / 10) + ", " + (Math.round(d.lng * 10) / 10)]);
    rows.push(["Flows", String(here.length)]);
    var orgs = uniq(function (a) { return a.org ? scrub(a.org, 30) : null; }, 3); if (orgs.length && !origin) rows.push(["Networks", orgs.join(", ")]);
    var ports = uniq(function (a) { return a.port ? String(a.protocol || "").toUpperCase() + " " + a.port : null; }, 4); if (ports.length) rows.push(["Ports", ports.join(", ")]);
    var bps = here.reduce(function (s, a) { return s + (Number(a.bytesPerSec) || 0); }, 0); if (bps > 0) rows.push(["Traffic", fmtBytes(bps) + "/s"]);
    if (d.type === "aws") rows.push(["Role", "Mainland node \u00b7 feed + page"]);
    if (ctx.lastSeen) rows.push(["Last seen", ctx.lastSeen]);
    var label = scrub(d.label || "", 60);
    return { kind: "point", title: origin ? "Origin" : d.type === "aws" ? "AWS region" : "Endpoint", subtitle: label || (origin ? "this node" : "location"), rows: rows };
  }
  function safeArcLabel(d, opt) {
    var head = [opt.showProcess ? scrub(d.process || "network", 40) : null, d.protocol || null].filter(Boolean).join(" \u00b7 ");
    var ip = shownIp(d, opt), who = ip && ip.indexOf("hidden") < 0 ? ip : (d.org ? scrub(d.org, 40) : null);
    var s = esc(head || "network");
    if (who) s += " \u00b7 " + esc(who) + (d.port ? ":" + esc(d.port) : "");
    if (d.awsRegion) s += "<br>AWS " + esc(d.awsRegion) + " \u00b7 " + esc(d.awsCount || "");
    else if (place(d)) s += "<br>" + esc(place(d));
    if (d.org) s += "<br>" + esc(scrub(d.org, 60));
    return s;
  }
  // AWS Mainland node (Ohio). The live AWS server only renders the desk's (Hawaiʻi) flows from
  // the SSH feed; it never adds itself. So the overlay adds the AWS point and a desk↔AWS link arc
  // (the feed path), with no IP. Skipped when the data already has an AWS/persistent-link entry
  // (mirror server.js). The link shows only while the feed is live (≥ 1 desk flow in the snapshot).
  function nearDeg(a, b, lat, lng, tol) { return Math.abs(Number(a) - lat) < tol && Math.abs(Number(b) - lng) < tol; }
  function withAwsPoint(points, aw) {
    if (!Array.isArray(points)) return points;
    if (points.some(function (p) { return p && (p.type === "aws" || (p.type === "origin" && nearDeg(p.lat, p.lng, aw.lat, aw.lng, 1))); })) return points;
    return points.concat([{ lat: aw.lat, lng: aw.lng, type: "aws", label: aw.label || "AWS us-east-2 \u00b7 Ohio", synthetic: true }]);
  }
  function withAwsLink(arcs, aw) {
    if (!Array.isArray(arcs) || aw.link === false) return arcs;
    // a desk flow that merely ENDS in Ohio (e.g. an Ohio-hosted server) must not suppress the link
    if (arcs.some(function (a) { return a && (a.protocol === "persistent" || nearDeg(a.startLat, a.startLng, aw.lat, aw.lng, 1)); })) return arcs;
    var o = null;
    for (var i = 0; i < arcs.length; i++) if (arcs[i] && isFinite(arcs[i].startLat) && isFinite(arcs[i].startLng)) { o = arcs[i]; break; }
    if (!o) return arcs;                                   // no live desk flows -> feed idle -> no link
    return arcs.concat([{ startLat: o.startLat, startLng: o.startLng, endLat: aw.lat, endLng: aw.lng,
      process: "Hawaii \u2194 Mainland", protocol: "persistent", port: null, endpoint: "AWS Mainland node",
      country: "United States", org: aw.label || "AWS us-east-2 \u00b7 Ohio", sourceNode: "HawaiiRoot", sourceRegion: "local-hawaii",
      color: aw.linkColor || "#38bdf8", altitude: 0.28, stroke: 1.5, synthetic: true }]);
  }
  var UTIL = { withAwsPoint: withAwsPoint, withAwsLink: withAwsLink, ipKind: ipKind, scrub: scrub, esc: esc, arcKey: arcKey, pointKey: pointKey, isDeskLink: isDeskLink,
    describeArc: describeArc, describePoint: describePoint, safeArcLabel: safeArcLabel, fmtBytes: fmtBytes };
  try { window.RR_OVERLAY_UTIL = UTIL; } catch (e) {}

  function start(cfg) {
    if (!cfg.enabled) return;
    if (cfg.allowUrlOverrides) {
      var flag = function (p, set) { if (qs.has(p)) set(qs.get(p) === "1"); };
      flag("ov_rail", function (v) { cfg.rail.enabled = v; });
      flag("ov_home", function (v) { cfg.cards.home.enabled = v; });
      flag("ov_signup", function (v) { cfg.cards.signup.enabled = v; });
      flag("ov_status", function (v) { cfg.cards.status.enabled = v; });
      if (qs.get("ov_reset") === "1") ["signup", "home", "status", "rail"].forEach(function (k) { store("closed:" + k, null); store(k, null); });
    }
    var root = document.documentElement;
    root.classList.add("rr-ov-on", "rr-ov-hud-" + (cfg.legacyHud || "keep"));

    var ov = el("div", { id: "rr-ov", "aria-label": "Root Record overlay" });
    var col = el("div", { class: "ov-col" });
    var dock = el("div", { class: "ov-dock", "aria-label": "Globe controls and closed cards" });
    var tools = el("span", { class: "ov-tools" }), pills = el("span", { class: "ov-pills" });
    dock.appendChild(tools); dock.appendChild(pills);
    var cards = {};
    var LABEL = { signup: "Sign up", home: "Website", status: "Status" };

    function card(id, title, body) {
      var x = el("button", { class: "ov-x", type: "button", "aria-label": "Close " + LABEL[id] + " card", title: "Close", text: "\u00d7" });
      var c = el("section", { class: "ov-card ov-glass", id: "rr-ov-" + id, "aria-label": title }, [el("h2", { text: title })].concat(body));
      c.insertBefore(x, c.firstChild);
      x.addEventListener("click", function () { setOpen(id, false); });
      cards[id] = c;
      col.appendChild(c);
    }
    function setOpen(id, open) {
      var c = cards[id]; if (!c) return;
      c.hidden = !open;
      store("closed:" + id, open ? null : "1");
      renderDock();
      if (open && id === "status") statusTick();
    }
    function renderDock() {
      while (pills.firstChild) pills.removeChild(pills.firstChild);
      Object.keys(cards).forEach(function (id) {
        if (!cards[id].hidden) return;
        var b = el("button", { type: "button", title: "Show " + LABEL[id], text: "+ " + LABEL[id] });
        b.addEventListener("click", function () { setOpen(id, true); });
        pills.appendChild(b);
      });
      ov.classList.toggle("has-dock", !!(pills.firstChild || tools.firstChild));
    }

    // ---- Signup card ----
    var s = cfg.cards.signup;
    if (s.enabled) {
      var body = [];
      var link = safeUrl(s.url);
      if (s.mode === "link" && link) {
        body.push(el("p", { text: s.blurb || "" }));
        body.push(el("a", { class: "ov-btn", href: link, rel: "noopener", text: "Sign up / Log in" }));
      } else {
        body.push(el("span", { class: "ov-badge", text: "Preview \u00b7 not live" }));
        body.push(el("p", { text: s.blurb || "" }));
        var email = el("input", { type: "email", name: "email", placeholder: "you@example.com", autocomplete: "email", "aria-label": "Email (preview only)" });
        var btn = el("button", { class: "ov-btn", type: "submit", text: "Notify me" });
        var note = el("div", { class: "ov-note", text: "Placeholder form \u2014 submits nowhere. Nothing is sent or stored." });
        var form = el("form", { novalidate: "novalidate", "data-placeholder": "true" }, [email, btn]);
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          note.textContent = "Preview only \u2014 nothing was sent. Sign-ups open soon.";
          email.value = "";
        });
        body.push(form, note);
      }
      card("signup", s.title || "Join Root Record", body);
    }

    // ---- Optional link card. Off unless a same-origin or https URL is set. ----
    var h = cfg.cards.home, homeUrl = safeUrl(h.url);
    if (h.enabled && homeUrl) {
      card("home", h.title || "Root Record", [
        el("p", { text: h.blurb || "" }),
        el("a", { class: "ov-btn", href: homeUrl, rel: "noopener", text: "Open" })
      ]);
    }

    // ---- Quick status / health card ----
    var st = cfg.cards.status, rows = {}, updated;
    if (st.enabled) {
      var dl = el("dl", { class: "ov-rows" });
      [["aws", "AWS globe node"], ["desk", "Hawai\u02bbi desk stream"], ["tele", "AWS telemetry"], ["fresh", "Data freshness"]]
        .concat(st.deskHealthUrl ? [["deskh", "Desk health"]] : [])
        .forEach(function (r) {
          var dot = el("span", { class: "ov-dot" }), dd = el("dd", { text: "\u2026" });
          dl.appendChild(el("dt", {}, [dot, document.createTextNode(r[1])]));
          dl.appendChild(dd);
          rows[r[0]] = { dot: dot, dd: dd };
        });
      updated = el("div", { class: "ov-updated", text: "checking\u2026" });
      card("status", "Live status", [dl, updated]);
    }
    function setRow(k, level, text) {
      var r = rows[k]; if (!r) return;
      r.dot.className = "ov-dot" + (level ? " " + level : "");
      r.dd.textContent = text;
    }
    var busy = false;
    // Health: first URL that answers JSON wins. Supports both server shapes:
    //   mirror server.js  /healthz -> {ok, uptimeSec, aws, ...}
    //   AWS runtime       /health  -> {status:"ok", uptime, flows, ...}
    function firstJson(urls, i) {
      i = i || 0;
      if (i >= urls.length) return Promise.reject(new Error("no health endpoint"));
      return fetchJson(urls[i]).catch(function () { return firstJson(urls, i + 1); });
    }
    function settle(p) { return p.then(function (v) { return { ok: true, v: v }; }, function () { return { ok: false }; }); }
    function statusTick() {
      if (!cards.status || cards.status.hidden || busy || document.hidden) return;
      busy = true;
      var hu = (Array.isArray(st.healthUrls) ? st.healthUrls : [st.healthzUrl]).filter(safeUrl);
      var jobs = [settle(firstJson(hu)), settle(fetchJson(st.stateUrl))];
      var dh = safeUrl(st.deskHealthUrl);
      if (dh) jobs.push(settle(fetchJson(dh)));
      Promise.all(jobs).then(function (r) {
        var z = r[0].ok ? r[0].v || {} : null, d = r[1].ok ? r[1].v || {} : null;
        var s2 = (d && d.stats) || {};
        if (z) {
          var up = z.uptimeSec != null ? z.uptimeSec : z.uptime;
          var healthy = z.ok === true || /^ok$/i.test(String(z.status || ""));
          setRow("aws", healthy ? "ok" : "bad", healthy ? "up" + (up != null ? " \u00b7 " + dur(up) : "") : "not ok");
        } else setRow("aws", d ? "warn" : "bad", d ? "health n/a \u00b7 data ok" : "unreachable");
        var tele = z && typeof z.aws === "boolean" ? z.aws : d && d.aws ? !!d.aws.ok : null;
        setRow("tele", tele === null ? "" : tele ? "ok" : "warn", tele === null ? "unknown" : tele ? "reporting" : "not connected");
        if (d) {
          var n = s2.hawaiiActiveFlows != null ? Number(s2.hawaiiActiveFlows)
            : s2.collector === "hawaii-feed" ? Number(s2.activeFlows) : null;
          if (n === null || isNaN(n)) setRow("desk", "", "n/a");
          else setRow("desk", n > 0 ? "ok" : "warn", n > 0 ? "live \u00b7 " + n + " flows" : "no recent flows");
          if (s2.updated) {
            var age = (Date.now() - Number(s2.updated)) / 1000;
            setRow("fresh", age <= st.staleSec ? "ok" : "warn", age < 5 ? "just now" : Math.round(age) + " s ago");
          } else setRow("fresh", "ok", "feed answering");
        } else { setRow("desk", "bad", "unknown"); setRow("fresh", "bad", "no data"); }
        if (dh) {
          var j = r[2].ok ? r[2].v || {} : null;
          var hok = j && (j.ok === true || /^(ok|live|up)$/i.test(String(j.status || "")));
          setRow("deskh", j ? (hok ? "ok" : "warn") : "bad", j ? (hok ? "ok" : "degraded") : "unreachable");
        }
        updated.textContent = "checked " + hst(Date.now());
        busy = false;
      });
    }

    // ---- Left rail (flag) ----
    if (cfg.rail.enabled) {
      root.classList.add("rr-ov-rail");
      var rail = el("nav", { class: "ov-rail ov-glass", "aria-label": "Site" });
      var saved = load("rail");
      var open = saved ? saved === "open" : !cfg.rail.startCollapsed;
      var item = function (ico, lbl, onClick, href) {
        var n = el(href ? "a" : "button", href ? { href: href, rel: "noopener", title: lbl } : { type: "button", title: lbl },
          [el("span", { class: "ov-ico", text: ico, "aria-hidden": "true" }), el("span", { class: "ov-lbl", text: lbl })]);
        if (onClick) n.addEventListener("click", onClick);
        rail.appendChild(n);
      };
      var toggle = function () {
        open = !open; rail.classList.toggle("open", open); store("rail", open ? "open" : "closed");
        root.style.setProperty("--rr-rail-w", open ? "184px" : "52px");
      };
      item("\u2630", "Menu", toggle);
      item("\u25ce", "Globe", function () { Object.keys(cards).forEach(function (id) { setOpen(id, false); }); });
      if (cards.signup) item("\u271a", "Sign up", function () { setOpen("signup", true); });
      if (cards.home) item("\u2302", "Website", null, homeUrl);
      if (cards.status) item("\u2665", "Status", function () { setOpen("status", true); });
      if ((cfg.globe || {}).spinToggle !== false) item("\u21bb", "Spin on/off", function () { toggleSpin(); });
      rail.appendChild(el("div", { class: "ov-spacer" }));
      rail.classList.toggle("open", open);
      root.style.setProperty("--rr-rail-w", open ? "184px" : "52px");
      ov.appendChild(rail);
    }

    // ---- Globe interaction: spin toggle, click info, hover highlight (v2, 2026-09-29) ----
    // index.html declares `const globe = Globe()(…)` at the top level of a classic
    // script. That is a global *lexical* binding (not window.globe), visible to this
    // classic script by name. If globe.gl failed to load, the binding is in TDZ -> try/catch.
    var gopt = cfg.globe || {};
    function findGlobe() {
      try { return (typeof globe !== "undefined" && globe && typeof globe.controls === "function") ? globe : null; }
      catch (e) { return null; }
    }
    var spinOn = true, spinHeld = false, spinBtn = null;
    (function () {
      var sv = load("spin");
      var reduce = false; try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      spinOn = sv ? sv === "on" : gopt.spinDefault === "off" ? false : !(gopt.spinDefault === "auto" && reduce);
    })();
    function applySpin() {
      var g = findGlobe();
      if (g) { try { g.controls().autoRotate = spinOn && !spinHeld; } catch (e) {} }
      if (spinBtn) {
        spinBtn.textContent = spinOn ? "\u23f8 Stop spin" : "\u25b6 Resume spin";
        spinBtn.setAttribute("aria-pressed", spinOn ? "false" : "true");
        spinBtn.title = spinOn ? "Stop the globe rotating" : "Resume globe rotation";
      }
    }
    function toggleSpin() { spinOn = !spinOn; store("spin", spinOn ? "on" : "off"); applySpin(); }
    if (gopt.spinToggle !== false) {
      spinBtn = el("button", { type: "button", class: "ov-tool", id: "rr-ov-spin" });
      spinBtn.addEventListener("click", toggleSpin);
      tools.appendChild(spinBtn);
    }

    var info = null, infoTitle, infoSub, infoRows, infoNote, sel = null, hoverKey = null;
    var seen = {}, latestArcs = [], latestPoints = [];
    function trackSeen() {
      var g = findGlobe(); if (!g) return;
      var now = Date.now();
      try { latestArcs = (g.arcsData() || []).slice(); latestPoints = (g.pointsData() || []).slice(); } catch (e) { return; }
      latestArcs.forEach(function (a) { seen[arcKey(a)] = now; });
      latestPoints.forEach(function (p) { seen[pointKey(p)] = now; });
      for (var k in seen) if (now - seen[k] > 3600e3) delete seen[k];
    }
    function renderInfo() {
      if (!info || !sel) return;
      trackSeen();
      var list = sel.kind === "arc" ? latestArcs : latestPoints, keyFn = sel.kind === "arc" ? arcKey : pointKey, cur = null;
      for (var i = 0; i < list.length; i++) if (keyFn(list[i]) === sel.key) { cur = list[i]; break; }
      if (cur) sel.d = cur;
      var ts = seen[sel.key], ago = ts ? Math.round((Date.now() - ts) / 1000) : null;
      var ctx = { opt: gopt, arcs: latestArcs, lastSeen: ts ? (ago < 3 ? "now \u00b7 " : ago + " s ago \u00b7 ") + hst(ts) : null };
      var v = sel.kind === "arc" ? describeArc(sel.d, ctx) : describePoint(sel.d, ctx);
      infoTitle.textContent = v.title;
      infoSub.textContent = v.subtitle;
      while (infoRows.firstChild) infoRows.removeChild(infoRows.firstChild);
      v.rows.forEach(function (r) { infoRows.appendChild(el("dt", { text: r[0] })); infoRows.appendChild(el("dd", { text: r[1], title: r[1] })); });
      infoNote.textContent = cur ? "Live \u00b7 updates every 2 s" : "No longer in the live snapshot";
    }
    function select(kind, d) {
      if (!d || !info) return;
      sel = { kind: kind, key: kind === "arc" ? arcKey(d) : pointKey(d), d: d };
      info.hidden = false; ov.classList.add("has-info");
      if (gopt.pauseSpinWhileInfoOpen !== false) { spinHeld = true; applySpin(); }
      renderInfo(); highlight();
    }
    function closeInfo() {
      if (!info) return;
      info.hidden = true; sel = null; ov.classList.remove("has-info");
      spinHeld = false; applySpin(); highlight();
    }
    if (gopt.clickInfo !== false) {
      var ix = el("button", { class: "ov-x", type: "button", "aria-label": "Close info", title: "Close", text: "\u00d7" });
      infoTitle = el("h2"); infoSub = el("div", { class: "ov-sub" });
      infoRows = el("dl", { class: "ov-rows ov-kv" }); infoNote = el("div", { class: "ov-updated" });
      info = el("section", { class: "ov-card ov-glass ov-info", id: "rr-ov-info", "aria-live": "polite", "aria-label": "Selection info" }, [ix, infoTitle, infoSub, infoRows, infoNote]);
      info.hidden = true;
      ix.addEventListener("click", closeInfo);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeInfo(); });
    }

    var wired = false;
    function highlight() {
      var g = findGlobe(); if (!g || !g.__rrOrig) return;
      var o = g.__rrOrig, hk = hoverKey, sk = sel && sel.key;
      var val = function (acc, d) { return typeof acc === "function" ? acc(d) : acc; };
      var on = function (k) { return k === hk || k === sk; };
      try {
        g.arcColor(function (d) { return on(arcKey(d)) ? "#fde68a" : val(o.arcColor, d); });
        g.arcStroke(function (d) { var s = Number(val(o.arcStroke, d)) || 0.6; return on(arcKey(d)) ? s * 1.9 : s; });
        g.pointColor(function (d) { return on(pointKey(d)) ? "#fde68a" : val(o.pointColor, d); });
        g.pointRadius(function (d) { var r = Number(val(o.pointRadius, d)) || 0.3; return on(pointKey(d)) ? r * 1.7 : r; });
      } catch (e) {}
    }
    // Root cause of flaky hover/click (both page versions): poll() calls globe.arcsData()/pointsData()
    // every 1 s with freshly JSON-parsed objects. three-globe joins data by object identity, so
    // every arc/point mesh is destroyed and re-created each second and re-plays its 1 s grow-in
    // transition. Hover state goes stale, tooltips drop, and clicks hit half-grown geometry.
    // Fix without touching index.html: reuse the previous object for the same flow key, so
    // three-globe updates the mesh in place instead of re-creating it.
    function stabilize(g, name, keyFn, pre, reuse) {
      var orig = g[name];
      if (typeof orig !== "function" || orig.__rrStable) return;
      var prev = {};
      try { (orig.call(g) || []).forEach(function (d) { if (d && typeof d === "object") prev[keyFn(d)] = d; }); } catch (e) {}
      var wrapped = function (v) {
        if (!arguments.length) return orig.call(g);
        if (!Array.isArray(v)) return orig.call(g, v);
        if (pre) { try { v = pre(v); } catch (e) {} }
        if (!reuse) return orig.call(g, v);
        var next = {};
        var out = v.map(function (d) {
          if (!d || typeof d !== "object") return d;
          var k = keyFn(d), p = prev[k];
          if (next[k]) return d;                       // duplicate key in this batch: keep as-is
          if (p && p !== d) {
            for (var key in p) if (key.indexOf("__") !== 0 && !(key in d)) delete p[key];
            for (var key2 in d) p[key2] = d[key2];
            next[k] = p; return p;
          }
          next[k] = d; return d;
        });
        prev = next;
        return orig.call(g, out);
      };
      wrapped.__rrStable = true;
      g[name] = wrapped;
    }
    function wireGlobe() {
      if (wired) return true;
      var g = findGlobe(); if (!g) return false;
      wired = true;
      applySpin();
      var aw = gopt.awsNode || {}, awOn = aw.enabled !== false && isFinite(aw.lat) && isFinite(aw.lng);
      var preArcs = awOn ? function (v) { return withAwsLink(v, aw); } : null;
      var prePts = awOn ? function (v) { return withAwsPoint(v, aw); } : null;
      if (gopt.stableData !== false || awOn) { var ru = gopt.stableData !== false; stabilize(g, "arcsData", arcKey, preArcs, ru); stabilize(g, "pointsData", pointKey, prePts, ru); }
      if (awOn) { try { g.arcsData(g.arcsData() || []); g.pointsData(g.pointsData() || []); } catch (e) {} }
      var chain = function (name, fn) {
        var prev = null; try { prev = g[name](); } catch (e) {}
        g[name](function () { if (typeof prev === "function") { try { prev.apply(this, arguments); } catch (e) {} } fn.apply(this, arguments); });
      };
      if (gopt.hardenTooltips !== false) {
        try {
          g.arcLabel(function (d) { return safeArcLabel(d, gopt); });
          g.pointLabel(function (d) { return esc(scrub(d.label || "", 80)); });
        } catch (e) {}
      }
      if (info) {
        chain("onArcClick", function (d) { select("arc", d); });
        chain("onPointClick", function (d) { select("point", d); });
        chain("onGlobeClick", function () { closeInfo(); });
        setInterval(function () { if (sel && !document.hidden) renderInfo(); }, 2000);
      }
      if (gopt.hover !== false) {
        try { g.__rrOrig = { arcColor: g.arcColor(), arcStroke: g.arcStroke(), pointColor: g.pointColor(), pointRadius: g.pointRadius() }; } catch (e) {}
        var hov = function (kind) { return function (d) { var k = d ? (kind === "arc" ? arcKey(d) : pointKey(d)) : null; if (k !== hoverKey) { hoverKey = k; highlight(); } }; };
        chain("onArcHover", hov("arc"));
        chain("onPointHover", hov("point"));
      }
      return true;
    }
    if (!wireGlobe()) { var tries = 0, wt = setInterval(function () { if (wireGlobe() || ++tries > 40) clearInterval(wt); }, 250); }

    ov.appendChild(col);
    ov.appendChild(dock);
    if (info) ov.appendChild(info);
    document.body.appendChild(ov);
    Object.keys(cards).forEach(function (id) { cards[id].hidden = load("closed:" + id) === "1"; });
    renderDock();
    if (cards.status) {
      statusTick();
      setInterval(statusTick, Math.max(5, Number(st.pollSec) || 15) * 1000);
      document.addEventListener("visibilitychange", statusTick);
    }
    window.RR_OVERLAY = { config: cfg, open: function (id) { setOpen(id, true); }, close: function (id) { setOpen(id, false); },
      select: select, closeInfo: closeInfo, toggleSpin: toggleSpin, spin: function () { return spinOn; }, wired: function () { return wired; } };
  }

  var css = document.createElement("link");
  css.rel = "stylesheet"; css.href = BASE + "overlay.css";
  document.head.appendChild(css);
  fetchJson(BASE + "overlay-config.json", 4000)
    .then(function (c) { return merge(DEFAULTS, c); }, function () { return DEFAULTS; })
    .then(function (cfg) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(cfg); });
      else start(cfg);
    });
})();
