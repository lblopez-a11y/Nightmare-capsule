(() => {
  const root = document.getElementById('mobileTouchUI');
  if (!root) return;
  const moveZone = document.getElementById('mobileMoveZone');
  const lookZone = document.getElementById('mobileLookZone');
  const joyBase = document.getElementById('mobileJoystickBase');
  const joyKnob = document.getElementById('mobileJoystickKnob');
  const sprintBtn = document.getElementById('mobileSprintBtn');
  const crouchBtn = document.getElementById('mobileCrouchBtn');
  const fireBtn = document.getElementById('mobileFireBtn');
  const jumpBtn = document.getElementById('mobileJumpBtn');
  const reloadBtn = document.getElementById('mobileReloadBtn');
  const interactBtn = document.getElementById('mobileInteractBtn');
  const menuBtn = document.getElementById('mobileMenuBtn');
  const flashBtn = document.getElementById('mobileFlashBtn');
  const weaponBtns = [...document.querySelectorAll('[data-mobile-slot]')];
  const serverInput = document.getElementById('serverInput');

  const activeKeys = new Set();
  let moveTouchId = null;
  let lookTouchId = null;
  let lookLastX = 0, lookLastY = 0;
  let sprint = false;
  let crouch = false;
  let fire = false;
  let interact = false;

  const emitKey = (code, down) => {
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
  };
  const clearKey = (code) => { if (activeKeys.has(code)) { activeKeys.delete(code); emitKey(code, false); } };
  const setMove = (x, y) => {
    const dead = 0.20;
    const absX = Math.abs(x), absY = Math.abs(y);
    const next = new Set();
    if (absY > dead) next.add(absY > 0 ? (y < 0 ? 'KeyW' : 'KeyS') : '');
    if (absX > dead) next.add(absX > 0 ? (x < 0 ? 'KeyA' : 'KeyD') : '');
    next.delete('');
    for (const k of ['KeyW','KeyA','KeyS','KeyD']) {
      if (next.has(k) && !activeKeys.has(k)) { activeKeys.add(k); emitKey(k, true); }
      if (!next.has(k) && activeKeys.has(k)) { activeKeys.delete(k); emitKey(k, false); }
    }
  };
  const centerJoystick = () => { joyKnob.style.transform = 'translate(-50%, -50%)'; };
  const joystick = (clientX, clientY) => {
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    let dx = clientX - cx, dy = clientY - cy;
    const max = r.width * .34;
    const len = Math.hypot(dx,dy) || 1;
    if (len > max) { dx = dx/len*max; dy = dy/len*max; }
    const nx = dx / max, ny = dy / max;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setMove(nx,ny);
  };

  moveZone.addEventListener('touchstart', e => {
    if (moveTouchId !== null) return;
    const t = e.changedTouches[0]; moveTouchId = t.identifier; joystick(t.clientX,t.clientY); e.preventDefault();
  }, {passive:false});
  moveZone.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier===moveTouchId) joystick(t.clientX,t.clientY);
    e.preventDefault();
  }, {passive:false});
  const endMove = e => { for (const t of e.changedTouches) if (t.identifier===moveTouchId) { moveTouchId=null; centerJoystick(); setMove(0,0); } e.preventDefault(); };
  moveZone.addEventListener('touchend',endMove,{passive:false}); moveZone.addEventListener('touchcancel',endMove,{passive:false});

  lookZone.addEventListener('touchstart', e => {
    if (lookTouchId !== null) return;
    const t=e.changedTouches[0]; lookTouchId=t.identifier; lookLastX=t.clientX; lookLastY=t.clientY; e.preventDefault();
  },{passive:false});
  lookZone.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier===lookTouchId) {
      const dx=t.clientX-lookLastX, dy=t.clientY-lookLastY; lookLastX=t.clientX; lookLastY=t.clientY;
      window.dispatchEvent(new CustomEvent('capsuleMobileLook',{detail:{dx,dy}}));
    }
    e.preventDefault();
  },{passive:false});
  const endLook=e=>{for(const t of e.changedTouches) if(t.identifier===lookTouchId) lookTouchId=null; e.preventDefault();};
  lookZone.addEventListener('touchend',endLook,{passive:false}); lookZone.addEventListener('touchcancel',endLook,{passive:false});

  const bindHold=(el,onDown,onUp)=>{ if(!el)return; el.addEventListener('touchstart',e=>{onDown();e.preventDefault();},{passive:false}); ['touchend','touchcancel'].forEach(evt=>el.addEventListener(evt,e=>{onUp();e.preventDefault();},{passive:false})); };
  bindHold(fireBtn,()=>{fire=true; window.dispatchEvent(new CustomEvent('capsuleMobileFire',{detail:{down:true}}));},()=>{fire=false;window.dispatchEvent(new CustomEvent('capsuleMobileFire',{detail:{down:false}}));});
  bindHold(sprintBtn,()=>{sprint=true;sprintBtn.classList.add('active');window.dispatchEvent(new CustomEvent('capsuleMobileSprint',{detail:{down:true}}));},()=>{sprint=false;sprintBtn.classList.remove('active');window.dispatchEvent(new CustomEvent('capsuleMobileSprint',{detail:{down:false}}));});
  bindHold(crouchBtn,()=>{crouch=true;crouchBtn.classList.add('active');window.dispatchEvent(new CustomEvent('capsuleMobileCrouch',{detail:{down:true}}));},()=>{crouch=false;crouchBtn.classList.remove('active');window.dispatchEvent(new CustomEvent('capsuleMobileCrouch',{detail:{down:false}}));});
  bindHold(interactBtn,()=>{interact=true;window.dispatchEvent(new CustomEvent('capsuleMobileAction',{detail:{action:'interact'}}));},()=>{interact=false;window.dispatchEvent(new CustomEvent('capsuleMobileInteractUp'));});
  jumpBtn.addEventListener('touchstart',e=>{window.dispatchEvent(new CustomEvent('capsuleMobileAction',{detail:{action:'jump'}}));e.preventDefault();},{passive:false});
  reloadBtn.addEventListener('touchstart',e=>{window.dispatchEvent(new CustomEvent('capsuleMobileAction',{detail:{action:'reload'}}));e.preventDefault();},{passive:false});
  menuBtn.addEventListener('touchstart',e=>{window.dispatchEvent(new CustomEvent('capsuleMobileAction',{detail:{action:'pause'}}));e.preventDefault();},{passive:false});
  flashBtn.addEventListener('touchstart',e=>{window.dispatchEvent(new CustomEvent('capsuleMobileAction',{detail:{action:'flashlight'}}));flashBtn.classList.toggle('active');e.preventDefault();},{passive:false});
  weaponBtns.forEach(btn=>btn.addEventListener('touchstart',e=>{window.dispatchEvent(new CustomEvent('capsuleMobileWeapon',{detail:{slot:Number(btn.dataset.mobileSlot)}}));weaponBtns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');e.preventDefault();},{passive:false}));

  // Also support click for testing with desktop browser emulation.
  [jumpBtn,reloadBtn,menuBtn,flashBtn].forEach((el)=>el?.addEventListener('click',()=>{}));

  const syncMobileSlots = () => {
    const slotEls = [null,document.getElementById('slot1'),document.getElementById('slot2'),document.getElementById('slot3')];
    for (let i=1;i<=3;i++) {
      const src=slotEls[i], dst=weaponBtns[i-1]; if(!src||!dst)continue;
      const name=src.querySelector('.slot-name')?.textContent || '---';
      dst.querySelector('small').textContent=name;
      dst.classList.toggle('active',src.classList.contains('active'));
      dst.classList.toggle('locked',src.classList.contains('locked'));
    }
  };
  const observer = new MutationObserver(syncMobileSlots);
  [1,2,3].forEach(i=>{const el=document.getElementById(`slot${i}`);if(el)observer.observe(el,{subtree:true,attributes:true,childList:true});});
  setInterval(syncMobileSlots,450);

  if (serverInput) {
    serverInput.value = localStorage.getItem('capsuleServerUrl') || '';
    serverInput.addEventListener('change',()=>{
      const value=serverInput.value.trim().replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'');
      if(value)localStorage.setItem('capsuleServerUrl',value); else localStorage.removeItem('capsuleServerUrl');
    });
  }

  window.addEventListener('beforeunload',()=>{
    for(const k of ['KeyW','KeyA','KeyS','KeyD']) clearKey(k);
    window.dispatchEvent(new CustomEvent('capsuleMobileSprint',{detail:{down:false}}));
    window.dispatchEvent(new CustomEvent('capsuleMobileCrouch',{detail:{down:false}}));
    window.dispatchEvent(new CustomEvent('capsuleMobileFire',{detail:{down:false}}));
  });
})();
