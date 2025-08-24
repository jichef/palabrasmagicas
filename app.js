// Palabras Nieve — app.js (DPR correcto, iOS, solo letras, legible, reciclado, ARRÁSTRAR)

// ==== Canvas y elementos ====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const slotsWrap = document.getElementById('wordSlots');
const listSelect = document.getElementById('listSelect');
const btnNext = document.getElementById('btnNext');
const btnReset = document.getElementById('btnReset');
const difficultySel = document.getElementById('difficulty');

let W = 0, H = 0, DPR = Math.max(1, window.devicePixelRatio || 1);

// ==== Utilidades ====
const rand = (a,b)=>Math.random()*(b-a)+a;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const shuffle = arr => arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);

const up = s => s.toLocaleUpperCase('es-ES');
function onlyLettersArray(word){
  const nfc = word.normalize('NFC');
  return Array.from(nfc).filter(ch => /\p{L}/u.test(ch)); // solo letras (incluye Ñ, tildes…)
}

// ==== Config ====
const CFG_BY_DIFF = {
  "suave":   { gravity: 18, wind: 6,  spawnEveryMs: 900, maxFallSpeed: 160 },
  "media":   { gravity: 28, wind: 10, spawnEveryMs: 720, maxFallSpeed: 220 },
  "rápida":  { gravity: 40, wind: 14, spawnEveryMs: 540, maxFallSpeed: 300 }
};
let CFG = CFG_BY_DIFF[difficultySel.value];

const LETTER_FONT = '700 36px "Atkinson Hyperlegible", system-ui, sans-serif';
const LETTER_SIZE = 40; // px CSS

// ==== Estado ====
let WORDS = {listas:{}};
let activeListName = null;
let queue = [];
let current = null;    // { word, targetSlots[], filledCount }
let letters = [];
let lastSpawnAt = 0;
let running = true;
let winFlash = 0;

// ==== Init ====
(async function init(){
  await loadWords();
  buildListSelect();
  onResize();
  addEventListeners();
  startGame();
})();

async function loadWords(){
  const res = await fetch('words.json');
  WORDS = await res.json();
}

function buildListSelect(){
  listSelect.innerHTML = '';
  const names = Object.keys(WORDS.listas);
  for(const name of names){
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    listSelect.appendChild(opt);
  }
  activeListName = names[0] || null;
  listSelect.value = activeListName;
}

// ==== Palabras ====
function refillQueue(){
  if(!activeListName) return;
  queue = shuffle(WORDS.listas[activeListName].slice());
}

function nextWord(){
  if(queue.length===0) refillQueue();
  const word = queue.shift();
  setupWord(word);
}

function setupWord(word){
  letters.length = 0;
  slotsWrap.innerHTML = '';
  winFlash = 0;

  const chars = onlyLettersArray(word);
  const gaps = chars.map(ch => ({ ch: up(ch), x:0, y:0, w:42, h:58, filled:false }));

  for(const g of gaps){
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.ch = g.ch;
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.textContent = g.ch;
    el.appendChild(ghost);
    slotsWrap.appendChild(el);
  }

  current = { word, targetSlots: gaps, filledCount:0 };
  positionSlots();
}

function positionSlots(){
  if(!current) return;
  const canvasRect = canvas.getBoundingClientRect();
  const els = [...slotsWrap.querySelectorAll('.slot')];
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    current.targetSlots[i].x = r.left - canvasRect.left;
    current.targetSlots[i].y = r.top  - canvasRect.top;
    current.targetSlots[i].w = r.width;
    current.targetSlots[i].h = r.height;
  });
}

// ==== Letras ====
function spawnLetter(){
  if(!current || !current.targetSlots.length) return;
  const needed = current.targetSlots.filter(s=>!s.filled).map(s=>s.ch);
  const pool = needed.length ? needed : [ ...new Set(current.targetSlots.map(s=>s.ch)) ];
  const ch = pool[Math.floor(rand(0, pool.length))];

  const x = rand(LETTER_SIZE*1.2, W - LETTER_SIZE*1.2);
  letters.push({
    ch,
    x,
    y: -LETTER_SIZE,
    vx: rand(-CFG.wind, CFG.wind),
    vy: rand(10, 30),
    angle: rand(-Math.PI, Math.PI),
    locked:false
  });
}

function respawnLetter(p){
  p.locked = false;
  p.x = rand(LETTER_SIZE * 1.2, W - LETTER_SIZE * 1.2);
  p.y = -LETTER_SIZE;
  p.vx = rand(-CFG.wind, CFG.wind);
  p.vy = rand(10, 30);
  p.angle = rand(-Math.PI, Math.PI);
}

function updateLetter(p, dt){
  if(p.locked) return;

  p.vy += CFG.gravity * dt;
  p.vx += rand(-CFG.wind, CFG.wind) * 0.15 * dt;
  p.vy = clamp(p.vy, -9999, CFG.maxFallSpeed);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.angle += 0.6 * dt;

  if(p.x < LETTER_SIZE*0.6){ p.x=LETTER_SIZE*0.6; p.vx = Math.abs(p.vx)*0.4; }
  if(p.x > W-LETTER_SIZE*0.6){ p.x=W-LETTER_SIZE*0.6; p.vx = -Math.abs(p.vx)*0.4; }

  trySnap(p);

  if(p.y > H - LETTER_SIZE){
    respawnLetter(p);
  }
}

function trySnap(p){
  if(!current) return;
  for(let i=0;i<current.targetSlots.length;i++){
    const s = current.targetSlots[i];
    if(s.filled) continue;
    if(p.ch !== s.ch) continue;

    const cx = p.x, cy = p.y;
    const insideX = (cx > s.x + 6) && (cx < s.x + s.w - 6);
    const nearY   = Math.abs((s.y + s.h/2) - cy) < (s.h*0.45);
    if(insideX && nearY){
      p.locked = true;
      p.x = s.x + s.w/2;
      p.y = s.y + s.h/2;
      p.vx = p.vy = 0;
      s.filled = true;
      slotsWrap.children[i].classList.add('ok');
      current.filledCount++;
      if(current.filledCount === current.targetSlots.length){
        winFlash = 1.0;
        setTimeout(nextWord, 1200);
      }
      return;
    }
  }
}

// ==== Render ====
function drawBackground(){
  ctx.clearRect(0,0,W,H);
  if(winFlash>0){
    ctx.fillStyle = `rgba(125,211,252,${winFlash*0.6})`;
    ctx.fillRect(0,0,W,H);
    winFlash = Math.max(0, winFlash - 0.04);
  }
  ctx.save();
  ctx.globalAlpha = 0.25;
  for(let i=0;i<60;i++){
    const x = (i*97 % W);
    const y = (i*53 % H);
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

function drawLetters(){
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = LETTER_FONT;
  for(const p of letters){
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle*0.15);

    // halo
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(0,0, LETTER_SIZE*0.8, 0, Math.PI*2);
    ctx.fill();

    // letra legible
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.fillText(p.ch, 0, 4);
    ctx.strokeText(p.ch, 0, 4);

    ctx.restore();
  }
  ctx.restore();
}

// ==== Bucle ====
let lastTime = performance.now();
function loop(t){
  if(!running){ requestAnimationFrame(loop); return; }
  const dt = Math.min(0.033, (t - lastTime)/1000);
  lastTime = t;

  drawBackground();

  if(current && (t - lastSpawnAt > CFG.spawnEveryMs)){
    lastSpawnAt = t;
    const remain = current.targetSlots.length - current.filledCount;
    const maxOnScreen = clamp(remain + 3, 4, 12);
    const onScreen = letters.filter(l=>!l.locked).length;
    if(onScreen < maxOnScreen) spawnLetter();
  }

  for(const p of letters) updateLetter(p, dt);
  drawLetters();
  requestAnimationFrame(loop);
}

// ==== Interacción — modo ARRÁSTRAR (sin “huir”) ====
function addEventListeners(){
  window.addEventListener('resize', onResize);

  listSelect.addEventListener('change', ()=>{
    activeListName = listSelect.value;
    refillQueue();
    nextWord();
  });
  difficultySel.addEventListener('change', ()=>{
    CFG = CFG_BY_DIFF[difficultySel.value];
  });
  btnNext.addEventListener('click', ()=> nextWord());
  btnReset.addEventListener('click', ()=>{ refillQueue(); nextWord(); });

  let draggingLetter = null;

  const getLocal = (clientX, clientY)=>{
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const pickLetter = (x,y)=>{
    // elige la letra más cercana bajo el dedo
    let best = null, bestD2 = Infinity;
    for(const p of letters){
      if(p.locked) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx*dx + dy*dy;
      if(d2 < bestD2 && d2 < (LETTER_SIZE*LETTER_SIZE*0.5)){
        best = p; bestD2 = d2;
      }
    }
    if(best){
      draggingLetter = best;
      best.vx = best.vy = 0; // detener
    }
  };

  const moveLetter = (x,y)=>{
    if(draggingLetter){
      draggingLetter.x = x;
      draggingLetter.y = y;
      draggingLetter.vx = draggingLetter.vy = 0;
    }
  };

  const endDrag = ()=>{
    draggingLetter = null;
  };

  // Pointer (iOS/Android/desktop modernos)
  canvas.addEventListener('pointerdown', (e)=>{
    const {x,y} = getLocal(e.clientX,e.clientY);
    pickLetter(x,y);
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener('pointermove', (e)=>{
    if(!draggingLetter) return;
    const {x,y} = getLocal(e.clientX,e.clientY);
    moveLetter(x,y);
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener('pointerup', endDrag, {passive:false});
  canvas.addEventListener('pointercancel', endDrag, {passive:false});
  canvas.addEventListener('pointerleave', endDrag, {passive:false});

  // Fallback Touch (iOS viejos)
  canvas.addEventListener('touchstart', (e)=>{
    const t = e.changedTouches[0];
    const {x,y} = getLocal(t.clientX,t.clientY);
    pickLetter(x,y);
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener('touchmove', (e)=>{
    if(!draggingLetter) return;
    const t = e.changedTouches[0];
    const {x,y} = getLocal(t.clientX,t.clientY);
    moveLetter(x,y);
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener('touchend', endDrag, {passive:false});
  canvas.addEventListener('touchcancel', endDrag, {passive:false});

  // Recalcular posiciones de slots si cambia el layout
  const ro = new ResizeObserver(positionSlots);
  ro.observe(slotsWrap);
}

function onResize(){
  // tamaño CSS del canvas
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;

  // píxeles reales para nitidez
  DPR = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.max(1, Math.floor(cssW * DPR));
  canvas.height = Math.max(1, Math.floor(cssH * DPR));

  // dibujar en coordenadas CSS (evita deformaciones)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  W = cssW;
  H = cssH;

  positionSlots();
}

function startGame(){
  refillQueue();
  nextWord();
  requestAnimationFrame(loop);
}