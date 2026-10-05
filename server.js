import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const TICK_MS = 60;
const INITIAL_COMBAT_GRACE = 6.0;
const SHOOTER_REACTION_MIN = 1.25;
const SHOOTER_REACTION_MAX = 2.25;
const SHOP_DURATION = 20;
const BULLET_GRAVITY = 4.2;
const HALL_MIN = -40;
const HALL_MAX = 40;
const TRAIN_X_MIN = -4.7;
const TRAIN_X_MAX = 4.7;
const TRAIN_Z_MIN = -28;
const TRAIN_Z_MAX = 28;
const OUTSIDE_Z = 56;
const DOWNED_DURATION = 15;
const REVIVE_DURATION = 3;
const REVIVE_RADIUS = 3.4;
const HALL_ESCAPE_MIN = -52;
const SAFE_X_MIN = -18;
const SAFE_X_MAX = 18;
const SAFE_Z_MIN = 44.15;
const SAFE_Z_MAX = 59;
let hallGateOpen = false;
const AMMO_DEFAULTS = {
  pistol: { mag: 12, reserve: 36, reload: 0.95 },
  shotgun: { mag: 8, reserve: 24, reload: 1.35 },
  rifle: { mag: 30, reserve: 120, reload: 1.55 }
};
let mapId = 'hall';
let escapeActive = false;
let escapeTimer = 0;
let victoryTriggered = false;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const players = new Map();
const enemies = new Map();
let wave = 0;
let waveState = 'intermission';
let waveTimer = 3.0;
let lastBroadcast = 0;
let nextEnemyId = 1;
let nextProjectileId = 1;
const projectiles = new Map();

const FLOOR_SPAWNS = [
  [-34,-34],[-16,-34],[2,-34],[20,-34],[34,-34],
  [-34,-18],[-16,-18],[2,-18],[20,-18],[34,-18],
  [-34,2],[-18,2],[18,2],[34,2],
  [-34,20],[-16,20],[2,20],[20,20],[34,20],
  [-30,34],[-10,34],[10,34],[30,34]
].map(([x,z]) => ({ x, z }));

const WALL_SPAWNS = [
  { id:'W-29', x:-43.2, z:-29 }, { id:'W-9', x:-43.2, z:-9 }, { id:'W11', x:-43.2, z:11 }, { id:'W31', x:-43.2, z:31 },
  { id:'E-29', x:43.2, z:-29 }, { id:'E-9', x:43.2, z:-9 }, { id:'E11', x:43.2, z:11 }, { id:'E31', x:43.2, z:31 },
  { id:'N-23', x:-23, z:-43.2 }, { id:'N0', x:0, z:-43.2 }, { id:'N23', x:23, z:-43.2 }
];

const HALL_BLOCKERS = [
  // Room partition walls with central 6m doorways.
  {x:-30,z:-34.8,halfX:9,halfZ:.28},{x:-30,z:-19.2,halfX:9,halfZ:.28},{x:30,z:-34.8,halfX:9,halfZ:.28},{x:30,z:-19.2,halfX:9,halfZ:.28},
  {x:-30,z:34.8,halfX:9,halfZ:.28},{x:-30,z:19.2,halfX:9,halfZ:.28},{x:30,z:34.8,halfX:9,halfZ:.28},{x:30,z:19.2,halfX:9,halfZ:.28},
  {x:-20,z:-32.45,halfX:.28,halfZ:2.55},{x:-20,z:-21.55,halfX:.28,halfZ:2.55},{x:20,z:-32.45,halfX:.28,halfZ:2.55},{x:20,z:-21.55,halfX:.28,halfZ:2.55},
  {x:-20,z:21.55,halfX:.28,halfZ:2.55},{x:-20,z:32.45,halfX:.28,halfZ:2.55},{x:20,z:21.55,halfX:.28,halfZ:2.55},{x:20,z:32.45,halfX:.28,halfZ:2.55},
  // Large central cover objects.
  {x:-13,z:-8,halfX:1.72,halfZ:.78},{x:13,z:-8,halfX:1.72,halfZ:.78},{x:-13,z:8,halfX:1.72,halfZ:.78},{x:13,z:8,halfX:1.72,halfZ:.78},
  // Entrance wall segments: keep the central doorway open.
  {x:-26,z:44,halfX:18,halfZ:.38},{x:26,z:44,halfX:18,halfZ:.38}
];
for(const r of [{cx:-30,cz:-27},{cx:30,cz:-27},{cx:-30,cz:27},{cx:30,cz:27}]){
  HALL_BLOCKERS.push(
    {x:r.cx-4,z:r.cz-3,halfX:1.42,halfZ:.67},
    {x:r.cx+4,z:r.cz+3,halfX:1.06,halfZ:.9},
    {x:r.cx+4,z:r.cz-3,halfX:.86,halfZ:.82},
    {x:r.cx-4,z:r.cz+3,halfX:1.32,halfZ:.67},
    {x:r.cx,z:r.cz+.3,halfX:1.75,halfZ:.78}
  );
}

const STATS = {
  walker: { hp:52, speed:2.8, damage:6, attackRange:1.7, cooldown:.78, radius:.72 },
  runner: { hp:40, speed:5.2, damage:9, attackRange:1.55, cooldown:.56, radius:.58 },
  tank: { hp:118, speed:1.55, damage:12, attackRange:1.95, cooldown:.9, radius:1.02 },
  shooter: { hp:46, speed:1.85, damage:6, attackRange:999, cooldown:1.85, radius:.7, preferredRange:18, minShootDistance:8 },
  kidnapper: { hp:86, speed:5.5, damage:0, attackRange:1.72, cooldown:.9, radius:.64 },
  dog: { hp:300, speed:4.0, damage:25, attackRange:2.9, cooldown:.8, radius:1.35 },
  boss: { hp:380, speed:2.05, damage:20, attackRange:3.6, cooldown:.84, radius:2.05 }
};

const WEAPONS = {
  pistol:{cost:500,damage:30,cooldown:.28,range:65,magSize:12,reserveMax:36,reload:.95},
  shotgun:{cost:2500,damage:10,pellets:8,cooldown:.82,range:34,magSize:8,reserveMax:24,reload:1.35},
  rifle:{cost:5000,damage:20,cooldown:.105,range:85,magSize:30,reserveMax:120,reload:1.55}
};

function nowSeconds() { return Date.now() / 1000; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function resolveHallPosition(x,z,radius=.6, allowEscape=false){
  let px=clamp(x,-40+radius,40-radius);
  let pz=clamp(z,(allowEscape?HALL_ESCAPE_MIN:-40)+radius,59-radius);
  for(const b of HALL_BLOCKERS){
    const left=b.x-b.halfX, right=b.x+b.halfX, top=b.z-b.halfZ, bottom=b.z+b.halfZ;
    const qx=clamp(px,left,right), qz=clamp(pz,top,bottom);
    let dx=px-qx,dz=pz-qz,d=Math.hypot(dx,dz);
    if(d<radius){
      if(d<0.0001){
        const dl=px-left, dr=right-px, dt=pz-top, db=bottom-pz; const m=Math.min(dl,dr,dt,db);
        if(m===dl) dx=-1,dz=0; else if(m===dr) dx=1,dz=0; else if(m===dt) dx=0,dz=-1; else dx=0,dz=1; d=1;
      }
      const push=(radius-d)/d; px+=dx*push; pz+=dz*push;
    }
  }
  return {x:px,z:pz};
}
function segmentIntersectsRect(ax,az,bx,bz,r,margin=0){
  const minX=r.x-r.halfX-margin,maxX=r.x+r.halfX+margin,minZ=r.z-r.halfZ-margin,maxZ=r.z+r.halfZ+margin;
  let t0=0,t1=1,dx=bx-ax,dz=bz-az;
  const slabs=[[ax,dx,minX,maxX],[az,dz,minZ,maxZ]];
  for(const [p,d,min,max] of slabs){
    if(Math.abs(d)<1e-8){if(p<min||p>max)return false;}
    else {let a=(min-p)/d,b=(max-p)/d;if(a>b)[a,b]=[b,a];t0=Math.max(t0,a);t1=Math.min(t1,b);if(t0>t1)return false;}
  }
  return true;
}
function steeringTarget(enemy,target){
  if(mapId!=='hall')return target;
  const blocker=HALL_BLOCKERS.find(b=>segmentIntersectsRect(enemy.x,enemy.z,target.x,target.z,b,1.0));
  if(!blocker)return target;
  const margin=1.8;
  const corners=[
    {x:blocker.x-blocker.halfX-margin,z:blocker.z-blocker.halfZ-margin},
    {x:blocker.x+blocker.halfX+margin,z:blocker.z-blocker.halfZ-margin},
    {x:blocker.x-blocker.halfX-margin,z:blocker.z+blocker.halfZ+margin},
    {x:blocker.x+blocker.halfX+margin,z:blocker.z+blocker.halfZ+margin}
  ];
  corners.sort((a,b)=>(dist2(enemy.x,enemy.z,a.x,a.z)+dist2(a.x,a.z,target.x,target.z)*.45)-(dist2(enemy.x,enemy.z,b.x,b.z)+dist2(b.x,b.z,target.x,target.z)*.45));
  return corners[0];
}

function createAmmoState() {
  return {
    pistol: { ...AMMO_DEFAULTS.pistol },
    shotgun: { ...AMMO_DEFAULTS.shotgun },
    rifle: { ...AMMO_DEFAULTS.rifle }
  };
}
function ammoSnapshot(p) {
  return { pistol:{...(p.ammo?.pistol||AMMO_DEFAULTS.pistol)}, shotgun:{...(p.ammo?.shotgun||AMMO_DEFAULTS.shotgun)}, rifle:{...(p.ammo?.rifle||AMMO_DEFAULTS.rifle)} };
}

function sanitizeName(input) {
  const s = String(input ?? '').replace(/[^a-zA-Z0-9_ áéíóúÁÉÍÓÚñÑ-]/g, '').trim().slice(0,16).toUpperCase();
  return s || 'CAPSULE';
}
function send(ws, payload) { if (ws?.readyState === 1) ws.sendText(JSON.stringify(payload)); }
function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.sendText(text);
}
function playerSnapshot() {
  return [...players.values()].map(p => ({ id:p.id, name:p.name, x:p.x, y:p.y, z:p.z, yaw:p.yaw, pitch:p.pitch, hp:p.hp, money:p.money, kills:p.kills||0, dead:p.dead, spectator:!!p.spectator, downed:!!p.downed, downedRemaining: p.downed ? Math.max(0, p.downedUntil-nowSeconds()) : 0, reviveProgress: p.reviveBy ? clamp((nowSeconds()-p.reviveStarted)/REVIVE_DURATION,0,1) : 0, inventory:p.inventory, weapon:p.weapon, ammo:ammoSnapshot(p), reloading:!!p.reloading, reloadRemaining:p.reloading?Math.max(0,(p.reloadEnds||nowSeconds())-nowSeconds()):0, grabbed:!!p.grabbed }));
}
function enemySnapshot() {
  return [...enemies.values()].map(e => ({ id:e.id, type:e.type, x:e.x, y:e.y, z:e.z, hp:e.hp, maxHp:e.maxHp, radius:e.radius, spawnStyle:e.spawnStyle, spawnSocket:e.spawnSocket }));
}
function gameSnapshot() { const active=[...players.values()].filter(p=>!p.dead&&!p.spectator); const ready=active.filter(p=>p.shopReady).length; return { wave, waveState, mapId, gateOpen:hallGateOpen, escapeActive, escapeRemaining: escapeActive ? Math.max(0, escapeTimer) : 0, victoryTriggered, shopRemaining:Math.max(0,waveTimer), shopReadyCount:ready, shopReadyTotal:active.length, players:playerSnapshot(), enemies:enemySnapshot(), playerCount:players.size }; }

function chooseSpawnPoint() {
  if (mapId === 'train') {
    const pool = [
      [-3.7,-23],[0,-23],[3.7,-23],[-3.7,-17],[3.7,-17],
      [-3.7,17],[3.7,17],[-3.7,23],[0,23],[3.7,23],
      [-3.7,0],[3.7,0]
    ].map(([x,z]) => ({x,z,style:'floor',socket:null}));
    const safe = pool.filter(c => [...players.values()].every(p => p.dead || dist2(c.x,c.z,p.x,p.z) > 10*10) && [...enemies.values()].every(e => dist2(c.x,c.z,e.x,e.z)>4*4));
    return (safe.length ? safe : pool)[Math.floor(Math.random()*(safe.length ? safe.length : pool.length))] || {x:0,z:23,style:'floor',socket:null};
  }
  const pool = [];
  for (const p of FLOOR_SPAWNS) pool.push({ ...p, style:'floor', socket:null });
  for (const p of WALL_SPAWNS) pool.push({ ...p, style:'wall', socket:p.id });

  const entryX = 0, entryZ = 43;
  const candidates = pool.filter(c => c.z < 41 && dist2(c.x, c.z, entryX, entryZ) > 15 * 15);
  const safe = candidates.filter(c => {
    for (const p of players.values()) {
      if (p.dead || p.spectator) continue;
      if (dist2(c.x, c.z, p.x, p.z) < 12 * 12) return false;
    }
    for (const e of enemies.values()) if (dist2(c.x,c.z,e.x,e.z) < 7 * 7) return false;
    return true;
  });
  const source = safe.length ? safe : candidates;

  let best = source[Math.floor(Math.random() * source.length)] || { x:0,z:-30,style:'floor',socket:null };
  let bestScore = -Infinity;
  for (const c of source) {
    let score = 0;
    for (const p of players.values()) if (!p.dead && !p.spectator) score += Math.sqrt(dist2(c.x,c.z,p.x,p.z));
    score += Math.random() * 12;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function spawnEnemy(type) {
  const spawn = chooseSpawnPoint();
  const s = STATS[type];
  const isBoss = type === 'boss';
  const trainBoost = mapId === 'train' ? 1.18 : 1;
  const trainDamage = mapId === 'train' ? 1.25 : 1;
  const enemy = {
    id:`E${nextEnemyId++}`, type, x:spawn.x, y:0, z:spawn.z, hp:s.hp, maxHp:s.hp, speed:s.speed*trainBoost, attackDamage:s.damage*trainDamage, attackRange:s.attackRange, attackCooldown:Math.random()*.6, radius:s.radius, spawnStyle:spawn.style, spawnSocket:spawn.socket, spawnedAt:nowSeconds(), isBoss, strafeDir:Math.random()<.5?-1:1, nextStrafe:nowSeconds()+.6+Math.random()*1.6, grabbedPlayerId:null, wanderAngle:Math.random()*Math.PI*2, weaponCooldown:Math.random()*1.1
  };
  if(type==='dog') enemy.wanderAngle=Math.random()*Math.PI*2;
  enemies.set(enemy.id, enemy);
  broadcast({ type:'spawnFx', style:enemy.spawnStyle, socket:enemy.spawnSocket, x:enemy.x, z:enemy.z, enemyType:enemy.type });
}

function waveComposition(number) {
  if(number===1)return ['walker','walker','walker'];
  if(number===2)return ['walker','walker','walker','walker','runner'];
  if(number===3)return ['walker','walker','walker','walker','walker','runner','runner','tank'];
  const list=[]; const train=mapId==='train';
  const walkers=Math.min(train?22:14,5+Math.floor(number*(train?1.15:.82)));
  const runners=Math.min(train?12:8,Math.max(1,Math.floor(number*.55)));
  const tanks=Math.min(train?7:5,1+Math.floor(number*.28));
  const shooters=number<5?0:Math.min(train?5:3,Math.floor((number-2)/2));
  for(let i=0;i<walkers;i++)list.push('walker'); for(let i=0;i<runners;i++)list.push('runner'); for(let i=0;i<tanks;i++)list.push('tank'); for(let i=0;i<shooters;i++)list.push('shooter');
  if(number>=4){list.push('dog');if(Math.random()<.14)list.push('kidnapper');}
  if(number===5||number===10)list.push('boss');
  return list;
}

function spawnWave(number) {
  resetShopReady();
  enemies.clear();
  const spawnZ = mapId === 'train' ? 22 : 52.5;
  for (const p of players.values()) {
    if (p.spectator || p.dead) {
      p.dead = false; p.spectator = false; p.downed = false; p.hp = 100; p.reloading=false; p.reloadWeapon=null; p.reloadEnds=0; p.x = 0; p.y = 1.6; p.z = spawnZ; p.respawnAt = 0; p.combatGraceUntil = nowSeconds()+INITIAL_COMBAT_GRACE;
      send(p.ws,{type:'roundRespawn',hp:100,x:p.x,y:p.y,z:p.z,mapId});
    }
  }
  const composition = waveComposition(number);
  composition.forEach(type => spawnEnemy(type));
  waveState = 'active';
  broadcast({ type:'waveStart', wave:number, enemyCount:enemies.size, boss:number===5 || number===10, mapId });
}

function tryStartNextWave(dt) {
  if (waveState === 'active' || waveState === 'victory') return;
  waveTimer -= dt;
  if (waveState === 'shop' && waveTimer > 0) return;
  if (waveTimer > 0) return;
  wave += 1;
  spawnWave(wave);
}

function targetPlayer(enemy) {
  let best = null;
  let bestD = Infinity;
  for (const p of players.values()) {
    if (p.dead || p.spectator || p.downed) continue;
    if(mapId==='hall' && p.z>=43) continue;
    const d = dist2(enemy.x,enemy.z,p.x,p.z);
    if (d < bestD) { bestD=d; best=p; }
  }
  return best;
}

function pushEnemiesApart() {
  const list = [...enemies.values()];
  for (let i=0;i<list.length;i++) {
    for (let j=i+1;j<list.length;j++) {
      const a=list[i], b=list[j];
      const dx=a.x-b.x, dz=a.z-b.z;
      let d=Math.hypot(dx,dz);
      const min=a.radius+b.radius;
      if (d < .001) { d=.001; }
      if (d < min) {
        const push=(min-d)/d*.5;
        a.x += dx*push; a.z += dz*push;
        b.x -= dx*push; b.z -= dz*push;
      }
    }
  }
}

function pushEnemyFromPlayers(enemy) {
  for (const p of players.values()) {
    if (p.dead || p.spectator || p.downed) continue;
    const dx=enemy.x-p.x, dz=enemy.z-p.z;
    let d=Math.hypot(dx,dz);
    const min=enemy.radius*.75+.58;
    if (d < .001) d=.001;
    if (d < min) {
      const push=(min-d)/d;
      enemy.x += dx*push*.7;
      enemy.z += dz*push*.7;
    }
  }
}

function nearestPlayer(from, maxDist=Infinity){
  let best=null,bestD=maxDist*maxDist;
  for(const p of players.values()){ if(p.dead||p.spectator||p.downed)continue; const d=dist2(from.x,from.z,p.x,p.z); if(d<bestD){bestD=d;best=p;} }
  return best;
}
function findDog(){ for(const e of enemies.values()) if(e.type==='dog') return e; return null; }
function releaseGrab(kid, rescued=false){
  if(!kid?.grabbedPlayerId) return;
  const p=players.get(kid.grabbedPlayerId);
  kid.grabbedPlayerId=null;
  if(p){ p.grabbed=false; p.grabbedBy=null; p.grabStarted=0; send(p.ws,{type:'grabRelease',rescued}); }
}
function markDowned(p, source='enemy') {
  if (!p || p.dead || p.spectator || p.downed) return;
  p.hp = 0;
  p.downed = true;
  p.downedUntil = nowSeconds() + DOWNED_DURATION;
  p.reviveBy = null;
  p.reviveStarted = 0;
  if (p.grabbed) { const kid=enemies.get(p.grabbedBy); if(kid) releaseGrab(kid,false); p.grabbed=false; p.grabbedBy=null; }
  send(p.ws,{type:'downed',duration:DOWNED_DURATION,source});
  broadcast({type:'playerDowned',id:p.id,name:p.name,downed:true});
}
function eliminatePlayer(p) {
  if (!p || p.dead || p.spectator) return;
  p.dead = true;
  p.spectator = true;
  p.downed = false;
  p.reviveBy = null;
  p.hp = 0;
  p.z = mapId === 'train' ? 22 : OUTSIDE_Z;
  send(p.ws,{type:'spectatorStart'});
  broadcast({type:'playerEliminated',id:p.id,name:p.name});
}
function damagePlayer(p, amount, source='enemy') {
  if (!p || p.dead || p.spectator || p.downed) return false;
  // Safe-room + entry grace: prevents instant damage at the beginning of a round.
  if(mapId==='hall' && p.z>=43) return false;
  if(nowSeconds() < (p.combatGraceUntil || 0)) return false;
  p.hp = Math.max(0,p.hp-amount);
  p.lastDamage = nowSeconds();
  if (p.hp <= 0) {
    if(players.size===1){
      p.hp=100; p.downed=false; p.dead=false; p.spectator=false; p.reviveBy=null; p.reviveStarted=0; p.grabbed=false; p.grabbedBy=null; p.x=0; p.y=1.6; p.z=52.5; p.shopReady=false; p.combatGraceUntil=nowSeconds()+INITIAL_COMBAT_GRACE;
      send(p.ws,{type:'soloRespawn',hp:100,x:p.x,y:p.y,z:p.z,mapId,instant:true});
      return true;
    }
    markDowned(p,source);
  }
  send(p.ws,{type:'damage',amount,hp:p.hp,source,downed:p.downed});
  return true;
}
function startRevive(reviver,targetId) {
  if (!reviver || reviver.dead || reviver.spectator || reviver.downed) return;
  const target=players.get(targetId);
  if (!target || !target.downed || target.id===reviver.id) return;
  if (dist2(reviver.x,reviver.z,target.x,target.z) > REVIVE_RADIUS*REVIVE_RADIUS) return;
  target.reviveBy=reviver.id;
  target.reviveStarted=nowSeconds();
  send(reviver.ws,{type:'reviveStart',targetId:target.id,duration:REVIVE_DURATION});
  send(target.ws,{type:'beingRevived',reviverId:reviver.id,duration:REVIVE_DURATION});
}
function stopRevive(reviver,targetId=null) {
  if (!reviver) return;
  for (const p of players.values()) {
    if (p.reviveBy===reviver.id && (!targetId || p.id===targetId)) { p.reviveBy=null; p.reviveStarted=0; send(p.ws,{type:'reviveCancel'}); }
  }
}
function completeRevive(target) {
  const reviver=players.get(target.reviveBy);
  if (!reviver || reviver.dead || reviver.spectator || reviver.downed || dist2(reviver.x,reviver.z,target.x,target.z)>REVIVE_RADIUS*REVIVE_RADIUS) { target.reviveBy=null; target.reviveStarted=0; return; }
  target.downed=false; target.hp=50; target.downedUntil=0; target.reviveBy=null; target.reviveStarted=0; target.lastDamage=nowSeconds();
  send(target.ws,{type:'revived',hp:50});
  send(reviver.ws,{type:'reviveComplete',targetId:target.id});
  broadcast({type:'playerRevived',id:target.id,name:target.name,hp:50});
}
function escapeAllPlayersReady(){
  const active=[...players.values()].filter(p=>!p.spectator && !p.dead);
  return active.length>0 && active.every(p=>Math.abs(p.x)<7 && p.z < -40);
}
function openHallGate(p){
  if(!p || mapId!=='hall' || hallGateOpen || p.dead || p.spectator) return;
  if(p.z < 41.5 || p.z > 46.2 || Math.abs(p.x)>8.5) return;
  hallGateOpen=true;
  broadcast({type:'gateState',open:true});
}
function resetShopReady(){ for(const p of players.values()) p.shopReady=false; }
function broadcastShopReady(){ const active=[...players.values()].filter(p=>!p.dead&&!p.spectator); const ready=active.filter(p=>p.shopReady).length; for(const p of active) send(p.ws,{type:'shopReadyState',readyCount:ready,activeCount:active.length,selfReady:!!p.shopReady}); }
function checkShopReady(){ const active=[...players.values()].filter(p=>!p.dead&&!p.spectator); if(waveState==='shop' && active.length>0 && active.every(p=>p.shopReady)){ waveTimer=0; broadcast({type:'shopSkipped'}); } }

function startEscapeSequence(){
  if(escapeActive || mapId!=='hall') return;
  escapeActive=true; escapeTimer=60; waveState='escape'; waveTimer=0;
  broadcast({type:'escapeStart',duration:60});
}
function loadTrainMap(){
  if(mapId==='train') return;
  mapId='train'; escapeActive=false; escapeTimer=0; victoryTriggered=false; waveState='intermission'; waveTimer=4; enemies.clear(); projectiles.clear();
  for(const p of players.values()){
    p.x=0; p.y=1.6; p.z=22; p.downed=false; p.dead=false; p.spectator=false; p.hp=100; p.reviveBy=null; p.reviveStarted=0;
    send(p.ws,{type:'mapChange',mapId:'train',x:p.x,y:p.y,z:p.z,wave:wave});
  }
  broadcast({type:'trainIntro'});
}

function checkTrainVictory(){
  if(mapId!=='train'||victoryTriggered||waveState==='victory')return;
  const active=[...players.values()].filter(p=>!p.dead&&!p.spectator);
  if(!active.length)return;
  if(active.every(p=>p.z<=-25)){
    victoryTriggered=true; waveState='victory'; escapeActive=false; escapeTimer=0; enemies.clear(); projectiles.clear();
    const killsTotal=active.reduce((n,p)=>n+(p.kills||0),0); const moneyTotal=active.reduce((n,p)=>n+(p.money||0),0);
    broadcast({type:'victory',killsTotal,moneyTotal});
  }
}

function applyEnemyDamage(enemy, amount, attacker){
  enemy.hp=Math.max(0,enemy.hp-amount);
  if(enemy.type==='kidnapper' && enemy.grabbedPlayerId) releaseGrab(enemy,true);
  broadcast({type:'enemyHit',id:enemy.id,hp:enemy.hp,attackerId:attacker?.id||'',damage:amount,x:enemy.x,y:enemy.type==='boss'?3.2:2.4,z:enemy.z});
  if(enemy.hp<=0){
    enemies.delete(enemy.id);
    if(attacker) { attacker.money += 100; attacker.kills=(attacker.kills||0)+1; send(attacker.ws,{type:'state',wave,waveState,mapId,enemies:enemySnapshot(),players:playerSnapshot(),playerCount:players.size}); }
    broadcast({type:'enemyKilled',id:enemy.id,enemyType:enemy.type,killerId:attacker?.id||'',reward:100,money:attacker?.money||0,x:enemy.x,z:enemy.z});
    if(enemy.type==='boss' && wave===10 && mapId==='hall') startEscapeSequence();
  }
}
function spawnProjectile({ownerId,type,start,velocity,damage,color=0xffd369,life=1.2,gravity=BULLET_GRAVITY,targetPlayerId=null}){
  const id=`P${nextProjectileId++}`;
  projectiles.set(id,{id,ownerId,type,x:start.x,y:start.y,z:start.z,px:start.x,py:start.y,pz:start.z,vx:velocity.x,vy:velocity.y,vz:velocity.z,damage,life,maxLife:life,gravity,targetPlayerId,color});
  broadcast({type:'projectile',id,x:start.x,y:start.y,z:start.z,vx:velocity.x,vy:velocity.y,vz:velocity.z,gravity,life,color});
  return id;
}
function endProjectile(p,hit=false){ broadcast({type:'projectileImpact',id:p.id,x:p.x,y:p.y,z:p.z,hit}); projectiles.delete(p.id); }
function enemyShoot(enemy,target){
  const targetDistance=Math.hypot(target.x-enemy.x,target.z-enemy.z);
  const minShoot=STATS.shooter.minShootDistance||8;
  if(targetDistance<minShoot)return;
  // No wall-banging: only fire if there is a clear line through the hall.
  if(mapId==='hall'){
    for(const b of HALL_BLOCKERS){
      if(segmentIntersectsRect(enemy.x,enemy.z,target.x,target.z,b,.15)) return;
    }
  }
  enemy.weaponCooldown=SHOOTER_REACTION_MIN+Math.random()*(SHOOTER_REACTION_MAX-SHOOTER_REACTION_MIN);
  const from={x:enemy.x,y:1.82,z:enemy.z};
  const dx=target.x-enemy.x,dz=target.z-enemy.z,d=Math.hypot(dx,dz)||1;
  const sideX=-dz/d, sideZ=dx/d;
  // Human-like aim: every shot has dispersion, and many shots deliberately miss.
  const hardMiss=Math.random()<0.38;
  const error=Math.min(6.0,1.1+targetDistance*0.065);
  const lateral=(Math.random()*2-1)*error*(hardMiss?1.55:0.75);
  const forward=(Math.random()*2-1)*error*(hardMiss?0.55:0.22);
  const vertical=(Math.random()*2-1)*(hardMiss?1.35:0.38);
  const aimX=target.x+sideX*lateral+(dx/d)*forward;
  const aimZ=target.z+sideZ*lateral+(dz/d)*forward;
  const aimY=(target.y||1.6)-0.2+vertical;
  const flat=Math.hypot(aimX-from.x,aimZ-from.z)||1;
  const speed=31;
  const vx=(aimX-from.x)/flat*speed,vz=(aimZ-from.z)/flat*speed,vy=((aimY-from.y)/Math.max(.4,flat))*speed;
  spawnProjectile({ownerId:enemy.id,type:'enemy',start:from,velocity:{x:vx,y:vy,z:vz},damage:enemy.attackDamage,color:0xff5d76,life:2.0,gravity:5.2,targetPlayerId:target.id});
}

function segmentPointDistanceSq(ax,ay,az,bx,by,bz,px,py,pz){
  const abx=bx-ax, aby=by-ay, abz=bz-az;
  const apx=px-ax, apy=py-ay, apz=pz-az;
  const denom=abx*abx+aby*aby+abz*abz;
  const t=denom>1e-8?clamp((apx*abx+apy*aby+apz*abz)/denom,0,1):0;
  const qx=ax+abx*t,qy=ay+aby*t,qz=az+abz*t;
  const dx=px-qx,dy=py-qy,dz=pz-qz;
  return dx*dx+dy*dy+dz*dz;
}
function updateProjectiles(dt){
  for(const p of projectiles.values()){
    p.life-=dt;
    p.px=p.x; p.py=p.y; p.pz=p.z;
    p.vy-=p.gravity*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt;
    if(p.type==='player'){
      let hit=null;
      let bestT=Infinity;
      for(const e of enemies.values()){
        if(e.hp<=0) continue;
        const radius=e.radius+.22;
        const d2=segmentPointDistanceSq(p.px,p.py,p.pz,p.x,p.y,p.z,e.x,1.55,e.z);
        if(d2<=radius*radius){
          const dx=p.x-p.px,dy=p.y-p.py,dz=p.z-p.pz;
          const tSeg=Math.hypot(dx,dy,dz)>0?Math.max(0,Math.min(1,((e.x-p.px)*dx+(1.55-p.py)*dy+(e.z-p.pz)*dz)/(dx*dx+dy*dy+dz*dz))):0;
          if(tSeg<bestT){bestT=tSeg;hit=e;}
        }
      }
      if(hit){
        p.x=hit.x; p.y=1.55; p.z=hit.z;
        const attacker=players.get(p.ownerId);
        if(attacker) applyEnemyDamage(hit,p.damage,attacker);
        endProjectile(p,true); continue;
      }
    }else{
      const target=players.get(p.targetPlayerId);
      if(target && mapId==='hall' && target.z>=43) { endProjectile(p,false); continue; }
      if(target&&!target.dead&&!target.spectator&&!target.downed){
        const d2=segmentPointDistanceSq(p.px,p.py,p.pz,p.x,p.y,p.z,target.x,(target.y||1.6)-.2,target.z);
        if(d2<=.72*.72){
          damagePlayer(target,p.damage,'shooter'); endProjectile(p,true); continue;
        }
      }
    }
    if(p.life<=0||p.y<.05||Math.abs(p.x)>90||Math.abs(p.z)>90)endProjectile(p,false);
  }
}

function updateEnemies(dt){
  const t=nowSeconds();
  for(const enemy of enemies.values()){
    if(enemy.type==='kidnapper'&&enemy.grabbedPlayerId){
      const victim=players.get(enemy.grabbedPlayerId),dog=findDog();
      if(!victim||victim.dead){releaseGrab(enemy,false);continue;}
      const target=dog||enemy,dx=target.x-victim.x,dz=target.z-victim.z,d=Math.hypot(dx,dz)||1;
      if(d>3.0){victim.x+=dx/d*3.15*dt;victim.z+=dz/d*3.15*dt;const minX=mapId==='train'?TRAIN_X_MIN:HALL_MIN,maxX=mapId==='train'?TRAIN_X_MAX:HALL_MAX,minZ=mapId==='train'?TRAIN_Z_MIN:HALL_MIN,maxZ=mapId==='train'?TRAIN_Z_MAX:HALL_MAX; victim.x=clamp(victim.x,minX,maxX);victim.z=clamp(victim.z,minZ,maxZ);}
      else if(dog){if(!victim.downed){ damagePlayer(victim,dt*14,'dog'); if(victim.downed) releaseGrab(enemy,false); }}
      continue;
    }
    const target=nearestPlayer(enemy);if(!target)continue;
    const steer=steeringTarget(enemy,target);
    const dx=steer.x-enemy.x,dz=steer.z-enemy.z,d=Math.hypot(dx,dz)||.001;
    const targetDx=target.x-enemy.x,targetDz=target.z-enemy.z,targetDist=Math.hypot(targetDx,targetDz)||.001;
    if(enemy.type==='shooter'){
      if(t>enemy.nextStrafe){enemy.strafeDir*=-1;enemy.nextStrafe=t+.6+Math.random()*1.4;}
      const minShoot=STATS.shooter.minShootDistance||8;
      const sideX=-dz/d*enemy.strafeDir,sideZ=dx/d*enemy.strafeDir;
      let closing=0; if(d>STATS.shooter.preferredRange+3)closing=1; else if(d<minShoot)closing=-1.55;
      enemy.x+=(dx/d*closing*enemy.speed+sideX*.72)*dt; enemy.z+=(dz/d*closing*enemy.speed+sideZ*.72)*dt;
      const minX=mapId==='train'?TRAIN_X_MIN:HALL_MIN,maxX=mapId==='train'?TRAIN_X_MAX:HALL_MAX,minZ=mapId==='train'?TRAIN_Z_MIN:HALL_MIN,maxZ=mapId==='train'?TRAIN_Z_MAX:HALL_MAX;
      enemy.x=clamp(enemy.x,minX,maxX);enemy.z=clamp(enemy.z,minZ,maxZ);enemy.weaponCooldown-=dt;
      if(enemy.weaponCooldown<=0&&d>=minShoot&&d<52)enemyShoot(enemy,target);
    }else if(enemy.type==='dog'){
      if(d>enemy.attackRange){enemy.x+=dx/d*enemy.speed*dt;enemy.z+=dz/d*enemy.speed*dt;}else{enemy.attackCooldown-=dt;if(enemy.attackCooldown<=0){enemy.attackCooldown=STATS.dog.cooldown;damagePlayer(target,enemy.attackDamage,'dog');}}
    }else if(enemy.type==='kidnapper'){
      if(d>enemy.attackRange){enemy.x+=dx/d*enemy.speed*dt;enemy.z+=dz/d*enemy.speed*dt;}else if(!enemy.grabbedPlayerId&&!target.grabbed){enemy.grabbedPlayerId=target.id;target.grabbed=true;target.grabbedBy=enemy.id;target.grabStarted=t;send(target.ws,{type:'grabStart',kidnapperId:enemy.id,dogId:findDog()?.id||null});}
    }else{
      const orbitSign=enemy.strafeDir||1;
      const sideX=-dz/d*orbitSign, sideZ=dx/d*orbitSign;
      const orbit=(targetDist<12?0.28:0.12);
      if(d>enemy.attackRange){enemy.x+=(dx/d+sideX*orbit)*enemy.speed*dt;enemy.z+=(dz/d+sideZ*orbit)*enemy.speed*dt;}else{enemy.attackCooldown-=dt;if(enemy.attackCooldown<=0){enemy.attackCooldown=STATS[enemy.type].cooldown;damagePlayer(target,enemy.attackDamage,enemy.type);}}
    }
    if(mapId==='hall'){const pos=resolveHallPosition(enemy.x,enemy.z,enemy.radius,escapeActive);enemy.x=pos.x;enemy.z=pos.z; enemy.z=Math.min(enemy.z,hallGateOpen?40.8:40.8);}
    else {enemy.x=clamp(enemy.x,TRAIN_X_MIN,TRAIN_X_MAX);enemy.z=clamp(enemy.z,TRAIN_Z_MIN,TRAIN_Z_MAX);}
    pushEnemyFromPlayers(enemy);
  }
  pushEnemiesApart();
}

function updateDownedAndRevives(){
  const t=nowSeconds();
  for(const p of players.values()){
    if(p.downed){
      if(p.reviveBy){
        const rev=players.get(p.reviveBy);
        if(!rev || rev.dead || rev.spectator || rev.downed || dist2(rev.x,rev.z,p.x,p.z)>REVIVE_RADIUS*REVIVE_RADIUS){p.reviveBy=null;p.reviveStarted=0;send(p.ws,{type:'reviveCancel'});}
        else if(t-p.reviveStarted>=REVIVE_DURATION) completeRevive(p);
      }
      if(p.downed && t>=p.downedUntil) eliminatePlayer(p);
    }
  }
}
function startEscapeTick(dt){
  if(!escapeActive)return;
  escapeTimer-=dt;
  if(escapeAllPlayersReady()||escapeTimer<=0) loadTrainMap();
  else broadcast({type:'escapeState',remaining:Math.max(0,escapeTimer)});
}


function aimDirection(yaw,pitch){const cp=Math.cos(pitch),sp=Math.sin(pitch);return {x:-Math.sin(yaw)*cp,y:sp,z:-Math.cos(yaw)*cp};}
function spawnPlayerBullet(attacker,weapon,dir,spread=0){
  const def=WEAPONS[weapon],speed=weapon==='shotgun'?62:weapon==='pistol'?78:108;const d={x:dir.x,y:dir.y,z:dir.z};
  if(spread){d.x+=(Math.random()-.5)*spread;d.y+=(Math.random()-.5)*spread*.6;d.z+=(Math.random()-.5)*spread;const n=Math.hypot(d.x,d.y,d.z)||1;d.x/=n;d.y/=n;d.z/=n;}
  const start={x:attacker.x+d.x*.7,y:(attacker.y||1.6)-.16,z:attacker.z+d.z*.7};
  spawnProjectile({ownerId:attacker.id,type:'player',start,velocity:{x:d.x*speed,y:d.y*speed,z:d.z*speed},damage:def.damage,color:weapon==='shotgun'?0xffd47d:weapon==='rifle'?0x9dffd4:0xbfeeff,life:weapon==='shotgun'?.92:weapon==='pistol'?1.55:1.25,gravity:BULLET_GRAVITY});
}
function handlePunch(attacker){
  if(attacker.dead||attacker.spectator||attacker.downed||attacker.grabbed)return;const t=nowSeconds();if(t-attacker.lastPunch<.34)return;attacker.lastPunch=t;const d=aimDirection(attacker.yaw,attacker.pitch);
  let best=null,bestDist=3.95;for(const e of enemies.values()){const ex=e.x-attacker.x,ez=e.z-attacker.z,flat=Math.hypot(ex,ez);if(flat<.2||flat>bestDist)continue;const dot=(ex/flat)*d.x+(ez/flat)*d.z;if(dot<.72)continue;best=e;bestDist=flat;}if(best)applyEnemyDamage(best,15,attacker);
}
function handleShoot(attacker,weapon){
  if(attacker.dead||attacker.spectator||attacker.downed||attacker.grabbed||attacker.reloading||attacker.inventory.indexOf(weapon)<0)return;
  const def=WEAPONS[weapon];if(!def)return;
  const a=attacker.ammo?.[weapon];if(!a||a.mag<=0){send(attacker.ws,{type:'reloadReject',reason:'Cargador vacío. Presioná R.'});return;}
  const t=nowSeconds();if(t-attacker.lastShot<def.cooldown)return;
  attacker.lastShot=t;
  a.mag--;
  const d=aimDirection(attacker.yaw,attacker.pitch);
  if(weapon==='shotgun'){for(let i=0;i<def.pellets;i++)spawnPlayerBullet(attacker,weapon,d,.105);}else spawnPlayerBullet(attacker,weapon,d,weapon==='rifle'?.008:0);
  send(attacker.ws,{type:'shotFired',weapon,ammo:{...a}});
}

function startReload(p,weapon){
  if(p.dead||p.spectator||p.downed||p.grabbed||p.reloading)return;
  const def=WEAPONS[weapon];if(!def||p.inventory.indexOf(weapon)<0)return;
  const a=p.ammo?.[weapon];if(!a||a.mag>=def.magSize||a.reserve<=0){send(p.ws,{type:'reloadReject',reason:a&&a.reserve<=0?'No quedan balas de reserva.':'El cargador ya está lleno.'});return;}
  p.reloading=true;p.reloadWeapon=weapon;p.reloadEnds=nowSeconds()+def.reload;
  send(p.ws,{type:'reloadStart',weapon,duration:def.reload});
}

function buyWeapon(p,weapon){
  if(waveState!=='shop'){send(p.ws,{type:'purchase',ok:false,reason:'La tienda abre cada 3 rondas.'});return;}
  const def=WEAPONS[weapon]; if(!def){send(p.ws,{type:'purchase',ok:false,reason:'Arma inválida.'});return;}
  if(p.inventory.includes(weapon)){send(p.ws,{type:'purchase',ok:false,reason:'Ya tenés esa arma.'});return;}
  if(p.inventory.length>=2){send(p.ws,{type:'purchase',ok:false,reason:'Inventario lleno: solo hay dos espacios de armas.'});return;}
  if(p.money<def.cost){send(p.ws,{type:'purchase',ok:false,reason:`Necesitás $${def.cost.toLocaleString('es-AR')}.`});return;}
  p.money-=def.cost;p.inventory.push(weapon);p.weapon=weapon;if(!p.ammo?.[weapon])p.ammo[weapon]={...AMMO_DEFAULTS[weapon]};send(p.ws,{type:'purchase',ok:true,money:p.money,inventory:p.inventory,weapon:p.weapon,ammo:ammoSnapshot(p)});
}
function releaseAnyGrabFromEnemy(enemyId){const e=enemies.get(enemyId);if(e?.type==='kidnapper'&&e.grabbedPlayerId)releaseGrab(e,true);}

function squadWipeCheck(){
  if(players.size===0 || escapeActive) return;
  const active=[...players.values()].some(p=>!p.dead&&!p.spectator);
  if(!active && waveState==='active'){
    enemies.clear(); projectiles.clear(); waveState='intermission'; waveTimer=3;
    broadcast({type:'squadWipe',nextWave:wave+1});
  }
}
function maybeFinishWave() {
  if (waveState!=='active' || enemies.size>0 || escapeActive) return;
  const shop=(wave%3===0);
  waveState=shop?'shop':'intermission';
  waveTimer=shop?SHOP_DURATION:6;
  resetShopReady();
  broadcast({type:'waveClear',wave,nextWave:wave+1,shop,duration:waveTimer,mapId});
  if(shop) { broadcast({type:'shopStart',duration:SHOP_DURATION}); broadcastShopReady(); }
}

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.map':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon'
};

function serveFile(req,res) {
  if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,players:players.size,wave,mapId}));}
  let pathname=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
  if (pathname==='/') pathname='/index.html';
  const file=path.normalize(path.join(ROOT,pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('Not found'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}

function makeWebSocketFrame(text) {
  const payload=Buffer.from(text);
  const length=payload.length;
  let header;
  if (length<126) header=Buffer.from([0x81,length]);
  else if (length<65536) { header=Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(length,2); }
  else { header=Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(length),2); }
  return Buffer.concat([header,payload]);
}

function attachWebSocket(socket) {
  const client={socket,readyState:1,buffer:Buffer.alloc(0),sendText(text){if(this.readyState===1)this.socket.write(makeWebSocketFrame(text));},close(){this.readyState=3;try{this.socket.end();}catch{}}};
  function consume(){
    while(client.buffer.length>=2){
      const b0=client.buffer[0],b1=client.buffer[1];
      const opcode=b0&0x0f,masked=Boolean(b1&0x80);let length=b1&0x7f,offset=2;
      if(length===126){if(client.buffer.length<4)return;length=client.buffer.readUInt16BE(2);offset=4;}
      else if(length===127){if(client.buffer.length<10)return;const big=client.buffer.readBigUInt64BE(2);if(big>BigInt(Number.MAX_SAFE_INTEGER))return client.close();length=Number(big);offset=10;}
      if(!masked){client.close();return;}
      if(client.buffer.length<offset+4+length)return;
      const mask=client.buffer.subarray(offset,offset+4);offset+=4;
      const payload=Buffer.alloc(length);for(let i=0;i<length;i++)payload[i]=client.buffer[offset+i]^mask[i%4];
      client.buffer=client.buffer.subarray(offset+length);
      if(opcode===0x8){client.close();return;}
      if(opcode===0x9){socket.write(Buffer.from([0x8A,payload.length]));continue;}
      if(opcode!==0x1)continue;
      try{onClientMessage(client,JSON.parse(payload.toString('utf8')));}catch{}
    }
  }
  socket.on('data',chunk=>{client.buffer=Buffer.concat([client.buffer,chunk]);consume();});
  socket.on('close',()=>onClientClose(client));
  socket.on('error',()=>client.close());
  return client;
}

function onClientMessage(ws,msg) {
  const p=ws.player;if(!p)return;
  if(msg.type==='setName'){
    p.name=sanitizeName(msg.name);
    send(ws,{type:'nameSet',name:p.name});
    broadcast({type:'playerJoin',id:p.id,name:p.name,playerCount:players.size});
    return;
  }
  if(msg.type==='state'){
    if(p.grabbed || p.dead || p.spectator) return;
    if(mapId==='train'){
      p.x=clamp(Number(msg.x)||0,TRAIN_X_MIN,TRAIN_X_MAX);
      p.z=clamp(Number(msg.z)||0,TRAIN_Z_MIN,TRAIN_Z_MAX);
    }else{
      const reqX=Number(msg.x)||0, reqZ=Number(msg.z)||52.5;
      if(!hallGateOpen){ p.x=clamp(reqX,SAFE_X_MIN,SAFE_X_MAX); p.z=clamp(reqZ,SAFE_Z_MIN,SAFE_Z_MAX); }
      else { const allowEscape=escapeActive; const pos=resolveHallPosition(reqX,reqZ,.6,allowEscape); p.x=pos.x; p.z=pos.z; if(!allowEscape&&p.z<-40)p.z=-39.4; }
    }
    p.y=clamp(Number(msg.y)||1.6,.8,5.4);
    p.yaw=Number(msg.yaw)||0;
    p.pitch=Number(msg.pitch)||0;
  } else if(msg.type==='punch') handlePunch(p);
  else if(msg.type==='shoot') handleShoot(p,msg.weapon);
  else if(msg.type==='reload') startReload(p,msg.weapon||p.weapon);
  else if(msg.type==='setWeapon'){ if(msg.weapon==='fists'||p.inventory.includes(msg.weapon)) {p.weapon=msg.weapon;send(p.ws,{type:'weaponSet',weapon:p.weapon});} }
  else if(msg.type==='shopReady'){ if(waveState==='shop'&&!p.dead&&!p.spectator){p.shopReady=true; broadcastShopReady(); checkShopReady();} }
  else if(msg.type==='openGate') openHallGate(p);
  else if(msg.type==='buyWeapon') buyWeapon(p,msg.weapon);
  else if(msg.type==='reviveStart') startRevive(p,msg.targetId);
  else if(msg.type==='reviveStop') stopRevive(p,msg.targetId);
  else if(msg.type==='qteEscape'){ if(p.grabbed){const kid=enemies.get(p.grabbedBy);if(kid?.type==='kidnapper'){releaseGrab(kid,true);} } }
}

function onClientClose(ws) {
  if(!ws.player)return;
  if(ws.player.grabbed){const kid=enemies.get(ws.player.grabbedBy);if(kid)releaseGrab(kid,false);}
  stopRevive(ws.player);
  players.delete(ws.player.id);
  if(waveState==='shop'){ broadcastShopReady(); checkShopReady(); }
  broadcast({type:'playerLeave',id:ws.player.id,playerCount:players.size});
  if(players.size===0){wave=0;waveState='intermission';waveTimer=3;enemies.clear();projectiles.clear();mapId='hall';escapeActive=false;escapeTimer=0;victoryTriggered=false;hallGateOpen=false;}
}

function makeWebSocketPing(){ return Buffer.from([0x89,0x00]); }
setInterval(()=>{ const ping=makeWebSocketPing(); for(const p of players.values()){ try{ if(p.ws?.readyState===1) p.ws.socket.write(ping); }catch{} } },20000);

const server=http.createServer(serveFile);
server.on('upgrade',(req,socket)=>{
  if(req.headers.upgrade?.toLowerCase()!=='websocket'){socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);
  const ws=attachWebSocket(socket);
  const id=crypto.randomUUID().slice(0,8);
  const p={ws,id,name:`CAPSULE-${Math.floor(100+Math.random()*900)}`,x:0,y:1.6,z:52.5,yaw:0,pitch:0,hp:100,money:0,inventory:[],weapon:'fists',ammo:createAmmoState(),reloading:false,reloadWeapon:null,reloadEnds:0,shopReady:false,dead:false,spectator:false,downed:false,downedUntil:0,reviveBy:null,reviveStarted:0,respawnAt:0,lastDamage:-Infinity,lastPunch:-Infinity,lastShot:-Infinity,kills:0,grabbed:false,grabbedBy:null,grabStarted:0,combatGraceUntil:nowSeconds()+INITIAL_COMBAT_GRACE};
  ws.player=p;players.set(id,p);
  send(ws,{type:'welcome',id,you:{x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp,money:p.money,inventory:p.inventory,weapon:p.weapon,ammo:ammoSnapshot(p)},me:{name:p.name},...gameSnapshot()});
  broadcast({type:'playerJoin',id,name:p.name,playerCount:players.size});
});

let lastTick=Date.now();
setInterval(()=>{
  const t=Date.now();const dt=Math.min(.15,(t-lastTick)/1000);lastTick=t;
  if(players.size>0){
    if(!escapeActive) tryStartNextWave(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateDownedAndRevives();
    squadWipeCheck();
    startEscapeTick(dt);
    maybeFinishWave();
    checkTrainVictory();
    const now=nowSeconds();
    for(const p of players.values()){
      if(p.reloading && now>=p.reloadEnds){
        const weapon=p.reloadWeapon; const def=WEAPONS[weapon]; const a=p.ammo?.[weapon];
        if(def&&a){ const need=Math.max(0,def.magSize-a.mag); const loaded=Math.min(need,a.reserve); a.mag+=loaded; a.reserve-=loaded; }
        p.reloading=false;p.reloadWeapon=null;p.reloadEnds=0;
        send(p.ws,{type:'reloadComplete',weapon,ammo:{...(p.ammo?.[weapon]||{})}});
      }
      if(!p.dead&&!p.spectator&&!p.downed&&p.hp<100&&now-p.lastDamage>=6) p.hp=Math.min(100,p.hp+8*dt);
    }
  }
  if(Date.now()-lastBroadcast>=150){
    lastBroadcast=Date.now();
    const activePlayers=[...players.values()].filter(p=>!p.dead&&!p.spectator); const readyPlayers=activePlayers.filter(p=>p.shopReady).length;
    broadcast({type:'state',wave,waveState,mapId,gateOpen:hallGateOpen,escapeActive,escapeRemaining:escapeActive?Math.max(0,escapeTimer):0,shopRemaining:waveState==='shop'?Math.max(0,waveTimer):0,shopReadyCount:readyPlayers,shopReadyTotal:activePlayers.length,enemies:enemySnapshot(),players:playerSnapshot(),playerCount:players.size});
  }
},TICK_MS);

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`CAPSULE NIGHTMARE: http://localhost:${PORT}`);
  console.log(`LAN: http://<IP-DE-LA-PC>:${PORT}`);
});
