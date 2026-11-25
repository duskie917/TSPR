import { config } from "../config.ts";

const EXAMPLES = [
  "Национальный банк КР: вам одобрен кредит 150 000 сом. Для получения оплатите страховой взнос 3 500 сом.",
  "Здравствуйте, служба безопасности банка. По вашей карте подозрительная операция, переведите деньги на безопасный счет.",
  "Мама, это я, попал в ДТП, это мой новый номер, не звони, срочно нужны деньги",
  "Вам начислена компенсация 12 000 сом. Успейте оформить: socfond-vyplata.online/kg",
  "Привет! Во сколько встречаемся завтра? Я возьму торт.",
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Single-file demo page served at GET / — lets a jury try the engine without Telegram. */
export const DEMO_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.brand.name)} — проверка на мошенничество</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5b6270;--border:#dde1e7;--accent:#1f6feb;
--danger:#c62828;--danger-bg:#fdecec;--warn:#b35c00;--warn-bg:#fff3e0;--ok:#2e7d32;--ok-bg:#e8f5e9}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e8eaef;--muted:#9aa3b2;--border:#2a2f3a;--accent:#4c8dff;
--danger:#ff6b6b;--danger-bg:#2a1416;--warn:#ffb74d;--warn-bg:#2a2012;--ok:#66bb6a;--ok-bg:#142417}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px}p.lead{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
textarea{width:100%;min-height:140px;resize:vertical;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
button{font:inherit;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:8px 12px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600;padding:10px 18px}
button:disabled{opacity:.6;cursor:wait}
.examples button{font-size:14px;color:var(--muted)}
#result{margin-top:20px;display:none}
.verdict{border-radius:12px;padding:16px;border:1px solid var(--border)}
.verdict.danger{background:var(--danger-bg);border-color:var(--danger)}.verdict.danger h2{color:var(--danger)}
.verdict.suspicious{background:var(--warn-bg);border-color:var(--warn)}.verdict.suspicious h2{color:var(--warn)}
.verdict.no_signs{background:var(--ok-bg);border-color:var(--ok)}.verdict.no_signs h2{color:var(--ok)}
.verdict h2{margin:0 0 4px;font-size:20px}.verdict h3{margin:16px 0 4px;font-size:15px}
.verdict ul,.verdict ol{margin:0;padding-left:20px}.muted{color:var(--muted);font-size:14px}
footer{margin-top:32px;color:var(--muted);font-size:14px}
</style>
</head>
<body>
<main>
<h1>🛡 ${esc(config.brand.name)}</h1>
<p class="lead">Вставьте подозрительное сообщение, ссылку или номер — и узнайте, похоже ли это на мошенничество. В Telegram бот работает так же: просто перешлите ему сообщение.</p>
<div class="card">
<label for="text" class="muted">Текст сообщения, ссылка или номер</label>
<textarea id="text" placeholder="Например: «Вам одобрен кредит от Нацбанка, оплатите страховку…»"></textarea>
<div class="row"><button class="primary" id="go">Проверить</button><span class="muted" id="status"></span></div>
<div class="row examples">${EXAMPLES.map((e, i) => `<button data-i="${i}">Пример ${i + 1}</button>`).join("")}</div>
</div>
<div id="result"></div>
<footer>Сервис не дает гарантий безопасности: он оценивает признаки мошенничества. Мы не сохраняем текст, который вы проверяете.</footer>
</main>
<script>
const EXAMPLES=${JSON.stringify(EXAMPLES).replace(/</g, "\\u003c")};
const TITLES={danger:"🔴 Очень похоже на мошенничество",suspicious:"🟠 Есть признаки мошенничества",no_signs:"🟢 Явных признаков не найдено"};
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
document.querySelectorAll(".examples button").forEach(b=>b.onclick=()=>{$("#text").value=EXAMPLES[b.dataset.i];check();});
$("#go").onclick=check;
async function check(){
  const text=$("#text").value.trim(); if(!text) return;
  $("#go").disabled=true; $("#status").textContent="Проверяю…";
  try{
    const r=await fetch("demo/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
    const v=await r.json(); if(!r.ok) throw new Error(v.error||r.status);
    let h='<div class="verdict '+v.level+'"><h2>'+TITLES[v.level]+'</h2>';
    if(v.scheme&&v.scheme.name) h+='<div>Похоже на схему: <b>'+esc(v.scheme.name)+'</b></div>';
    h+='<div class="muted">Уровень риска: '+v.score+'/100'+(v.ai_used?' · проверено ИИ':' · проверено по базе схем')+'</div>';
    if(v.explanation) h+='<p>'+esc(v.explanation)+'</p>';
    if(v.red_flags.length&&v.level!=="no_signs") h+='<h3>Что настораживает</h3><ul>'+v.red_flags.slice(0,6).map(f=>'<li>'+esc(f.text)+'</li>').join("")+'</ul>';
    if(v.advice.length) h+='<h3>Что делать</h3><ol>'+v.advice.map(a=>'<li>'+esc(a)+'</li>').join("")+'</ol>';
    h+='</div>'; $("#result").innerHTML=h; $("#result").style.display="block"; $("#status").textContent="";
  }catch(e){$("#status").textContent="Ошибка: "+e.message}
  finally{$("#go").disabled=false}
}
</script>
</body>
</html>`;
