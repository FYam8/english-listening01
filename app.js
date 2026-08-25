
const SKILLS = ["次の発言","情報変更","場所","時刻","金額","した・しなかった","最終決定","理由","数量","否定","内容一致"];
const STORAGE_KEY = "waseshibuListeningProgressV1";
let questions = [];
let session = [];
let currentIndex = 0;
let sessionStats = [];
let deferredPrompt = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function loadProgress(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw) return JSON.parse(raw);
  const skills = {};
  SKILLS.forEach(s => skills[s] = {attempts:0, correct:0, streak:0, mastery:50, lastSeen:null});
  return {skills, totalAttempts:0, totalCorrect:0};
}
function saveProgress(p){ localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

function calcOverall(p){
  const values = Object.values(p.skills);
  const seen = values.filter(v=>v.attempts>0);
  if(!seen.length) return 50;
  return Math.round(seen.reduce((a,b)=>a+b.mastery,0)/seen.length);
}
function levelLabel(m){
  if(m < 55) return "基礎固め：A優先";
  if(m < 68) return "60点確保：A安定化";
  if(m < 78) return "65〜70点帯：B強化";
  return "70〜75点帯：弱点精密化";
}
function updateMastery(skill, correct){
  const p = loadProgress();
  const s = p.skills[skill] || {attempts:0,correct:0,streak:0,mastery:50,lastSeen:null};
  s.attempts += 1;
  s.correct += correct ? 1 : 0;
  s.streak = correct ? s.streak + 1 : 0;
  // BKT風の軽量更新: 正解 +7、誤答 -10、連続正解ボーナス +2、上下限15-95
  const delta = correct ? (7 + Math.min(s.streak,3)*0.7) : -10;
  s.mastery = Math.max(15, Math.min(95, Math.round((s.mastery + delta)*10)/10));
  s.lastSeen = new Date().toISOString();
  p.skills[skill] = s;
  p.totalAttempts += 1;
  p.totalCorrect += correct ? 1 : 0;
  saveProgress(p);
}
function renderHome(){
  const p = loadProgress();
  const overall = calcOverall(p);
  $("#overallMastery").textContent = overall+"%";
  $("#overallRing").style.background = `conic-gradient(#2563eb ${overall*3.6}deg,#e5e7eb 0deg)`;
  $("#levelBadge").textContent = levelLabel(overall);

  let goal = "A問題を落とさず、弱点を1つ改善する。";
  if(overall < 55) goal = "A問題を最優先。次の発言・場所・理由を安定させる。";
  else if(overall < 68) goal = "A問題90%を目標。情報変更は少量ずつ。";
  else if(overall < 78) goal = "Aを維持しつつ、時刻・金額・最終決定のB問題を増やす。";
  else goal = "弱点Bを精密補強。難問に固執せず70〜75点帯を安定化。";
  $("#todayGoal").textContent = goal;

  const rows = SKILLS.map(skill=>{
    const s = p.skills[skill];
    return `<div class="skill-row"><span>${skill}</span><div class="bar"><span style="width:${s.mastery}%"></span></div><strong>${Math.round(s.mastery)}%</strong></div>`;
  }).join("");
  $("#skillList").innerHTML = rows;

  const weak = [...SKILLS].sort((a,b)=>p.skills[a].mastery-p.skills[b].mastery).slice(0,3);
  $("#strategyCard").innerHTML = `
    <h3>合格戦略上の優先順位</h3>
    <p><strong>60点を守る：</strong> A問題の取りこぼしを最優先で削減。</p>
    <p><strong>65〜70点へ：</strong> 弱点上位「${weak.join("・")}」を重点復習。</p>
    <p><strong>70〜75点へ：</strong> Aを維持したままB問題比率を段階的に上げる。</p>`;
}
function showView(id){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $(id).classList.add("active");
}
function shuffle(a){ return [...a].sort(()=>Math.random()-.5); }

function selectSession(mode="daily"){
  const p = loadProgress();
  const overall = calcOverall(p);
  const weak = [...SKILLS].sort((a,b)=>p.skills[a].mastery-p.skills[b].mastery);
  let pool = questions;

  if(mode==="weak") pool = questions.filter(q=>weak.slice(0,4).includes(q.category));
  if(mode==="timeMoney") pool = questions.filter(q=>["時刻","金額","数量"].includes(q.category));

  let targetA = 6, targetB = 4;
  if(overall < 55){ targetA = 8; targetB = 2; }
  else if(overall < 68){ targetA = 7; targetB = 3; }
  else if(overall >= 78){ targetA = 5; targetB = 5; }
  if(mode==="ab"){ targetA = overall < 68 ? 8 : 6; targetB = 10-targetA; }

  const scoreQ = q => {
    const sm = p.skills[q.category]?.mastery ?? 50;
    const weakness = 100-sm;
    const unseen = (p.skills[q.category]?.attempts ?? 0)===0 ? 15 : 0;
    return weakness + unseen + Math.random()*25;
  };
  const choose = (diff,n) => pool.filter(q=>q.difficulty===diff).sort((a,b)=>scoreQ(b)-scoreQ(a)).slice(0,n);
  let chosen = [...choose("A",targetA), ...choose("B",targetB)];

  // 足りない場合は全プールから補充
  if(chosen.length < 10){
    const ids = new Set(chosen.map(x=>x.id));
    chosen.push(...pool.filter(q=>!ids.has(q.id)).sort((a,b)=>scoreQ(b)-scoreQ(a)).slice(0,10-chosen.length));
  }
  return shuffle(chosen).slice(0,10);
}

function startQuiz(mode){
  session = selectSession(mode);
  currentIndex = 0;
  sessionStats = [];
  showView("#quizView");
  renderQuestion();
}
function speakQuestion(q){
  if(!("speechSynthesis" in window)) return alert("このブラウザは音声読み上げに対応していません。");
  speechSynthesis.cancel();
  const items = [];
  q.script.forEach(([speaker,text])=>items.push(`${speaker}: ${text}`));
  items.push(`Question: ${q.question}`);
  const utter = new SpeechSynthesisUtterance(items.join(" ... "));
  utter.lang = "en-US";
  utter.rate = 0.92;
  speechSynthesis.speak(utter);
}

let listened = false;
function renderQuestion(){
  const q = session[currentIndex];
  if(!q){ finishQuiz(); return; }
  listened = false;
  $("#progressText").textContent = `${currentIndex+1} / ${session.length}`;
  $("#difficultyPill").textContent = q.difficulty;
  $("#categoryPill").textContent = q.category;
  $("#listenCount").textContent = "再生 0 / 1";
  $("#listenBtn").disabled = false;
  $("#questionText").textContent = q.question;
  $("#feedback").classList.add("hidden");
  $("#feedback").innerHTML = "";
  $("#choices").innerHTML = q.choices.map((c,i)=>`<button class="choice" data-i="${i}"><strong>${String.fromCharCode(65+i)}.</strong> ${c}</button>`).join("");
  $$(".choice").forEach(btn=>btn.addEventListener("click",()=>answerQuestion(Number(btn.dataset.i))));
}
function answerQuestion(choice){
  const q = session[currentIndex];
  const correct = choice===q.answer;
  updateMastery(q.category, correct);
  sessionStats.push({id:q.id,category:q.category,difficulty:q.difficulty,correct});
  $$(".choice").forEach((btn,i)=>{
    btn.disabled = true;
    if(i===q.answer) btn.classList.add("correct");
    if(i===choice && !correct) btn.classList.add("wrong");
  });
  $("#feedback").classList.remove("hidden");
  $("#feedback").innerHTML = `
    <h3 class="${correct?"good":"bad"}">${correct?"✅ 正解":"❌ 不正解"} — Answer ${String.fromCharCode(65+q.answer)}</h3>
    <p><strong>根拠：</strong>${q.evidence}</p>
    <p><strong>ひっかけ：</strong>${q.trap}</p>
    <p><strong>重要表現：</strong>${q.key}</p>
    <p><strong>解くコツ：</strong>${q.strategy}</p>
    <button class="primary-btn" id="nextBtn">${currentIndex+1===session.length?"結果を見る":"次の問題 →"}</button>`;
  $("#nextBtn").addEventListener("click",()=>{currentIndex++; renderQuestion();});
}
function finishQuiz(){
  const correct = sessionStats.filter(x=>x.correct).length;
  showView("#resultView");
  $("#resultScore").textContent = `${correct} / ${sessionStats.length}`;
  const a = sessionStats.filter(x=>x.difficulty==="A"), b = sessionStats.filter(x=>x.difficulty==="B");
  const ac = a.filter(x=>x.correct).length, bc = b.filter(x=>x.correct).length;
  $("#resultBreakdown").innerHTML = `<p>A問題：<strong>${ac}/${a.length||0}</strong>　B問題：<strong>${bc}/${b.length||0}</strong></p>`;
  const p = loadProgress(), overall = calcOverall(p);
  const weak = [...SKILLS].sort((x,y)=>p.skills[x].mastery-p.skills[y].mastery).slice(0,3);
  let advice = "";
  if(a.length && ac/a.length < .9) advice += `<p><strong>最優先：</strong>A問題の正答率を90%以上へ。C相当の難問より、まずAの取りこぼしを減らします。</p>`;
  else advice += `<p><strong>できていること：</strong>A問題は概ね守れています。次はB問題の取り方を増やします。</p>`;
  advice += `<p><strong>次回の重点：</strong>${weak.join("・")}</p>`;
  advice += `<p><strong>現在の習熟度：</strong>${overall}%（${levelLabel(overall)}）</p>`;
  $("#resultAdvice").innerHTML = advice;
}
async function init(){
  questions = await fetch("./questions.json").then(r=>r.json());
  renderHome();

  $$(".menu").forEach(b=>b.addEventListener("click",()=>startQuiz(b.dataset.mode)));
  $("#backHomeBtn").addEventListener("click",()=>{ speechSynthesis?.cancel(); showView("#homeView"); renderHome(); });
  $("#resultHomeBtn").addEventListener("click",()=>{ showView("#homeView"); renderHome(); });
  $("#listenBtn").addEventListener("click",()=>{
    if(listened) return;
    listened = true;
    $("#listenCount").textContent = "再生 1 / 1";
    $("#listenBtn").disabled = true;
    speakQuestion(session[currentIndex]);
  });
  $("#resetBtn").addEventListener("click",()=>{
    if(confirm("学習履歴をリセットしますか？")){
      localStorage.removeItem(STORAGE_KEY); renderHome();
    }
  });

  if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");

  window.addEventListener("beforeinstallprompt",(e)=>{
    e.preventDefault(); deferredPrompt = e; $("#installBtn").classList.remove("hidden");
  });
  $("#installBtn").addEventListener("click",async()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("#installBtn").classList.add("hidden");
  });
}
init();
