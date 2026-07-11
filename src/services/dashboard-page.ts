// The dashboard page — clean, light, document-style (NOT terminal). Geist Pixel for the brand title
// AND the section headers (served from the geist npm package via /fonts), Geist Sans body.
// Layout: sticky top (terminal log + header) · multi-column dashboard on the left · chat fixed right.
export const PAGE = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>polsia</title>
<style>
  @font-face{font-family:'Geist Pixel';src:url('/fonts/pixel.woff2') format('woff2');font-display:swap}
  @font-face{font-family:'Geist Sans';src:url('/fonts/sans.woff2') format('woff2');font-weight:100 900;font-display:swap}
  :root{ --bg:#f6f5f2; --card:#fff; --ink:#16150f; --dim:#8c887e; --line:#e6e3db; --accent:#d6532b; --green:#1a7f37; --mono:ui-monospace,'SF Mono',Menlo,monospace; }
  *{box-sizing:border-box}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:'Geist Sans',system-ui,sans-serif; font-size:14px; line-height:1.55; }
  h2{ font-family:'Geist Pixel',monospace; font-size:13px; font-weight:400; letter-spacing:.3px; margin:0 0 11px; padding-bottom:7px; border-bottom:1px solid var(--line); }
  a{color:var(--accent);text-decoration:none}
  /* sticky top: terminal log + header */
  .topbar{ position:sticky; top:0; z-index:30; }
  #logbar{ background:#0b0b0c; color:#d6d3cb; font-family:var(--mono); font-size:12px; padding:7px 28px; cursor:pointer; }
  #logbar:hover{color:#fff}
  #logfull{ max-height:200px; overflow:auto; margin-top:6px; padding-top:6px; border-top:1px solid #222; }
  #logfull .t{color:#6a6a6a} #logfull .a{color:#e0b341}
  header{ display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding:13px 28px; background:var(--bg); border-bottom:2px solid var(--ink); }
  .brand{ font-family:'Geist Pixel',monospace; font-size:26px; line-height:1; letter-spacing:.5px; }
  .co{ color:var(--dim); font-family:Georgia,serif; font-style:italic; }
  .controls{ margin-left:auto; display:flex; align-items:center; gap:8px; font-size:12px; color:var(--dim); }
  .pill{ font-family:var(--mono); font-size:11px; border:1px solid var(--line); border-radius:99px; padding:1px 9px; color:var(--dim); background:var(--card); }
  .pill.on{ color:var(--green); border-color:#bfe3c8; background:#f0faf2; }
  button{ font-family:var(--mono); font-size:11px; letter-spacing:.5px; text-transform:uppercase; background:var(--card); border:1px solid var(--ink); border-radius:5px; color:var(--ink); cursor:pointer; padding:4px 9px; }
  button:hover{ background:var(--ink); color:#fff; }
  button:disabled{ opacity:.5; cursor:default; }
  .wrap{ padding:20px 28px 40px; }
  /* layout: dashboard (multi-col) + chat (fixed right) */
  .layout{ display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:28px; align-items:start; }
  .dash{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:26px; align-items:start; }
  .col{ min-width:0; }
  section{ margin-bottom:24px; }
  /* agent card */
  .agent{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
  #face{ font-family:var(--mono); font-size:11px; line-height:1.15; margin:0 0 8px; white-space:pre; color:var(--ink); }
  .agent .nm{ font-weight:600; text-transform:capitalize; }
  .agent .md{ color:var(--accent); font-size:12px; font-family:var(--mono); }
  .agent .msg{ margin-top:7px; color:var(--dim); font-size:12.5px; max-height:80px; overflow:hidden; }
  /* business snapshot */
  .stats{ display:grid; grid-template-columns:repeat(2,1fr); gap:9px; }
  .stat{ background:var(--card); border:1px solid var(--line); border-radius:8px; padding:9px 11px; }
  .stat .k{ font-size:10.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.5px; }
  .stat .v{ font-size:19px; font-family:Georgia,serif; }
  .muted{ color:var(--dim); font-size:12px; }
  /* lists */
  .row{ display:flex; align-items:center; gap:9px; padding:8px 0; border-bottom:1px solid var(--line); }
  .row:last-child{border-bottom:none}
  .row .ttl{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .badge{ font-family:var(--mono); font-size:9.5px; text-transform:uppercase; letter-spacing:.5px; border:1px solid var(--line); border-radius:4px; padding:1px 5px; color:var(--dim); white-space:nowrap; }
  .b-suggested{ color:var(--accent); border-color:#f0c4b4; } .b-in_progress{ color:var(--green); border-color:#bfe3c8; }
  .b-completed{ color:var(--dim); } .b-failed{ color:#c0392b; } .b-needs_continuation{ color:#b8860b; border-color:#e8d4a0; }
  .pr{ font-family:var(--mono); font-size:11px; color:var(--dim); width:20px; }
  .doc{ cursor:pointer; } .doc:hover .ttl{ color:var(--accent); }
  .doc .ic{ color:var(--dim); } .doc .arr{ color:var(--dim); font-size:11px; }
  .soon{ background:var(--card); border:1px dashed var(--line); border-radius:8px; padding:11px; color:var(--dim); font-size:12px; }
  /* chat */
  .chat{ position:sticky; top:106px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; display:flex; flex-direction:column; height:calc(100vh - 126px); }
  #chatlog{ flex:1; overflow:auto; font-size:13px; }
  #chatlog .you{ margin:10px 0 2px; font-weight:600; }
  #chatlog .bot{ margin:2px 0 10px; color:#333; white-space:pre-wrap; }
  .chatin{ display:flex; gap:8px; border-top:1px solid var(--line); padding-top:10px; margin-top:10px; }
  #chatin{ flex:1; border:1px solid var(--line); border-radius:7px; padding:9px 11px; font-family:inherit; font-size:13px; outline:none; }
  #chatin:focus{ border-color:var(--ink); }
  /* onboarding overlay */
  #onboard{ position:fixed; inset:0; background:var(--bg); display:none; align-items:center; justify-content:center; z-index:40; padding:24px; }
  #onboard.show{ display:flex; }
  .ob-card{ max-width:540px; width:100%; text-align:center; }
  .ob-card .brand{ font-size:36px; }
  .ob-sub{ color:var(--dim); margin:12px 0 22px; font-size:15px; line-height:1.5; }
  #ob-idea{ width:100%; min-height:96px; border:1px solid var(--line); border-radius:10px; padding:14px; font-family:inherit; font-size:15px; outline:none; resize:vertical; background:var(--card); }
  #ob-idea:focus{ border-color:var(--ink); }
  #ob-btn{ margin-top:16px; font-size:13px; padding:10px 20px; }
  /* modal */
  #modal{ position:fixed; inset:0; background:rgba(20,18,12,.45); display:none; align-items:center; justify-content:center; z-index:50; padding:24px; }
  #modal.show{ display:flex; }
  .sheet{ background:var(--card); border:1px solid var(--line); border-radius:12px; max-width:680px; width:100%; max-height:82vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.2); }
  .sheet header{ display:flex; align-items:center; border:none; border-bottom:1px solid var(--line); padding:16px 20px; background:var(--card); }
  .sheet h3{ font-family:Georgia,serif; font-size:18px; margin:0; text-transform:capitalize; flex:1; }
  .sheet .body{ padding:18px 20px; overflow:auto; white-space:pre-wrap; line-height:1.6; font-size:14px; }
  .x{ cursor:pointer; border:1px solid var(--line); border-radius:6px; width:26px; height:26px; line-height:24px; text-align:center; color:var(--dim); }
  .x:hover{ background:var(--ink); color:#fff; }
</style></head>
<body>
  <div class="topbar">
    <div id="logbar" onclick="toggleLog()"><span id="logline">› booting…</span><div id="logfull" style="display:none"></div></div>
    <header>
      <div class="brand">polsia</div>
      <div class="co" id="co"></div>
      <div class="controls">
        <button onclick="newCompany()">+ new</button>
        <span>worker</span><span id="wpill" class="pill"></span>
        <button onclick="setWorker(true)">start</button><button onclick="setWorker(false)">stop</button>
        <button onclick="runCron(this)" title="daily cron: run the top proposal to completion, then the CEO reviews + replans">⏰ daily cron</button>
      </div>
    </header>
  </div>

  <div class="wrap">
    <div class="layout">
      <div class="dash">
        <div class="col">
          <section class="agent">
            <pre id="face"></pre>
            <div class="nm" id="aname">polsia</div><div class="md" id="amood"></div><div class="msg" id="amsg"></div>
          </section>
          <section>
            <h2>Business</h2>
            <div class="stats">
              <div class="stat"><div class="k">Visitors</div><div class="v" id="b-visitors">—</div></div>
              <div class="stat"><div class="k">Revenue</div><div class="v" id="b-revenue">—</div></div>
              <div class="stat"><div class="k">Shipped today</div><div class="v" id="b-shipped">—</div></div>
              <div class="stat"><div class="k">Documents</div><div class="v" id="b-docs">—</div></div>
            </div>
            <div class="muted" style="margin-top:8px">Visitors &amp; revenue populate once the site is live (beacon + Stripe).</div>
          </section>
        </div>

        <div class="col">
          <section><h2>Tasks</h2><div id="tasks"></div></section>
          <section><h2>Documents</h2><div id="docs"></div></section>
          <section><h2>Website</h2><div id="website"></div></section>
        </div>

        <div class="col">
          <section><h2>Twitter</h2><div class="soon">Coming soon — the growth agent posts here.</div></section>
          <section><h2>Email</h2><div class="soon">Coming soon — owner updates &amp; inbound.</div></section>
          <section><h2>Ads</h2><div class="soon">Coming soon — Meta/Google ad creatives.</div></section>
        </div>
      </div>

      <aside class="chat">
        <h2>Chat</h2>
        <div id="chatlog"></div>
        <div class="chatin">
          <input id="chatin" autocomplete="off" placeholder="Ask Polsia anything…">
        </div>
      </aside>
    </div>
  </div>

  <div id="onboard">
    <div class="ob-card">
      <div class="brand">polsia</div>
      <p class="ob-sub">Tell me your idea — I'll name the company, write the docs, set the goal,<br>and kick off the daily build.</p>
      <textarea id="ob-idea" placeholder="e.g. a monthly subscription for freshly-roasted single-origin coffee beans"></textarea>
      <div><button id="ob-btn" onclick="submitOnboard()">Build it →</button></div>
    </div>
  </div>

  <div id="modal" onclick="if(event.target===this)closeDoc()">
    <div class="sheet">
      <header><h3 id="m-title"></h3><div class="x" onclick="closeDoc()">✕</div></header>
      <div class="body" id="m-body"></div>
    </div>
  </div>
<script>
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const EYES={idle:'-   -',thinking:'o   o',building:'O   O',researching:'o   o',shipped:'^   ^',stuck:'x   x'};
const MOUTH={idle:'_____',thinking:'. . .',building:'=====',researching:'-----',shipped:'vvvvv',stuck:'wwwww'};
const MOODTXT={idle:'resting',thinking:'planning',building:'building',researching:'researching',shipped:'shipped!',stuck:'needs a look'};
function face(mood){ const e=EYES[mood]||EYES.idle, m=MOUTH[mood]||MOUTH.idle;
  return '┌───────────┐\n│   '+e+'   │\n│     ▽     │\n│   '+m+'   │\n└───────────┘'; }

let logOpen=false;
function toggleLog(){ logOpen=!logOpen; document.getElementById('logfull').style.display=logOpen?'block':'none'; }
async function post(u){ await fetch(u,{method:'POST'}); tick(); }
function setWorker(on){ post('/api/worker?on='+on); }
async function runCron(btn){ btn.disabled=true; const o=btn.textContent; btn.textContent='⏰ running…';
  try{ await fetch('/api/cron',{method:'POST'}); }catch(e){} btn.textContent=o; btn.disabled=false; tick(); }
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('button[data-act]'); if(b){ post('/api/'+b.dataset.act+'/'+b.dataset.id); return; }
  const rp=e.target.closest&&e.target.closest('.rep[data-report]'); if(rp){ openReport(rp.dataset.report, rp.dataset.name); return; }
  const d=e.target.closest&&e.target.closest('.doc[data-doc]'); if(d) openDoc(d.dataset.doc);
});
async function openDoc(type){
  document.getElementById('m-title').textContent=type.replace(/_/g,' ');
  document.getElementById('m-body').textContent='Loading…';
  document.getElementById('modal').classList.add('show');
  try{ const r=await(await fetch('/api/document?type='+encodeURIComponent(type))).json();
    document.getElementById('m-body').textContent=r.content||'(empty)'; }
  catch(e){ document.getElementById('m-body').textContent='[error] '+e; }
}
async function openReport(id, name){
  document.getElementById('m-title').textContent=name||('report #'+id);
  document.getElementById('m-body').textContent='Loading…';
  document.getElementById('modal').classList.add('show');
  try{ const r=await(await fetch('/api/report?id='+encodeURIComponent(id))).json();
    document.getElementById('m-body').textContent=(r&&r.content)||'(empty)'; }
  catch(e){ document.getElementById('m-body').textContent='[error] '+e; }
}
function closeDoc(){ document.getElementById('modal').classList.remove('show'); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeDoc(); });

let started=false;
function newCompany(){ started=false; fetch('/api/reset',{method:'POST'}).then(()=>tick()); }
async function submitOnboard(){
  const v=document.getElementById('ob-idea').value.trim(); if(!v)return;
  started=true;
  const btn=document.getElementById('ob-btn'); btn.disabled=true; btn.textContent='Setting up…';
  document.getElementById('onboard').classList.remove('show');
  await fetch('/api/onboard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idea:v})});
  btn.disabled=false; btn.textContent='Build it →'; document.getElementById('ob-idea').value='';
  tick();
}

async function tick(){
  let s; try{ s=await (await fetch('/api/state')).json(); }catch(e){ return; }
  // onboarding overlay: show when there's no onboarded company and we're not mid-onboarding.
  const onboarding = s.busy && s.agent && s.agent.name==='onboarding';
  document.getElementById('onboard').classList.toggle('show', !s.onboarded && !started && !onboarding);
  document.getElementById('co').textContent = s.company;
  const w=document.getElementById('wpill'); w.textContent=s.worker?(s.busy?'running':'on'):'off'; w.className='pill'+(s.worker?' on':'');

  const a=s.agent||{mood:'idle',name:'polsia',message:''};
  document.getElementById('face').textContent=face(a.mood);
  document.getElementById('aname').textContent=a.name;
  document.getElementById('amood').textContent=MOODTXT[a.mood]||a.mood;
  document.getElementById('amsg').textContent=a.message||(a.mood==='idle'?'Idle — start the worker or run the daily cron.':'');

  const b=s.business||{};
  document.getElementById('b-visitors').textContent=b.visitors??0;
  document.getElementById('b-revenue').textContent=b.revenue??'$0.00';
  document.getElementById('b-shipped').textContent=b.shippedToday??0;
  document.getElementById('b-docs').textContent=b.docs??0;

  document.getElementById('tasks').innerHTML = (s.tasks&&s.tasks.length)? s.tasks.map(t=>
    '<div class="row"><span class="pr">p'+t.priority+'</span><span class="badge b-'+t.status+'">'+t.status.replace('_',' ')+'</span>'+
    '<span class="ttl">'+esc(t.title)+'</span>'+
    (t.status==='suggested'?'<button data-act="approve" data-id="'+t.id+'">ok</button> <button data-act="reject" data-id="'+t.id+'">x</button>':'')+
    '</div>').join('') : '<div class="muted">No tasks yet — run the daily cron or ask in chat.</div>';

  const docRows = (s.documents||[]).map(d=>
    '<div class="row doc" data-doc="'+esc(d.type)+'"><span class="ic">▤</span><span class="ttl">'+esc(d.type.replace(/_/g,' '))+'</span><span class="muted">'+d.updated+'</span> <span class="arr">view ›</span></div>');
  const repRows = (s.reports||[]).map(r=>
    '<div class="row doc rep" data-report="'+r.id+'" data-name="'+esc(r.name)+'"><span class="ic">◈</span><span class="ttl">'+esc(r.name)+'</span><span class="muted">'+r.created+'</span> <span class="arr">view ›</span></div>');
  document.getElementById('docs').innerHTML = (docRows.length||repRows.length)? docRows.concat(repRows).join('') : '<div class="muted">No documents yet.</div>';

  document.getElementById('website').innerHTML = s.website
    ? '<div class="row"><span class="ttl"><a href="'+s.website+'" target="_blank">'+esc(s.website)+'</a></span><button>manage</button></div>'
    : '<div class="soon">Not deployed yet — ships when the engineering agent deploys the app.</div>';

  const ev=s.events||[];
  const last=ev[ev.length-1];
  document.getElementById('logline').textContent = last? ('› '+last.actor+' · '+last.type+' '+(last.payload||'')).slice(0,160) : '› idle';
  document.getElementById('logfull').innerHTML = ev.map(e=>'<div><span class="t">'+e.ts+'</span> <span class="a">'+e.actor+'</span> '+e.type+' '+esc(e.payload)+'</div>').join('');
}

const clog=document.getElementById('chatlog');
function addmsg(who,txt){ const d=document.createElement('div'); d.className=who==='you'?'you':'bot'; d.textContent=(who==='you'?'You: ':'Polsia: ')+txt; clog.appendChild(d); clog.scrollTop=clog.scrollHeight; return d; }
async function loadChat(){
  try{ const r=await(await fetch('/api/messages')).json();
    clog.innerHTML='';
    (r.messages||[]).forEach(m=>addmsg(m.role==='user'?'you':'bot', m.content));
  }catch(e){}
}
loadChat();
document.getElementById('chatin').addEventListener('keydown',async e=>{
  if(e.key!=='Enter')return; const v=e.target.value.trim(); if(!v)return;
  e.target.value=''; addmsg('you',v); const pend=addmsg('bot','…thinking');
  let text='';
  try{
    const resp=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:v})});
    const reader=resp.body.getReader(); const dec=new TextDecoder(); let buf='';
    for(;;){
      const {value,done}=await reader.read(); if(done)break;
      buf+=dec.decode(value,{stream:true});
      let i; while((i=buf.indexOf('\n\n'))>=0){
        const line=buf.slice(0,i).trim(); buf=buf.slice(i+2);
        if(!line.startsWith('data:'))continue;
        const ev=JSON.parse(line.slice(5).trim());
        if(ev.type==='tool'){ if(!text) pend.textContent='Polsia: ⚙ '+ev.name+'…'; }
        else if(ev.type==='text'){ text+=ev.delta; pend.textContent='Polsia: '+text; }
        else if(ev.type==='done'){ text=ev.reply||text; pend.textContent='Polsia: '+(text||'(no reply)'); }
        clog.scrollTop=clog.scrollHeight;
      }
    }
  }catch(err){ pend.textContent='Polsia: [error] '+err; }
  tick();
});
tick(); setInterval(tick, 1500);
</script>
</body></html>`;
