/* CAPSULE NIGHTMARE Android classic runtime. Three.js is loaded globally by three.min.js. */
/* Offline simulation exposed as a single global for the Android classic-script build. */
(function(){
// Lightweight single-player simulation used by the Android APK when no PC server is configured.
// Multiplayer stays available through the normal WebSocket server field.

const WEAPONS = {
  pistol:{cost:500,damage:30,cooldown:.28,range:65,magSize:12,reserveMax:36,reload:.95,speed:78},
  shotgun:{cost:2500,damage:10,pellets:8,cooldown:.82,range:34,magSize:8,reserveMax:24,reload:1.35,speed:62},
  rifle:{cost:5000,damage:20,cooldown:.105,range:85,magSize:30,reserveMax:120,reload:1.55,speed:108}
};
const STATS = {
  walker:{hp:52,speed:2.8,damage:6,range:1.7,cooldown:.78,radius:.72},
  runner:{hp:40,speed:5.2,damage:9,range:1.55,cooldown:.56,radius:.58},
  tank:{hp:118,speed:1.55,damage:12,range:1.95,cooldown:.9,radius:1.02},
  shooter:{hp:46,speed:1.9,damage:8,range:999,cooldown:1.55,radius:.7,minShootDistance:8},
  kidnapper:{hp:86,speed:5.5,damage:0,range:1.72,cooldown:.9,radius:.64},
  dog:{hp:300,speed:4,damage:25,range:2.9,cooldown:.8,radius:1.35},
  boss:{hp:380,speed:2.05,damage:20,range:3.6,cooldown:.84,radius:2.05}
};
const halls = [
  {x:-34,z:-34},{x:-16,z:-34},{x:2,z:-34},{x:20,z:-34},{x:34,z:-34},
  {x:-34,z:-18},{x:-16,z:-18},{x:2,z:-18},{x:20,z:-18},{x:34,z:-18},
  {x:-34,z:2},{x:-18,z:2},{x:18,z:2},{x:34,z:2},
  {x:-34,z:20},{x:-16,z:20},{x:2,z:20},{x:20,z:20},{x:34,z:20},
  {x:-30,z:34},{x:-10,z:34},{x:10,z:34},{x:30,z:34}
];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const dotAim=(px,pz,yaw,tx,tz)=>{
  const ax=-Math.sin(yaw), az=-Math.cos(yaw); const dx=tx-px,dz=tz-pz; const d=Math.hypot(dx,dz)||1; return (ax*dx+az*dz)/d;
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

window.createOfflineSim = function createOfflineSim({emit,getPlayer}){
  let running=false, timer=0, idCounter=1, projectileCounter=1;
  let wave=0, waveState='intermission', waveTimer=3, mapId='hall', gateOpen=false, escapeActive=false, escapeTimer=0, victory=false;
  let money=0, weapon='fists', inventory=[];
  let kills=0, hp=100, downed=false, grabbed=false, reloading=false;
  let ammo={pistol:{mag:12,reserve:36},shotgun:{mag:8,reserve:24},rifle:{mag:30,reserve:120}};
  const enemies=new Map();
  const cooldowns=new Map();

  function snapshotPlayer(){
    const p=getPlayer();
    return {id:'offline',name:localStorage.getItem('capsuleName')||'CAPSULE',x:p.x,y:(p.y||1.6),z:p.z,yaw:p.yaw||0,pitch:p.pitch||0,hp,money,kills,dead:false,spectator:false,downed:false,downedRemaining:0,inventory,weapon,ammo,reloading:false,reloadRemaining:0,grabbed};
  }
  function enemySnapshot(){return [...enemies.values()].map(e=>({id:e.id,type:e.type,x:e.x,y:0,z:e.z,hp:e.hp,maxHp:e.maxHp,radius:e.radius,spawnStyle:'floor',spawnSocket:null}));}
  function state(){ emit({type:'state',wave,waveState,mapId,gateOpen,escapeActive,escapeRemaining:Math.max(0,escapeTimer),victoryTriggered:victory,shopRemaining:Math.max(0,waveTimer),shopReadyCount:0,shopReadyTotal:1,playerCount:1,players:[snapshotPlayer()],enemies:enemySnapshot()}); }
  function welcome(){
    emit({type:'welcome',id:'offline',wave,waveState,mapId,gateOpen,escapeActive,escapeRemaining:0,playerCount:1,shopRemaining:waveTimer,shopReadyCount:0,shopReadyTotal:1,me:{name:localStorage.getItem('capsuleName')||'CAPSULE'},you:snapshotPlayer(),players:[snapshotPlayer()],enemies:enemySnapshot()});
  }
  function composition(n){
    if(n===1)return ['walker','walker','walker','walker'];
    if(n===2)return ['walker','walker','walker','walker','walker','runner'];
    if(n===3)return ['walker','walker','walker','walker','walker','walker','runner','runner','tank'];
    const list=[]; const walkers=Math.min(14,5+Math.floor(n*.82)); const runners=Math.min(8,Math.max(1,Math.floor(n*.55))); const tanks=Math.min(5,1+Math.floor(n*.28)); const shooters=n<4?0:Math.min(3,Math.floor((n-2)/2));
    for(let i=0;i<walkers;i++)list.push('walker'); for(let i=0;i<runners;i++)list.push('runner'); for(let i=0;i<tanks;i++)list.push('tank'); for(let i=0;i<shooters;i++)list.push('shooter');
    if(n>=4){list.push('dog'); if(Math.random()<.14)list.push('kidnapper');}
    if(n===5||n===10)list.push('boss');
    return list;
  }
  function spawnWave(){
    wave += 1; enemies.clear(); waveState='active'; waveTimer=0;
    const p=getPlayer(); const list=composition(wave);
    for(const type of list){
      const s=STATS[type]; let spawn=halls[Math.floor(Math.random()*halls.length)];
      let tries=0; while(tries++<20 && Math.hypot(spawn.x-p.x,spawn.z-p.z)<10) spawn=halls[Math.floor(Math.random()*halls.length)];
      enemies.set('E'+idCounter++, {id:'E'+(idCounter-1),type,x:spawn.x,z:spawn.z,hp:s.hp,maxHp:s.hp,speed:s.speed,damage:s.damage,radius:s.radius,lastAttack:0,nextShot:.8+Math.random()*1.3,grabbed:false});
    }
    emit({type:'waveStart',wave,enemyCount:enemies.size,boss:wave===5||wave===10,mapId});
    emit({type:'spawnFx',x:0,z:0,style:'floor',enemyType:'walker'});
    state();
  }
  function maybeRound(){
    if(waveState==='active' || waveState==='escape' || waveState==='victory') return;
    waveTimer-=timer;
    timer=0;
    if(waveState==='shop'){
      if(waveTimer<=0) spawnWave();
      else emit({type:'shopState',remaining:waveTimer});
      return;
    }
    if(wave===0 && gateOpen && waveTimer<=0) spawnWave();
    else if(wave>0 && waveTimer<=0) spawnWave();
  }
  function finishWave(){
    if(enemies.size>0 || waveState!=='active')return;
    const shop=wave%3===0;
    waveState=shop?'shop':'intermission'; waveTimer=shop?20:5;
    emit({type:'waveClear',wave,nextWave:wave+1,shop,duration:waveTimer,mapId});
    if(shop)emit({type:'shopStart',duration:20});
  }
  function damagePlayer(amount){
    if(downed||grabbed||waveState!=='active')return;
    const p=getPlayer(); if(mapId==='hall'&&p.z>=43&&!gateOpen)return;
    hp=Math.max(0,hp-amount); emit({type:'damage',hp,amount,source:'enemy',downed:false});
    if(hp<=0){
      hp=100; downed=false; grabbed=false;
      emit({type:'soloRespawn',hp:100,x:0,y:1.6,z:52.5,mapId});
    }
  }
  function aimTarget(range,spread=0.992){
    const p=getPlayer(); let best=null,bestScore=-Infinity;
    for(const e of enemies.values()){
      if(e.hp<=0)continue; const d=Math.hypot(e.x-p.x,e.z-p.z); if(d>range)continue;
      const a=dotAim(p.x,p.z,p.yaw,e.x,e.z); const score=a- d/500 + (Math.random()*spread*.02); if(a>=spread&&score>bestScore){bestScore=score;best=e;}
    }
    return best;
  }
  function hitEnemy(e,damage){
    if(!e||!enemies.has(e.id))return;
    e.hp=Math.max(0,e.hp-damage);
    emit({type:'enemyHit',id:e.id,hp:e.hp,attackerId:'offline',damage,x:e.x,y:e.type==='boss'?3.2:2.4,z:e.z});
    if(e.hp<=0){
      enemies.delete(e.id); money+=100; kills+=1;
      emit({type:'enemyKilled',id:e.id,enemyType:e.type,killerId:'offline',reward:100,money,x:e.x,z:e.z});
      if(e.type==='boss'&&wave===10){escapeActive=true;escapeTimer=60;waveState='escape';emit({type:'escapeStart',duration:60});}
    }
  }
  function playerShot(type){
    if(waveState!=='active'||reloading||grabbed||downed||!inventory.includes(type))return;
    const w=WEAPONS[type], a=ammo[type]; if(!a||a.mag<=0){emit({type:'reloadReject',reason:'Sin munición. Pulsá recargar.'});return;}
    const p=getPlayer(); const target=aimTarget(w.range,type==='shotgun'?.88:.97); a.mag--; emit({type:'shotFired',weapon:type,ammo:{...ammo}});
    const targets=type==='shotgun' ? [...enemies.values()].filter(e=>e.hp>0 && Math.hypot(e.x-p.x,e.z-p.z)<=w.range && dotAim(p.x,p.z,p.yaw,e.x,e.z)>.86).slice(0,w.pellets) : [target].filter(Boolean);
    for(const e of targets){
      const d=Math.max(8,Math.hypot(e.x-p.x,e.z-p.z)); const speed=w.speed; emit({type:'projectile',id:'P'+projectileCounter++,x:p.x,y:1.75,z:p.z,vx:-Math.sin(p.yaw)*speed,vy:(p.pitch||0)*speed*.12,vz:-Math.cos(p.yaw)*speed,gravity:4.2,life:Math.min(1.2,d/speed+.08),color: type==='rifle'?0x8cf7ff:type==='shotgun'?0xffd166:0x70d7ff});
      const travel=Math.max(40, d/speed*1000);
      setTimeout(()=>{ if(enemies.has(e.id))hitEnemy(e,type==='shotgun'?w.damage:w.damage); emit({type:'projectileImpact',id:'P'+(projectileCounter-1),x:e.x,y:1.55,z:e.z,hit:true}); },travel);
    }
  }
  function punch(){
    if(waveState!=='active'||downed||grabbed)return; const e=aimTarget(4.0,.82); if(e)hitEnemy(e,15);
  }
  function buy(type){
    if(waveState!=='shop'){emit({type:'purchase',ok:false,reason:'La tienda abre cada 3 rondas.'});return;}
    if(inventory.includes(type)){emit({type:'purchase',ok:false,reason:'Ya tenés esa arma.'});return;}
    if(inventory.length>=2){emit({type:'purchase',ok:false,reason:'Inventario lleno.'});return;}
    if(money<WEAPONS[type].cost){emit({type:'purchase',ok:false,reason:`Necesitás $${WEAPONS[type].cost}.`});return;}
    money-=WEAPONS[type].cost; inventory.push(type); weapon=type; ammo[type]={mag:WEAPONS[type].magSize,reserve:WEAPONS[type].reserveMax}; emit({type:'purchase',ok:true,money,inventory,weapon,ammo});
  }
  async function reload(){
    if(waveState!=='active'||!inventory.includes(weapon)||reloading)return; const a=ammo[weapon],w=WEAPONS[weapon]; if(a.mag>=w.magSize||a.reserve<=0){emit({type:'reloadReject',reason:'No hay balas disponibles.'});return;}
    reloading=true;emit({type:'reloadStart',weapon,duration:w.reload});await sleep(w.reload*1000); if(!reloading)return; const take=Math.min(w.magSize-a.mag,a.reserve);a.mag+=take;a.reserve-=take;reloading=false;emit({type:'reloadComplete',weapon,ammo:a});
  }
  function openGate(){const p=getPlayer(); if(mapId==='hall'&&!gateOpen&&p.z>41&&p.z<47&&Math.abs(p.x)<9){gateOpen=true;emit({type:'gateState',open:true});waveTimer=1.5;}}
  function shopReady(){if(waveState==='shop'){waveTimer=0;emit({type:'shopSkipped'});}}
  function qteEscape(){if(grabbed){grabbed=false;emit({type:'grabRelease',rescued:false});}}
  function updateEnemy(e,dt){
    const p=getPlayer(); if(waveState!=='active')return; if(mapId==='hall'&&p.z>=43&&!gateOpen)return;
    const dx=p.x-e.x,dz=p.z-e.z,d=Math.hypot(dx,dz)||.001;
    if(e.type==='shooter'){
      if(d<8){e.x-=dx/d*dt*e.speed;e.z-=dz/d*dt*e.speed;}
      else if(d>14){e.x+=dx/d*dt*e.speed;e.z+=dz/dt*0;}
      if(d>=8&&e.nextShot<=0){e.nextShot=1.6+Math.random()*.8;if(Math.random()>.2){setTimeout(()=>damagePlayer(e.damage),380);}}
      e.nextShot-=dt;
      return;
    }
    if(e.type==='kidnapper'&&!grabbed&&d<1.7){grabbed=true;emit({type:'grabStart'});return;}
    if(e.type!=='kidnapper'&&d<e.radius+.72){e.lastAttack-=dt;if(e.lastAttack<=0){e.lastAttack=e.cooldown;damagePlayer(e.damage);}}
    else {e.x+=dx/d*e.speed*dt;e.z+=dz/d*e.speed*dt;}
  }
  function checkEscape(dt){
    if(!escapeActive)return; escapeTimer-=dt; emit({type:'escapeState',remaining:escapeTimer}); const p=getPlayer();
    if(mapId==='hall' && p.z<-40 || escapeTimer<=0){ mapId='train'; escapeActive=false; waveState='intermission'; waveTimer=4; enemies.clear(); emit({type:'mapChange',mapId:'train',x:0,y:1.6,z:22,wave}); emit({type:'trainIntro'}); }
  }
  function tick(dt){
    if(!running)return; timer+=dt;
    if(waveState==='active'){
      for(const e of enemies.values()) updateEnemy(e,dt);
      if(enemies.size===0)finishWave();
    }
    if(waveState==='intermission'||waveState==='shop')maybeRound();
    if(waveState==='escape')checkEscape(dt);
    if(mapId==='train'&&getPlayer().z<=-25&&!victory){victory=true;waveState='victory';emit({type:'victory',killsTotal:kills,moneyTotal:money});}
    if(timer>=.15){timer=0;state();}
  }
  return {
    start(){ if(running)return; running=true; welcome(); const loop=()=>{tick(.05);setTimeout(loop,50)}; loop(); },
    handle(msg){
      switch(msg.type){
        case 'setName': localStorage.setItem('capsuleName',String(msg.name||'CAPSULE').slice(0,16).toUpperCase()); emit({type:'nameSet',name:localStorage.getItem('capsuleName')}); break;
        case 'state': break;
        case 'openGate': openGate(); break;
        case 'shopReady': shopReady(); break;
        case 'buyWeapon': buy(msg.weapon); break;
        case 'setWeapon': if(msg.weapon==='fists'||inventory.includes(msg.weapon)) weapon=msg.weapon; emit({type:'weaponSet',weapon}); break;
        case 'shoot': playerShot(msg.weapon||weapon); break;
        case 'punch': punch(); break;
        case 'reload': reload(); break;
        case 'qteEscape': qteEscape(); break;
      }
    }
  };
}

})();


const CONFIG = {
  maxHp: 100,
  punchDamage: 15,
  enemyHp: 40,
  enemyDamage: 5,
  bossHp: 300,
  bossDamage: 15,
  regenDelay: 6,
  regenRate: 8,
  walkSpeed: 6.8,
  sprintSpeed: 11.2,
  crouchSpeed: 3.8,
  staminaMax: 100,
  staminaDrain: 25,
  staminaRegen: 18,
  punchCooldown: 0.34,
  weaponFireCooldown: { pistol: 0.28, shotgun: 0.82, rifle: 0.105 },
  weaponRange: { pistol: 65, shotgun: 34, rifle: 85 },
  shotgunPellets: 8,
  shotgunPelletDamage: 10,
  roomHalf: 44,
  safeMinX: -41,
  safeMaxX: 41,
  safeMinZ: -41,
  safeMaxZ: 41,
  outsideSpawnZ: 53,
  eyeHeight: 2.05,
  crouchHeight: 1.28,
  playerRadius: 0.58,
  mouseSensitivity: 0.0019,
  sprintFov: 88,
  normalFov: 76,
  crouchFov: 73,
  jumpVelocity: 8.4,
  gravity: 22,
  bulletGravity: 4.2,
  bulletSpeed: { pistol: 78, shotgun: 62, rifle: 108 },
  projectileTrail: .72
};

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const IS_MOBILE = document.body.classList.contains('mobile-build') || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const fpsEl = $('fps');
const playersEl = $('players');
const statusEl = $('status');
const playerNameHud = $('playerNameHud');
const hpText = $('hpText');
const hpFill = $('hpFill');
const staminaText = $('staminaText');
const staminaFill = $('staminaFill');
const moneyText = $('moneyText');
const waveText = $('waveText');
const enemyText = $('enemyText');
const announcement = $('announcement');
const announcementSmall = $('announcementSmall');
const announcementMain = $('announcementMain');
const announcementSub = $('announcementSub');
const bossWrap = $('bossWrap');
const bossFill = $('bossFill');
const bossHpText = $('bossHp');
const escapeWrap = $('escapeWrap');
const escapeTimerEl = $('escapeTimer');
const slotEls = [null, $('slot1'), $('slot2'), $('slot3')];
const slotNames = { fists: 'PUÑOS', pistol: 'PISTOLA', shotgun: 'ESCOPETA', rifle: 'RIFLE' };
const slotMeta = { fists: '∞', pistol: '$500', shotgun: '$2.500', rifle: '$5.000' };
const weaponHud = $('weaponHud');
const ammoHud = $('ammoHud');
const reloadHud = $('reloadHud');
const graphicsOverlay = $('graphicsOverlay');
const lowGraphicsToggle = $('lowGraphicsToggle');
const graphicsClose = $('graphicsClose');
const shadowsToggle = $('shadowsToggle');
const fogToggle = $('fogToggle');
const lightsToggle = $('lightsToggle');
const floorDetailToggle = $('floorDetailToggle');
const enemyDetailToggle = $('enemyDetailToggle');
const bloomToggle = $('bloomToggle');
const shadowModeText = $('shadowModeText');
const renderScaleText = $('renderScaleText');
const fogModeText = $('fogModeText');
const drawDistanceText = $('drawDistanceText');
const lightModeText = $('lightModeText');
const enemyModeText = $('enemyModeText');
const shopOverlay = $('shopOverlay');
const shopCountdown = $('shopCountdown');
const shopStatus = $('shopStatus');
const shopMoney = $('shopMoney');
const shopPistol = $('buyPistol');
const shopShotgun = $('buyShotgun');
const shopRifle = $('buyRifle');
const qteOverlay = $('qteOverlay');
const qteTarget = $('qteTarget');
const qteProgress = $('qteProgress');
const qteStatus = $('qteStatus');
const hitFlash = $('hitFlash');
const damageVignette = $('damageVignette');
const pauseOverlay = $('pauseOverlay');
const deathOverlay = $('deathOverlay');
const deathText = $('deathText');
const startOverlay = $('startOverlay');
const nameInput = $('nameInput');
const startButton = $('startButton');
const bootError = $('bootError');
const victoryOverlay = $('victoryOverlay');
const victoryStats = $('victoryStats');
const shopReadyBtn = $('shopReadyBtn');
const shopReadyStatus = $('shopReadyStatus');
const safeDoorPrompt = $('safeDoorPrompt');

// Android/offline bootstrap state. This flag is client-local and guarantees
// that an empty/broken server address never blocks the local game.
let isOffline = false;
let startupAttempted = false;

function hideStartUIImmediately() {
  const overlay = document.getElementById('startOverlay') || document.getElementById('login-screen') || document.getElementById('menu');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.add('hidden');
  }
}

// Bind the mobile start button before any Three.js-dependent initialization
// runs. This means a WebView error elsewhere cannot leave the login button
// completely inert. The actual initialization happens in startGame().
if (startButton) {
  startButton.addEventListener('click', (event) => {
    event.preventDefault();
    try {
      startGame();
    } catch (err) {
      hideStartUIImmediately();
      console.error('CAPSULE startGame failed:', err);
      alert('Error al iniciar: ' + (err?.message || err));
    }
  });
}

const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071117);
scene.fog = new THREE.FogExp2(0x24353d, 0.007);

const camera = new THREE.PerspectiveCamera(CONFIG.normalFov, innerWidth / innerHeight, 0.08, 190);
camera.position.set(0, CONFIG.eyeHeight, CONFIG.outsideSpawnZ);

const AUTO_LOW = IS_MOBILE || (Number(navigator.deviceMemory || 99) <= 4) || (Number(navigator.hardwareConcurrency || 8) <= 4);
const explicitLow = localStorage.getItem('capsuleGraphicsLow');
const graphicsSettings = {
  low: explicitLow === '1' || (explicitLow === null && AUTO_LOW),
  shadows: localStorage.getItem('capsuleGraphicsShadows') !== '0',
  fog: localStorage.getItem('capsuleGraphicsFog') !== '0',
  lights: localStorage.getItem('capsuleGraphicsLights') !== '0',
  floorDetail: localStorage.getItem('capsuleGraphicsFloor') !== '0',
  enemyDetail: localStorage.getItem('capsuleGraphicsEnemies') !== '0',
  bloom: localStorage.getItem('capsuleGraphicsBloom') !== '0'
};
let lowGraphics = graphicsSettings.low;
if (lowGraphics) {
  graphicsSettings.shadows=false; graphicsSettings.fog=false; graphicsSettings.lights=false;
  graphicsSettings.floorDetail=false; graphicsSettings.enemyDetail=false; graphicsSettings.bloom=false;
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', depth: true, stencil: false });
renderer.setPixelRatio(graphicsSettings.low ? 0.5 : Math.min(devicePixelRatio || 1, 1.0));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;


const hemi = new THREE.HemisphereLight(0xdaf3ff, 0x55686f, 2.45);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xf2f8ff, 1.08);
scene.add(ambient);

const room = new THREE.Group();
const entities = new THREE.Group();
const fx = new THREE.Group();
scene.add(room, entities, fx);

const keys = new Set();
const remotePlayers = new Map();
const weaponViews = new Map();
const enemyMeshes = new Map();
const damageNumbers = [];
const particles = [];
const ceilingLights = [];
const mapLights = [];
let hallFloorMesh = null;
let hallFloorTexture = null;
let hallFloorRoughnessMap = null;
const breachSockets = new Map();
const enemyColliders = [];
const floorColliders = [];
let escapeGate = null;
let escapeStation = null;
let hallEntryDoor = null;

const player = {
  position: new THREE.Vector3(0, CONFIG.eyeHeight, CONFIG.outsideSpawnZ),
  velocity: new THREE.Vector3(),
  yaw: 0,
  targetYaw: 0,
  pitch: 0,
  targetPitch: 0,
  crouch: false,
  sprint: false,
  bob: 0,
  bobSpeed: 0,
  headHeight: CONFIG.eyeHeight,
  groundY: 0,
  verticalVelocity: 0,
  grounded: true
};

let socket = null;
let offlineSim = null;

let myId = '';
let connected = false;
let playerName = localStorage.getItem('capsuleName') || `CAPSULE-${Math.floor(100 + Math.random() * 900)}`;
let localHp = 100;
let localStamina = 100;
let localMoney = 0;
let wave = 0;
let waveState = 'intermission';
let lastServerDamage = -Infinity;
let punchTimer = 0;
let punchPhase = 0;
let recoil = 0;
let shake = 0;
let hurtFlash = 0;
let messageTimer = 0;
let fpsFrames = 0;
let fpsTime = 0;
let lastUiTime = 0;
let lastNetTime = 0;
let audioCtx = null;
let paused = true;
let dead = false;
let flashlightOn = true;
let entranceSeen = false;
let mouseDown = false;
let currentWeapon = 'fists';
let inventory = { 1: 'fists', 2: null, 3: null };
let weaponFireTimer = 0;
let weaponRecoil = 0;
let reloading = false;
let reloadRemaining = 0;
let reloadDuration = 1.1;
let ammo = { pistol: { mag: 12, reserve: 36 }, shotgun: { mag: 8, reserve: 24 }, rifle: { mag: 30, reserve: 120 } };
let shopActive = false;
let shopRemaining = 0;
let grabbed = false;
let qteHits = 0;
let qteDeadline = 0;
let qteTotal = 7;
let projectiles = [];
let jumpQueued = false;
let mapId = 'hall';
let downed = false;
let spectatorMode = false;
let downedRemaining = 0;
let reviveTargetId = null;
let reviveHold = false;
let escapeRemaining = 0;
let escapeActive = false;
let trainAnim = 0;
let victoryShown = false;
let hallGateOpen = false;
let shopReady = false;
let spectatorTargetId = null;
let spectatorOrbit = 0;
const trainWindowStrips = [];

nameInput.value = playerName;
playerNameHud.textContent = playerName;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function random(min, max) { return min + Math.random() * (max - min); }
function lerp(a, b, t) { return a + (b - a) * t; }
function damp(a, b, lambda, dt) { return THREE.MathUtils.damp(a, b, lambda, dt); }
function rndInt(min, max) { return Math.floor(random(min, max + 1)); }

function cacheOriginalShadows() {
  scene.traverse((obj) => {
    if (obj.isMesh || obj.isLight) {
      if (obj.userData._origCastShadow === undefined) obj.userData._origCastShadow = !!obj.castShadow;
      if (obj.userData._origReceiveShadow === undefined) obj.userData._origReceiveShadow = !!obj.receiveShadow;
      if (obj.userData._origVisible === undefined) obj.userData._origVisible = obj.visible;
    }
  });
}

function applyGraphicsSettings() {
  const low = !!graphicsSettings.low;
  lowGraphics = low;
  const ratio = low ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.0);
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = !!graphicsSettings.shadows && !low;
  renderer.shadowMap.autoUpdate = renderer.shadowMap.enabled;
  scene.fog = graphicsSettings.fog && !low ? new THREE.FogExp2(0x24353d, 0.0065) : null;
  camera.far = low ? 78 : 190;
  camera.updateProjectionMatrix();
  // Android/mobile build: no post-processing composer or bloom pass.
  // Render directly with WebGLRenderer for compatibility and lower GPU cost.
  graphicsSettings.bloom = false;
  scene.traverse((obj)=>{
    if(obj.isMesh){
      if(obj.userData._origCastShadow===undefined)obj.userData._origCastShadow=!!obj.castShadow;
      if(obj.userData._origReceiveShadow===undefined)obj.userData._origReceiveShadow=!!obj.receiveShadow;
      obj.castShadow=!!graphicsSettings.shadows&&!low&&!!obj.userData._origCastShadow;
      obj.receiveShadow=!!graphicsSettings.shadows&&!low&&!!obj.userData._origReceiveShadow;
    }
    if(obj.isLight&&obj.shadow)obj.castShadow=!!graphicsSettings.shadows&&!low&&(obj===flashlight||!!obj.userData._origCastShadow);
  });
  for(const item of ceilingLights){ if(item.light)item.light.visible=!!graphicsSettings.lights&&!low; if(item.bulb)item.bulb.visible=!!graphicsSettings.lights&&!low; }
  for(const light of mapLights)light.visible=!!graphicsSettings.lights&&!low;
  if(flashlight){flashlight.castShadow=!!graphicsSettings.shadows&&!low; flashlight.visible=flashlightOn;}
  if(hallFloorMesh?.material){
    const detailed=graphicsSettings.floorDetail&&!low;
    hallFloorMesh.material.map=detailed?hallFloorTexture:null;
    hallFloorMesh.material.roughnessMap=detailed?hallFloorRoughnessMap:null;
    hallFloorMesh.material.color.set(detailed?0xffffff:0x343f43);
    hallFloorMesh.material.roughness=detailed?.68:.94;
    hallFloorMesh.material.metalness=detailed?.05:.02;
    hallFloorMesh.material.needsUpdate=true;
  }
  if(lowGraphicsToggle)lowGraphicsToggle.checked=low;
  if(shadowsToggle)shadowsToggle.checked=!!graphicsSettings.shadows&&!low;
  if(fogToggle)fogToggle.checked=!!graphicsSettings.fog&&!low;
  if(lightsToggle)lightsToggle.checked=!!graphicsSettings.lights&&!low;
  if(floorDetailToggle)floorDetailToggle.checked=!!graphicsSettings.floorDetail&&!low;
  if(enemyDetailToggle)enemyDetailToggle.checked=!!graphicsSettings.enemyDetail&&!low;
  if(bloomToggle){ bloomToggle.checked=false; bloomToggle.disabled=true; }
  if(shadowModeText)shadowModeText.textContent=graphicsSettings.shadows&&!low?'DINÁMICAS':'APAGADAS';
  if(renderScaleText)renderScaleText.textContent=`${Math.round(ratio*100)}%`;
  if(fogModeText)fogModeText.textContent=graphicsSettings.fog&&!low?'ACTIVA':'DESACTIVADA';
  if(drawDistanceText)drawDistanceText.textContent=low?'78m':'190m';
  if(lightModeText)lightModeText.textContent=graphicsSettings.lights&&!low?'ACTIVAS':'APAGADAS';
  if(enemyModeText)enemyModeText.textContent=graphicsSettings.enemyDetail&&!low?'DETALLADOS':'CÁPSULAS';
  localStorage.setItem('capsuleGraphicsLow',low?'1':'0');
  localStorage.setItem('capsuleGraphicsShadows',graphicsSettings.shadows?'1':'0');
  localStorage.setItem('capsuleGraphicsFog',graphicsSettings.fog?'1':'0');
  localStorage.setItem('capsuleGraphicsLights',graphicsSettings.lights?'1':'0');
  localStorage.setItem('capsuleGraphicsFloor',graphicsSettings.floorDetail?'1':'0');
  localStorage.setItem('capsuleGraphicsEnemies',graphicsSettings.enemyDetail?'1':'0');
  localStorage.setItem('capsuleGraphicsBloom','0');
  for(const view of enemyMeshes.values())applyEnemyVisualQuality(view);
}
function applyEnemyVisualQuality(view){ if(!view)return; const capsule=!graphicsSettings.enemyDetail||lowGraphics; if(view.detailParts)for(const part of view.detailParts)part.visible=!capsule; if(view.capsuleGroup)view.capsuleGroup.visible=capsule; }
function setGraphicsSetting(key,value){ graphicsSettings[key]=!!value; graphicsSettings.low=false; applyGraphicsSettings(); }
function togglePapaMode(enabled){ graphicsSettings.low=!!enabled; if(graphicsSettings.low){graphicsSettings.shadows=false;graphicsSettings.fog=false;graphicsSettings.lights=false;graphicsSettings.floorDetail=false;graphicsSettings.enemyDetail=false;graphicsSettings.bloom=false;}else{graphicsSettings.shadows=true;graphicsSettings.fog=true;graphicsSettings.lights=true;graphicsSettings.floorDetail=true;graphicsSettings.enemyDetail=true;graphicsSettings.bloom=true;} applyGraphicsSettings(); }

function toggleGraphicsMenu(force) {
  const show = typeof force === 'boolean' ? force : graphicsOverlay.classList.contains('hidden');
  graphicsOverlay.classList.toggle('hidden', !show);
  if (show) {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    paused = true;
  }
}

function createProceduralFloorTexture() {
  const size = 1024;
  const tile = 64;
  const colorCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = roughCanvas.width = roughCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');
  const rough = roughCanvas.getContext('2d');

  ctx.fillStyle = '#111719';
  ctx.fillRect(0, 0, size, size);
  rough.fillStyle = '#d2d7d9';
  rough.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      const v = rndInt(13, 25);
      ctx.fillStyle = `rgb(${v},${v + 5},${v + 7})`;
      ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      ctx.strokeStyle = 'rgba(2,5,6,.94)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, tile - 3, tile - 3);
      ctx.strokeStyle = 'rgba(115,146,151,.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 5, y + 5, tile - 10, tile - 10);

      for (let n = 0; n < 12; n++) {
        const gx = x + random(7, tile - 7);
        const gy = y + random(7, tile - 7);
        ctx.fillStyle = `rgba(180,200,205,${random(.015,.06)})`;
        ctx.fillRect(gx, gy, random(.4, 2.4), random(.4, 2.4));
      }
    }
  }

  for (let i = 0; i < 25; i++) {
    const cx = random(20, size - 20);
    const cy = random(20, size - 20);
    const rx = random(16, 60);
    const ry = random(8, 38);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(random(0, Math.PI));
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
    grad.addColorStop(0, 'rgba(105,0,4,.95)');
    grad.addColorStop(.5, 'rgba(60,0,3,.78)');
    grad.addColorStop(1, 'rgba(10,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,30,35,.23)';
    ctx.lineWidth = random(1, 3);
    ctx.stroke();
    for (let s = 0; s < 7; s++) {
      const ang = random(0, Math.PI * 2);
      const dist = random(rx * .7, rx * 2.1);
      const sx = Math.cos(ang) * dist;
      const sy = Math.sin(ang) * dist;
      ctx.fillStyle = 'rgba(85,0,3,.76)';
      ctx.beginPath();
      ctx.arc(sx, sy, random(1.5, 5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // glossy reflection streak
    ctx.save();
    ctx.translate(cx - rx * .15, cy - ry * .1);
    ctx.rotate(random(0, Math.PI));
    ctx.fillStyle = 'rgba(255,160,165,.10)';
    ctx.fillRect(-rx * .35, -1, rx * .5, 2);
    ctx.restore();

    rough.save();
    rough.translate(cx, cy);
    rough.rotate(random(0, Math.PI));
    const rg = rough.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
    rg.addColorStop(0, '#363a3d');
    rg.addColorStop(.45, '#656b6e');
    rg.addColorStop(1, '#d8d8d8');
    rough.fillStyle = rg;
    rough.beginPath();
    rough.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    rough.fill();
    rough.restore();
  }

  const texture = new THREE.CanvasTexture(colorCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(6, 6);
  return { texture, roughnessMap };
}

function addWallSegment(x, z, sx, sy, sz, material, receiveShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, 6, z);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = false;
  room.add(mesh);
  return mesh;
}

function buildSocket(id, position, rotationY = 0) {
  const g = new THREE.Group();
  g.position.copy(position);
  g.rotation.y = rotationY;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x222b30, roughness: .65, metalness: .5 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x12191d, emissive: 0x1f4f58, emissiveIntensity: .25, transparent: true, opacity: .9, roughness: .9 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: .16 });
  const frameA = new THREE.Mesh(new THREE.BoxGeometry(.35, 5.5, 5.1), frameMat);
  const frameB = frameA.clone();
  frameA.position.x = -2.55; frameB.position.x = 2.55;
  const top = new THREE.Mesh(new THREE.BoxGeometry(5.45, .35, 5.1), frameMat);
  top.position.y = 2.75;
  const barrier = new THREE.Mesh(new THREE.BoxGeometry(5.0, 5.2, .18), barrierMat);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), glowMat);
  glow.position.z = .12;
  g.add(frameA, frameB, top, barrier, glow);
  room.add(g);
  breachSockets.set(id, { group: g, barrier, glow, cooldown: 0 });
}


function disposeSceneGroup(group){
  group.traverse(obj=>{
    if(obj.isMesh||obj.isLine||obj.isSprite){
      obj.geometry?.dispose?.();
      if(obj.material){
        const mats=Array.isArray(obj.material)?obj.material:[obj.material];
        for(const m of mats){m.map?.dispose?.();m.lightMap?.dispose?.();m.bumpMap?.dispose?.();m.normalMap?.dispose?.();m.roughnessMap?.dispose?.();m.dispose?.();}
      }
    }
  });
  for(const child of [...group.children]) group.remove(child);
}
function addRectCollider(x, z, halfX, halfZ) {
  floorColliders.push({ type: 'rect', x, z, halfX, halfZ });
}

function addRoomWall(x, z, sx, sz, material, emissive=0x000000) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6.2, sz), material);
  m.position.set(x, 3.1, z);
  m.receiveShadow = false;
  m.castShadow = false;
  room.add(m);
  addRectCollider(x, z, sx/2, sz/2);
  if (emissive) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.8, sx*.55), .06, Math.max(.08, sz*.08)), new THREE.MeshBasicMaterial({color:emissive, transparent:true, opacity:.7}));
    led.position.set(x, 5.9, z);
    room.add(led);
  }
  return m;
}

function clearHallForTrain(){
  disposeSceneGroup(room);
  floorColliders.length=0; breachSockets.clear(); ceilingLights.length=0; mapLights.length=0; trainWindowStrips.length=0; escapeGate=null; escapeStation=null;
}
function addTrainWindow(x,z){
  const frame=new THREE.Mesh(new THREE.BoxGeometry(.18,2.8,4.8),new THREE.MeshStandardMaterial({color:0x20292e,metalness:.72,roughness:.36}));
  frame.position.set(x,3.35,z);
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(4.4,2.35),new THREE.MeshBasicMaterial({color:0x9bdcff,transparent:true,opacity:.26,side:THREE.DoubleSide}));
  glass.rotation.y=x<0?Math.PI/2:-Math.PI/2; glass.position.set(x+(x<0?.1:-.1),3.35,z);
  room.add(frame,glass);
  trainWindowStrips.push({x,z,glass});
}
function createTrainMap(){
  clearHallForTrain();
  const floorMat=new THREE.MeshStandardMaterial({color:0x283238,roughness:.66,metalness:.35});
  const floor=new THREE.Mesh(new THREE.BoxGeometry(10,.38,66),floorMat); floor.position.y=-.22; room.add(floor);
  const wallMat=new THREE.MeshStandardMaterial({color:0x172126,roughness:.76,metalness:.34});
  const left=new THREE.Mesh(new THREE.BoxGeometry(.45,5.4,66),wallMat), right=left.clone(); left.position.set(-5,2.5,0); right.position.set(5,2.5,0); room.add(left,right);
  const ceiling=new THREE.Mesh(new THREE.BoxGeometry(10,.42,66),new THREE.MeshStandardMaterial({color:0x11181c,roughness:.9,metalness:.15})); ceiling.position.y=5.2; room.add(ceiling);
  const endA=new THREE.Mesh(new THREE.BoxGeometry(10,5.2,.38),wallMat), endB=endA.clone(); endA.position.set(0,2.5,-32.8); endB.position.set(0,2.5,32.8); room.add(endA,endB);
  for(const z of [-25,-12.5,0,12.5,25]) addTrainWindow(-4.78,z), addTrainWindow(4.78,z);
  const aisleMat=new THREE.MeshStandardMaterial({color:0x4c2f22,roughness:.78,metalness:.06});
  for(const z of [-25,-12.5,0,12.5,25]){
    for(const side of [-1,1]){
      const seat=new THREE.Mesh(new THREE.BoxGeometry(2.2,.7,1.55),aisleMat); seat.position.set(side*2.55,.72,z); room.add(seat);
      const back=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.15,.32),aisleMat); back.position.set(side*2.55,1.25,z+(side<0?.58:-.58)); room.add(back);
      floorColliders.push({x:side*2.55,z,radius:1.2});
    }
  }
  const railMat=new THREE.MeshBasicMaterial({color:0xc8f3ff,transparent:true,opacity:.62});
  for(const z of [-27,-13.5,0,13.5,27]){
    const bar=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,5.6),railMat); bar.position.set(0,4.35,z); room.add(bar);
  }
  for(const z of [-25,-12.5,0,12.5,25]){
    const light=new THREE.PointLight(0xc7e9ff,8,15,2); light.position.set(0,4.65,z); room.add(light); ceilingLights.push({light,bulb:null,seed:Math.random()*10,base:1}); mapLights.push(light);
  }
  const signMat=new THREE.MeshBasicMaterial({color:0xff9d68});
  const sign=new THREE.Mesh(new THREE.BoxGeometry(3.2,.35,.05),signMat); sign.position.set(0,4.5,-32.25); room.add(sign);
  showAnnouncement('MAPA 2 // TREN', 'A toda velocidad. Las hordas no van a esperar.', 'ESCAPE COMPLETADO', 4.4);
}
function createRoom() {
  const floor = createProceduralFloorTexture();
  hallFloorTexture=floor.texture; hallFloorRoughnessMap=floor.roughnessMap;
  const floorMat = new THREE.MeshStandardMaterial({ map: floor.texture, roughness: .68, roughnessMap: floor.roughnessMap, metalness: .05 });
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(88, .42, 88), floorMat);
  floorMesh.position.y = -.22; floorMesh.receiveShadow = false; hallFloorMesh=floorMesh;
  room.add(floorMesh);

  const outsideMat = new THREE.MeshStandardMaterial({ color: 0x11191d, roughness: 1 });
  const outside = new THREE.Mesh(new THREE.BoxGeometry(88, .22, 16), outsideMat);
  outside.position.set(0, -.33, 52);
  outside.receiveShadow = false;
  room.add(outside);

  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x11191d, roughness: 1, metalness: .05 });
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(88, .5, 88), ceilingMat);
  ceiling.position.y = 12.2;
  ceiling.receiveShadow = false;
  room.add(ceiling);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x17242a, roughness: .88, metalness: .22 });
  // Left/right walls: gaps are fitted with regenerative breach sockets.
  const sideSocketZ = [-29, -9, 11, 31];
  for (const x of [-44, 44]) {
    let previous = -44;
    for (const sz of sideSocketZ) {
      addWallSegment(x, (previous + sz - 3) / 2, .7, 12, (sz - 3) - previous, wallMat);
      previous = sz + 3;
    }
    addWallSegment(x, (previous + 44) / 2, .7, 12, 44 - previous, wallMat);
  }

  // North wall with two breach sockets.
  const northSockets = [-23, 0, 23];
  let previousX = -44;
  for (const sx of northSockets) {
    addWallSegment((previousX + sx - 2.7) / 2, -44, (sx - 2.7) - previousX, 12, .7, wallMat);
    previousX = sx + 2.7;
  }
  addWallSegment((previousX + 44) / 2, -44, 44 - previousX, 12, .7, wallMat);

  // Entrance wall with a large doorway.
  addWallSegment((-44 - 8) / 2, 44, 36, 12, .7, wallMat);
  addWallSegment((44 + 8) / 2, 44, 36, 12, .7, wallMat);
  const entranceTop = new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, .7), wallMat);
  entranceTop.position.set(0, 11, 44);
  room.add(entranceTop);

  const doorMat = new THREE.MeshStandardMaterial({ color: 0x1d2b31, roughness: .52, metalness: .48, emissive: 0x10252b, emissiveIntensity: .18 });
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(5.2, 9.1, .18), doorMat);
  const doorR = doorL.clone();
  doorL.position.set(-5.35, 5, 43.55); doorR.position.set(5.35, 5, 43.55);
  room.add(doorL, doorR);
  doorL.rotation.y = -.08; doorR.rotation.y = .08;
  hallEntryDoor = {left:doorL,right:doorR,target:0,progress:0};
  addRectCollider(-26,44,18,.38); addRectCollider(26,44,18,.38);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3941, roughness: .45, metalness: .65 });
  for (const x of [-8, 8]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(.42, 10.4, .85), frameMat);
    p.position.set(x, 5.2, 44);
    room.add(p);
  }

  const sign = new THREE.Mesh(new THREE.BoxGeometry(9.4, .75, .12), new THREE.MeshBasicMaterial({ color: 0x8ceaff }));
  sign.position.set(0, 9.5, 43.6);
  room.add(sign);

  // Regenerative side / north breaches.
  buildSocket('W-29', new THREE.Vector3(-43.62, 3.1, -29), Math.PI / 2);
  buildSocket('W-9', new THREE.Vector3(-43.62, 3.1, -9), Math.PI / 2);
  buildSocket('W11', new THREE.Vector3(-43.62, 3.1, 11), Math.PI / 2);
  buildSocket('W31', new THREE.Vector3(-43.62, 3.1, 31), Math.PI / 2);
  buildSocket('E-29', new THREE.Vector3(43.62, 3.1, -29), -Math.PI / 2);
  buildSocket('E-9', new THREE.Vector3(43.62, 3.1, -9), -Math.PI / 2);
  buildSocket('E11', new THREE.Vector3(43.62, 3.1, 11), -Math.PI / 2);
  buildSocket('E31', new THREE.Vector3(43.62, 3.1, 31), -Math.PI / 2);
  buildSocket('N-23', new THREE.Vector3(-23, 3.1, -43.62), 0);
  buildSocket('N0', new THREE.Vector3(0, 3.1, -43.62), 0);
  buildSocket('N23', new THREE.Vector3(23, 3.1, -43.62), 0);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x192328, roughness: .66, metalness: .38 });
  for (let i = -36; i <= 36; i += 12) {
    for (const z of [-42.9, 42.9]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(6, .22, .42), trimMat);
      trim.position.set(i, 8.65, z);
      room.add(trim);
    }
    for (const x of [-42.9, 42.9]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(.42, .22, 6), trimMat);
      trim.position.set(x, 8.65, i);
      room.add(trim);
    }
  }

  const columnMat = new THREE.MeshStandardMaterial({ color: 0x10181d, roughness: .8, metalness: .5 });
  for (let x = -36; x <= 36; x += 12) {
    for (let z = -36; z <= 36; z += 12) {
      if (Math.abs(x) < 10 && Math.abs(z) < 12) continue;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 11, 1.25), columnMat);
      pillar.position.set(x, 5.5, z);
      pillar.castShadow = false;
      pillar.receiveShadow = false;
      room.add(pillar);
      floorColliders.push({ x, z, radius: 1.15 });
    }
  }

  const centralMark = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.34, 64), new THREE.MeshBasicMaterial({ color: 0x82e9ff, transparent: true, opacity: .12, side: THREE.DoubleSide }));
  centralMark.rotation.x = -Math.PI / 2;
  centralMark.position.y = .035;
  room.add(centralMark);

  // Outside entrance lights.
  for (const x of [-6.6, 6.6]) {
    const lamp = new THREE.PointLight(0x8edfff, 32, 14, 1.7);
    lamp.position.set(x, 7.5, 44.5);
    room.add(lamp); mapLights.push(lamp);
  }

  // Ceiling lights, only a few cast shadows to keep 60 FPS realistic.
  for (let row = -24, i = 0; row <= 24; row += 24) {
    for (let col = -24; col <= 24; col += 24, i++) createCeilingLight(col, row, i);
  }

  const centralSpot = new THREE.SpotLight(0xd5edff, 230, 105, Math.PI / 2.5, .82, 1.2);
  centralSpot.position.set(0, 11, -1);
  centralSpot.target.position.set(0, 0, -10);
  centralSpot.castShadow = false;
  room.add(centralSpot, centralSpot.target); mapLights.push(centralSpot);

  const redSpot = new THREE.SpotLight(0x7f111b, 24, 70, Math.PI / 3.2, .8, 1.3);
  redSpot.position.set(28, 9, -26);
  redSpot.target.position.set(10, 0, -10);
  redSpot.castShadow = false;
  room.add(redSpot, redSpot.target); mapLights.push(redSpot);

  createSafeRoom();
  createMapDecor();
  createEscapeGate();
  createFlashlight();
}

function createCeilingLight(x, z, index) {
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(4.6, .12, .42), new THREE.MeshStandardMaterial({ color: 0x25343b, roughness: .7, metalness: .35, emissive: 0x274f5a, emissiveIntensity: .28 }));
  fixture.position.set(x, 11.86, z);
  room.add(fixture);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(3.9, .035, .16), new THREE.MeshBasicMaterial({ color: 0xbdefff, transparent: true, opacity: .78 }));
  bulb.position.set(x, 11.77, z);
  room.add(bulb);
  const fill = new THREE.PointLight(0xc8e9ff, 10.5, 26, 1.6);
  fill.position.set(x, 11.25, z);
  fill.castShadow = false;
  room.add(fill);
  ceilingLights.push({ light: fill, bulb, seed: Math.random() * 20, base: 1.0 }); mapLights.push(fill);
}


function addDecorBox(x, z, sx, sy, sz, color=0x4b3524, rotation=0, colliderRadius=null) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: .05 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, sy/2, z); m.rotation.y = rotation;
  m.castShadow = false; m.receiveShadow = false;
  room.add(m);
  if (colliderRadius) floorColliders.push({ x, z, radius: colliderRadius });
}

function addWallArt(x, y, z, ry, color=0x8edfff) {
  const g = new THREE.Group();
  g.position.set(x,y,z); g.rotation.y=ry;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3,1.55,.12), new THREE.MeshStandardMaterial({color:0x18252b,metalness:.55,roughness:.42}));
  const art = new THREE.Mesh(new THREE.PlaneGeometry(2.0,1.25), new THREE.MeshBasicMaterial({color, transparent:true, opacity:.7}));
  art.position.z=.07;
  g.add(frame,art); room.add(g);
}

function addAlarm(x,z,ry=0) {
  const base = new THREE.Mesh(new THREE.BoxGeometry(.34,.22,.18), new THREE.MeshStandardMaterial({color:0x242c31,metalness:.55,roughness:.4}));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.1,8,8), new THREE.MeshBasicMaterial({color:0xff304c}));
  const g=new THREE.Group(); g.position.set(x,7.4,z); g.rotation.y=ry; g.add(base,lamp); room.add(g);
  ceilingLights.push({light:null,bulb:lamp,seed:Math.random()*30,base:.35,alarm:true});
}


function createInstancedCrates(parent,xs,matColor=0x4b3524){
  if(!xs.length) return;
  const geo=new THREE.BoxGeometry(1.45,1.05,1.15);
  const mat=new THREE.MeshStandardMaterial({color:matColor,roughness:.95,metalness:.02});
  const inst=new THREE.InstancedMesh(geo,mat,xs.length);
  const dummy=new THREE.Object3D();
  xs.forEach((p,i)=>{dummy.position.set(p.x,.525,p.z);dummy.rotation.y=p.r||0;dummy.scale.set(p.s||1,p.s||1,p.s||1);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);});
  inst.instanceMatrix.needsUpdate=true; inst.castShadow=false; inst.receiveShadow=false; parent.add(inst);
}

function createSafeRoom(){
  const wall=new THREE.MeshStandardMaterial({color:0x2f3538,roughness:.9,metalness:.12});
  const brick=new THREE.MeshStandardMaterial({color:0x3a3431,roughness:1,metalness:.02});
  const floorMat=new THREE.MeshStandardMaterial({color:0x485057,roughness:.95,metalness:.04});
  const floor=new THREE.Mesh(new THREE.BoxGeometry(34,.35,16),floorMat); floor.position.set(0,-.18,52.2); room.add(floor);
  // Concrete/industrial room envelope. The front battle door remains the only exit.
  const back=new THREE.Mesh(new THREE.BoxGeometry(34,8.6,.5),wall); back.position.set(0,4.25,60); room.add(back);
  const left=new THREE.Mesh(new THREE.BoxGeometry(.5,8.6,16),brick), right=left.clone(); left.position.set(-17,4.25,52.2); right.position.set(17,4.25,52.2); room.add(left,right);
  addRectCollider(-17,52.2,.35,8.25); addRectCollider(17,52.2,.35,8.25); addRectCollider(0,60,16.7,.35);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(34,.45,16),new THREE.MeshStandardMaterial({color:0x252a2d,roughness:1,metalness:.12})); roof.position.set(0,8.5,52.2); room.add(roof);
  const columnMat=new THREE.MeshStandardMaterial({color:0x273238,metalness:.7,roughness:.42});
  for(const x of [-12,-6,6,12]){
    const col=new THREE.Mesh(new THREE.BoxGeometry(.5,8.2,.7),columnMat); col.position.set(x,4.1,59.25); room.add(col);
  }
  // Removable industrial crates, batched for low draw calls.
  createInstancedCrates(room,[{x:-11,z:50,r:-.05,s:1},{x:-9.4,z:50.9,r:.04,s:.92},{x:10.5,z:50.1,r:.02,s:1.1},{x:11.8,z:51.2,r:-.06,s:.85}],0x5a3c26);
  for(const x of [-13.5,13.5]){
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.62,.62,1.45,12),new THREE.MeshStandardMaterial({color:0x4d5558,roughness:.7,metalness:.72})); barrel.position.set(x,.73,56.2); room.add(barrel); floorColliders.push({x,z:56.2,radius:.72});
  }
  // Warm ceiling fixtures using emissive geometry + one shared soft light.
  const glowMat=new THREE.MeshBasicMaterial({color:0xffb45d,transparent:true,opacity:.9});
  for(const x of [-10,0,10]){
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(3,.08,.2),glowMat); lamp.position.set(x,7.7,50.2); room.add(lamp); ceilingLights.push({light:null,bulb:lamp,seed:Math.random()*20,base:1});
  }
  const safeFill=new THREE.PointLight(0xffb56c,22,25,1.6); safeFill.position.set(0,6.4,53); safeFill.castShadow=false; room.add(safeFill); ceilingLights.push({light:safeFill,bulb:null,seed:0,base:1}); mapLights.push(safeFill);
  const sign=makeTextSprite('ZONA SEGURA  //  PRESIONA [E] PARA COMBATIR','#ffd69b',44,5.2,.55); sign.position.set(0,6.9,43.5); room.add(sign);
}

function createMapDecor() {
  const wallMat = new THREE.MeshStandardMaterial({color:0x26363d, roughness:.82, metalness:.18});
  const innerMat = new THREE.MeshStandardMaterial({color:0x1d2b31, roughness:.78, metalness:.22});

  // Four side rooms. Each has a central doorway into the main hall.
  const rooms = [
    {cx:-30, cz:-27, name:'NORTHWEST'}, {cx:30, cz:-27, name:'NORTHEAST'},
    {cx:-30, cz:27, name:'SOUTHWEST'}, {cx:30, cz:27, name:'SOUTHEAST'}
  ];
  for(const r of rooms){
    const zTop=r.cz-8, zBottom=r.cz+8;
    const xInner=r.cx<0?-20:20;
    const xOuter=r.cx<0?-39.5:39.5;
    // top/bottom partition walls
    addRoomWall(r.cx,zTop,18,.42,wallMat,0x8bdfff);
    addRoomWall(r.cx,zBottom,18,.42,wallMat,0x8bdfff);
    // outer wall reinforcement
    addRoomWall(xOuter,r.cz,.42,16,wallMat,0x8bdfff);
    // inner wall split around a 6m doorway
    const gap=3.15;
    addRoomWall(xInner,r.cz-8+2.55,.42,5.1,innerMat,0x8bdfff);
    addRoomWall(xInner,r.cz+8-2.55,.42,5.1,innerMat,0x8bdfff);

    // Room floor inset for visual separation.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(17.2,.08,15.2), new THREE.MeshStandardMaterial({color:0x26363a,roughness:.9,metalness:.05}));
    floor.position.set(r.cx,.045,r.cz); room.add(floor);

    // Furniture and crates, all with light-weight colliders.
    addDecorBox(r.cx-4,r.cz-3,2.8,1.1,1.3,0x3f2b20,.05,1.7);
    addDecorBox(r.cx+4,r.cz+3,2.1,1.45,1.8,0x513522,-.06,1.35);
    addDecorBox(r.cx+4,r.cz-3,1.7,1.2,1.6,0x3d2a21,.08,1.15);
    addDecorBox(r.cx-4,r.cz+3,2.6,.75,1.3,0x242d31,.02,1.35);

    // Terminal / desk.
    const deskMat=new THREE.MeshStandardMaterial({color:0x2a3136,roughness:.55,metalness:.35});
    const desk=new THREE.Mesh(new THREE.BoxGeometry(3.2,.85,1.1),deskMat); desk.position.set(r.cx,.45,r.cz+0.3); room.add(desk); addRectCollider(r.cx,r.cz+0.3,1.75,.78);
    const monitor=new THREE.Mesh(new THREE.BoxGeometry(1.2,.82,.12),new THREE.MeshStandardMaterial({color:0x172126,emissive:0x75dfff,emissiveIntensity:.18,metalness:.5,roughness:.38})); monitor.position.set(r.cx,.98,r.cz-0.05); room.add(monitor);
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.95,.55),new THREE.MeshBasicMaterial({color:0x8feaff,transparent:true,opacity:.72})); screen.position.set(r.cx,.99,r.cz-.12); room.add(screen);

    // Wall art facing the central hall.
    addWallArt(xInner + (r.cx<0?.28:-.28), 4.8, r.cz-5.0, r.cx<0?Math.PI/2:-Math.PI/2, r.cx<0?0x7ab9d0:0x9c6b7f);
    addWallArt(xInner + (r.cx<0?.28:-.28), 4.8, r.cz+5.0, r.cx<0?Math.PI/2:-Math.PI/2, r.cx<0?0x8f745f:0x6b8a73);

    addAlarm(xOuter + (r.cx<0?.18:-.18), r.cz, r.cx<0?Math.PI/2:-Math.PI/2);
  }

  // Central hall cover objects.
  addDecorBox(-13,-8,3.4,1.0,1.5,0x2f373b,.08,1.8);
  addDecorBox(13,-8,3.4,1.0,1.5,0x2f373b,-.08,1.8);
  addDecorBox(-13,8,3.4,1.0,1.5,0x2f373b,.08,1.8);
  addDecorBox(13,8,3.4,1.0,1.5,0x2f373b,-.08,1.8);
  addWallArt(-41.2,7,0,Math.PI/2,0x8ccbe3); addWallArt(41.2,7,0,-Math.PI/2,0xd18a9a);
  addWallArt(-12,7,-43.1,0,0x8f6b9a); addWallArt(12,7,43.1,Math.PI,0x74946d);

  // LED strips: emissive geometry only, no extra dynamic lights.
  for(const z of [-34,-17,0,17,34]) for(const x of [-12,0,12]) {
    const cable=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1.15,5),new THREE.MeshBasicMaterial({color:0x36434a})); cable.position.set(x,11.25,z); room.add(cable);
    const led=new THREE.Mesh(new THREE.BoxGeometry(3.0,.07,.15),new THREE.MeshBasicMaterial({color:0xbaf3ff,transparent:true,opacity:.78})); led.position.set(x,10.65,z); room.add(led);
    ceilingLights.push({light:null,bulb:led,seed:Math.random()*22,base:.86});
  }

  for(const [x,z,ry] of [[-41.4,-27,Math.PI/2],[41.4,-27,-Math.PI/2],[-41.4,27,Math.PI/2],[41.4,27,-Math.PI/2]]) addAlarm(x,z,ry);
}

function createEscapeStation(){
  escapeStation=new THREE.Group();
  const stone=new THREE.MeshStandardMaterial({color:0x4a4f52,roughness:.92,metalness:.08});
  const stoneDark=new THREE.MeshStandardMaterial({color:0x292f32,roughness:.96,metalness:.12});
  const iron=new THREE.MeshStandardMaterial({color:0x20282c,roughness:.42,metalness:.82});
  const bronze=new THREE.MeshStandardMaterial({color:0x7a5c3a,roughness:.55,metalness:.5});
  const warm=new THREE.MeshBasicMaterial({color:0xffcb74});
  const cool=new THREE.MeshBasicMaterial({color:0xbfeaff});
  // Underground vaulted platform.
  const floor=new THREE.Mesh(new THREE.BoxGeometry(52,.3,28),stone); floor.position.set(0,-.15,-54); escapeStation.add(floor);
  const backWall=new THREE.Mesh(new THREE.BoxGeometry(52,8,.5),stoneDark); backWall.position.set(0,4,-68); escapeStation.add(backWall);
  // Vault ribs: simple arches from segmented boxes to keep draw calls/triangles low.
  for(const z of [-66,-60,-54,-48,-42]){
    for(const x of [-18,-9,0,9,18]){
      const col=new THREE.Mesh(new THREE.BoxGeometry(.46,7.8,.46),iron); col.position.set(x,3.9,z); escapeStation.add(col);
      const beam=new THREE.Mesh(new THREE.BoxGeometry(8.8,.38,.46),iron); beam.position.set(x,7.6,z); escapeStation.add(beam);
    }
  }
  // Rails and sleepers.
  for(const x of [-6,6]){const rail=new THREE.Mesh(new THREE.BoxGeometry(.14,.1,26),bronze); rail.position.set(x,.08,-54); escapeStation.add(rail);}
  for(const z of [-66,-62,-58,-54,-50,-46,-42]){const tie=new THREE.Mesh(new THREE.BoxGeometry(14,.12,.32),stoneDark); tie.position.set(0,-.02,z); escapeStation.add(tie);}
  const platform=new THREE.Mesh(new THREE.BoxGeometry(34,.5,5.8),stone); platform.position.set(0,.1,-53.7); escapeStation.add(platform);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(34,.08,.18),warm); edge.position.set(0,.37,-50.85); escapeStation.add(edge);
  // Old benches, repeated with instances.
  createInstancedCrates(escapeStation,[{x:-12,z:-54,s:1},{x:-3,z:-54,s:1},{x:6,z:-54,s:1},{x:15,z:-54,s:1}],0x5b3e25);
  // Station clocks and lanterns.
  for(const x of [-12,0,12]){
    const clock=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.05,.16,24),bronze); clock.rotation.x=Math.PI/2; clock.position.set(x,6.4,-61); escapeStation.add(clock);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(.07,.68,.04),stoneDark); hand.position.set(x,6.45,-60.86); escapeStation.add(hand);
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),warm); lamp.position.set(x,5.75,-60.6); escapeStation.add(lamp);
  }
  // Vintage train body, front locomotive + two wagons.
  function wagon(z,bodyColor=0x263035){
    const g=new THREE.Group(); const body=new THREE.Mesh(new THREE.BoxGeometry(9.2,2.9,8.5),new THREE.MeshStandardMaterial({color:bodyColor,roughness:.54,metalness:.7})); body.position.y=1.7; g.add(body);
    const roof=new THREE.Mesh(new THREE.CylinderGeometry(3.1,3.1,8.8,18,1,false,Math.PI/2,Math.PI),iron); roof.rotation.x=Math.PI/2; roof.position.y=3.25; g.add(roof);
    for(const x of [-3.3,0,3.3]){
      const win=new THREE.Mesh(new THREE.BoxGeometry(1.65,1.15,.08),new THREE.MeshBasicMaterial({color:0x9bdcff,transparent:true,opacity:.72})); win.position.set(x,2,-4.28); g.add(win);
      const win2=win.clone(); win2.position.z=4.28; g.add(win2);
    }
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(7.7,.12,.18),cool); lamp.position.y=2.95; g.add(lamp);
    g.position.set(0,0,z); escapeStation.add(g); return g;
  }
  wagon(-55); wagon(-65,0x303b40);
  const loco=new THREE.Group();
  const locoBody=new THREE.Mesh(new THREE.BoxGeometry(8.8,3.4,7.2),iron); locoBody.position.set(0,1.9,-44); loco.add(locoBody);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(7.6,2.4,3.1),new THREE.MeshStandardMaterial({color:0x161d20,roughness:.48,metalness:.82})); cab.position.set(0,4.2,-44.2); loco.add(cab);
  const chimney=new THREE.Mesh(new THREE.CylinderGeometry(.42,.56,1.9,12),iron); chimney.position.set(0,4.9,-41.8); loco.add(chimney);
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.5,12,8),new THREE.MeshBasicMaterial({color:0xffe4b2})); lamp.position.set(0,2.4,-47.75); loco.add(lamp);
  escapeStation.add(loco);
  const headlight=new THREE.SpotLight(0xffe4b2,95,42,.33,.7,1.4); headlight.position.set(0,2.6,-48); headlight.target.position.set(0,1,-60); escapeStation.add(headlight,headlight.target);
  // Clear directional station light.
  const stationFill=new THREE.DirectionalLight(0xdaf4ff,1.35); stationFill.position.set(0,10,-54); stationFill.target.position.set(0,0,-54); stationFill.castShadow=false; escapeStation.add(stationFill,stationFill.target);
  room.add(escapeStation); escapeStation.visible=false;
}
function setHallEntryDoorOpen(open){
  hallGateOpen=!!open;
  if(hallEntryDoor) hallEntryDoor.target=hallGateOpen?1:0;
}
function updateHallEntryDoor(dt){
  if(!hallEntryDoor)return;
  hallEntryDoor.progress=damp(hallEntryDoor.progress,hallEntryDoor.target,8,dt);
  const p=hallEntryDoor.progress;
  hallEntryDoor.left.position.x=-5.35-p*4.4;
  hallEntryDoor.right.position.x=5.35+p*4.4;
  hallEntryDoor.left.rotation.y=-.08-p*.18;
  hallEntryDoor.right.rotation.y=.08+p*.18;
}

function createEscapeGate() {
  const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:0x53616a,metalness:.74,roughness:.3,emissive:0x11191d,emissiveIntensity:.25});
  const left=new THREE.Mesh(new THREE.BoxGeometry(4.9,8.6,.48),steel); left.position.x=-2.45;
  const right=left.clone(); right.position.x=2.45;
  const top=new THREE.Mesh(new THREE.BoxGeometry(10,.55,.48),steel); top.position.y=4.28;
  const red=new THREE.Mesh(new THREE.BoxGeometry(8.8,.08,.06),new THREE.MeshBasicMaterial({color:0xff4356,transparent:true})); red.position.set(0,3.8,.26);
  g.add(left,right,top,red); g.position.set(0,4.4,-43.65); room.add(g); escapeGate=g; g.userData.openTarget=0; g.userData.openProgress=0;
  createEscapeStation();
}
function setEscapeGateOpen(open){
  if(!escapeGate)return;
  escapeGate.userData.openTarget=open?1:0;
  if(open) escapeGate.visible=true;
  const n0=breachSockets.get('N0'); if(n0) n0.group.visible=!open;
  if(escapeStation) escapeStation.visible=open;
}
function updateEscapeGate(dt){
  if(!escapeGate)return;
  const g=escapeGate; g.userData.openProgress=damp(g.userData.openProgress,g.userData.openTarget,7,dt); const p=g.userData.openProgress;
  g.children[0].position.x=-2.45-p*2.75; g.children[1].position.x=2.45+p*2.75; g.children[2].position.y=4.28-p*.35; g.children[3].material.opacity=1-p*.9;
  if(g.userData.openTarget===0 && p<.01) g.visible=true;
}

let flashlight = null;
let flashlightTarget = null;
function createFlashlight() {
  flashlight = new THREE.SpotLight(0xb8eaff, 32, 42, .38, .66, 1.35);
  flashlight.position.set(.05, -.1, -.25);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(128, 128);
  flashlight.shadow.bias = -0.00035;
  flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.set(0, -.12, -24);
  camera.add(flashlight, flashlightTarget);
  flashlight.target = flashlightTarget;
}

function capsuleParts(material, radius = .6, height = 1.2) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material);
  const top = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  top.position.y = height / 2; bottom.position.y = -height / 2;
  for (const m of [body, top, bottom]) { m.castShadow = !lowGraphics; m.receiveShadow = !lowGraphics; }
  g.add(body, top, bottom);
  return g;
}

function makeTextSprite(text, color = '#e9fbff', size = 36, scaleX = 1, scaleY = .34) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = `900 ${size}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,.68)';
  ctx.lineWidth = 9;
  ctx.strokeText(text, c.width / 2, c.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

function createRemotePlayer(data) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4ed5ff, roughness: .38, metalness: .48, emissive: 0x113d4c, emissiveIntensity: .3 });
  const body = capsuleParts(mat, .58, 1.5);
  body.position.y = 1.38;
  root.add(body);

  const visor = new THREE.Mesh(new THREE.TorusGeometry(.42, .055, 8, 20), new THREE.MeshBasicMaterial({ color: 0xb7f6ff }));
  visor.rotation.x = Math.PI / 2;
  visor.position.y = 1.92;
  root.add(visor);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(.82, .04, 8, 32), new THREE.MeshBasicMaterial({ color: 0x8feaff, transparent: true, opacity: .6 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .15;
  root.add(ring);

  const nameTag = makeTextSprite(data.name || 'CAPSULE', '#bff4ff', 34, 1.8, .42);
  nameTag.position.set(0, 3.15, 0);
  root.add(nameTag);
  entities.add(root);
  return { root, body, ring, nameTag, name: data.name || 'CAPSULE', target: new THREE.Vector3(), targetYaw: 0, lastHp: 100, phase: Math.random() * 10 };
}

function createLocalArms() {
  const arms = new THREE.Group();
  arms.name = 'localArms';
  camera.add(arms);
  arms.position.set(0, -.54, -.78);

  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1a272d, metalness: .6, roughness: .28, emissive: 0x092027, emissiveIntensity: .25 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x66e7ff, metalness: .55, roughness: .3, emissive: 0x145667, emissiveIntensity: .42 });

  function makeArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * .28, .04, 0);
    arm.rotation.set(.18, side * -.1, side * .28);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(.11, .15, .72, 12), gloveMat);
    forearm.rotation.z = Math.PI / 2;
    forearm.position.x = side * .18;
    const fist = capsuleParts(gloveMat, .19, .18);
    fist.scale.set(1.3, 1.05, 1.18);
    fist.position.set(side * .52, -.02, -.02);
    fist.rotation.z = side * .14;
    const band = new THREE.Mesh(new THREE.TorusGeometry(.135, .024, 8, 18), bandMat);
    band.rotation.y = Math.PI / 2;
    band.position.set(side * .28, 0, -.01);
    arm.add(forearm, fist, band);
    return arm;
  }

  const left = makeArm(-1);
  const right = makeArm(1);
  arms.add(left, right);
  return { arms, left, right };
}

const ENEMY_STYLE = {
  walker: { body: 0x38574b, head: 0x4a6b5d, eye: 0xb9ffdb, scale: 1, speedMul: 1 },
  runner: { body: 0x613c31, head: 0x805146, eye: 0xffc16d, scale: .88, speedMul: 1.45 },
  tank: { body: 0x3d415e, head: 0x565d7c, eye: 0xd1c8ff, scale: 1.22, speedMul: .72 },
  boss: { body: 0x5e1218, head: 0x7a1a22, eye: 0xff263d, scale: 2.72, speedMul: .8 },
  shooter: { body: 0x34465e, head: 0x4c6484, eye: 0xbde4ff, scale: .96, speedMul: 1.0 },
  kidnapper: { body: 0x5c2e57, head: 0x7b3e72, eye: 0xffb3ef, scale: 1.04, speedMul: 1.52 },
  dog: { body: 0x3a2225, head: 0x5a2d32, eye: 0xff5a5a, scale: 1.72, speedMul: 1.08 }
};

function createEnemyMesh(data) {
  const style = ENEMY_STYLE[data.type] || ENEMY_STYLE.walker;
  const isBoss = data.type === 'boss';
  const isDog = data.type === 'dog';
  const root = new THREE.Group();
  root.scale.setScalar(style.scale);
  root.userData.serverY = 0;

  const mat = new THREE.MeshStandardMaterial({ color: style.body, roughness: .82, metalness: .08, emissive: isBoss ? 0x2b0408 : 0x071d16, emissiveIntensity: isBoss ? .7 : .22 });
  const headMat = new THREE.MeshStandardMaterial({ color: style.head, roughness: .9, emissive: isBoss ? 0x2d0507 : 0x10241e, emissiveIntensity: .28 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: style.eye });

  if (isDog) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.55, .95, 2.35), mat);
    body.position.y = 1.05;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.44, .58, .88, 10), mat);
    neck.position.set(0, 1.35, 1.02);
    neck.rotation.x = Math.PI / 2.8;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, .72, 1.12), headMat);
    head.position.set(0, 1.72, 1.56);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(.72, .46, .72), headMat);
    snout.position.set(0, 1.55, 2.0);
    const earL = new THREE.Mesh(new THREE.ConeGeometry(.22, .46, 5), headMat), earR = earL.clone();
    earL.position.set(-.34, 2.08, 1.55); earR.position.set(.34, 2.08, 1.55);
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 8), eyeMat), eyeR = eyeL.clone();
    eyeL.position.set(-.22, 1.78, 2.03); eyeR.position.set(.22, 1.78, 2.03);
    const legGeo = new THREE.CylinderGeometry(.16, .22, 1.0, 9);
    const legs = [];
    for (const [x,z] of [[-.58,.75],[.58,.75],[-.58,-.68],[.58,-.68]]) { const leg = new THREE.Mesh(legGeo, mat); leg.position.set(x,.53,z); legs.push(leg); root.add(leg); }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(.08,.13,.9,8), mat);
    tail.position.set(0,1.3,-1.45); tail.rotation.x = -.6;
    for (const m of [body,neck,head,snout,earL,earR,eyeL,eyeR,tail]) root.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55,.05,8,36), new THREE.MeshBasicMaterial({ color:0xff5757, transparent:true, opacity:.55 }));
    ring.rotation.x=Math.PI/2; ring.position.y=.08; root.add(ring);
    const barBack = new THREE.Mesh(new THREE.PlaneGeometry(2.2,.09), new THREE.MeshBasicMaterial({color:0x060708,transparent:true,opacity:.9,side:THREE.DoubleSide}));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.2,.09), new THREE.MeshBasicMaterial({color:0xff6868,side:THREE.DoubleSide}));
    const hpGroup = new THREE.Group(); bar.position.x=-1.1; hpGroup.add(barBack,bar); hpGroup.position.y=3.05; root.add(hpGroup);
    const detailParts=root.children.filter(ch=>ch!==ring&&ch!==hpGroup);
    const capsuleGroup=new THREE.Group();
    const capMat=new THREE.MeshStandardMaterial({color:style.body,roughness:1,metalness:0,emissive:style.eye,emissiveIntensity:.12});
    const cap=new THREE.Mesh(new THREE.CapsuleGeometry(.62,.95,5,8),capMat); cap.position.y=1.38; capsuleGroup.add(cap);
    const visor=new THREE.Mesh(new THREE.TorusGeometry(.36,.045,6,12),new THREE.MeshBasicMaterial({color:style.eye,transparent:true,opacity:.75})); visor.rotation.x=Math.PI/2; visor.position.set(0,1.65,.45); capsuleGroup.add(visor);
    capsuleGroup.visible=false; root.add(capsuleGroup);
    root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
    entities.add(root);
    return {root,torso:body,head,armL:null,armR:null,legL:legs[0],legR:legs[1],hindL:legs[2],hindR:legs[3],ring,bar,hpGroup,hp:data.hp,maxHp:data.maxHp,type:data.type,phase:Math.random()*20,spawnT:0,spawnDuration:2.0,baseScale:style.scale,spawnStyle:data.spawnStyle||'floor',spawnSocket:data.spawnSocket||null,radius:data.radius||1.3,dog:true,tail,detailParts,capsuleGroup};
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.6, isBoss ? 1.5 : 1.08, 7, 14), mat);
  torso.position.y = 1.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.52,14,10), headMat);
  head.scale.y=1.08; head.position.y=isBoss?2.62:2.5;
  const eyeA=new THREE.Mesh(new THREE.SphereGeometry(isBoss?.095:.055,8,8),eyeMat), eyeB=eyeA.clone();
  eyeA.position.set(-.19,head.position.y+.03,.47); eyeB.position.set(.19,head.position.y+.03,.47);

  const armHeight=isBoss?2.0:data.type==='tank'?1.55:1.28;
  const legHeight=isBoss?2.1:data.type==='tank'?1.5:1.34;
  const armGeo=new THREE.CylinderGeometry(isBoss?.18:.13,isBoss?.26:.17,armHeight,10);
  const legGeo=new THREE.CylinderGeometry(isBoss?.19:.14,isBoss?.28:.19,legHeight,10);
  const armL=new THREE.Mesh(armGeo,mat),armR=armL.clone();
  armL.position.set(isBoss?-.82:-.72,1.35,0); armR.position.set(isBoss?.82:.72,1.35,0);
  armL.rotation.z=-.34;armR.rotation.z=.34;
  const legL=new THREE.Mesh(legGeo,mat),legR=legL.clone(); legL.position.set(-.33,.28,0);legR.position.set(.33,.28,0);
  for(const m of [torso,head,eyeA,eyeB,armL,armR,legL,legR]) root.add(m);

  if(data.type==='tank'||isBoss){
    const shoulderGeo=new THREE.SphereGeometry(isBoss?.42:.28,12,8);
    const shL=new THREE.Mesh(shoulderGeo,mat),shR=shL.clone();
    shL.position.set(isBoss?-.86:-.72,2.02,0);shR.position.set(isBoss?.86:.72,2.02,0); root.add(shL,shR);
  }

  let gun=null;
  if(data.type==='shooter'){
    gun=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.72),new THREE.MeshStandardMaterial({color:0x10161b,metalness:.65,roughness:.35}));
    gun.position.set(.42,1.42,.42); gun.rotation.x=.18; root.add(gun);
  }
  if(data.type==='runner'){
    const rag=new THREE.Mesh(new THREE.BoxGeometry(.85,.9,.08),new THREE.MeshBasicMaterial({color:0x271711,transparent:true,opacity:.68})); rag.position.set(0,1.45,-.58);rag.rotation.z=.18;root.add(rag);
  }
  if(data.type==='kidnapper'){
    const hook=new THREE.Mesh(new THREE.TorusGeometry(.25,.055,6,14,Math.PI*1.2),new THREE.MeshBasicMaterial({color:0xff6be8})); hook.rotation.z=-.6; hook.position.set(.55,1.65,.48); root.add(hook);
  }

  const ringColor=isBoss?0xff5961:data.type==='runner'?0xffb454:data.type==='tank'?0xa89bff:data.type==='shooter'?0x74b8ff:data.type==='kidnapper'?0xff63dd:0x7af0c4;
  const ring=new THREE.Mesh(new THREE.TorusGeometry(isBoss?1.82:.9,.045,8,36),new THREE.MeshBasicMaterial({color:ringColor,transparent:true,opacity:isBoss?.85:.52}));
  ring.rotation.x=Math.PI/2;ring.position.y=.08;root.add(ring);

  const barWidth=isBoss?3.0:1.45;
  const barBack=new THREE.Mesh(new THREE.PlaneGeometry(barWidth,.09),new THREE.MeshBasicMaterial({color:0x060708,transparent:true,opacity:.9,side:THREE.DoubleSide}));
  const bar=new THREE.Mesh(new THREE.PlaneGeometry(barWidth,.09),new THREE.MeshBasicMaterial({color:isBoss?0xff5a60:data.type==='shooter'?0x74b8ff:data.type==='kidnapper'?0xff63dd:0xcdfde4,side:THREE.DoubleSide}));
  const hpGroup=new THREE.Group(); bar.position.x=-barWidth/2; hpGroup.add(barBack,bar); hpGroup.position.y=isBoss?5.2:3.62; root.add(hpGroup);
  const detailParts=root.children.filter(ch=>ch!==ring&&ch!==hpGroup);
  const capsuleGroup=new THREE.Group();
  const capMat=new THREE.MeshStandardMaterial({color:style.body,roughness:1,metalness:0,emissive:style.eye,emissiveIntensity:.14});
  const cap=new THREE.Mesh(new THREE.CapsuleGeometry(.52,isBoss?1.15:1.0,5,8),capMat); cap.position.y=isBoss?1.7:1.55; capsuleGroup.add(cap);
  const capBand=new THREE.Mesh(new THREE.TorusGeometry(.36,.045,6,14),new THREE.MeshBasicMaterial({color:style.eye,transparent:true,opacity:.8})); capBand.rotation.x=Math.PI/2; capBand.position.set(0,cap.position.y+.25,.43); capsuleGroup.add(capBand);
  capsuleGroup.visible=false; root.add(capsuleGroup);
  root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
  entities.add(root);
  return {root,torso,head,armL,armR,legL,legR,ring,bar,hpGroup,hp:data.hp,maxHp:data.maxHp,type:data.type,phase:Math.random()*20,spawnT:0,spawnDuration:isBoss?2.6:1.35,baseScale:style.scale,spawnStyle:data.spawnStyle||'floor',spawnSocket:data.spawnSocket||null,radius:data.radius||(isBoss?2.0:data.type==='tank'?.95:data.type==='dog'?1.3:.72),gun,kidnapper:false,dog:false,detailParts,capsuleGroup};
}

function weaponDef(type){
  return {
    fists:{name:'PUÑOS',slot:1,damage:15,cooldown:CONFIG.punchCooldown,range:3.45,color:'#dffbff'},
    pistol:{name:'PISTOLA',slot:2,damage:30,cooldown:CONFIG.weaponFireCooldown.pistol,range:CONFIG.weaponRange.pistol,color:'#bde5ff',magSize:12,reserveMax:36,reload:0.95},
    shotgun:{name:'ESCOPETA',slot:2,damage:80,cooldown:CONFIG.weaponFireCooldown.shotgun,range:CONFIG.weaponRange.shotgun,color:'#ffd68c',magSize:8,reserveMax:24,reload:1.35},
    rifle:{name:'RIFLE DE ASALTO',slot:2,damage:20,cooldown:CONFIG.weaponFireCooldown.rifle,range:CONFIG.weaponRange.rifle,color:'#8fffcf',magSize:30,reserveMax:120,reload:1.55}
  }[type]||null;
}
function updateInventoryUi(){
  for(let i=1;i<=3;i++){
    const el=slotEls[i]; if(!el) continue;
    const type=inventory[i];
    el.classList.toggle('active', type===currentWeapon);
    el.classList.toggle('locked', !type);
    const nameEl=el.querySelector('.slot-name'); const keyEl=el.querySelector('.slot-key'); const priceEl=el.querySelector('.slot-price');
    keyEl.textContent=String(i); nameEl.textContent=type?slotNames[type]:'VACÍO'; priceEl.textContent=type?slotMeta[type]:'—';
  }
  if(weaponHud) weaponHud.textContent=`ARMA: ${slotNames[currentWeapon]}`;
  if(shopPistol) shopPistol.disabled = inventory[2]==='pistol'||inventory[3]==='pistol';
  if(shopShotgun) shopShotgun.disabled = inventory[2]==='shotgun'||inventory[3]==='shotgun';
  if(shopRifle) shopRifle.disabled = inventory[2]==='rifle'||inventory[3]==='rifle';
  updateAmmoUi();
}
function updateAmmoUi(){
  if(!ammoHud) return;
  if(currentWeapon==='fists'){ ammoHud.textContent='MUNICIÓN: ∞ / ∞'; if(reloadHud) reloadHud.classList.add('hidden'); return; }
  const a=ammo[currentWeapon]||{mag:0,reserve:0};
  ammoHud.textContent=`MUNICIÓN: ${Math.max(0,a.mag)} / ${Math.max(0,a.reserve)}`;
  if(reloadHud) reloadHud.classList.toggle('hidden', !reloading);
}
function selectWeapon(type){
  const slot=Object.keys(inventory).find(k=>inventory[k]===type);
  if(!slot || reloading) return;
  currentWeapon=type; weaponFireTimer=0; updateInventoryUi(); setWeaponView(); send({type:'setWeapon',weapon:type});
}
function selectSlot(slot){ const type=inventory[slot]; if(type) selectWeapon(type); }
function createWeaponViews(){
  const root=new THREE.Group(); root.name='weaponViews'; camera.add(root);
  const gunMat=new THREE.MeshStandardMaterial({color:0x15191c,metalness:.78,roughness:.22});
  const metal2=new THREE.MeshStandardMaterial({color:0x46535b,metalness:.82,roughness:.2,emissive:0x091316,emissiveIntensity:.18});
  const wood=new THREE.MeshStandardMaterial({color:0x4b2f1e,roughness:.72,metalness:.05});
  const glow=new THREE.MeshBasicMaterial({color:0xbdefff});
  const pistol=new THREE.Group();
  const pFrame=new THREE.Mesh(new THREE.BoxGeometry(.28,.18,.72),gunMat); pFrame.position.z=-.24;
  const pSlide=new THREE.Mesh(new THREE.BoxGeometry(.25,.075,.57),metal2); pSlide.position.set(0,.09,-.25);
  const pBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.042,.046,.22,10),metal2); pBarrel.rotation.x=Math.PI/2; pBarrel.position.set(0,.02,-.66);
  const pGrip=new THREE.Mesh(new THREE.BoxGeometry(.16,.34,.2),metal2); pGrip.position.set(0,-.23,-.01); pGrip.rotation.x=-.2;
  const pTrigger=new THREE.Mesh(new THREE.TorusGeometry(.045,.016,6,10,Math.PI*1.2),glow); pTrigger.rotation.x=Math.PI/2; pTrigger.position.set(0,-.08,-.34);
  pistol.add(pFrame,pSlide,pBarrel,pGrip,pTrigger); pistol.position.set(.38,-.32,-.88); pistol.rotation.set(-.07,-.06,-.12); root.add(pistol);
  const shotgun=new THREE.Group();
  const sStock=new THREE.Mesh(new THREE.BoxGeometry(.2,.24,.62),wood); sStock.position.set(0,-.12,.16);
  const sReceiver=new THREE.Mesh(new THREE.BoxGeometry(.25,.2,.5),gunMat); sReceiver.position.set(0,.03,-.2);
  const sBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.06,.055,1.36,12),metal2); sBarrel.rotation.x=Math.PI/2; sBarrel.position.set(0,.055,-.92);
  const sPump=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.36,10),wood); sPump.rotation.x=Math.PI/2; sPump.position.set(0,-.02,-.64);
  const sSight=new THREE.Mesh(new THREE.BoxGeometry(.05,.07,.13),glow); sSight.position.set(0,.18,-.52);
  shotgun.add(sStock,sReceiver,sBarrel,sPump,sSight); shotgun.position.set(.3,-.34,-.86); shotgun.rotation.set(.02,-.06,-.1); root.add(shotgun);
  const rifle=new THREE.Group();
  const rBody=new THREE.Mesh(new THREE.BoxGeometry(.22,.2,.78),gunMat); rBody.position.z=-.16;
  const rStock=new THREE.Mesh(new THREE.BoxGeometry(.16,.17,.62),metal2); rStock.position.set(0,-.08,.3); rStock.rotation.x=.04;
  const rBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.046,.05,1.28,10),metal2); rBarrel.rotation.x=Math.PI/2; rBarrel.position.set(0,.055,-1.0);
  const rSight=new THREE.Mesh(new THREE.BoxGeometry(.07,.11,.2),metal2); rSight.position.set(0,.17,-.48);
  const rMag=new THREE.Mesh(new THREE.BoxGeometry(.13,.34,.16),metal2); rMag.position.set(0,-.24,-.02); rMag.rotation.x=-.12;
  const rMuzzle=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,6,14),glow); rMuzzle.rotation.x=Math.PI/2; rMuzzle.position.set(0,.055,-1.65);
  rifle.add(rBody,rStock,rBarrel,rSight,rMag,rMuzzle); rifle.position.set(.3,-.32,-.9); rifle.rotation.set(-.02,-.04,-.08); root.add(rifle);
  const supportRoot=new THREE.Group(); supportRoot.name='supportHand'; camera.add(supportRoot); supportRoot.position.set(.08,-.66,-.78);
  const gloveMat=new THREE.MeshStandardMaterial({color:0x17262c,metalness:.55,roughness:.34});
  const supportForearm=new THREE.Mesh(new THREE.CapsuleGeometry(.08,.48,5,8),gloveMat); supportForearm.rotation.z=-.55; supportForearm.position.set(-.16,.05,0);
  const supportFist=capsuleParts(gloveMat,.16,.2); supportFist.position.set(-.34,.1,-.12); supportFist.scale.set(1.15,.92,1.1);
  supportRoot.add(supportForearm,supportFist);
  weaponViews.set('pistol',pistol); weaponViews.set('shotgun',shotgun); weaponViews.set('rifle',rifle); weaponViews.support=supportRoot;
  for(const g of [pistol,shotgun,rifle,supportRoot]) g.visible=false;
  return root;
}
function setWeaponView(){
  for(const [k,v] of weaponViews) if(k!=='support') v.visible = k===currentWeapon && !downed && !spectatorMode;
  if(weaponViews.support) weaponViews.support.visible = currentWeapon!=='fists';
}
function fireWeaponFx(type){
  weaponRecoil=Math.min(.22,weaponRecoil+.14);
  const root=weaponViews.get(type); if(root){
    const flash=new THREE.Mesh(new THREE.SphereGeometry(.07,6,6),new THREE.MeshBasicMaterial({color:type==='shotgun'?0xffc46b:type==='rifle'?0x8fffc3:0xbde5ff,transparent:true,opacity:.9}));
    flash.position.set(0,.03,-1.58); root.add(flash);
    setTimeout(()=>{root.remove(flash);flash.geometry.dispose();flash.material.dispose();},45);
  }
  createParticleBurst(camera.position.clone().add(new THREE.Vector3(0,0,-1.3).applyQuaternion(camera.quaternion)), type==='shotgun'?0xffc46b:0x9deaff, type==='shotgun'?5:3, 3.8, .022);
}
function shootWeapon(){
  if(dead||downed||spectatorMode||!connected||paused||grabbed||currentWeapon==='fists'||reloading) return;
  if(weaponFireTimer>0) return;
  const def=weaponDef(currentWeapon); if(!def) return;
  const a=ammo[currentWeapon]||{mag:0,reserve:0};
  if(a.mag<=0){ reloadWeapon(); return; }
  weaponFireTimer=def.cooldown; fireWeaponFx(currentWeapon);
  send({type:'shoot',weapon:currentWeapon,yaw:player.yaw,pitch:player.pitch});
  if(!audioCtx) createAudio(); if(audioCtx?.state==='suspended')audioCtx.resume(); sfx(currentWeapon);
}
function reloadWeapon(){
  if(dead||downed||spectatorMode||paused||grabbed||currentWeapon==='fists'||reloading) return;
  const a=ammo[currentWeapon]; const def=weaponDef(currentWeapon);
  if(!a||!def||a.mag>=def.magSize||a.reserve<=0) return;
  send({type:'reload',weapon:currentWeapon});
}
function createParticleBurst(position, color = 0x84eaff, count = 16, speed = 7, size = .045) {
  const safeCount = lowGraphics ? Math.min(Math.floor(count * 0.55), 20) : Math.min(count, 42);
  for (let i = 0; i < safeCount; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size * random(.65, 1.35), 5, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
    mesh.position.copy(position);
    fx.add(mesh);
    const velocity = new THREE.Vector3(random(-1,1), random(-.4,1.25), random(-1,1)).normalize().multiplyScalar(random(speed * .45, speed));
    particles.push({ mesh, velocity, life: random(.25,.62), maxLife: 1 });
  }
}

function addShockwave(position, color = 0x8ceeff, start = .14, end = 2.1) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(start, start + .12, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  fx.add(ring);
  particles.push({ mesh: ring, velocity: new THREE.Vector3(), life: .48, maxLife: .48, shock: true, endScale: end / start });
}

function createRift(position, color = 0x7ce8ff) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(.38, .58, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.05, .22, 2.8, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 1.4;
  g.position.copy(position);
  g.add(ring, beam);
  fx.add(g);
  const life = .9;
  particles.push({ mesh: g, velocity: new THREE.Vector3(), life, maxLife: life, rift: true });
}

function animateBreach(id) {
  const socketInfo = breachSockets.get(id);
  if (!socketInfo || socketInfo.cooldown > 0) return;
  socketInfo.cooldown = 3.4;
  socketInfo.barrier.visible = false;
  socketInfo.glow.material.opacity = .65;
  const p = socketInfo.group.position.clone();
  p.y = 2.2;
  createParticleBurst(p, 0x87eaff, 24, 9, .045);
  addShockwave(new THREE.Vector3(p.x, .2, p.z), 0x76e7ff, .25, 2.6);
  setTimeout(() => {
    socketInfo.barrier.visible = true;
    socketInfo.glow.material.opacity = .13;
    createParticleBurst(new THREE.Vector3(p.x, 2.2, p.z), 0xb7f8ff, 10, 4, .035);
  }, 1400);
}

function createDamageNumber(position, amount, color = '#ff4646') {
  const sprite = makeTextSprite(`-${amount}`, color, 50, 1.15, .36);
  sprite.position.copy(position).add(new THREE.Vector3(random(-.12,.12), .3, random(-.12,.12)));
  fx.add(sprite);
  damageNumbers.push({ sprite, life: 1, maxLife: 1, velocity: random(.75, 1.15) });
}

function createAudio() {
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { audioCtx = null; }
}
function sfx(type) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  if (type === 'punch') {
    osc.type='triangle'; osc.frequency.setValueAtTime(145,t); osc.frequency.exponentialRampToValueAtTime(55,t+.08);
    gain.gain.setValueAtTime(.045,t); gain.gain.exponentialRampToValueAtTime(.001,t+.11);
  } else if (type === 'hit') {
    osc.type='square'; osc.frequency.setValueAtTime(230,t); osc.frequency.exponentialRampToValueAtTime(80,t+.09);
    gain.gain.setValueAtTime(.028,t); gain.gain.exponentialRampToValueAtTime(.001,t+.11);
  } else if (type === 'pistol' || type === 'rifle') {
    osc.type=type==='rifle'?'square':'triangle'; osc.frequency.setValueAtTime(type==='rifle'?125:180,t); osc.frequency.exponentialRampToValueAtTime(type==='rifle'?70:95,t+.07);
    gain.gain.setValueAtTime(type==='rifle'?.018:.025,t); gain.gain.exponentialRampToValueAtTime(.001,t+.09);
  } else if (type === 'shotgun') {
    osc.type='sawtooth'; osc.frequency.setValueAtTime(85,t); osc.frequency.exponentialRampToValueAtTime(35,t+.18);
    gain.gain.setValueAtTime(.05,t); gain.gain.exponentialRampToValueAtTime(.001,t+.22);
  } else if (type === 'boss') {
    osc.type='sawtooth'; osc.frequency.setValueAtTime(52,t); osc.frequency.linearRampToValueAtTime(26,t+.72);
    gain.gain.setValueAtTime(.075,t); gain.gain.exponentialRampToValueAtTime(.001,t+.86);
  }
  osc.start(t); osc.stop(t + (type === 'boss' ? .88 : .13));
}

function showAnnouncement(main, sub, small='SISTEMA DE COMBATE', duration=3.2) {
  announcementSmall.textContent = small;
  announcementMain.textContent = main;
  announcementSub.textContent = sub;
  announcement.classList.remove('hidden');
  announcement.style.animation='none';
  void announcement.offsetWidth;
  announcement.style.animation='';
  messageTimer = duration;
}

function waveAnnouncement(number, boss=false) {
  if (boss) {
    showAnnouncement(`RONDA ${number}`, number===10 ? 'EL COLOSO VOLVIÓ. DERROTALO Y CORRÉ AL TREN.' : 'EL COLOSO despertó. Trescientos HP. Quince de daño.', number===10 ? 'AMENAZA // PROTOCOLO DE ESCAPE' : 'AMENAZA MÁXIMA', 4.7);
    sfx('boss');
  } else {
    const texts = [
      'LA OSCURIDAD SE MUEVE',
      'SE ESCUCHAN PASOS',
      'CORREN ENTRE LAS COLUMNAS',
      'NO HAY SALIDA',
      'EL SALÓN YA NO ES TUYO'
    ];
    showAnnouncement(`RONDA ${number}`, texts[(number - 1) % texts.length], 'TRANSMISIÓN DE SUPERVIVENCIA', 3.5);
  }
}

function updateAnnouncement(dt) {
  if (messageTimer <= 0) { announcement.classList.add('hidden'); return; }
  messageTimer -= dt;
  if (messageTimer <= .45) announcement.style.opacity = String(Math.max(0, messageTimer / .45));
  else announcement.style.opacity = '1';
}

function updateHud(enemyCount = enemyMeshes.size) {
  hpText.textContent = `${Math.ceil(localHp)} / ${CONFIG.maxHp}`;
  hpFill.style.width = `${clamp(localHp / CONFIG.maxHp, 0, 1) * 100}%`;
  staminaText.textContent = `${Math.round(localStamina)}`;
  staminaFill.style.width = `${clamp(localStamina / CONFIG.staminaMax, 0, 1) * 100}%`;
  moneyText.textContent = `$${Math.floor(localMoney).toLocaleString('en-US')}`;
  if(shopMoney) shopMoney.textContent = `$${Math.floor(localMoney).toLocaleString('es-AR')}`;
  if(shopReadyStatus && shopActive) shopReadyStatus.textContent = shopReadyStatus.dataset.text || shopReadyStatus.textContent;
  waveText.textContent = mapId==='train' ? `TREN · RONDA ${wave}` : `RONDA ${wave}`;
  if(downed && !spectatorMode){ deathText.textContent=`REANIMACIÓN EN ${Math.ceil(downedRemaining)}s · MANTENÉTE EN MOVIMIENTO`; }
  if(escapeWrap) escapeWrap.classList.toggle('hidden', !escapeActive);
  if(escapeTimerEl) escapeTimerEl.textContent = `${Math.max(0,Math.ceil(escapeRemaining))}s`;
  if(weaponHud) weaponHud.textContent = `ARMA: ${slotNames[currentWeapon]}`;
  enemyText.textContent = `AMENAZAS: ${enemyCount}`;
  playersEl.textContent = playersEl.textContent || 'JUGADORES: 1';
  playerNameHud.textContent = playerName;

  let boss = null;
  for (const e of enemyMeshes.values()) if (e.type === 'boss') { boss = e; break; }
  if (boss) {
    bossWrap.classList.remove('hidden');
    const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
    bossFill.style.width = `${ratio * 100}%`;
    bossHpText.textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
  } else {
    bossWrap.classList.add('hidden');
  }
}

function startOfflineMode(reason='') {
  if (offlineSim) return;
  isOffline = true;
  connected = true;
  statusEl.textContent = reason ? `MODO SOLITARIO · ${reason}` : 'MODO SOLITARIO · APP LOCAL';
  offlineSim = createOfflineSim({
    emit: handleServer,
    getPlayer: () => ({
      x: player.position.x,
      y: player.groundY + player.headHeight,
      z: player.position.z,
      yaw: player.yaw,
      pitch: player.pitch
    })
  });
  offlineSim.start();
}

function connect() {
  if (isOffline) { startOfflineMode(); return; }
  if (offlineSim) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const configuredServer = String(localStorage.getItem('capsuleServerUrl') || window.CAPSULE_SERVER_URL || '').trim();
  const sameOriginOnline = window.CAPSULE_ONLINE === true && !configuredServer;
  if (!configuredServer && !sameOriginOnline) {
    startOfflineMode();
    return;
  }
  const base = configuredServer || location.host;
  const normalized = /^(wss?:\/\/)/i.test(base) ? base : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${base}`;
  const url = normalized.replace(/\/$/, '');
  statusEl.textContent = 'Conectando al escuadrón...';
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    connected = true;
    isOffline = false;
    statusEl.textContent = 'EN LÍNEA · SALÓN SEGURO';
    send({ type:'setName', name: playerName });
  }, { once: true });
  socket.addEventListener('close', () => {
    connected = false;
    if (window.CAPSULE_ONLINE === true && !isOffline) {
      statusEl.textContent = 'SERVIDOR OFFLINE · REINTENTANDO...';
      setTimeout(() => { if (!connected && gameInitialized && !isOffline) connect(); }, 2500);
    } else if (!isOffline) {
      statusEl.textContent = 'CONEXIÓN PERDIDA';
    }
  });
  socket.addEventListener('error', () => {
    if (window.CAPSULE_ONLINE === true) statusEl.textContent = 'NO SE PUDO CONECTAR AL SERVIDOR';
    else if (!isOffline) startOfflineMode('SERVIDOR NO DISPONIBLE');
  }, { once: true });
  socket.addEventListener('message', (event) => {
    try { handleServer(JSON.parse(event.data)); } catch (err) { console.warn('Paquete inválido', err); }
  });
}

function send(payload) {
  if (offlineSim) { offlineSim.handle(payload); return; }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function hydratePlayers(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    if (p.id === myId) continue;
    let view = remotePlayers.get(p.id);
    if (!view) { view = createRemotePlayer(p); remotePlayers.set(p.id, view); }
    view.target.set(p.x, Math.max(0, (p.y ?? 1.6) - 1.6), p.z);
    view.targetYaw = p.yaw || 0;
    view.lastHp = p.hp;
    const newName = p.name || 'CAPSULE';
    if (view.name !== newName) {
      if (view.nameTag) {
        view.root.remove(view.nameTag);
        view.nameTag.material.map?.dispose?.();
        view.nameTag.material.dispose();
      }
      view.name = newName;
      view.nameTag = makeTextSprite(newName, '#bff4ff', 34, 1.8, .42);
      view.nameTag.position.set(0, 3.15, 0);
      view.root.add(view.nameTag);
    }
    view.root.visible = !p.dead || p.downed; view.downed=!!p.downed; view.spectator=!!p.spectator; view.root.position.y = p.downed ? -0.65 : 0;
  }
  for (const [id, view] of remotePlayers) {
    if (!seen.has(id)) { entities.remove(view.root); remotePlayers.delete(id); }
  }
  playersEl.textContent = `JUGADORES: ${list.length}`;
}

function hydrateEnemies(list) {
  const seen = new Set();
  for (const e of list) {
    seen.add(e.id);
    let view = enemyMeshes.get(e.id);
    if (!view) {
      if (e.spawnStyle === 'wall' && e.spawnSocket) animateBreach(e.spawnSocket);
      else createRift(new THREE.Vector3(e.x, .06, e.z), e.type === 'boss' ? 0xff4b57 : 0x6ee5ff);
      view = createEnemyMesh(e);
      enemyMeshes.set(e.id, view);
      applyEnemyVisualQuality(view);
    }
    view.hp = e.hp;
    view.maxHp = e.maxHp;
    view.root.userData.target = new THREE.Vector3(e.x, 0, e.z);
    view.root.userData.serverY = 0;
    updateEnemyBar(view);
  }
  for (const [id, view] of enemyMeshes) {
    if (!seen.has(id)) { entities.remove(view.root); enemyMeshes.delete(id); }
  }
}

function updateEnemyBar(view) {
  view.bar.scale.x = clamp(view.hp / view.maxHp, 0.001, 1);
}

function handleServer(msg) {
  if (msg.type === 'welcome') {
    myId = msg.id;
    wave = msg.wave;
    waveState = msg.waveState;
    mapId = msg.mapId || 'hall';
    escapeActive = !!msg.escapeActive;
    escapeRemaining = msg.escapeRemaining || 0;
    hallGateOpen = !!msg.gateOpen;
    if(msg.shopReadyCount!=null) updateShopReadyUi(msg.shopReadyCount,msg.shopReadyTotal||msg.playerCount||1,msg.shopReadySelf);
    setHallEntryDoorOpen(hallGateOpen); if(escapeActive) setEscapeGateOpen(true); else setEscapeGateOpen(false);
    if(escapeWrap) escapeWrap.classList.toggle('hidden', !escapeActive);
    localHp = msg.you.hp ?? 100;
    localMoney = msg.you.money ?? 0;
    inventory = {1:'fists',2:msg.you.inventory?.[0]||null,3:msg.you.inventory?.[1]||null};
    currentWeapon = msg.you.weapon || 'fists';
    ammo = msg.you.ammo || ammo;
    reloading = false; reloadRemaining = 0;
    updateInventoryUi(); setWeaponView();
    if (msg.you) {
      player.position.set(msg.you.x, 0, msg.you.z);
      player.groundY = Math.max(0, (msg.you.y ?? CONFIG.eyeHeight) - CONFIG.eyeHeight);
      player.verticalVelocity = 0; player.grounded = true;
      player.targetYaw = msg.you.yaw ?? 0;
      player.yaw = player.targetYaw;
      player.targetPitch = 0;
      player.pitch = 0;
    }
    if (msg.me?.name) playerName = msg.me.name;
    hydratePlayers(msg.players || []);
    hydrateEnemies(msg.enemies || []);
    if(mapId==='train') createTrainMap();
    playersEl.textContent = `JUGADORES: ${msg.playerCount || 1}`;
    if(waveState==='shop'){ shopActive=true; shopRemaining=msg.shopRemaining||20; paused=true; if(document.pointerLockElement)document.exitPointerLock(); shopOverlay.classList.remove('hidden'); updateShopUi(); }
    return;
  }
  if(msg.type==='escapeStart'){ escapeActive=true; escapeRemaining=msg.duration||60; waveState='escape'; setEscapeGateOpen(true); if(escapeWrap)escapeWrap.classList.remove('hidden'); showAnnouncement('¡CORRE AL TREN!', '¡LA COMPUERTA ESTÁ ABIERTA! LLEGÁ A LA ESTACIÓN.', 'ALARMA // 60 SEGUNDOS', 4.8); if(!audioCtx)createAudio(); sfx('boss'); return; }
  if(msg.type==='escapeState'){ escapeRemaining=msg.remaining||0; if(escapeWrap)escapeWrap.classList.remove('hidden'); return; }
  if(msg.type==='mapChange'){ mapId=msg.mapId||'train'; hallGateOpen=true; setHallEntryDoorOpen(true); escapeActive=false; escapeRemaining=0; if(escapeWrap)escapeWrap.classList.add('hidden'); wave=msg.wave||wave; downed=false; dead=false; spectatorMode=false; for(const v of enemyMeshes.values()) entities.remove(v.root); enemyMeshes.clear(); for(const pr of projectiles) removeClientProjectile(pr); projectiles.length=0; player.position.set(msg.x||0,0,msg.z||22); createTrainMap(); updateHud(); return; }
  if(msg.type==='gateState'){ hallGateOpen=!!msg.open; setHallEntryDoorOpen(hallGateOpen); return; }
  if(msg.type==='shopReadyState'){ updateShopReadyUi(msg.readyCount,msg.activeCount,msg.selfReady); return; }
  if(msg.type==='shopSkipped'){ shopRemaining=0; if(shopStatus)shopStatus.textContent='Todos listos. Iniciando próxima oleada...'; return; }
  if(msg.type==='trainIntro'){ showAnnouncement('TREN EN MARCHA','Las puertas se cerraron. No hay vuelta atrás.','MAPA 2',4.2); return; }
  if(msg.type==='victory'){ victoryShown=true; paused=true; if(document.pointerLockElement) document.exitPointerLock(); if(victoryStats) victoryStats.textContent=`BAJAS TOTALES: ${msg.killsTotal||0} · DINERO OBTENIDO: $${Number(msg.moneyTotal||0).toLocaleString('es-AR')}`; victoryOverlay.classList.remove('hidden'); return; }
  if (msg.type === 'shopStart') {
    waveState='shop'; shopActive=true; shopRemaining=msg.duration||20; paused=true; if(document.pointerLockElement)document.exitPointerLock();
    shopReady=false; if(shopReadyBtn){shopReadyBtn.disabled=false;shopReadyBtn.classList.remove('is-ready');shopReadyBtn.textContent='✓ LISTO / OMITIR TIENDA';} if(shopReadyStatus)shopReadyStatus.textContent='0 / 1 jugadores listos';
    shopOverlay.classList.remove('hidden'); shopStatus.textContent='Comprá armas con el dinero ganado.'; updateShopUi();
    showAnnouncement('ARSENAL ABIERTO', 'Tenés 20 segundos antes de la próxima ronda.', 'VENTANA DE COMPRA', 3.2);
    return;
  }
  if (msg.type === 'waveStart') {
    shopActive=false; shopOverlay.classList.add('hidden'); paused=false;
    wave = msg.wave;
    waveState = 'active';
    waveAnnouncement(msg.wave, msg.boss);
    return;
  }
  if (msg.type === 'waveClear') {
    waveState = msg.shop ? 'shop' : 'intermission';
    showAnnouncement(msg.wave === 5 ? 'EL COLOSO CAÍDO' : 'OLEADA NEUTRALIZADA', msg.wave === 5 ? 'La sala vuelve a respirar... por unos segundos.' : 'Siguiente ronda en seis segundos.', 'SALA DESPEJADA', 3.4);
    return;
  }
  if (msg.type === 'spawnFx') {
    if (msg.style === 'wall') animateBreach(msg.socket);
    else createRift(new THREE.Vector3(msg.x, .06, msg.z), msg.enemyType === 'boss' ? 0xff4b57 : 0x6ee5ff);
    return;
  }
  if (msg.type === 'shopState') { shopRemaining=msg.remaining||0; shopCountdown.textContent=Math.ceil(shopRemaining); updateShopUi(); return; }
  if (msg.type === 'purchase') {
    if(msg.ok){ localMoney=msg.money; inventory={1:'fists',2:msg.inventory?.[0]||null,3:msg.inventory?.[1]||null}; currentWeapon=msg.weapon||currentWeapon; ammo=msg.ammo||ammo; reloading=false; updateInventoryUi(); setWeaponView(); shopStatus.textContent=`Compraste ${slotNames[msg.weapon]}.`; }
    else shopStatus.textContent=msg.reason||'Compra rechazada.'; updateHud(); return;
  }
  if (msg.type === 'weaponSet') { currentWeapon=msg.weapon||'fists'; updateInventoryUi(); setWeaponView(); return; }
  if (msg.type === 'shotFired') { if(msg.weapon && msg.ammo) ammo[msg.weapon]=msg.ammo; updateAmmoUi(); return; }
  if (msg.type === 'reloadStart') { reloading=true; reloadDuration=msg.duration||1.1; reloadRemaining=reloadDuration; weaponFireTimer=Math.max(weaponFireTimer,reloadDuration); updateAmmoUi(); return; }
  if (msg.type === 'reloadComplete') { reloading=false; reloadRemaining=0; if(msg.weapon) ammo[msg.weapon]=msg.ammo||ammo[msg.weapon]; updateAmmoUi(); return; }
  if (msg.type === 'reloadReject') { reloading=false; reloadRemaining=0; shopStatus.textContent=msg.reason||'No se puede recargar.'; updateAmmoUi(); return; }
  if(msg.type==='soloRespawn'){
    localHp=msg.hp||100; downed=false; dead=false; spectatorMode=false; grabbed=false; spectatorTargetId=null; hideDownedUi();
    player.position.set(msg.x||0,0,msg.z||52.5); player.groundY=0; player.verticalVelocity=0; player.grounded=true;
    return;
  }
  if (msg.type === 'damage') {
    localHp = msg.hp;
    lastServerDamage = performance.now() / 1000;
    shake = .2;
    hurtFlash = .28;
    if (msg.downed) { downed=true; downedRemaining=15; showDownedUi(); }
    sfx('hit');
    updateHud();
    return;
  }
  if(msg.type==='downed'){ downed=true; downedRemaining=msg.duration||15; showDownedUi(); localHp=0; return; }
  if(msg.type==='beingRevived'){ showAnnouncement('REANIMACIÓN','Un aliado te está levantando.','MANTENETE CERCA',2.2); return; }
  if(msg.type==='reviveCancel'){ reviveTargetId=null; return; }
  if(msg.type==='revived'){ downed=false; downedRemaining=0; localHp=msg.hp||50; hideDownedUi(); showAnnouncement('REANIMADO','Volviste al combate con 50 HP.','ESCUDERO EN LÍNEA',2.5); return; }
  if(msg.type==='spectatorStart'){ startSpectator(); return; }
  if(msg.type==='reviveStart'){ reviveTargetId=msg.targetId; reviveHold=true; return; }
  if(msg.type==='reviveComplete'){ showAnnouncement('ALIADO REANIMADO','Volvió al combate con 50 HP.','RESCATE EXITOSO',2.0); reviveTargetId=null; return; }
  if (msg.type === 'respawn' || msg.type==='roundRespawn') {
    dead = false; spectatorMode=false; downed=false; downedRemaining=0; grabbed=false; qteOverlay.classList.add('hidden');
    deathOverlay.classList.add('hidden');
    localHp = 100;
    reloading=false; reloadRemaining=0; updateAmmoUi();
    player.position.set(msg.x, 0, msg.z);
    player.groundY = 0; player.verticalVelocity = 0; player.grounded = true;
    player.velocity.set(0,0,0);
    hideDownedUi();
    if(msg.mapId && msg.mapId!==mapId){mapId=msg.mapId; if(mapId==='train')createTrainMap();}
    showAnnouncement('REACTIVACIÓN', mapId==='train' ? 'Nuevo asalto. Aguantá en el tren.' : 'Volviste al exterior. Volvé a cruzar la puerta.', 'SISTEMA', 2.6);
    return;
  }
  if (msg.type === 'nameSet') {
    playerName = msg.name;
    localStorage.setItem('capsuleName', playerName);
    playerNameHud.textContent = playerName;
    return;
  }
  if (msg.type === 'projectile') {
    const p={id:msg.id,position:new THREE.Vector3(msg.x,msg.y,msg.z),previous:new THREE.Vector3(msg.x,msg.y,msg.z),velocity:new THREE.Vector3(msg.vx,msg.vy,msg.vz),gravity:msg.gravity ?? CONFIG.bulletGravity,life:msg.life ?? 1.2,maxLife:msg.life ?? 1.2,color:msg.color ?? 0xffd369,mesh:null,trail:null};
    createClientProjectileMesh(p); projectiles.push(p); return;
  }
  if (msg.type === 'projectileImpact') {
    const pIndex=projectiles.findIndex(p=>p.id===msg.id);
    if(pIndex>=0){ removeClientProjectile(projectiles[pIndex]); projectiles.splice(pIndex,1); }
    createParticleBurst(new THREE.Vector3(msg.x,msg.y,msg.z), msg.hit ? 0xff8d65 : 0xa8efff, msg.hit ? 12 : 6, msg.hit ? 5.8 : 3.2, .028);
    if(msg.hit) addShockwave(new THREE.Vector3(msg.x,.05,msg.z),0xffa06a,.1,.75); return;
  }
  if (msg.type === 'grabStart') {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    paused=false;
    grabbed=true; qteHits=0; qteDeadline=performance.now()+4500; qteOverlay.classList.remove('hidden'); qteStatus.textContent='¡SOLTATE!'; moveQteTarget(); return;
  }
  if (msg.type === 'grabRelease') {
    grabbed=false; qteOverlay.classList.add('hidden'); qteStatus.textContent=msg.rescued?'RESCATADO':'LIBERADO'; paused=false; return;
  }
  if (msg.type === 'enemyHit') {
    const e = enemyMeshes.get(msg.id);
    const pos = new THREE.Vector3(msg.x ?? 0, msg.y ?? 2.2, msg.z ?? 0);
    if (e) {
      e.hp = msg.hp;
      updateEnemyBar(e);
      pos.copy(e.root.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, e.type === 'boss' ? 3.0 : 2.7, 0));
      createParticleBurst(pos, e.type === 'boss' ? 0xff646a : 0xffd166, 8, 4.2, .032);
    }
    if (msg.attackerId === myId) {
      createDamageNumber(pos, msg.damage ?? 15, e?.type === 'boss' ? '#ffd166' : '#ff4b4b');
      sfx('hit');
      recoil = Math.min(.16, recoil + .1);
      shake = Math.max(shake, .05);
    }
    return;
  }
  if (msg.type === 'enemyKilled') {
    const e = enemyMeshes.get(msg.id);
    const pos = e ? e.root.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(msg.x || 0, 1, msg.z || 0);
    createParticleBurst(pos, msg.enemyType === 'boss' ? 0xff4d54 : 0x85f2d5, msg.enemyType === 'boss' ? 44 : 18, msg.enemyType === 'boss' ? 10 : 7, msg.enemyType === 'boss' ? .08 : .045);
    addShockwave(new THREE.Vector3(pos.x, .05, pos.z), msg.enemyType === 'boss' ? 0xff5960 : 0x8defff, .18, msg.enemyType === 'boss' ? 4 : 2.2);
    if (e) { entities.remove(e.root); enemyMeshes.delete(msg.id); }
    if (msg.killerId === myId) {
      localMoney = msg.money ?? (localMoney + (msg.reward ?? 100));
      showKillToast(msg.reward ?? 100, msg.enemyType === 'boss');
    }
    return;
  }
  if (msg.type === 'state') {
    wave = msg.wave;
    waveState = msg.waveState;
    mapId = msg.mapId || 'hall';
    escapeActive = !!msg.escapeActive;
    escapeRemaining = msg.escapeRemaining || 0;
    hallGateOpen = !!msg.gateOpen;
    if(msg.shopReadyCount!=null) updateShopReadyUi(msg.shopReadyCount,msg.shopReadyTotal||msg.playerCount||1,msg.shopReadySelf);
    setHallEntryDoorOpen(hallGateOpen); if(escapeActive) setEscapeGateOpen(true); else setEscapeGateOpen(false);
    if(escapeWrap) escapeWrap.classList.toggle('hidden', !escapeActive);
    if(waveState==='shop') shopRemaining=msg.shopRemaining||shopRemaining||20;
    if(waveState==='shop' && !shopActive){ shopActive=true; shopRemaining=msg.shopRemaining||20; paused=true; if(document.pointerLockElement)document.exitPointerLock(); shopOverlay.classList.remove('hidden'); }
    if(waveState!=='shop' && shopActive && waveState==='active'){ shopActive=false; shopOverlay.classList.add('hidden'); paused=false; }
    hydratePlayers(msg.players || []);
    hydrateEnemies(msg.enemies || []);
    playersEl.textContent = `JUGADORES: ${msg.playerCount || 1}`;
    const mine = msg.players?.find(p => p.id === myId);
    if (mine) {
      localHp = mine.hp;
      localMoney = mine.money ?? localMoney;
      grabbed = !!mine.grabbed;
      const wasSpectator = spectatorMode;
      downed=!!mine.downed; downedRemaining=mine.downedRemaining||0;
      if(downed) showDownedUi(); else if(!mine.spectator) hideDownedUi();
      if(mine.spectator && !wasSpectator) startSpectator(); else spectatorMode=!!mine.spectator;
      inventory = {1:'fists',2:mine.inventory?.[0]||null,3:mine.inventory?.[1]||null};
      currentWeapon = mine.weapon || currentWeapon; ammo = mine.ammo || ammo; reloading = !!mine.reloading; reloadRemaining = mine.reloadRemaining || 0; updateInventoryUi(); setWeaponView();
    }
    return;
  }
  if (msg.type === 'playerJoin') {
    playersEl.textContent = `JUGADORES: ${msg.playerCount}`;
    if (msg.id !== myId) showAnnouncement('NUEVO ESCUADRÓN', `${msg.name || 'Un CAPSULE'} entró al salón.`, 'MULTIJUGADOR', 2.3);
    return;
  }
  if (msg.type === 'playerLeave') {
    playersEl.textContent = `JUGADORES: ${msg.playerCount}`;
    return;
  }
  if(msg.type==='squadWipe'){ showAnnouncement('ESCUADRÓN CAÍDO','Todos quedaron fuera de combate. Nueva ronda en 3 segundos.','PROTOCOLO DE REINICIO',3.0); return; }
}

let killToastTimer = 0;
let killToastAmount = 0;
function showKillToast(amount, boss=false) {
  killToastTimer = 1.2;
  killToastAmount = amount;
  if (boss) showAnnouncement('COLOSO HERIDO', `+ $${amount}`, 'GOLPE FINAL', 1.6);
}


function showDownedUi(){
  deathOverlay.classList.remove('hidden');
  const card=deathOverlay.querySelector('.death-card');
  if(card) card.classList.add('downed-card');
  const kicker=deathOverlay.querySelector('.death-kicker'); if(kicker) kicker.textContent='PROTOCOLO DE EMERGENCIA';
  const title=deathOverlay.querySelector('h1'); if(title) title.textContent='DERIVADO // DERRIBADO';
  deathText.textContent=`REANIMACIÓN EN ${Math.ceil(downedRemaining||15)}s · MANTENÉTE EN MOVIMIENTO`;
}
function hideDownedUi(){
  const card=deathOverlay.querySelector('.death-card'); if(card) card.classList.remove('downed-card');
  deathOverlay.classList.add('hidden');
}
function startSpectator(){
  downed=false; spectatorMode=true; dead=true; grabbed=false; spectatorTargetId=null; qteOverlay.classList.add('hidden');
  deathOverlay.classList.remove('hidden');
  const title=deathOverlay.querySelector('h1'); if(title) title.textContent='MODO ESPECTADOR';
  const kicker=deathOverlay.querySelector('.death-kicker'); if(kicker) kicker.textContent='SEÑAL PERDIDA';
  deathText.textContent='Siguiendo a un aliado. Reaparecés al inicio de la próxima ronda.';
  if(document.pointerLockElement)document.exitPointerLock();
}
function getNearestDownedAlly(){
  let best=null,bestD=3.4*3.4;
  for(const view of remotePlayers.values()){
    if(!view.downed||!view.root.visible)continue;
    const dx=player.position.x-view.root.position.x,dz=player.position.z-view.root.position.z; const d=dx*dx+dz*dz;
    if(d<bestD){bestD=d;best=view;}
  }
  return best;
}
function updateReviveInput(){
  if(!reviveHold||spectatorMode||downed||dead)return;
  const target=getNearestDownedAlly();
  if(target){const id=[...remotePlayers.entries()].find(([,v])=>v===target)?.[0]; if(id&&id!==reviveTargetId){reviveTargetId=id;send({type:'reviveStart',targetId:id});}}
  else if(reviveTargetId){send({type:'reviveStop',targetId:reviveTargetId});reviveTargetId=null;}
}
function updateSpectator(dt){
  const alive=[...remotePlayers.entries()].filter(([,v])=>v.root.visible&&!v.downed&&!v.spectator);
  if(!alive.length){ camera.position.lerp(new THREE.Vector3(0,4.5,8),1-Math.exp(-dt*3)); return; }
  if(!spectatorTargetId || !alive.some(([id])=>id===spectatorTargetId)) spectatorTargetId=alive[0][0];
  const target=remotePlayers.get(spectatorTargetId);
  if(!target) return;
  spectatorOrbit=damp(spectatorOrbit,target.root.rotation.y,4,dt);
  const backOffset=new THREE.Vector3(0,3.35,6.4).applyAxisAngle(new THREE.Vector3(0,1,0),spectatorOrbit);
  const targetWorld=target.root.position.clone().add(new THREE.Vector3(0,1.45,0));
  const desired=targetWorld.clone().add(backOffset);
  camera.position.lerp(desired,1-Math.exp(-dt*5.5));
  camera.lookAt(targetWorld);
  camera.rotation.z=damp(camera.rotation.z,0,8,dt);
  const arms=camera.getObjectByName('localArms'); if(arms)arms.visible=false;
}
function setDead() {
  dead = true; spectatorMode=true;
  deathOverlay.classList.remove('hidden');
  deathText.textContent = 'Reaparición automática en 3 segundos...';
}

function enforcePlayerCollisions() {
  for (const c of floorColliders) {
    if (c.type === 'rect') {
      const left = c.x - c.halfX, right = c.x + c.halfX, top = c.z - c.halfZ, bottom = c.z + c.halfZ;
      const qx = clamp(player.position.x, left, right), qz = clamp(player.position.z, top, bottom);
      let dx = player.position.x - qx, dz = player.position.z - qz, d = Math.hypot(dx, dz);
      if (d < CONFIG.playerRadius) {
        if (d < 0.0001) {
          const pushLeft = player.position.x - left, pushRight = right - player.position.x, pushTop = player.position.z - top, pushBottom = bottom - player.position.z;
          const m = Math.min(pushLeft, pushRight, pushTop, pushBottom);
          if (m === pushLeft) dx=-1, dz=0;
          else if (m === pushRight) dx=1, dz=0;
          else if (m === pushTop) dx=0, dz=-1;
          else dx=0, dz=1;
          d=1;
        }
        const push=(CONFIG.playerRadius-d)/d; player.position.x += dx*push; player.position.z += dz*push;
      }
    } else {
      const dx = player.position.x - c.x, dz = player.position.z - c.z, d = Math.hypot(dx, dz);
      const min = c.radius + CONFIG.playerRadius;
      if (d > 0.001 && d < min) { const push=(min-d)/d; player.position.x += dx*push; player.position.z += dz*push; }
    }
  }

  // Enemy capsules never visually overlap the player.
  for (const e of enemyMeshes.values()) {
    const t = e.root.userData.target;
    if (!t) continue;
    const dx = player.position.x - t.x;
    const dz = player.position.z - t.z;
    const d = Math.hypot(dx, dz);
    const min = CONFIG.playerRadius + e.radius * .72;
    if (d > 0.001 && d < min) {
      const push = (min - d) / d;
      player.position.x += dx * push;
      player.position.z += dz * push;
    }
  }
}

function playerInput(dt) {
  if ((dead && !spectatorMode) || paused || !connected) return;
  if (weaponFireTimer > 0) weaponFireTimer -= dt;
  if (grabbed) {
    player.velocity.x = damp(player.velocity.x, 0, 20, dt); player.velocity.z = damp(player.velocity.z, 0, 20, dt);
    camera.position.set(player.position.x, player.groundY + player.headHeight, player.position.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    if(performance.now()/1000-lastNetTime>.08){lastNetTime=performance.now()/1000;send({type:'state',x:player.position.x,y:player.groundY + player.headHeight,z:player.position.z,yaw:player.yaw,pitch:player.pitch});}
    return;
  }
  if(spectatorMode){ updateSpectator(dt); return; }
  if(downed){
    const forwardDown=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
    const rightDown=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
    const crawl=new THREE.Vector3();
    if(keys.has('KeyW'))crawl.add(forwardDown); if(keys.has('KeyS'))crawl.sub(forwardDown); if(keys.has('KeyA'))crawl.sub(rightDown); if(keys.has('KeyD'))crawl.add(rightDown);
    if(crawl.lengthSq()>0)crawl.normalize();
    const crawlSpeed=1.25; const desired=crawl.multiplyScalar(crawlSpeed); player.velocity.x=damp(player.velocity.x,desired.x,12,dt); player.velocity.z=damp(player.velocity.z,desired.z,12,dt);
    player.position.x=clamp(player.position.x+player.velocity.x*dt,mapId==='train'?-4.7:-41,mapId==='train'?4.7:41);
    player.position.z=clamp(player.position.z+player.velocity.z*dt,mapId==='train'? -28 : (escapeActive ? -52 : -41),mapId==='train'?28:56);
    player.headHeight=damp(player.headHeight,0.88,12,dt); camera.position.set(player.position.x,player.groundY+player.headHeight,player.position.z); camera.rotation.set(player.pitch,player.yaw,0,'YXZ');
    if(performance.now()/1000-lastNetTime>.08){lastNetTime=performance.now()/1000;send({type:'state',x:player.position.x,y:player.groundY+player.headHeight,z:player.position.z,yaw:player.yaw,pitch:player.pitch});}
    return;
  }
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(forward);
  if (keys.has('KeyS')) move.sub(forward);
  if (keys.has('KeyA')) move.sub(right);
  if (keys.has('KeyD')) move.add(right);
  if (move.lengthSq() > 0) move.normalize();

  player.crouch = keys.has('ControlLeft') || keys.has('ControlRight');
  const wantSprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  player.sprint = wantSprint && !player.crouch && move.lengthSq() > 0 && localStamina > 2;
  if (player.sprint) localStamina = Math.max(0, localStamina - CONFIG.staminaDrain * dt);
  else localStamina = Math.min(CONFIG.staminaMax, localStamina + CONFIG.staminaRegen * dt);

  if (jumpQueued && player.grounded && !player.crouch) { player.verticalVelocity = CONFIG.jumpVelocity; player.grounded = false; }
  jumpQueued = false;
  player.verticalVelocity -= CONFIG.gravity * dt;
  player.groundY += player.verticalVelocity * dt;
  if (player.groundY <= 0) { player.groundY = 0; player.verticalVelocity = 0; player.grounded = true; }

  const speed = player.crouch ? CONFIG.crouchSpeed : player.sprint ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
  const desired = move.multiplyScalar(speed);
  const accel = move.lengthSq() > 0 ? 18 : 24;
  player.velocity.x = damp(player.velocity.x, desired.x, accel, dt);
  player.velocity.z = damp(player.velocity.z, desired.z, accel, dt);

  player.position.x += player.velocity.x * dt;
  player.position.z += player.velocity.z * dt;
  if(mapId==='hall' && !hallGateOpen){
    player.position.x = clamp(player.position.x, -18, 18);
    player.position.z = clamp(player.position.z, 44.15, CONFIG.outsideSpawnZ + 3.2);
  } else {
    player.position.x = clamp(player.position.x, CONFIG.safeMinX, CONFIG.safeMaxX);
    const escapeMinZ = escapeActive ? -52 : -CONFIG.safeMaxZ;
    player.position.z = clamp(player.position.z, escapeMinZ, CONFIG.outsideSpawnZ + 3.2);
  }
  enforcePlayerCollisions();

  player.yaw = damp(player.yaw, player.targetYaw, 22, dt);
  player.pitch = damp(player.pitch, player.targetPitch, 22, dt);
  const targetHeight = player.crouch ? CONFIG.crouchHeight : CONFIG.eyeHeight;
  player.headHeight = damp(player.headHeight, targetHeight, 13, dt);
  const targetFov = player.sprint ? CONFIG.sprintFov : player.crouch ? CONFIG.crouchFov : CONFIG.normalFov;
  camera.fov = damp(camera.fov, targetFov, 10, dt);
  camera.position.set(player.position.x, player.groundY + player.headHeight, player.position.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  camera.updateProjectionMatrix();

  const speedPct = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / CONFIG.sprintSpeed);
  player.bobSpeed = damp(player.bobSpeed, speedPct, 9, dt);
  if (player.bobSpeed > .08) player.bob += dt * (6 + player.bobSpeed * 7);

  if (punchTimer > 0) punchTimer -= dt;
  recoil = damp(recoil, 0, 15, dt);

  if (!entranceSeen && player.position.z < 43) {
    entranceSeen = true;
    showAnnouncement('PUERTA CERRADA', 'La única salida quedó detrás de vos.', 'ENTRADA AL SALÓN', 2.8);
  }

  if (performance.now() / 1000 - lastNetTime > .05) {
    lastNetTime = performance.now() / 1000;
    send({ type:'state', x:player.position.x, y:player.groundY + player.headHeight, z:player.position.z, yaw:player.yaw, pitch:player.pitch });
  }
}

function punch() {
  if (dead || downed || spectatorMode || !connected || punchTimer > 0) return;
  if (!IS_MOBILE && !document.pointerLockElement) { canvas.requestPointerLock(); return; }
  if (!audioCtx) createAudio();
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  punchTimer = CONFIG.punchCooldown;
  punchPhase = 1;
  recoil = .1;
  shake = Math.max(shake, .055);
  send({ type:'punch' });
  sfx('punch');
}

function mouseMove(event) {
  if ((document.pointerLockElement !== canvas && !IS_MOBILE) || dead || paused) return;
  player.targetYaw -= event.movementX * CONFIG.mouseSensitivity;
  player.targetPitch -= event.movementY * CONFIG.mouseSensitivity;
  player.targetPitch = clamp(player.targetPitch, -Math.PI / 2.05, Math.PI / 2.05);
}

function updateCameraEffects(dt) {
  if(spectatorMode) return;
  const bob = player.bobSpeed * .04;
  camera.position.y += Math.sin(player.bob * 1.5) * bob;
  camera.position.x += Math.cos(player.bob * .8) * bob * .5;
  camera.rotation.z = damp(camera.rotation.z, Math.sin(player.bob * .8) * bob * .5, 8, dt);
  if (shake > 0) {
    shake = damp(shake, 0, 13, dt);
    camera.position.x += random(-1,1) * shake;
    camera.position.y += random(-1,1) * shake;
    camera.position.z += random(-1,1) * shake;
  }
}

function updateArms(dt) {
  const group = camera.getObjectByName('localArms');
  if (!group) return;
  group.visible = currentWeapon === 'fists' && !downed && !spectatorMode;
  setWeaponView();
  if (punchPhase > 0) punchPhase = damp(punchPhase, 0, 13, dt);
  const power = punchPhase > .01 ? Math.sin((1 - punchPhase) * Math.PI) : 0;
  const left = group.children[0];
  const right = group.children[1];
  const walkBob = player.bobSpeed * .032;
  left.position.y = .03 - walkBob;
  right.position.y = -.02 + walkBob;
  left.rotation.z = -.28 + power * .2;
  right.rotation.z = .28 - power * 1.05;
  left.rotation.x = .16 + power * .12;
  right.rotation.x = .16 - power * .32;
  right.position.z = power * .68;
  right.position.x = .27 + power * .08;
  right.scale.setScalar(1 + power * .08);
  group.rotation.x = -recoil;
  const reloadT = reloading ? clamp(1 - reloadRemaining / Math.max(.01,reloadDuration), 0, 1) : 0;
  const reloadDip = reloading ? Math.sin(reloadT * Math.PI) : 0;
  for(const [name,v] of weaponViews) { if(name==='support') continue; v.position.y = -.32 + Math.sin(player.bob*1.2)*.018 - reloadDip*.22; v.rotation.x = weaponRecoil*2.4 + reloadDip*.72; v.rotation.z = reloadDip*.2; }
  if(weaponViews.support){ weaponViews.support.visible=currentWeapon!=='fists' && !downed && !spectatorMode; weaponViews.support.position.x=.08+weaponRecoil*.12; weaponViews.support.rotation.x=weaponRecoil*1.3 + reloadDip*.55; weaponViews.support.position.y=-.66-reloadDip*.08; }
  group.rotation.y = player.sprint ? -.04 : 0;
}

function updateRemotePlayers(dt, time) {
  for (const view of remotePlayers.values()) {
    view.root.position.lerp(view.target, 1 - Math.exp(-dt * 12));
    view.root.rotation.y = damp(view.root.rotation.y, view.targetYaw, 11, dt);
    const moving = view.root.position.distanceTo(view.target) > .025;
    if (moving) view.ring.rotation.z += dt * 3.2;
    view.body.position.y = 1.38 + (moving ? Math.sin(time * 8 + view.phase) * .035 : 0);
  }
}

function updateEnemiesVisuals(dt, time) {
  for (const view of enemyMeshes.values()) {
    const target = view.root.userData.target;
    if (!target) continue;
    view.root.position.x = damp(view.root.position.x, target.x, 11, dt);
    view.root.position.z = damp(view.root.position.z, target.z, 11, dt);

    if (view.spawnT < 1) {
      view.spawnT = Math.min(1, view.spawnT + dt / view.spawnDuration);
      const t = view.spawnT;
      const eased = 1 - Math.pow(1 - t, 3);
      view.root.position.y = THREE.MathUtils.lerp(-2.2 * view.baseScale, 0, eased);
      const scale = THREE.MathUtils.lerp(.35, view.baseScale, eased);
      view.root.scale.setScalar(scale);
    } else {
      view.root.position.y = 0;
      view.root.scale.setScalar(view.baseScale);
    }

    const dx = target.x - view.root.position.x;
    const dz = target.z - view.root.position.z;
    const speed = Math.hypot(dx,dz);
    if (speed > .02) view.root.rotation.y = Math.atan2(dx, dz);
    if(view.dog){
      const stride=Math.sin(time*7+view.phase);
      if(view.legL){view.legL.rotation.z=stride*.35;view.legR.rotation.z=-stride*.35;view.hindL.rotation.z=-stride*.28;view.hindR.rotation.z=stride*.28;}
      if(view.tail) view.tail.rotation.x=-.6+Math.sin(time*4+view.phase)*.18;
    }else{
      const stride = Math.sin(time * ((view.type === 'runner' || view.type==='kidnapper' ? 10.5 : view.type === 'tank' ? 4.4 : view.type === 'boss' ? 3.7 : view.type==='shooter' ? 6.5 : 7)) + view.phase);
      if(view.legL) view.legL.rotation.z = stride * .33;
      if(view.legR) view.legR.rotation.z = -stride * .33;
      if(view.armL) view.armL.rotation.z = -.34 + stride * .26;
      if(view.armR) view.armR.rotation.z = .34 - stride * .26;
      if(view.torso) view.torso.rotation.z = Math.sin(time * 2.3 + view.phase) * .025;
      if(view.head) view.head.rotation.y = Math.sin(time * 1.6 + view.phase) * .08;
      if(view.gun && view.type==='shooter') view.gun.rotation.y=Math.sin(time*1.7+view.phase)*.08;
    }
    if(view.capsuleGroup?.visible){view.capsuleGroup.rotation.y=Math.sin(time*2.1+view.phase)*.08;view.capsuleGroup.position.y=Math.sin(time*4.4+view.phase)*.035;}
    view.ring.rotation.z += dt * (view.type === 'boss' ? 1.6 : 2.5);
    view.hpGroup.quaternion.copy(camera.quaternion);
  }
}

function updateLights(time) {
  if (graphicsSettings.lights && !lowGraphics) {
    for (const item of ceilingLights) {
      const broken=Math.sin(time*.55+item.seed*2.1)>.985?.08:1;
      if(item.light)item.light.intensity=item.base*(.96+Math.sin(time*1.7+item.seed)*.04)*broken;
      if(item.bulb?.material)item.bulb.material.opacity=.58*broken+.1;
    }
  }
  if(flashlight){flashlight.visible=flashlightOn; flashlight.intensity=flashlightOn?(graphicsSettings.shadows&&!lowGraphics?29:24):0;}
  for(const socketInfo of breachSockets.values())if(socketInfo.cooldown>0)socketInfo.cooldown-=1/60;
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    if (p.shock) {
      const factor = THREE.MathUtils.lerp(1, p.endScale || 4, 1 - alpha);
      p.mesh.scale.setScalar(factor);
      p.mesh.material.opacity = alpha * .8;
    } else if (p.rift) {
      p.mesh.scale.setScalar(1 + (1 - alpha) * 1.8);
      p.mesh.traverse(obj => { if (obj.material) obj.material.opacity = alpha * .7; });
    } else {
      p.velocity.y -= dt * 7;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.material) p.mesh.material.opacity = alpha;
    }
    if (p.life <= 0) {
      fx.remove(p.mesh);
      p.mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) { if (obj.material.map) obj.material.map.dispose?.(); obj.material.dispose?.(); }
      });
      particles.splice(i, 1);
    }
  }

  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.life -= dt;
    d.sprite.position.y += d.velocity * dt;
    d.sprite.material.opacity = clamp(d.life / d.maxLife, 0, 1);
    if (d.life <= 0) {
      fx.remove(d.sprite);
      d.sprite.material.map?.dispose?.();
      d.sprite.material.dispose();
      damageNumbers.splice(i,1);
    }
  }
}

function updateDeathUi() {
  if (!dead) return;
  deathText.textContent = 'Reaparición automática en unos segundos...';
}

function updateShopUi(){
  if(shopMoney) shopMoney.textContent=`$${Math.floor(localMoney).toLocaleString('es-AR')}`;
  if(!shopOverlay.classList.contains('hidden')){ shopCountdown.textContent=Math.max(0,Math.ceil(shopRemaining)); }
  const free = !inventory[2] || !inventory[3];
  shopPistol.disabled=!free || !!inventory[2]&&inventory[2]==='pistol' || !!inventory[3]&&inventory[3]==='pistol' || localMoney<500;
  shopShotgun.disabled=!free || !!inventory[2]&&inventory[2]==='shotgun' || !!inventory[3]&&inventory[3]==='shotgun' || localMoney<2500;
  shopRifle.disabled=!free || !!inventory[2]&&inventory[2]==='rifle' || !!inventory[3]&&inventory[3]==='rifle' || localMoney<5000;
  shopStatus.textContent = free ? `DINERO DISPONIBLE: $${Math.floor(localMoney).toLocaleString('es-AR')}` : 'INVENTARIO COMPLETO: solo podés conservar dos armas además de los puños.';
}
function updateShopReadyUi(count,total,self){
  if(shopReadyBtn){shopReadyBtn.classList.toggle('is-ready',!!self);shopReadyBtn.textContent=self?'✓ LISTO':'✓ LISTO / OMITIR TIENDA';shopReadyBtn.disabled=!!self;}
  if(shopReadyStatus) shopReadyStatus.textContent=`${count} / ${total} jugadores listos`;
}
function toggleShopReady(){ if(!shopActive||dead||spectatorMode)return; send({type:'shopReady'}); }
function nearSafeDoor(){ return mapId==='hall' && !hallGateOpen && player.position.z<=46.2 && player.position.z>=41.5 && Math.abs(player.position.x)<=8.5; }
function updateSafeDoorPrompt(){ if(!safeDoorPrompt)return; safeDoorPrompt.classList.toggle('hidden',!nearSafeDoor()); }
function buyWeapon(type){ if(!shopActive)return; send({type:'buyWeapon',weapon:type}); }
function moveQteTarget(){
  const rect=qteOverlay.getBoundingClientRect();
  const pad=30; const size=82;
  const x=random(pad, Math.max(pad,rect.width-size-pad)); const y=random(100, Math.max(100,rect.height-size-pad));
  qteTarget.style.left=`${x}px`; qteTarget.style.top=`${y}px`;
  qteTarget.textContent=Math.max(1,qteTotal-qteHits);
  qteProgress.textContent=`${qteHits} / ${qteTotal}`;
}
function qteClick(){
  if(!grabbed)return;
  qteHits++;
  if(qteHits>=qteTotal){ send({type:'qteEscape'}); grabbed=false; qteOverlay.classList.add('hidden'); return; }
  if(performance.now()>qteDeadline){ qteHits=0; qteDeadline=performance.now()+4500; qteStatus.textContent='DEMASIADO LENTO'; }
  moveQteTarget();
}
function onLockChange() {
  if (IS_MOBILE) { paused = false; pauseOverlay.classList.add('hidden'); return; }
  const locked = document.pointerLockElement === canvas;
  if (shopActive || !graphicsOverlay.classList.contains('hidden') || grabbed || victoryShown) return;
  if (locked) {
    paused = false;
    pauseOverlay.classList.add('hidden');
    createAudio();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  } else if (!dead && startOverlay.classList.contains('hidden')) {
    // ESC in the browser only releases Pointer Lock. It no longer opens a game menu.
    // The pause/settings menu is exclusively bound to P.
    pauseOverlay.classList.add('hidden');
  }
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(lowGraphics ? 0.5 : Math.min(devicePixelRatio, 1.0));
  renderer.setSize(innerWidth, innerHeight);
}

let gameInitialized = false;

function initGame() {
  if (gameInitialized) return;
  if (typeof THREE === 'undefined') {
    throw new Error('Three.js no está cargado. Verificá que three.min.js esté en app/src/main/assets/.');
  }
  if (!scene || !camera || !renderer) {
    throw new Error('Falta una variable esencial del escenario 3D (scene, camera o renderer).');
  }

  createRoom();
  createLocalArms();
  createWeaponViews();
  cacheOriginalShadows();
  applyGraphicsSettings();
  updateInventoryUi();
  connect();
  updateHud();
  showAnnouncement('PUERTA DE INGRESO', 'Elegí tu nombre y entrá al salón.', 'PROTOCOLO DE INICIO', 4.2);
  gameInitialized = true;
  animate();
}

window.initGame = initGame;

function startGame() {
  try {
    if (startupAttempted && gameInitialized) return;
    startupAttempted = true;

    const clean = String(nameInput?.value || '').trim()
      .replace(/[^a-zA-Z0-9_ áéíóúÁÉÍÓÚñÑ-]/g, '')
      .slice(0,16) || 'CAPSULE';
    playerName = clean.toUpperCase();
    localStorage.setItem('capsuleName', playerName);
    if (playerNameHud) playerNameHud.textContent = playerName;

    const serverInput = document.getElementById('serverInput');
    const configured = String(serverInput?.value || '').trim()
      .replace(/^https?:\/\//,'')
      .replace(/^wss?:\/\//,'');

    // Empty server = guaranteed local singleplayer. Never infer an endpoint
    // from the Android appassets URL.
    const sameOriginOnline = window.CAPSULE_ONLINE === true && !configured;
    isOffline = !configured && !sameOriginOnline;
    if (configured) {
      localStorage.setItem('capsuleServerUrl', configured);
    } else {
      localStorage.removeItem('capsuleServerUrl');
    }

    // Hide login immediately, before creating the 3D scene.
    hideStartUIImmediately();

    // Start local/offline immediately when no server was supplied.
    if (isOffline) {
      try {
        initGame();
      } catch (err) {
        throw err;
      }
    } else {
      initGame();
    }

    paused = false;
    if (!IS_MOBILE && canvas.requestPointerLock) canvas.requestPointerLock();
    showAnnouncement('ENTRADA CONFIRMADA', 'Cruzá la puerta. Sobrevive a las oleadas.', 'CAPSULE NIGHTMARE', 3.2);
  } catch (err) {
    console.error('CAPSULE startGame failed:', err);
    const message = String(err?.message || err);
    if (bootError) {
      bootError.classList.remove('hidden');
      const text = $('bootErrorText');
      if (text) text.textContent = `Error al iniciar: ${message}`;
    }
    alert('Error al iniciar: ' + message);
    // Allow another attempt after fixing the reported variable/error.
    startupAttempted = false;
    gameInitialized = false;
  }
}

nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });
pauseOverlay.addEventListener('mousedown', () => canvas.requestPointerLock());
shopPistol.addEventListener('click',()=>buyWeapon('pistol'));
shopShotgun.addEventListener('click',()=>buyWeapon('shotgun'));
shopRifle.addEventListener('click',()=>buyWeapon('rifle'));
shopReadyBtn?.addEventListener('click',toggleShopReady);
qteTarget.addEventListener('click',(e)=>{ e.stopPropagation(); qteClick(); });
graphicsClose?.addEventListener('click',()=>{ toggleGraphicsMenu(false); pauseOverlay.classList.add('hidden'); if(IS_MOBILE) paused=false; else if(startOverlay.classList.contains('hidden') && !shopActive && !grabbed && !dead) canvas.requestPointerLock(); });
lowGraphicsToggle?.addEventListener('change',()=>togglePapaMode(lowGraphicsToggle.checked));
shadowsToggle?.addEventListener('change',()=>setGraphicsSetting('shadows',shadowsToggle.checked));
fogToggle?.addEventListener('change',()=>setGraphicsSetting('fog',fogToggle.checked));
lightsToggle?.addEventListener('change',()=>setGraphicsSetting('lights',lightsToggle.checked));
floorDetailToggle?.addEventListener('change',()=>setGraphicsSetting('floorDetail',floorDetailToggle.checked));
enemyDetailToggle?.addEventListener('change',()=>setGraphicsSetting('enemyDetail',enemyDetailToggle.checked));
bloomToggle?.addEventListener('change',()=>{ bloomToggle.checked=false; graphicsSettings.bloom=false; });

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','ControlLeft','ControlRight','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !e.repeat && !downed && !spectatorMode) jumpQueued = true;
  if(e.code==='KeyE' && !e.repeat){ if(nearSafeDoor()){ send({type:'openGate'}); } else { reviveHold=true; updateReviveInput(); } } 
  if (e.code === 'KeyR' && !e.repeat){ reloadWeapon(); e.preventDefault(); }
  if (e.code === 'Digit1') selectSlot(1);
  if (e.code === 'Digit2') selectSlot(2);
  if (e.code === 'Digit3') selectSlot(3);
  if (e.code === 'KeyF' && startOverlay.classList.contains('hidden')) flashlightOn = !flashlightOn;
  if (e.code === 'KeyP' && startOverlay.classList.contains('hidden')) {
    if (grabbed || shopActive || victoryShown) return;
    const opening = graphicsOverlay.classList.contains('hidden');
    if (opening) { pauseOverlay.classList.add('hidden'); toggleGraphicsMenu(true); }
    else { toggleGraphicsMenu(false); pauseOverlay.classList.add('hidden'); if(!dead) canvas.requestPointerLock(); }
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if(e.code==='KeyE'){ reviveHold=false; if(reviveTargetId){send({type:'reviveStop',targetId:reviveTargetId}); reviveTargetId=null;} } });
window.addEventListener('mouseup', (e) => { if(e.button===0) mouseDown=false; });
window.addEventListener('mousemove', mouseMove);
window.addEventListener('resize', resize);
document.addEventListener('pointerlockchange', onLockChange);
window.addEventListener('capsuleMobileLook', (e) => {
  if (!IS_MOBILE || dead || paused || grabbed || shopActive || victoryShown) return;
  const dx = Number(e.detail?.dx || 0);
  const dy = Number(e.detail?.dy || 0);
  player.targetYaw -= dx * 0.0042;
  player.targetPitch -= dy * 0.0042;
  player.targetPitch = clamp(player.targetPitch, -Math.PI / 2.05, Math.PI / 2.05);
});
window.addEventListener('capsuleMobileFire', (e) => {
  if (!IS_MOBILE) return;
  if (e.detail?.down) {
    if (currentWeapon === 'fists') punch(); else { mouseDown = true; shootWeapon(); }
  } else {
    mouseDown = false;
  }
});
window.addEventListener('capsuleMobileAction', (e) => {
  if (!IS_MOBILE) return;
  const action = e.detail?.action;
  if (action === 'jump') { if (!downed && !spectatorMode) jumpQueued = true; return; }
  if (action === 'reload') { reloadWeapon(); return; }
  if (action === 'flashlight') { if (startOverlay.classList.contains('hidden')) flashlightOn = !flashlightOn; return; }
  if (action === 'pause') {
    if (startOverlay.classList.contains('hidden') && !grabbed && !shopActive && !victoryShown) {
      const opening = graphicsOverlay.classList.contains('hidden');
      if (opening) { toggleGraphicsMenu(true); pauseOverlay.classList.add('hidden'); }
      else { toggleGraphicsMenu(false); pauseOverlay.classList.add('hidden'); paused = false; }
    }
    return;
  }
  if (action === 'interact') {
    if (nearSafeDoor()) send({type:'openGate'}); else { reviveHold = true; updateReviveInput(); }
  }
});
window.addEventListener('capsuleMobileInteractUp', () => {
  if (!IS_MOBILE) return;
  reviveHold = false;
  if (reviveTargetId) { send({type:'reviveStop',targetId:reviveTargetId}); reviveTargetId=null; }
});
window.addEventListener('capsuleMobileWeapon', (e) => { if (IS_MOBILE) selectSlot(Number(e.detail?.slot || 1)); });
window.addEventListener('capsuleMobileSprint', (e) => { if (IS_MOBILE) { if (e.detail?.down) keys.add('ShiftLeft'); else keys.delete('ShiftLeft'); } });
window.addEventListener('capsuleMobileCrouch', (e) => { if (IS_MOBILE) { if (e.detail?.down) keys.add('ControlLeft'); else keys.delete('ControlLeft'); } });
canvas.addEventListener('mousedown', (e) => {
  if (!startOverlay.classList.contains('hidden') || !graphicsOverlay.classList.contains('hidden') || shopActive) return;
  if (grabbed) return;
  createAudio();
  if (!IS_MOBILE && !document.pointerLockElement) { canvas.requestPointerLock(); return; }
  if (e.button === 0 && !downed && !spectatorMode) { mouseDown=true; if(currentWeapon==='fists') punch(); else shootWeapon(); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function alignTrail(mesh, a, b){
  const mid=a.clone().add(b).multiplyScalar(.5), dir=b.clone().sub(a), len=Math.max(.06,dir.length());
  mesh.position.copy(mid); mesh.scale.set(1,len/.72,1); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
}
function createClientProjectileMesh(p){
  p.mesh=new THREE.Mesh(new THREE.SphereGeometry(.045,5,5),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.98,blending:THREE.AdditiveBlending,depthWrite:false}));
  p.trail=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.72,5),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.76,blending:THREE.AdditiveBlending,depthWrite:false}));
  fx.add(p.mesh,p.trail);
}
function removeClientProjectile(p){
  if(!p)return;
  if(p.mesh){fx.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();}
  if(p.trail){fx.remove(p.trail);p.trail.geometry.dispose();p.trail.material.dispose();}
}
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i]; p.life-=dt; p.previous.copy(p.position); p.velocity.y-=p.gravity*dt; p.position.addScaledVector(p.velocity,dt);
    if(p.mesh)p.mesh.position.copy(p.position); if(p.trail){alignTrail(p.trail,p.previous,p.position);p.trail.material.opacity=.72*clamp(p.life/p.maxLife,.15,1);}
    if(p.life<=0 || p.position.y<.02){removeClientProjectile(p);projectiles.splice(i,1);}
  }
}
function updateQte(dt){
  if(!grabbed){return;}
  if(performance.now()>qteDeadline){ qteHits=0; qteDeadline=performance.now()+4500; qteStatus.textContent='¡MAS RÁPIDO!'; moveQteTarget(); }
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  const time = clock.elapsedTime;

  if (spectatorMode) updateSpectator(dt);
  else if (!paused && !dead) { playerInput(dt); if(downed) updateReviveInput(); if(mouseDown && currentWeapon==='rifle' && !downed) shootWeapon(); }
  if (weaponRecoil>0) weaponRecoil=damp(weaponRecoil,0,18,dt);
  if(downed && !spectatorMode){ downedRemaining=Math.max(0,downedRemaining-dt); }
  if(reloading){ reloadRemaining=Math.max(0,reloadRemaining-dt); if(reloadRemaining<=0) reloading=false; updateAmmoUi(); }
  if(escapeActive) { escapeRemaining=Math.max(0,escapeRemaining-dt); setEscapeGateOpen(true); }
  updateHallEntryDoor(dt);
  updateEscapeGate(dt);
  updateQte(dt);
  updateProjectiles(dt);
  updateAnnouncement(dt);
  updateArms(dt);
  updateCameraEffects(dt);
  updateRemotePlayers(dt, time);
  updateEnemiesVisuals(dt, time);
  if(mapId==='train'){
    trainAnim += dt;
    for(const w of trainWindowStrips) w.glass.material.opacity=.24+.08*Math.sin(trainAnim*3+w.z*.03);
  }
  updateLights(time);
  updateParticles(dt);

  if (hurtFlash > 0) hurtFlash = damp(hurtFlash, 0, 15, dt);
  hitFlash.style.opacity = String(Math.min(1, hurtFlash * 2.6));
  const damagePulse = Math.max(0, 1 - ((performance.now() / 1000 - lastServerDamage) / .8));
  damageVignette.style.opacity = String(dead ? .4 : damagePulse * .58);

  if (shopActive) { shopRemaining=Math.max(0, shopRemaining-dt); shopCountdown.textContent=Math.ceil(shopRemaining); }
  if (killToastTimer > 0) killToastTimer -= dt;
  updateSafeDoorPrompt();

  if (performance.now() - lastUiTime > 80) {
    lastUiTime = performance.now();
    updateHud();
    updateDeathUi();
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime > .5) {
    fpsEl.textContent = `FPS: ${Math.round(fpsFrames / fpsTime)}`;
    fpsFrames = 0;
    fpsTime = 0;
  }

  // Mobile Android: direct renderer path; no composer/bloom dependencies.
  renderer.render(scene, camera);
}

// El juego se inicializa al presionar ENTRAR AL SALÓN. Esto permite decidir
// explícitamente entre modo local/offline y multijugador antes de abrir cualquier socket.
