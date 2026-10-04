/* getbackpost.com: the home page, the admin panel (/admin) and the coach invite page (/join/<code>). */
(() => {
  "use strict";
  const ROUTE = window.BP_ROUTE || { kind: "landing" };
  if (ROUTE.kind === "school") return;
  const $ = s => document.querySelector(s);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const setStatus = (el, msg, kind) => { el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : ""); };
  async function api(method, path, body) {
    let res;
    try { res = await fetch("/api/" + path, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (_) { const e = new Error("Can't reach Backpost. Check your connection."); e.status = 0; throw e; }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error((data && data.error) || "Something went wrong. Try again."); e.status = res.status; throw e; }
    return data || {};
  }

  /* ---------- Home page ---------- */
  if (ROUTE.kind === "landing") {
    $("#landing").hidden = false;
    // The live session in the hero: the clock runs, and Win / Loss work.
    let w = 6, l = 3, secs = 37 * 60 + 11;
    const segs = $("#demoSegs");
    for (let i = 0; i < 20; i++) segs.append(mk("i", i >= 15 ? "stretch" : ""));
    const draw = () => {
      $("#demoN").textContent = String(w + l);
      $("#demoW").textContent = w + "W"; $("#demoL").textContent = l + "L";
      Array.from(segs.children).forEach((x, i) => x.classList.toggle("on", i < w + l));
    };
    draw();
    document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => { if (w + l >= 20) { w = 0; l = 0; } if (b.dataset.demo === "w") w++; else l++; draw(); }));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setInterval(() => { secs++; $("#demoClock").textContent = Math.floor(secs / 3600) + ":" + String(Math.floor((secs % 3600) / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0"); }, 1000);
    $("#reqForm").addEventListener("submit", async e => {
      e.preventDefault();
      const f = e.target, st = $("#reqStatus"), go = f.querySelector('button[type="submit"]');
      const val = n => f.elements.namedItem(n).value.trim();
      if (!val("school") || !val("name") || !val("email")) { setStatus(st, "Fill in your school, name and email.", "err"); return; }
      go.disabled = true;
      try {
        await api("POST", "public/request", { school: val("school"), name: val("name"), email: val("email"), role: val("role"), message: val("message"), website: val("website") });
        f.reset();
        setStatus(st, "Thanks. We'll email you to set up your team.", "ok");
      } catch (err) { setStatus(st, err.message, "err"); }
      finally { go.disabled = false; }
    });
    return;
  }

  /* ---------- Coach invite ---------- */
  if (ROUTE.kind === "join") {
    $("#joinApp").hidden = false;
    document.title = "Coach account · Backpost";
    const token = ROUTE.token;
    const fail = msg => { $("#joinForm").textContent = ""; $("#joinForm").append(mk("p", "status err", msg), Object.assign(mk("a", "btn", "Go to Backpost"), { href: "/" })); };
    (async () => {
      let info;
      try { info = await api("GET", "join/" + token); }
      catch (err) { fail(err.message); return; }
      const s = info.settings || {};
      const title = s.title || info.school.name;
      $("#joinTitle").textContent = title;
      $("#joinLead").textContent = "Set up your coach account for " + title + ". You'll use this name and password to sign in at getbackpost.com/" + info.school.slug + ".";
      const img = $("#joinLogo");
      if (s.logo) { img.src = s.logo; img.hidden = false; $("#joinMono").hidden = true; }
      else $("#joinMono").textContent = title.split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
      if (s.theme) {
        const t = s.theme, html = document.documentElement;
        html.style.setProperty("--brand", t.primary);
        if (t.secondary) html.style.setProperty("--accent", t.secondary);
        html.dataset.shape = t.shape; html.dataset.fonts = t.fonts; html.dataset.paper = t.paper;
      }
      $("#jName").focus();
    })();
    $("#joinForm").addEventListener("submit", async e => {
      e.preventDefault();
      const st = $("#jStatus"), go = $("#jGo");
      const name = $("#jName").value.trim(), pw = $("#jPw").value;
      if (!name) { setStatus(st, "Enter your name.", "err"); return; }
      if (pw.length < 8) { setStatus(st, "Use at least 8 characters for your password.", "err"); return; }
      if (pw !== $("#jPw2").value) { setStatus(st, "The passwords don't match.", "err"); return; }
      go.disabled = true;
      try {
        const r = await api("POST", "join/" + token, { name, password: pw });
        location.replace("/" + r.slug);
      } catch (err) { setStatus(st, err.message, "err"); go.disabled = false; }
    });
    return;
  }

  /* ---------- Admin ---------- */
  if (ROUTE.kind !== "admin") return;
  $("#adminApp").hidden = false;
  document.title = "Admin · Backpost";
  let needsSetup = false, setupVia = "";
  const fmtDay = ms => ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Never";
  const ago = ms => {
    if (!ms) return "No activity yet";
    const d = Math.floor((Date.now() - ms) / 864e5);
    return d <= 0 ? "Active today" : d === 1 ? "Active yesterday" : "Active " + d + " days ago";
  };
  function armOrRun(b, fn, label) {
    if (b.dataset.armed === "1") { b.dataset.armed = ""; fn(); return; }
    const old = b.textContent; b.dataset.armed = "1"; b.textContent = label || "Confirm";
    setTimeout(() => { if (b.isConnected && b.dataset.armed === "1") { b.dataset.armed = ""; b.textContent = old; } }, 4000);
  }
  async function boot() {
    let st;
    try { st = await api("GET", "admin/state"); }
    catch (err) { $("#adminAuth").hidden = false; setStatus($("#adStatus"), err.message, "err"); return; }
    needsSetup = !!st.needsSetup; setupVia = "";
    $("#adGate").hidden = true; $("#adminAuthForm").hidden = false; $("#adSetupNote").hidden = true; $("#adKeyRow").hidden = true;
    if (!st.me) {
      $("#adminAuth").hidden = false; $("#adminBody").hidden = true; $("#adminOut").hidden = true; $("#adminWho").textContent = "";
      $("#adminAuthT").textContent = needsSetup ? "Create the admin account" : "Admin sign in";
      if (needsSetup && st.founder) {
        // Only a signed-in coach of the founding team can make the first admin account.
        let me = null;
        try { me = (await api("GET", "s/" + encodeURIComponent(st.founder.slug) + "/me")).me; } catch (_) {}
        if (!me || me.role !== "coach") {
          $("#adminAuthForm").hidden = true; $("#adGate").hidden = false;
          $("#adGateMsg").textContent = "To create the admin account, first sign in to " + st.founder.name + " as a coach on this site, then come back to this page.";
          $("#adGateLink").href = "/" + st.founder.slug;
          $("#adGateLink").textContent = "Sign in to " + st.founder.name;
          return;
        }
        setupVia = "s/" + encodeURIComponent(st.founder.slug) + "/coach/claim-admin";
        $("#adSetupNote").hidden = false;
        $("#adSetupNote").textContent = "Signed in as " + me.name + ", coach of " + st.founder.name + ". Choose a name and a new password for the admin account.";
      } else if (needsSetup) {
        setupVia = "admin/setup";
        $("#adKeyRow").hidden = false;
      }
      $("#adPw2Row").hidden = !needsSetup;
      $("#adPw").autocomplete = needsSetup ? "new-password" : "current-password";
      $("#adGo").textContent = needsSetup ? "Create account" : "Sign in";
      $("#adName").focus();
      return;
    }
    $("#adminAuth").hidden = true; $("#adminBody").hidden = false; $("#adminOut").hidden = false;
    $("#adminWho").textContent = "Signed in as " + st.me.name;
    await Promise.all([loadSchools(), loadRequests()]);
  }
  $("#adminAuthForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#adStatus"), name = $("#adName").value.trim(), pw = $("#adPw").value;
    if (!name || !pw) { setStatus(st, "Enter your name and password.", "err"); return; }
    if (needsSetup) {
      if (pw.length < 10) { setStatus(st, "Use at least 10 characters.", "err"); return; }
      if (pw !== $("#adPw2").value) { setStatus(st, "The passwords don't match.", "err"); return; }
    }
    $("#adGo").disabled = true;
    const body = { name, password: pw };
    if (setupVia === "admin/setup") body.setupKey = $("#adKey").value;
    try { await api("POST", needsSetup ? setupVia : "admin/login", body); $("#adPw").value = ""; $("#adPw2").value = ""; $("#adKey").value = ""; setStatus(st, ""); await boot(); }
    catch (err) { setStatus(st, err.message, "err"); }
    finally { $("#adGo").disabled = false; }
  });
  $("#adminOut").addEventListener("click", async () => { try { await api("POST", "admin/logout", {}); } catch (_) {} boot(); });

  // Schools
  const slugify = v => String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  let slugTouched = false;
  $("#schoolNewOpen").addEventListener("click", () => { const f = $("#schoolForm"); f.hidden = !f.hidden; if (!f.hidden) { slugTouched = false; $("#snName").focus(); } });
  $("#snCancel").addEventListener("click", () => { $("#schoolForm").hidden = true; });
  $("#snName").addEventListener("input", () => { if (!slugTouched) $("#snSlug").value = slugify($("#snName").value); });
  $("#snSlug").addEventListener("input", () => { slugTouched = true; });
  $("#schoolForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#snStatus");
    try {
      await api("POST", "admin/schools", { name: $("#snName").value.trim(), slug: $("#snSlug").value.trim(), primary: $("#snPrimary").value, secondary: $("#snSecondary").value });
      e.target.reset(); $("#snPrimary").value = "#4289d1"; $("#snSecondary").value = "#ed8727";
      e.target.hidden = true; setStatus(st, "");
      await loadSchools();
    } catch (err) { setStatus(st, err.message, "err"); }
  });
  async function loadSchools() {
    const box = $("#schoolList");
    let r;
    try { r = await api("GET", "admin/schools"); } catch (err) { box.textContent = err.message; return; }
    box.textContent = "";
    if (!r.schools.length) { box.append(mk("p", "empty", "No schools yet. Create the first one.")); return; }
    for (const sc of r.schools) box.append(schoolCard(sc));
  }
  function schoolCard(sc) {
    const c = mk("div", "school" + (sc.status === "paused" ? " paused" : ""));
    const head = mk("div", "school-head");
    const name = mk("h3", "", sc.name);
    const link = mk("a", "linkbtn", "getbackpost.com/" + sc.id); link.href = "/" + sc.id; link.target = "_blank"; link.rel = "noopener";
    head.append(name, link);
    if (sc.status === "paused") head.append(mk("span", "pill missed", "Paused"));
    const facts = mk("p", "fine", [sc.players + (sc.players === 1 ? " player" : " players"), sc.coaches + (sc.coaches === 1 ? " coach" : " coaches"), ago(sc.lastActive), "Created " + fmtDay(sc.createdAt)].join("  |  "));
    const out = mk("div", "stack");
    const row = mk("div", "row");
    // Opens the team's own app with full coach powers: roster, coaches, schedule, reviews, settings and look.
    const manage = mk("a", "btn sm primary", "Manage team"); manage.href = "/" + sc.id;
    const edit = mk("button", "btn sm", "Name and address"); edit.type = "button";
    edit.addEventListener("click", () => {
      out.textContent = "";
      const f = mk("form", "sub"); f.noValidate = true;
      const nameF = mk("label", "fld"); nameF.append(mk("span", "lbl", "School or team name"));
      const nIn = mk("input"); nIn.type = "text"; nIn.maxLength = 60; nIn.value = sc.name; nameF.append(nIn);
      const slugF = mk("label", "fld"); slugF.append(mk("span", "lbl", "Web address"));
      const pre = mk("span", "addr-row"); pre.append(mk("span", "fine", "getbackpost.com/"));
      const sIn = mk("input"); sIn.type = "text"; sIn.maxLength = 32; sIn.value = sc.id; sIn.spellcheck = false; sIn.autocomplete = "off";
      pre.append(sIn); slugF.append(pre);
      const founder = sc.id === "nebraska";
      if (founder) sIn.disabled = true;
      const note = mk("p", "fine", founder ? "Nebraska keeps this address so the original site keeps working." : "Changing the address signs everyone on the team out. Old links and installed apps stop working, so send the team the new address.");
      const st3 = mk("p", "status"); st3.setAttribute("role", "status");
      const r3 = mk("div", "row end");
      const cancel = mk("button", "btn", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", () => { out.textContent = ""; });
      const save = mk("button", "btn primary", "Save"); save.type = "submit";
      r3.append(cancel, save);
      f.append(nameF, slugF, note, st3, r3);
      f.addEventListener("submit", async ev => {
        ev.preventDefault();
        const body = { name: nIn.value.trim() };
        const want = sIn.value.trim().toLowerCase();
        if (!founder && want !== sc.id) body.slug = want;
        save.disabled = true;
        try { await api("PATCH", "admin/schools/" + sc.id, body); await loadSchools(); }
        catch (err) { setStatus(st3, err.message, "err"); save.disabled = false; }
      });
      out.append(f);
      nIn.focus();
    });
    const inv = mk("button", "btn sm", "Invite a coach"); inv.type = "button";
    inv.addEventListener("click", async () => {
      inv.disabled = true;
      try {
        const r = await api("POST", "admin/schools/" + sc.id + "/invites", { days: 14 });
        out.textContent = "";
        const box = mk("div", "copybox");
        const code = mk("code", "", r.invite.link);
        const cp = mk("button", "btn sm", "Copy link"); cp.type = "button";
        cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.invite.link); cp.textContent = "Copied"; } catch (_) { const rg = document.createRange(); rg.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); } });
        box.append(code, cp);
        out.append(box, mk("p", "fine", "Works once, until " + fmtDay(r.invite.expiresAt) + ". Send it to the coach; they pick their own name and password."));
      } catch (err) { out.textContent = err.message; }
      finally { inv.disabled = false; }
    });
    const pause = mk("button", "btn sm", sc.status === "paused" ? "Resume" : "Pause"); pause.type = "button";
    pause.addEventListener("click", async () => {
      pause.disabled = true;
      try { await api("PATCH", "admin/schools/" + sc.id, { status: sc.status === "paused" ? "active" : "paused" }); await loadSchools(); }
      catch (err) { pause.disabled = false; out.textContent = err.message; }
    });
    const rm = mk("button", "linkbtn rm push", "Remove school"); rm.type = "button";
    rm.addEventListener("click", () => {
      out.textContent = "";
      const w = mk("div", "warnbox");
      w.append(mk("p", "", "This deletes " + sc.name + " and everything in it: players, sessions, reviews and schedule. Type " + sc.id + " to confirm."));
      const inp = mk("input"); inp.type = "text"; inp.setAttribute("aria-label", "Type " + sc.id + " to confirm");
      const go = mk("button", "btn sm primary", "Remove for good"); go.type = "button";
      go.addEventListener("click", async () => {
        try { await api("DELETE", "admin/schools/" + sc.id, { confirm: inp.value.trim() }); await loadSchools(); }
        catch (err) { setStatus(st2, err.message, "err"); }
      });
      const st2 = mk("p", "status");
      const r2 = mk("div", "row"); r2.append(inp, go);
      w.append(r2, st2);
      out.append(w);
      inp.focus();
    });
    row.append(manage, edit, inv, pause, rm);
    c.append(head, facts, row, out);
    return c;
  }
  async function loadRequests() {
    const box = $("#requestList");
    let r;
    try { r = await api("GET", "admin/requests"); } catch (err) { box.textContent = err.message; return; }
    box.textContent = "";
    if (!r.requests.length) { box.append(mk("p", "empty", "No requests yet.")); return; }
    for (const q of r.requests) {
      const c = mk("div", "school req" + (q.status === "done" ? " done" : ""));
      const head = mk("div", "school-head");
      head.append(mk("h3", "", q.school), mk("span", "fine", fmtDay(q.createdAt)));
      const who = mk("p", "");
      const mail = mk("a", "linkbtn", q.email); mail.href = "mailto:" + q.email;
      who.append(document.createTextNode(q.name + (q.role ? ", " + q.role : "") + "  "), mail);
      c.append(head, who);
      if (q.message) c.append(mk("p", "rv-note", q.message));
      const row = mk("div", "row");
      const done = mk("button", "btn sm", q.status === "done" ? "Mark new" : "Mark handled"); done.type = "button";
      done.addEventListener("click", async () => { await api("PATCH", "admin/requests/" + q.id, { status: q.status === "done" ? "new" : "done" }); loadRequests(); });
      const rm = mk("button", "linkbtn rm", "Delete"); rm.type = "button";
      rm.addEventListener("click", () => armOrRun(rm, async () => { await api("DELETE", "admin/requests/" + q.id); loadRequests(); }));
      row.append(done, rm);
      c.append(row);
      box.append(c);
    }
  }
  $("#adPwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#adPwStatus");
    try { await api("POST", "admin/password", { current: $("#adCur").value, next: $("#adNew").value }); $("#adCur").value = ""; $("#adNew").value = ""; setStatus(st, "Password changed.", "ok"); }
    catch (err) { setStatus(st, err.message, "err"); }
  });
  boot();
})();
