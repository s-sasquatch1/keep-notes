/* Keep Notes voice core, shared by the Notes app and the Record app: listening, sorting with Claude,
   alarm and calendar lines, the review-later queue and notifications. */
(function(){
  "use strict";
  var SRC = (document.currentScript && document.currentScript.src) || location.href;
  var ROOT = new URL("./", SRC).href;           // the Notes app's folder
  var NS = "keepnotes:";
  var CLAUDE_MODEL = "claude-sonnet-5-5";
  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], BYDAY = ["SU","MO","TU","WE","TH","FR","SA"];

  function lsGet(k, d){ try{ var v = localStorage.getItem(NS + k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } }
  function norm(s){ return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  function ymd(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function fmtDay(d){ return DAYS[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); }
  function okTime(hm){ return /^([01]?\d|2[0-3]):[0-5]\d$/.test(hm || ""); }
  function fmtTime(hm){ if(!okTime(hm)) return ""; var p = hm.split(":"), h = +p[0]; return (h % 12 || 12) + ":" + p[1] + " " + (h >= 12 ? "pm" : "am"); }
  function to24(h, mi, ap){ return pad(+h % 12 + (/pm/i.test(ap) ? 12 : 0)) + ":" + mi; }
  function stamp(d){ return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00"; }
  function nextDate(hm, test){
    var now = new Date(), p = (hm || "00:00").split(":"), d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +p[0], +p[1]);
    for(var i = 0; i < 9 && (d <= now || (test && !test(d))); i++) d.setDate(d.getDate() + 1);
    return ymd(d);
  }

  /* ---------- alarm and event lines ---------- */
  function alarmLine(a){
    var when = fmtTime(a.time), d = parseYmd(a.date);
    if(a.repeat === "daily") when += ", every day";
    else if(a.repeat === "weekdays") when += ", every weekday";
    else if(a.repeat === "weekly") when += ", every " + DAYS[(d || new Date()).getDay()];
    else if(d) when += ", " + fmtDay(d);
    return "Alarm " + when + ": " + (norm(a.label) || "Alarm");
  }
  function eventLine(e){
    var d = parseYmd(e.date), when = "";
    if(okTime(e.start)) when = fmtTime(e.start) + (okTime(e.end) ? " to " + fmtTime(e.end) : "") + ", ";
    return "Event " + when + fmtDay(d) + ": " + (norm(e.title) || "Event") + (norm(e.location) ? " (" + norm(e.location) + ")" : "");
  }
  function parseReminder(text){
    var m = /^(Alarm|Event)\s+(.+?):\s+(.+)$/.exec(norm(text)); if(!m) return null;
    var when = m[2], r = { kind:m[1].toLowerCase(), title:m[3], location:"", recur:"" };
    if(r.kind === "event"){ var lm = /\s\(([^)]+)\)$/.exec(r.title); if(lm){ r.location = lm[1]; r.title = r.title.slice(0, lm.index); } }
    var times = []; when.replace(/(\d{1,2}):(\d{2})\s*(am|pm)/gi, function(all, h, mi, ap){ times.push(to24(h, mi, ap)); return all; });
    r.start = times[0] || ""; r.end = times[1] || "";
    var dm = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(when);
    if(dm){ var mo = MON.map(function(x){ return x.toLowerCase(); }).indexOf(dm[2].toLowerCase()); if(mo >= 0) r.date = ymd(new Date(+dm[3], mo, +dm[1])); }
    var rep = /every\s+(day|weekday|[A-Za-z]{3})/i.exec(when);
    if(rep){
      var w = rep[1].toLowerCase(), di = DAYS.map(function(x){ return x.toLowerCase(); }).indexOf(w.slice(0, 3));
      if(w === "day"){ r.recur = "FREQ=DAILY"; if(!r.date) r.date = nextDate(r.start); }
      else if(w === "weekday"){ r.recur = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; if(!r.date) r.date = nextDate(r.start, function(d){ return d.getDay() > 0 && d.getDay() < 6; }); }
      else if(di >= 0){ r.recur = "FREQ=WEEKLY;BYDAY=" + BYDAY[di]; if(!r.date) r.date = nextDate(r.start, function(d){ return d.getDay() === di; }); }
    }
    if(!r.date){ if(!r.start) return null; r.date = nextDate(r.start); }
    return r;
  }
  function gcalUrl(r){
    var p = new URLSearchParams(), d = parseYmd(r.date);
    p.set("action", "TEMPLATE");
    p.set("text", r.kind === "alarm" ? "Alarm: " + r.title : r.title);
    if(!okTime(r.start)){ var nx = new Date(d); nx.setDate(nx.getDate() + 1); p.set("dates", ymd(d).replace(/-/g, "") + "/" + ymd(nx).replace(/-/g, "")); }
    else {
      var hs = r.start.split(":"), s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +hs[0], +hs[1]), en;
      if(okTime(r.end)){ var he = r.end.split(":"); en = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +he[0], +he[1]); if(en <= s) en.setDate(en.getDate() + 1); }
      else en = new Date(s.getTime() + (r.kind === "alarm" ? 10 : 60) * 60000);
      p.set("dates", stamp(s) + "/" + stamp(en));
      try{ p.set("ctz", Intl.DateTimeFormat().resolvedOptions().timeZone); }catch(e){}
    }
    p.set("details", r.details || (r.kind === "alarm" ? "Alarm from Keep Notes" : "Added from Keep Notes"));
    if(r.location) p.set("location", r.location);
    if(r.recur) p.set("recur", "RRULE:" + r.recur);
    return "https://calendar.google.com/calendar/render?" + p.toString();
  }

  /* ---------- sections, read straight from the notes text ---------- */
  function splitDoc(md){ return md.split(/(?=^## )/m); }
  function readMeta(text){
    var m = text.match(/<!--\s*keep:([\s\S]*?)-->/), meta = {};
    if(!m) return meta;
    m[1].split(";").forEach(function(bit){
      var i = bit.indexOf(":"), k = (i < 0 ? bit : bit.slice(0, i)).trim().toLowerCase(), v = i < 0 ? true : bit.slice(i + 1).trim();
      if(k) meta[k] = v;
    });
    return meta;
  }
  function plain(s){ return norm(s.replace(/\[added[^\]]*\]/g, "").replace(/[*_`]/g, "")); }
  /* Numbered sections only. map: id -> { head (the "## ..." line), name, gi (group index for colour) }; lines: the list sent to Claude. */
  function sectionsFromDoc(doc){
    var map = {}, lines = [], groups = [];
    splitDoc(doc || "").forEach(function(p, pi){
      if(!/^## /.test(p)) return;
      var head = p.split("\n")[0], meta = readMeta(p), gi = -1;
      if(typeof meta.group === "string"){ gi = groups.indexOf(meta.group); if(gi < 0){ groups.push(meta.group); gi = groups.length - 1; } }
      var m = /^## (\d+)\.\s+(.*)$/.exec(head); if(!m) return;
      var title = plain(m[2]), id = "s" + m[1]; if(map[id]) id += "-" + pi;
      map[id] = { head:head, name:m[1] + ". " + (typeof meta.short === "string" ? meta.short : title), gi:gi };
      lines.push("- " + id + ": " + title + (meta["private"] ? " (private)" : (typeof meta.blurb === "string" ? " | " + meta.blurb : "")));
    });
    return { map:map, lines:lines };
  }

  /* ---------- sorting with Claude ---------- */
  var sdkP = null;
  function loadSdk(){
    if(window.Anthropic) return Promise.resolve(window.Anthropic);
    if(!sdkP) sdkP = new Promise(function(res, rej){
      var s = document.createElement("script"); s.src = new URL("anthropic.min.js", ROOT).href;
      s.onload = function(){ window.Anthropic ? res(window.Anthropic) : rej(new Error("The Claude library didn't load.")); };
      s.onerror = function(){ sdkP = null; rej(new Error("Couldn't load the Claude library. Check your connection.")); };
      document.head.append(s);
    });
    return sdkP;
  }
  var SYSTEM = [
    "You sort one person's spoken voice notes into their personal notes app. The text came from speech recognition, so expect misheard words, missing punctuation and filler.",
    "Split the note into separate items when it covers several things. For each item, write it the way the person would jot it down: first person, plain and short, misheard words fixed when the meaning is clear, filler removed. Keep their meaning; don't add facts or advice.",
    "kind is \"todo\" for something they need to do, otherwise \"note\". section is the id of the section it fits best; use \"inbox\" when nothing fits well or you're unsure.",
    "alarms: only when they ask to be woken, alarmed or reminded at a particular clock time. label is a few words. time is 24-hour HH:MM. date is YYYY-MM-DD, or empty when they gave no day (the next time that clock time comes round). repeat is none, daily, weekdays or weekly.",
    "events: appointments, meetings and plans on a particular day that belong in a calendar. date is required (YYYY-MM-DD); start and end are 24-hour HH:MM or empty when not said (empty start means all day). If you can't work out a day, make it a todo instead.",
    "Don't repeat an alarm or event as a todo unless there is a separate task to do. Work out relative days (\"tomorrow\", \"next Tuesday\") from the current date you are given.",
    "summary is one short sentence saying what you understood."
  ].join("\n\n");
  function schemaFor(ids){
    var str = { type:"string" };
    return { type:"object", additionalProperties:false, required:["summary", "items", "alarms", "events"], properties:{
      summary:str,
      items:{ type:"array", items:{ type:"object", additionalProperties:false, required:["kind", "section", "text"], properties:{
        kind:{ type:"string", enum:["note", "todo"] }, section:{ type:"string", enum:ids.concat("inbox") }, text:str } } },
      alarms:{ type:"array", items:{ type:"object", additionalProperties:false, required:["label", "date", "time", "repeat"], properties:{
        label:str, date:str, time:str, repeat:{ type:"string", enum:["none", "daily", "weekdays", "weekly"] } } } },
      events:{ type:"array", items:{ type:"object", additionalProperties:false, required:["title", "date", "start", "end", "location", "details"], properties:{
        title:str, date:str, start:str, end:str, location:str, details:str } } }
    } };
  }
  function nowText(){
    var d = new Date(), tz = ""; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear() + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + (tz ? " (" + tz + ")" : "") + ", that is " + ymd(d);
  }
  /* secs comes from sectionsFromDoc. Resolves to { summary, items:[{kind,target,text}], alarms, events }. */
  async function sortNote(key, text, secs){
    var A = await loadSdk();
    var client = new A({ apiKey:key, dangerouslyAllowBrowser:true, baseURL:lsGet("claudeBase", null) || undefined, maxRetries:1, timeout:90000 });
    var res = await client.beta.messages.create({
      model:CLAUDE_MODEL,
      max_tokens:16000,
      betas:["server-side-fallback-2026-07-01"],
      fallbacks:"default",
      output_config:{ effort:"low", format:{ type:"json_schema", schema:schemaFor(Object.keys(secs.map)) } },
      system:SYSTEM,
      messages:[{ role:"user", content:"Current date and time: " + nowText() + "\n\nSections:\n" + secs.lines.join("\n") + "\n\nVoice note:\n<voice_note>\n" + text + "\n</voice_note>" }]
    });
    if(res.stop_reason === "refusal"){ var rf = new Error("refusal"); rf.code = "refusal"; throw rf; }
    var out = res.content.filter(function(b){ return b.type === "text"; }).map(function(b){ return b.text; }).join("");
    var j;
    try{ j = JSON.parse(out); }catch(e){ throw new Error(res.stop_reason === "max_tokens" ? "Claude's answer was cut short. Try a shorter note." : "Claude's answer couldn't be read. Try again."); }
    return {
      summary:String(j.summary || ""),
      items:(j.items || []).filter(function(it){ return it && norm(it.text); }).map(function(it){ return { kind:it.kind === "todo" ? "todo" : "note", target:secs.map[it.section] ? it.section : "inbox", text:norm(it.text) }; }),
      alarms:(j.alarms || []).filter(function(a){ return a && okTime(a.time); }).map(function(a){ return { label:norm(a.label) || "Alarm", date:parseYmd(a.date) ? a.date : "", time:a.time.length === 4 ? "0" + a.time : a.time, repeat:/^(daily|weekdays|weekly)$/.test(a.repeat) ? a.repeat : "none" }; }),
      events:(j.events || []).filter(function(e){ return e && parseYmd(e.date); }).map(function(e){ return { title:norm(e.title) || "Event", date:e.date, start:okTime(e.start) ? e.start : "", end:okTime(e.end) ? e.end : "", location:norm(e.location), details:String(e.details || "") }; })
    };
  }
  /* A plain-language message for a failed sort; settings is true when the fix is in Voice notes settings. */
  function explain(err){
    var A = window.Anthropic;
    if(err && err.code === "refusal") return { msg:"Claude declined to sort this note. You can save it to the Inbox instead." };
    if(A){
      if(err instanceof A.AuthenticationError) return { msg:"Claude didn't accept the API key. Check it in Voice notes settings.", settings:true };
      if(err instanceof A.PermissionDeniedError) return { msg:"This API key isn't allowed to do that. Check the key in the Claude Console.", settings:true };
      if(err instanceof A.RateLimitError) return { msg:"Claude is busy, or your account has hit a usage limit. Try again in a minute." };
      if(err instanceof A.APIConnectionError) return { msg:"Couldn't reach Claude. Check your connection, or save this to the Inbox for now." };
      if(err instanceof A.BadRequestError) return { msg:/credit|balance|billing/i.test(err.message || "") ? "Your Claude account is out of credit. Add some at console.anthropic.com, or save this to the Inbox for now." : "Claude couldn't handle the request (" + (err.status || 400) + "). You can save this to the Inbox instead." };
      if(err instanceof A.APIError) return { msg:"Claude had a problem" + (err.status ? " (" + err.status + ")" : "") + ". Try again in a moment." };
    }
    return { msg:(err && err.message) || "Something went wrong. Try again." };
  }

  /* ---------- listening ---------- */
  function getSR(){ return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function canListen(){ return !!getSR(); }
  /* o: { initial, silenceMs (stop after this long without new words), waitMs (give up if nothing is said), onState(), onText(text), onEnd({reason, heard, text}) }
     reason: "silence", "nothing", "quiet", "stopped", "blocked", "network", "nomic", "failed", "unsupported" */
  function listen(o){
    var api = { active:true, stop:stop }, SR = getSR();
    if(!SR){ api.active = false; setTimeout(function(){ if(o.onEnd) o.onEnd({ reason:"unsupported", heard:false, text:o.initial || "" }); }); return api; }
    var rec = null, want = true, text = o.initial || "", base = tidy(text), heardAny = false, heardThis = false, quiet = 0, silenceT = null, waitT = null, reason = "stopped";
    function tidy(s){ s = s.replace(/\s+$/, ""); return s ? s + " " : ""; }
    function armSilence(){ clearTimeout(silenceT); if(o.silenceMs) silenceT = setTimeout(function(){ reason = "silence"; stop(); }, o.silenceMs); }
    function finish(){
      if(!api.active) return; api.active = false; clearTimeout(silenceT); clearTimeout(waitT);
      if(o.onEnd) o.onEnd({ reason:reason === "stopped" && quiet >= 2 ? "quiet" : reason, heard:heardAny, text:text });
    }
    function run(){
      try{
        rec = new SR(); rec.lang = o.lang || navigator.language || "en-NZ"; rec.continuous = true; rec.interimResults = true; heardThis = false;
        rec.onstart = function(){ if(o.onState) o.onState("on"); };
        rec.onresult = function(e){
          var fin = "", tmp = "";
          for(var i = 0; i < e.results.length; i++){ var t = e.results[i][0].transcript; if(e.results[i].isFinal) fin += t; else tmp += t; }
          heardThis = heardAny = true; clearTimeout(waitT);
          text = base + (fin + tmp).replace(/^\s+/, "");
          if(o.onText) o.onText(text);
          armSilence();
        };
        rec.onerror = function(e){
          if(e.error === "not-allowed" || e.error === "service-not-allowed"){ want = false; reason = "blocked"; }
          else if(e.error === "network"){ want = false; reason = "network"; }
          else if(e.error === "audio-capture"){ want = false; reason = "nomic"; }
        };
        rec.onend = function(){
          rec = null; quiet = heardThis ? 0 : quiet + 1;
          if(want && quiet < 2){ base = tidy(text); setTimeout(function(){ if(want && !rec) run(); else if(!want) finish(); }, 200); return; }
          finish();
        };
        rec.start();
      }catch(err){ rec = null; want = false; reason = "failed"; finish(); }
    }
    function stop(){
      want = false; clearTimeout(silenceT); clearTimeout(waitT);
      if(rec){ try{ rec.stop(); }catch(e){ rec = null; finish(); } } else finish();
    }
    if(o.waitMs) waitT = setTimeout(function(){ if(!heardAny){ reason = "nothing"; stop(); } }, o.waitMs);
    run();
    return api;
  }

  /* ---------- review-later queue (IndexedDB, so the service worker can read it too) ---------- */
  var dbp = null;
  function db(){
    if(!dbp) dbp = new Promise(function(res, rej){ var r = indexedDB.open("keepnotes", 1); r.onupgradeneeded = function(){ r.result.createObjectStore("kv"); }; r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); }; });
    return dbp;
  }
  function tx(mode, fn){ return db().then(function(d){ return new Promise(function(res, rej){ var t = d.transaction("kv", mode), st = t.objectStore("kv"), out = { v:undefined }; fn(st, out); t.oncomplete = function(){ res(out.v); }; t.onerror = function(){ rej(t.error); }; }); }); }
  var pending = {
    newId:function(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    put:function(item){ return tx("readwrite", function(st){ st.put(item, "pending:" + item.id); }); },
    remove:function(id){ return tx("readwrite", function(st){ st.delete("pending:" + id); }); },
    get:function(id){ return tx("readonly", function(st, out){ var r = st.get("pending:" + id); r.onsuccess = function(){ out.v = r.result; }; }); },
    list:function(){
      return tx("readonly", function(st, out){
        var all = []; out.v = all;
        var c = st.openCursor(IDBKeyRange.bound("pending:", "pending:￿"));
        c.onsuccess = function(){ var cur = c.result; if(cur){ all.push(cur.value); cur.continue(); } };
      }).then(function(all){ return (all || []).sort(function(a, b){ return a.created - b.created; }); });
    }
  };

  /* ---------- notifications ---------- */
  function countText(r){
    var bits = [], t = r.items.filter(function(i){ return i.kind === "todo"; }).length, n = r.items.length - t;
    if(t) bits.push(t + (t === 1 ? " to-do" : " to-dos"));
    if(n) bits.push(n + (n === 1 ? " note" : " notes"));
    if(r.alarms.length) bits.push(r.alarms.length + (r.alarms.length === 1 ? " alarm" : " alarms"));
    if(r.events.length) bits.push(r.events.length + (r.events.length === 1 ? " event" : " events"));
    return bits.join(", ");
  }
  function swReg(){
    if(!("serviceWorker" in navigator)) return Promise.resolve(null);
    return Promise.race([navigator.serviceWorker.ready, new Promise(function(res){ setTimeout(function(){ res(null); }, 4000); })]);
  }
  /* Shows "review this" for a queued note. Resolves true when a notification was shown. */
  async function notify(item){
    if(!("Notification" in window) || Notification.permission !== "granted") return false;
    var reg = await swReg(); if(!reg) return false;
    var r = item.result, title, body;
    if(r){ title = "Voice note sorted: " + (countText(r) || "nothing found"); body = r.summary || item.text; }
    else { title = "Voice note saved"; body = (item.error ? item.error + " " : "") + "“" + item.text.slice(0, 90) + (item.text.length > 90 ? "…" : "") + "”"; }
    await reg.showNotification(title, {
      body:body, tag:"voice-" + item.id, icon:new URL("icon-192.png", ROOT).href,
      data:{ id:item.id },
      actions:r ? [{ action:"review", title:"Review" }, { action:"save", title:"Save all" }] : [{ action:"review", title:"Review" }]
    });
    return true;
  }

  window.KNV = {
    ROOT:ROOT, MON:MON, DAYS:DAYS, lsGet:lsGet, norm:norm, pad:pad, ymd:ymd, parseYmd:parseYmd, okTime:okTime, fmtTime:fmtTime, nextDate:nextDate,
    alarmLine:alarmLine, eventLine:eventLine, parseReminder:parseReminder, gcalUrl:gcalUrl,
    sectionsFromDoc:sectionsFromDoc, sortNote:sortNote, explain:explain, loadSdk:loadSdk,
    canListen:canListen, listen:listen, pending:pending, notify:notify, countText:countText
  };
})();
