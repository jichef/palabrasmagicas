// Palabras Nieve — sin librerías — Canvas 2D + DOM para huecos
// by Juan & ChatGPT

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const slotsWrap = document.getElementById('wordSlots');
const listSelect = document.getElementById('listSelect');
const btnNext = document.getElementById('btnNext');
const btnReset = document.getElementById('btnReset');
const difficultySel = document.getElementById('difficulty');

let W = 0, H = 0, DPR = Math.max(1, devicePixelRatio || 1);

// ---------- Utilidades ----------
const rand = (a,b)=>Math.random()*(b-a)+a;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const shuffle = arr => arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);

// Normaliza: opcional si quieres “ignorar acentos” al decidir el hueco correcto.
// Aquí decidimos NO ignorarlos: 'Á' va a su hueco 'Á' (mejor pedagógicamente).
const up = s => s.toUpperCase();

// ---------- Config ----------
const CFG_BY_DIFF = {
  "suave":   { gravity: 18, wind: 6, spawnEveryMs: 900, maxFallSpeed: 160 },
  "media":   { gravity: 28, wind: 10, spawnEveryMs: 720, maxFallSpeed: 220 },
  "rápida":  { gravity: 40, wind: 14, spawnEveryMs: 540, maxFallSpeed: 300 }
};
let CFG = CFG_BY_DIFF[difficultySel.value];

const LETTER_FONT = 'bold 28px ui-sans-serif';
const LETTER_SIZE = 34; // caja aproximada para colisiones

// ---------- Estado ----------
let WORDS = {listas:{}};
let activeListName = null;
let queue = [];        // cola de palabras pendientes
let current = null;    // { word, targetSlots[], filledCount }
let letters = [];      // partículas que caen
let lastSpawnAt = 0;
let running = true;
let winFlash = 0;

// ---------- Carga JSON ----------
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

// ---------- Palabras / huecos ----------
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
  // Reset
  letters.length = 0;
  slotsWrap.innerHTML = '';
  winFlash = 0;

  const chars = [...word]; // conserva acentos
  const gaps = chars.map((ch, i) => ({
    ch: up(ch),
    x: 0, y: 0, w: 40, h: 56, filled:false
  }));

  // Construye los “huecos” visuales (DOM) centrados
  for(const g of gaps){
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.ch = g.ch;
    // “ghost” muestra la letra en bajísima opacidad a modo de pista (opcional):
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
  // calcula posiciones absolutas de los slots en relación al canvas
  const rect = slotsWrap.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const dx = rect.left - canvasRect.left;
  const dy = rect.top  - canvasRect.top;

  // Escribe coordenadas en 'current'
  const els = [...slotsWrap.querySelectorAll('.slot')];
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const x = (r.left - canvasRect.left);
    const y = (r.top  - canvasRect.top);
    current.targetSlots[i].x = x * DPR;
    current.targetSlots[i].y = y * DPR;
    current.targetSlots[i].w = r.width * DPR;
    current.targetSlots[i].h = r.height * DPR;
  });
}

// ---------- Letras que caen ----------
function spawnLetter(){
  if(!current) return;
  // Genera letras de la palabra mezcladas; si ya hay suficientes para llenar, añade algunas de relleno suaves
  const needed = current.targetSlots.filter(s=>!s.filled).map(s=>s.ch);
  const pool = needed.length ? needed : [ ...new Set(current.targetSlots.map(s=>s.ch)) ];
  const ch = pool[Math.floor(rand(0, pool.length))];

  const x = rand(LETTER_SIZE*1.2, W/DPR - LETTER_SIZE*1.2);
  letters.push({
    ch,
    x: x*DPR,
    y: -LETTER_SIZE*DPR,
    vx: rand(-CFG.wind, CFG.wind)*DPR,
    vy: rand(10, 30)*DPR,
    angle: rand(-Math.PI, Math.PI),
    locked:false
  });
}

function updateLetter(p, dt){
  if(p.locked) return;

  // Física simple
  p.vy += CFG.gravity * dt * DPR;
  p.vx += rand(-CFG.wind, CFG.wind) * 0.15 * dt * DPR;
  p.vy = clamp(p.vy, -9999, CFG.maxFallSpeed*DPR);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.angle += 0.6 * dt;

  // Paredes
  if(p.x < LETTER_SIZE*0.6*DPR){ p.x=LETTER_SIZE*0.6*DPR; p.vx = Math.abs(p.vx)*0.4; }
  if(p.x > W-LETTER_SIZE*0.6*DPR){ p.x=W-LETTER_SIZE*0.6*DPR; p.vx = -Math.abs(p.vx)*0.4; }

  // ¿Encaja en algún hueco?
  trySnap(p);

  // Suelo: si no encaja, rebota leve y vuelve a subir un poco (para que no se amontonen)
  if(p.y > H - LETTER_SIZE*DPR){
    p.y = H - LETTER_SIZE*DPR;
    p.vy = -Math.abs(p.vy)*0.35;
    p.vx *= 0.7;
  }
}

function trySnap(p){
  if(!current) return;

  for(let i=0;i<current.targetSlots.length;i++){
    const s = current.targetSlots[i];
    if(s.filled) continue;
    if(p.ch !== s.ch) continue;

    // Simple colisión centro-en-rectángulo
    const cx = p.x, cy = p.y;
    const insideX = (cx > s.x + 6*DPR) && (cx < s.x + s.w - 6*DPR);
    const nearY   = Math.abs((s.y + s.h/2) - cy) < (s.h*0.45);

    if(insideX && nearY){
      // Encaja
      p.locked = true;
      p.x = s.x + s.w/2;
      p.y = s.y + s.h/2;
      p.vx = p.vy = 0;
      s.filled = true;
      slotsWrap.children[i].classList.add('ok');
      current.filledCount++;

      if(current.filledCount === current.targetSlots.length){
        // Ganado
        winFlash = 1.0;
        setTimeout(nextWord, 1200);
      }
      return;
    }
  }
}

// ---------- Render ----------
function drawBackground(){
  // Nieve tenue de fondo
  ctx.clearRect(0,0,W,H);
  if(winFlash>0){
    ctx.fillStyle = `rgba(125,211,252,${winFlash*0.6})`;
    ctx.fillRect(0,0,W,H);
    winFlash = Math.max(0, winFlash - 0.04);
  }
  // Estrellas puntuales
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
    ctx.arc(0,0, LETTER_SIZE*0.8*DPR, 0, Math.PI*2);
    ctx.fill();
    // letra
    ctx.fillStyle = '#eef6ff';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2*DPR;
    ctx.fillText(p.ch, 0, 4*DPR);
    ctx.strokeText(p.ch, 0, 4*DPR);
    ctx.restore();
  }
  ctx.restore();
}

// ---------- Bucle ----------
let lastTime = performance.now();
function loop(t){
  if(!running){ requestAnimationFrame(loop); return; }
  const dt = Math.min(0.033, (t - lastTime)/1000); // cap 30ms
  lastTime = t;

  drawBackground();

  // Spawn
  if(current){
    if(t - lastSpawnAt > CFG.spawnEveryMs){
      lastSpawnAt = t;
      // No spawnear infinito: controla cuántas simultáneas si ya casi está completo
      const remain = current.targetSlots.length - current.filledCount;
      const maxOnScreen = clamp(remain + 3, 4, 12);
      const onScreen = letters.filter(l=>!l.locked).length;
      if(onScreen < maxOnScreen) spawnLetter();
    }
  }

  // Update
  for(const p of letters){
    updateLetter(p, dt);
  }

  drawLetters();

  requestAnimationFrame(loop);
}

// ---------- Interacción ----------
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
  btnReset.addEventListener('click', ()=>{
    refillQueue(); nextWord();
  });

  // Empujar letras con pointer (ratón o dedo)
  const push = (x,y)=>{
    const px = x * DPR, py = y * DPR;
    for(const p of letters){
      if(p.locked) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const d2 = dx*dx + dy*dy;
      const r = LETTER_SIZE*1.1*DPR;
      if(d2 < r*r){
        const d = Math.sqrt(d2) || 1;
        const ux = dx/d, uy = dy/d;
        p.vx += ux * 90;
        p.vy += uy * 90;
      }
    }
  };
  canvas.addEventListener('pointerdown', e=>{
    const rect = canvas.getBoundingClientRect();
    push(e.clientX-rect.left, e.clientY-rect.top);
  });
  canvas.addEventListener('pointermove', e=>{
    if(e.buttons!==1) return;
    const rect = canvas.getBoundingClientRect();
    push(e.clientX-rect.left, e.clientY-rect.top);
  });

  // Recalcular posiciones de slots si cambia el layout (por ejemplo, orientación)
  const ro = new ResizeObserver(positionSlots);
  ro.observe(slotsWrap);
}

function onResize(){
  const rect = canvas.getBoundingClientRect();
  DPR = Math.max(1, devicePixelRatio || 1);
  W = Math.floor(rect.width * DPR);
  H = Math.floor(rect.height * DPR);
  canvas.width = W; canvas.height = H;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(1,1);
  positionSlots();
}

function startGame(){
  refillQueue();
  nextWord();
  requestAnimationFrame(loop);
}