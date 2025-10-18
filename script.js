/* GoldDigger - script.js
   Full-featured implementation:
   - Movement (arrow/WASD), mining (click or Space/Enter)
   - World generation (vertical), smooth camera
   - Tiles with hardness/HP, values, and break animations
   - Inventory, sell at surface, upgrades/shop that apply immediately
   - localStorage save/load, UI updates, sounds via WebAudio
   - Responsive canvas rendering and particle effects
*/

/* ---------------------------------
   Utilities & DOM helpers
   --------------------------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function rand(min, max) { return Math.random()*(max-min)+min; }

/* ---------------------------------
   DOM references
   --------------------------------- */
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const moneyDisplay = $('#money-display');
const energyFill = $('#energy-fill');
const inventoryList = $('#inventory-list');
const capVal = $('#cap-val');
const shopBtn = $('#shop-btn');
const shopModal = $('#shop-modal');
const shopClose = $('#shop-close');
const shopList = $('#shop-upgrade-list');
const popups = $('#popups');
const sellBtn = $('#sell-btn');
const saveBtn = $('#save-btn');
const resetBtn = $('#reset-btn');
const muteBtn = $('#mute-btn');
const titleScreen = $('#title-screen');
const startBtn = $('#start-btn');
const continueBtn = $('#continue-btn');
const resetSaveBtn = $('#reset-save-btn');
const upgradesListPanel = $('#upgrades-list');

/* ---------------------------------
   Game constants
   --------------------------------- */
const TILE_SIZE = 16;          // base tile size in pixels (scaled)
const VIEW_W = 30;             // tiles visible horizontally
const VIEW_H = 40;             // tiles visible vertically
const WORLD_W = VIEW_W;
const WORLD_H = 700;           // deep world for long play
const SURFACE_ROW = 4;         // rows considered surface
const SAVE_KEY = 'golddigger_save_v2';

/* ORE definitions */
const ORES = [
  { id:'dirt',     name:'Dirt',    color:'#8b6b3a', hardness:1, value:1, rarity:1.0 },
  { id:'stone',    name:'Stone',   color:'#6a6a6a', hardness:2, value:0, rarity:0.95 },
  { id:'coal',     name:'Coal',    color:'#111111', hardness:2, value:5, rarity:0.6 },
  { id:'iron',     name:'Iron',    color:'#c0c0c0', hardness:3, value:10, rarity:0.35 },
  { id:'gold',     name:'Gold',    color:'#ffd54a', hardness:4, value:25, rarity:0.18 },
  { id:'diamond',  name:'Diamond', color:'#80e0ff', hardness:6, value:50, rarity:0.06 }
];

/* Upgrades - each has apply(state) */
const UPGRADES = [
  { id:'pick1', name:'Pickaxe +1', desc:'Increase pick level by 1 (faster mining)', cost:120, apply:(s)=>{ s.pickLevel+=1; } },
  { id:'pack1', name:'Backpack +20', desc:'Increase inventory capacity by 20', cost:140, apply:(s)=>{ s.invCapacity += 20; } },
  { id:'fuel1', name:'Fuel Tank +20', desc:'Increase max energy by 20', cost:100, apply:(s)=>{ s.maxEnergy += 20; s.energy += 20; } }
];

/* ---------------------------------
   Saveable state
   --------------------------------- */
let state = {
  money: 0,
  inventory: {},   // {oreId: count}
  invCapacity: 50,
  pickLevel: 1,
  maxEnergy: 100,
  energy: 100,
  upgradesOwned: {},
  player: { x: Math.floor(WORLD_W/2), y: 2 },
};

/* ---------------------------------
   World
   --------------------------------- */
let world = []; // array of rows: world[y][x] = {id, hp, hardness, ore}
function genWorld(){
  world = [];
  for(let y=0;y<WORLD_H;y++){
    const row = [];
    for(let x=0;x<WORLD_W;x++){
      // base tile
      let tile = { id:'dirt', hardness:1, hp:1, ore:null };
      if(y > SURFACE_ROW){
        tile.id = 'stone'; tile.hardness=2; tile.hp=2;
      }
      // ore sampling, heavier chance with depth
      for(let ore of ORES.slice(2)){ // skip dirt & stone
        const depthFactor = y / WORLD_H;
        const chance = ore.rarity * (0.6 + depthFactor*2.0);
        if(Math.random() < chance){
          tile.id = ore.id;
          tile.hardness = ore.hardness;
          tile.hp = ore.hardness;
          tile.ore = ore.id;
          break;
        }
      }
      // occasional diamonds deeper
      if(Math.random() < 0.0008 + (y/WORLD_H)*0.002) {
        tile.id='diamond'; tile.hardness=6; tile.hp=6; tile.ore='diamond';
      }
      // surface rows = dirt
      if(y <= SURFACE_ROW){ tile.id='dirt'; tile.hardness=1; tile.hp=1; tile.ore=null; }
      row.push(tile);
    }
    world.push(row);
  }
}

/* helpers */
function getTile(y,x){
  if(y<0 || y>=WORLD_H || x<0 || x>=WORLD_W) return null;
  return world[y][x];
}

/* ---------------------------------
   Canvas & rendering setup
   --------------------------------- */
let devicePixelRatioCached = window.devicePixelRatio || 1;
function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  // use CSS to make canvas responsive
  // set canvas real pixel size
  const cssW = Math.max(320, Math.min(window.innerWidth - 360, 640));
  canvas.style.width = cssW + 'px';
  canvas.style.height = Math.floor(window.innerHeight * 0.78) + 'px';
  const DPR = window.devicePixelRatio || 1;
  canvas.width = Math.round(parseFloat(canvas.style.width) * DPR);
  canvas.height = Math.round(parseFloat(canvas.style.height) * DPR);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resizeCanvas);

/* camera */
let cameraY = 0;

/* draw functions */
function draw(){
  // clear
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // scaling between tile units and canvas pixels
  const tilePixel = (canvas.width / VIEW_W);
  // background gradient influenced by depth
  const grd = ctx.createLinearGradient(0,0,0,canvas.height);
  grd.addColorStop(0,'#7ec4ff'); grd.addColorStop(0.35,'#3fa3d9'); grd.addColorStop(1,'#0b2a2b');
  ctx.fillStyle = grd; ctx.fillRect(0,0,canvas.width,canvas.height);

  // compute top row visible
  const topRow = Math.floor(cameraY);
  for(let vy=0; vy<VIEW_H; vy++){
    for(let vx=0; vx<VIEW_W; vx++){
      const wy = topRow + vy;
      const tile = getTile(wy, vx);
      const px = vx * tilePixel;
      const py = vy * tilePixel;
      if(!tile) {
        // void
        ctx.fillStyle = '#000';
        ctx.fillRect(px,py,tilePixel,tilePixel);
        continue;
      }
      // tile color with depth darkening
      const oreDef = ORES.find(o => o.id === tile.id) || {color:'#444'};
      const depthFactor = Math.min(1, wy / WORLD_H);
      ctx.fillStyle = shadeColor(oreDef.color || '#6b4f2b', -Math.floor(depthFactor*30));
      ctx.fillRect(px,py,tilePixel,tilePixel);

      // subtle texture
      ctx.fillStyle = shadeColor(oreDef.color || '#6b4f2b', -10);
      for(let i=0;i<2;i++){
        ctx.fillRect(px + Math.random()*tilePixel, py + Math.random()*tilePixel, Math.max(1,Math.floor(tilePixel*0.06)), Math.max(1,Math.floor(tilePixel*0.06)));
      }
      // cracks if partially damaged
      if(tile.hp < tile.hardness){
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = Math.max(1, Math.floor(tilePixel*0.06));
        ctx.beginPath();
        ctx.moveTo(px + tilePixel*0.1, py + tilePixel*0.1);
        ctx.lineTo(px + tilePixel*0.9, py + tilePixel*0.9);
        ctx.stroke();
      }
    }
  }

  // draw player
  const playerScreenX = state.player.x * tilePixel;
  const playerScreenY = (state.player.y - topRow) * tilePixel;
  drawPlayer(playerScreenX, playerScreenY, tilePixel);

  // HUD: depth
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(6, canvas.height - 28, 140, 20);
  ctx.fillStyle = '#fff';
  ctx.font = `${12 * (canvas.width/480)}px Courier`;
  ctx.fillText(`Depth: ${state.player.y}`, 10 * (canvas.width/480), canvas.height - 12);
}

/* draw player simple sprited block */
function drawPlayer(px, py, tilePixel){
  ctx.fillStyle = '#ffcc99';
  ctx.fillRect(px + tilePixel*0.1, py + tilePixel*0.15, tilePixel*0.6, tilePixel*0.6);
  // helmet
  ctx.fillStyle = '#333';
  ctx.fillRect(px + tilePixel*0.1, py + tilePixel*0.05, tilePixel*0.6, tilePixel*0.12);
  // pick
  ctx.strokeStyle = '#bfbfbf';
  ctx.lineWidth = Math.max(1, Math.floor(tilePixel*0.06));
  ctx.beginPath();
  ctx.moveTo(px + tilePixel*0.7, py + tilePixel*0.4);
  ctx.lineTo(px + tilePixel*0.95, py + tilePixel*0.18);
  ctx.stroke();
}

/* color shade helper */
function shadeColor(hex, percent) {
  // hex format #rrggbb
  hex = hex.replace('#','');
  let R = parseInt(hex.substring(0,2),16);
  let G = parseInt(hex.substring(2,4),16);
  let B = parseInt(hex.substring(4,6),16);
  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);
  R = (R<255)?R:255; G=(G<255)?G:255; B=(B<255)?B:255;
  const rr = (R.toString(16).length===1)?'0'+R.toString(16):R.toString(16);
  const gg = (G.toString(16).length===1)?'0'+G.toString(16):G.toString(16);
  const bb = (B.toString(16).length===1)?'0'+B.toString(16):B.toString(16);
  return `#${rr}${gg}${bb}`;
}

/* ---------------------------------
   Particles & floating popups
   --------------------------------- */
const particles = [];
function createParticles(tx, ty, color='#c0c0c0', n=10){
  const rect = canvas.getBoundingClientRect();
  const topRow = Math.floor(cameraY);
  const tilePixel = (rect.width / VIEW_W);
  const px = tx * tilePixel;
  const py = (ty - topRow) * tilePixel;
  for(let i=0;i<n;i++){
    particles.push({
      x: px + Math.random()*tilePixel,
      y: py + Math.random()*tilePixel,
      vx: (Math.random()-0.5)*2.4,
      vy: -Math.random()*2.4,
      life: 40 + Math.random()*30,
      col: color,
    });
  }
}
function updateRenderParticles(){
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.life--;
    // render small rect
    const tilePixel = (canvas.width/VIEW_W);
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x, p.y, Math.max(1,Math.floor(tilePixel*0.06)), Math.max(1,Math.floor(tilePixel*0.06)));
    if(p.life <= 0) particles.splice(i,1);
  }
}

/* popup notifications (DOM) */
function popup(text, ttl=1500){
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  popups.appendChild(el);
  setTimeout(()=> {
    el.style.opacity = '0';
    setTimeout(()=> el.remove(), 300);
  }, ttl);
}

/* floating text anchored to tile (uses DOM and canvas position) */
function popFloating(text, tx, ty, ttl=900){
  const node = document.createElement('div');
  node.className = 'popup';
  node.textContent = text;
  node.style.position = 'absolute';
  node.style.pointerEvents = 'none';
  const rect = canvas.getBoundingClientRect();
  const topRow = Math.floor(cameraY);
  const tilePixel = (rect.width / VIEW_W);
  const sx = rect.left + tx * tilePixel;
  const sy = rect.top + (ty - topRow) * tilePixel;
  node.style.left = `${sx + tilePixel/2}px`;
  node.style.top = `${sy}px`;
  document.body.appendChild(node);
  setTimeout(()=> node.remove(), ttl);
}

/* ---------------------------------
   Audio (WebAudio synth & patterns)
   --------------------------------- */
class SFX {
  constructor(){
    this.ctx = null; this.gain = null; this.muted = false;
  }
  ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.12;
      this.gain.connect(this.ctx.destination);
    }
  }
  setMuted(v){ this.muted = v; if(this.gain) this.gain.gain.value = v ? 0 : 0.12; }
  playTone(freq=440, dur=0.08, type='sine', decay=0.08){
    if(this.muted) return;
    this.ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(this.gain);
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(1, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur + decay);
    o.start(now); o.stop(now + dur + decay + 0.02);
  }
  click(){ this.playTone(880, 0.04, 'square'); }
  mine(){ this.playTone(220, 0.06, 'sawtooth'); }
  sell(){ this.playTone(1200, 0.12, 'triangle', 0.12); }
  buy(){ this.playTone(900, 0.1, 'sine'); }
}
const sfx = new SFX();

/* mute toggle */
let isMuted = false;
muteBtn.addEventListener('click', ()=>{
  isMuted = !isMuted;
  sfx.setMuted(isMuted);
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
});

/* ---------------------------------
   Inventory & selling
   --------------------------------- */
function refreshInventoryUI(){
  inventoryList.innerHTML = '';
  const displayOres = ['dirt','coal','iron','gold','diamond','stone'];
  for(let id of displayOres){
    const def = ORES.find(o=>o.id===id) || {name:id, color:'#444', value:0};
    const count = state.inventory[id] || 0;
    const row = document.createElement('div');
    row.className = 'inv-item';
    row.innerHTML = `<div class="inv-name"><span class="ore-swatch" style="background:${def.color || '#444'}"></span><strong>${def.name}</strong></div><div>${count}</div>`;
    inventoryList.appendChild(row);
  }
  const total = Object.values(state.inventory).reduce((a,b)=>a+(b||0),0);
  capVal.textContent = `${total}/${state.invCapacity}`;
  moneyDisplay.textContent = `💰 ${state.money}`;
  // energy fill
  const pct = clamp(state.energy / state.maxEnergy, 0, 1) * 100;
  energyFill.style.width = pct + '%';
}

/* add ore */
function addToInventory(oreId, qty=1){
  // capacity check
  const total = Object.values(state.inventory).reduce((a,b)=>a+(b||0),0);
  if(total + qty > state.invCapacity){
    popup('Inventory full!');
    return false;
  }
  state.inventory[oreId] = (state.inventory[oreId] || 0) + qty;
  refreshInventoryUI();
  saveStateDebounced();
  return true;
}

/* sell all (only at surface) */
function atSurface(){ return state.player.y <= SURFACE_ROW; }
function sellAll(){
  if(!atSurface()){ popup('You must be at the surface to sell'); return; }
  let earned = 0;
  for(const id in state.inventory){
    const count = state.inventory[id]||0;
    if(count<=0) continue;
    const def = ORES.find(o=>o.id===id) || {value:1};
    earned += def.value * count;
    state.inventory[id] = 0;
  }
  if(earned === 0){ popup('Nothing to sell'); return; }
  state.money += earned;
  refreshInventoryUI();
  popup(`+$${earned}`);
  sfx.sell();
  createFloatingMoney(`+$${earned}`);
  saveStateDebounced();
}
sellBtn.addEventListener('click', sellAll);

/* floating money */
function createFloatingMoney(text){
  const node = document.createElement('div');
  node.className = 'popup';
  node.textContent = text;
  popups.appendChild(node);
  setTimeout(()=> node.remove(), 1400);
}

/* ---------------------------------
   Shop & upgrades
   --------------------------------- */
function openShop(){
  shopModal.classList.remove('hidden');
  shopList.innerHTML = '';
  for(let u of UPGRADES){
    const owned = !!state.upgradesOwned[u.id];
    const row = document.createElement('div');
    row.className = 'upgrade';
    row.innerHTML = `
      <div>
        <strong>${u.name}</strong>
        <div style="font-size:12px;color:#aaa">${u.desc}</div>
      </div>
      <div style="text-align:right">
        <div style="margin-bottom:6px">$${u.cost}</div>
        <button class="pixel-btn" data-id="${u.id}" ${owned? 'disabled' : ''}>${owned? 'Owned':'Buy'}</button>
      </div>`;
    shopList.appendChild(row);
  }
}
function buyUpgrade(id){
  const u = UPGRADES.find(x=>x.id===id);
  if(!u) return;
  if(state.money < u.cost){ popup('Not enough money'); return; }
  state.money -= u.cost;
  state.upgradesOwned[u.id] = true;
  u.apply(state);
  sfx.buy();
  popup('Upgrade Purchased!');
  refreshInventoryUI();
  saveStateDebounced();
  // refresh both shop and panel
  openShop(); initUpgradesPanel();
}
shopBtn.addEventListener('click', openShop);
shopClose.addEventListener('click', ()=> shopModal.classList.add('hidden'));
shopList.addEventListener('click',(e)=>{
  const btn = e.target.closest('button[data-id]');
  if(btn) buyUpgrade(btn.getAttribute('data-id'));
});

/* right-side upgrades panel quick access */
function initUpgradesPanel(){
  upgradesListPanel.innerHTML = '';
  for(let u of UPGRADES){
    const owned = !!state.upgradesOwned[u.id];
    const el = document.createElement('div');
    el.className = 'upgrade';
    el.innerHTML = `<div><strong>${u.name}</strong><div style="font-size:12px;color:#aaa">${u.desc}</div></div>
      <div>
        <div style="text-align:right;margin-bottom:6px">$${u.cost}</div>
        <button class="pixel-btn" data-id="${u.id}" ${owned? 'disabled':''}>${owned? 'Owned':'Buy'}</button>
      </div>`;
    upgradesListPanel.appendChild(el);
  }
}
upgradesListPanel.addEventListener('click',(e)=>{
  const btn = e.target.closest('button[data-id]');
  if(btn) buyUpgrade(btn.getAttribute('data-id'));
});

/* ---------------------------------
   Movement & mining
   --------------------------------- */
const keys = {};
window.addEventListener('keydown', (e)=>{ keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e)=>{ keys[e.key.toLowerCase()] = false; });

let moveCooldown = 0;
function playerTick(dt){
  const speedDelay = 0.06;
  moveCooldown -= dt;
  if(moveCooldown <= 0){
    if(keys['arrowleft'] || keys['a']){ tryMove(-1,0); moveCooldown = speedDelay; }
    else if(keys['arrowright'] || keys['d']){ tryMove(1,0); moveCooldown = speedDelay; }
    else if(keys['arrowdown'] || keys['s']){ tryMove(0,1); moveCooldown = speedDelay; }
  }
}

/* move if target is empty/air */
function tryMove(dx,dy){
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  if(nx < 0 || nx >= WORLD_W || ny < 0 || ny >= WORLD_H) return;
  const tile = getTile(ny, nx);
  // treat mined tiles or air as passable
  if(!tile || tile.id === 'air' || tile.hp <= 0){
    state.player.x = nx; state.player.y = ny;
  } else {
    // can't move through solid tile
  }
}

/* mining rules: can mine adjacent (4-directional) or tile below */
function canMineTile(tx, ty){
  const px = state.player.x, py = state.player.y;
  const dx = Math.abs(tx - px), dy = Math.abs(ty - py);
  if(dx + dy === 1 || (dx === 0 && ty === py+1)) return true;
  return false;
}

/* mine tile with pick power and animation */
function mineTile(tx, ty){
  const tile = getTile(ty, tx);
  if(!tile || tile.hp <= 0) return;
  if(!canMineTile(tx, ty)){ popup('Cannot reach'); return; }
  // pick power is pickLevel (reduces hits)
  const pickPower = Math.max(1, state.pickLevel);
  tile.hp -= pickPower;
  sfx.mine();
  createParticles(tx, ty, '#c8bda6', 12);
  if(tile.hp <= 0){
    // collect
    if(tile.ore){
      const oreDef = ORES.find(o=>o.id===tile.ore) || {value:1};
      if(addToInventory(tile.ore, 1)){
        popFloating(`+${oreDef.value}`, tx, ty);
      }
    } else {
      if(addToInventory('dirt',1)){
        popFloating('+1', tx, ty);
      }
    }
    // set to air/missing
    world[ty][tx] = { id:'air', hardness:0, hp:0, ore:null };
    sfx.click && sfx.click();
  }
}

/* canvas click mining */
canvas.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const tilePixel = rect.width / VIEW_W;
  const tx = Math.floor((e.clientX - rect.left) / tilePixel);
  const ty = Math.floor((e.clientY - rect.top) / tilePixel) + Math.floor(cameraY);
  mineTile(tx, ty);
  refreshInventoryUI();
});

/* keyboard mining */
window.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' || e.key === 'Enter'){
    e.preventDefault();
    mineTile(state.player.x, state.player.y + 1);
    refreshInventoryUI();
  }
});

/* ---------------------------------
   Save / Load
   --------------------------------- */
function saveState(){
  try{
    const toSave = {
      money: state.money,
      inventory: state.inventory,
      invCapacity: state.invCapacity,
      pickLevel: state.pickLevel,
      maxEnergy: state.maxEnergy,
      energy: state.energy,
      upgradesOwned: state.upgradesOwned,
      player: state.player,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave));
    popup('Game saved');
  }catch(e){ console.warn('save failed', e); }
}
function loadState(){
  try{
    const s = localStorage.getItem(SAVE_KEY);
    if(!s) return false;
    const parsed = JSON.parse(s);
    Object.assign(state, parsed);
    // safety defaults
    state.inventory = state.inventory || {};
    state.upgradesOwned = state.upgradesOwned || {};
    state.player = state.player || {x: Math.floor(WORLD_W/2), y:2};
    return true;
  }catch(e){ console.warn('load failed', e); return false; }
}
function resetSave(){
  if(confirm('Reset save? This will delete your progress.')) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
}
saveBtn.addEventListener('click', saveState);
resetBtn.addEventListener('click', resetSave);

/* debounced save to avoid spamming localStorage */
let saveTimer = null;
function saveStateDebounced(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ saveState(); saveTimer = null; }, 600);
}

/* ---------------------------------
   Camera & game loop
   --------------------------------- */
let lastTime = performance.now();
let cameraLerp = 0;
function updateCamera(){
  const target = state.player.y - Math.floor(VIEW_H/2);
  cameraY += (target - cameraY) * 0.12;
  cameraY = clamp(cameraY, 0, WORLD_H - VIEW_H);
}

/* main loop */
let gameRunning = false;
function mainLoop(ts){
  if(!gameRunning) return;
  const dt = (ts - lastTime)/1000; lastTime = ts;
  playerTick(dt);
  updateCamera();
  draw();
  updateRenderParticles();
  requestAnimationFrame(mainLoop);
}

/* ---------------------------------
   Initialization & UI hookups
   --------------------------------- */
function init(){
  resizeCanvas();
  genWorld();
  loadState(); // attempt load; if loaded keep state
  refreshInventoryUI();
  initUpgradesPanel();
  lastTime = performance.now();
}

/* Title screen start/continue behavior */
const hasSave = !!localStorage.getItem(SAVE_KEY);
function setupTitleScreen(){
  if(hasSave) titleScreen.classList.remove('hidden');
  else titleScreen.classList.add('hidden');
  startBtn.addEventListener('click', ()=>{
    // ensure audio context can start on interaction
    if(sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
    titleScreen.classList.add('hidden');
    startGame(false);
  });
  continueBtn.addEventListener('click', ()=>{
    titleScreen.classList.add('hidden');
    startGame(true);
  });
  resetSaveBtn.addEventListener('click', ()=> {
    if(confirm('Reset save?')) { localStorage.removeItem(SAVE_KEY); location.reload(); }
  });
}

/* startGame: continue true -> try load, otherwise fresh */
function startGame(continueSave=false){
  // if continue, load state
  if(continueSave){
    const ok = loadState();
    if(!ok) { popup('No save found - starting new game'); }
  } else {
    // if new start, reset world and ensure player at surface
    state.player = {x: Math.floor(WORLD_W/2), y:2};
  }
  // wire audio context unlocked on first input if needed
  sfx.ensure && sfx.ensure();
  // start loop
  gameRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);
  refreshInventoryUI();
}

/* upgrades UI population */
function initUpgradesPanel(){
  upgradesListPanel.innerHTML = '';
  for(let u of UPGRADES){
    const owned = !!state.upgradesOwned[u.id];
    const el = document.createElement('div');
    el.className = 'upgrade';
    el.innerHTML = `<div><strong>${u.name}</strong><div style="font-size:12px;color:#aaa">${u.desc}</div></div>
      <div>
        <div style="text-align:right;margin-bottom:6px">$${u.cost}</div>
        <button class="pixel-btn" data-id="${u.id}" ${owned? 'disabled':''}>${owned ? 'Owned' : 'Buy'}</button>
      </div>`;
    upgradesListPanel.appendChild(el);
  }
}

/* shop panel handler already attached earlier via openShop; ensure panel refresh after buying */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#shop-upgrade-list .pixel-btn[data-id], #upgrades-list .pixel-btn[data-id]');
  if(btn){
    const id = btn.getAttribute('data-id');
    buyUpgrade(id);
  }
});

/* user input handlers: provide friendly controls */
window.addEventListener('keydown', (e)=>{
  // resume audio ctx on first user interaction
  if(sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
});

/* resize on load */
window.addEventListener('load', ()=> {
  init();
  resizeCanvas();
  setupTitleScreen();
  // ensure start button always works (fix from earlier bug)
  // If no save exists, hide Continue
  if(!localStorage.getItem(SAVE_KEY)) {
    $('#continue-btn').style.opacity = '0.45';
  }
});

/* utility to ensure UI is updated at load */
refreshInventoryUI();

/* ---------------------------------
   Expose some dev helpers (console)
   --------------------------------- */
window.GoldDigger = {
  state, world, genWorld, saveState, loadState
};
