/* ============================================================
   墨流 · 四时行卷 (Ink & Qi · Reversible Time Scroll)
   零依赖纯手写 WebGL2 双通道实时着色器引擎：
   - Pass 1: 全屏 3D 域扭曲 FBM 水墨云海 + 等高线山脊 + 可逆空间折射涟漪
   - Pass 2: 15,000+ GPU Instanced 3D 景深穿时粒子（随滚轮速度动态拉出星轨流线）
   - Audio : 可选纯代码 Web Audio 五声音阶物理合成（默认静音）
   - Export: 一键「拓印」合成朱砂印章并导出高清 PNG
   ============================================================ */

(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const engineTag = document.getElementById('engineTag');
  const btnPause = document.getElementById('btnPause');
  const btnSound = document.getElementById('btnSound');
  const btnGuide = document.getElementById('btnGuide');
  const btnStamp = document.getElementById('btnStamp');
  const guideBox = document.getElementById('guideBox');
  const toastSeal = document.getElementById('toastSeal');
  const toastText = document.getElementById('toastText');
  const timeDirEl = document.getElementById('timeDir');
  const timeCodeEl = document.getElementById('timeCode');
  const scrubber = document.getElementById('scrubber');
  const scrubberThumb = document.getElementById('scrubberThumb');
  const scrubberRipples = document.getElementById('scrubberRipples');
  const eraBtns = Array.from(document.querySelectorAll('.era-btn'));

  const CYCLE_LEN = 40.0; // 每 40 个时间单位走完 卯→午→酉→子 一昼夜循环
  const MAX_RIPPLES = 12;
  const ERA_NAMES = ['卯 · 晨纸山岚', '午 · 朱岚涌动', '酉 · 暮色松烟', '子 · 夜灯折腾'];

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 760;

  // ---------- 核心物理与时间状态 ----------
  const state = {
    time: 1.5,            // 当前连续可逆时间坐标 T
    targetVel: reducedMotion ? 0.0 : 0.34, // 自然呼吸流速
    vel: reducedMotion ? 0.0 : 0.34,       // 当前时间流速（正=探索，负=时光倒流）
    paused: reducedMotion,
    mouseX: 0.5,
    mouseY: 0.5,
    smoothMX: 0.5,
    smoothMY: 0.5,
    mouseVX: 0.0,
    mouseVY: 0.0,
    pressing: false,
    pressStartMs: 0,
    vortex: 0.0,
    ripples: [],          // { x, y, birthTime, strength, revChimed }
    draggingScrubber: false,
    hasInteracted: false,
    eraIndex: 0,
    darkTone: false,
    dpr: Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2),
    width: 1,
    height: 1,
    exportRequested: false
  };

  // ---------- 可选纯代码五声音阶声景（默认静音） ----------
  const sound = {
    enabled: false,
    ctx: null,
    windGain: null,
    windFilter: null,
    scale: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0],
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // 柔和穿风白噪声
      const bufSize = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 320;
      filter.Q.value = 1.8;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start();

      this.windFilter = filter;
      this.windGain = gain;
    },
    toggle() {
      if (!this.enabled) {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        this.enabled = true;
        this.pluck(0.5, 0.5, 0.9);
      } else {
        this.enabled = false;
        if (this.windGain && this.ctx) {
          this.windGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
        }
      }
      btnSound.setAttribute('aria-pressed', String(this.enabled));
      btnSound.textContent = this.enabled ? '听风 · 开' : '听风';
    },
    pluck(nx, ny, power = 1.0, reverse = false) {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const idx = Math.max(0, Math.min(this.scale.length - 1, Math.floor((nx * 0.65 + (1 - ny) * 0.35) * this.scale.length)));
      const freq = this.scale[idx] * (reverse ? 2.0 : 1.0);

      const osc = this.ctx.createOscillator();
      const overtone = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      overtone.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      overtone.frequency.setValueAtTime(freq * 2.0, now);

      const peak = Math.min(0.11, 0.055 * power);
      if (reverse) {
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak * 0.7, now + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      } else {
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);
      }

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.22;

      osc.connect(gain);
      overtone.connect(subGain);
      subGain.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + (reverse ? 0.5 : 1.55));
      overtone.stop(now + (reverse ? 0.5 : 1.55));
    },
    burst(nx, ny) {
      if (!this.enabled || !this.ctx) return;
      this.pluck(nx, ny, 1.2);
      setTimeout(() => this.pluck(Math.min(1, nx + 0.18), ny, 0.8), 65);
      setTimeout(() => this.pluck(Math.max(0, nx - 0.18), Math.max(0, ny - 0.2), 0.7), 130);
    },
    updateWind(vel) {
      if (!this.enabled || !this.ctx || !this.windGain || !this.windFilter) return;
      const speed = Math.min(12.0, Math.abs(vel));
      const targetVol = speed > 0.55 ? Math.min(0.065, (speed - 0.55) * 0.0085) : 0.0;
      const targetFreq = 260 + speed * 95 + (vel < 0 ? 180 : 0);
      this.windGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.09);
      this.windFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.09);
    }
  };

  // ---------- 辅助函数 ----------
  const mod = (n, m) => ((n % m) + m) % m;

  function addRipple(nx, ny, strength = 1.0) {
    state.ripples.push({
      x: nx,
      y: ny,
      birthTime: state.time,
      strength,
      revChimed: false
    });
    if (state.ripples.length > MAX_RIPPLES) {
      state.ripples.shift();
    }
    syncRippleDots();
  }

  function syncRippleDots() {
    scrubberRipples.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of state.ripples) {
      const pct = (mod(r.birthTime, CYCLE_LEN) / CYCLE_LEN) * 100;
      const dot = document.createElement('span');
      dot.className = 'scrubber-dot';
      dot.style.left = pct.toFixed(2) + '%';
      frag.appendChild(dot);
    }
    scrubberRipples.appendChild(frag);
  }

  function markInteracted() {
    if (state.hasInteracted) return;
    state.hasInteracted = true;
    setTimeout(() => {
      if (btnGuide.getAttribute('aria-pressed') === 'true') {
        guideBox.classList.add('is-hidden');
        btnGuide.setAttribute('aria-pressed', 'false');
      }
    }, 3600);
  }

  let toastTimer = null;
  function showToast(msg) {
    toastText.textContent = msg;
    toastSeal.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastSeal.classList.remove('is-show'), 2600);
  }

  // ---------- WebGL2 着色器源码 ----------
  const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FIELD_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uVel;
uniform float uPhase;
uniform vec2 uMouse;
uniform vec2 uMouseVel;
uniform float uVortex;
uniform vec4 uRipples[12];
uniform int uRippleCount;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p.xy = rot * p.xy * 2.04 + vec2(17.1, 31.7);
    p.z = p.z * 1.92 + 5.3;
    a *= 0.5;
  }
  return v;
}

// 四时色板平滑插值（严格贴合主页宣纸/墨/朱砂/苔青）
void samplePalette(float ph, out vec3 bg, out vec3 mist, out vec3 ink, out vec3 greenCol, out vec3 redCol, out float nightAmt) {
  float s = fract(ph) * 4.0;
  int idx = int(floor(s));
  float t = smoothstep(0.0, 1.0, fract(s));

  vec3 bg0 = vec3(0.937, 0.910, 0.847); // 卯 晨纸 #efe8d8
  vec3 bg1 = vec3(0.922, 0.878, 0.796); // 午 朱岚暖纸
  vec3 bg2 = vec3(0.205, 0.196, 0.172); // 酉 暮色松烟
  vec3 bg3 = vec3(0.078, 0.072, 0.062); // 子 夜灯深墨 #141210

  vec3 mi0 = vec3(0.835, 0.802, 0.720);
  vec3 mi1 = vec3(0.845, 0.768, 0.665);
  vec3 mi2 = vec3(0.155, 0.175, 0.156);
  vec3 mi3 = vec3(0.125, 0.145, 0.132);

  vec3 in0 = vec3(0.135, 0.128, 0.106);
  vec3 in1 = vec3(0.155, 0.112, 0.092);
  vec3 in2 = vec3(0.855, 0.790, 0.660);
  vec3 in3 = vec3(0.945, 0.865, 0.710);

  vec3 gr0 = vec3(0.298, 0.388, 0.302);
  vec3 gr1 = vec3(0.270, 0.375, 0.285);
  vec3 gr2 = vec3(0.415, 0.560, 0.435);
  vec3 gr3 = vec3(0.405, 0.575, 0.450);

  vec3 rd0 = vec3(0.710, 0.220, 0.173);
  vec3 rd1 = vec3(0.790, 0.235, 0.165);
  vec3 rd2 = vec3(0.855, 0.325, 0.240);
  vec3 rd3 = vec3(0.910, 0.335, 0.220);

  float ni0 = 0.0;
  float ni1 = 0.08;
  float ni2 = 0.82;
  float ni3 = 1.0;

  if (idx == 0) {
    bg = mix(bg0, bg1, t); mist = mix(mi0, mi1, t); ink = mix(in0, in1, t);
    greenCol = mix(gr0, gr1, t); redCol = mix(rd0, rd1, t); nightAmt = mix(ni0, ni1, t);
  } else if (idx == 1) {
    bg = mix(bg1, bg2, t); mist = mix(mi1, mi2, t); ink = mix(in1, in2, t);
    greenCol = mix(gr1, gr2, t); redCol = mix(rd1, rd2, t); nightAmt = mix(ni1, ni2, t);
  } else if (idx == 2) {
    bg = mix(bg2, bg3, t); mist = mix(mi2, mi3, t); ink = mix(in2, in3, t);
    greenCol = mix(gr2, gr3, t); redCol = mix(rd2, rd3, t); nightAmt = mix(ni2, ni3, t);
  } else {
    bg = mix(bg3, bg0, t); mist = mix(mi3, mi0, t); ink = mix(in3, in0, t);
    greenCol = mix(gr3, gr0, t); redCol = mix(rd3, rd0, t); nightAmt = mix(ni3, ni0, t);
  }
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

  // 镜头轻微 3D 视差偏移
  vec2 parallax = -m * 0.065;
  vec2 sampleP = p + parallax;

  // 鼠标拂风与长按太极漩涡扭曲
  vec2 dMouse = sampleP - m;
  float distM = length(dMouse);
  float mouseInfluence = exp(-distM * distM * 10.5);
  sampleP -= uMouseVel * mouseInfluence * 0.35;

  if (uVortex > 0.001) {
    float swirlAngle = uVortex * 3.1 * exp(-distM * 3.2);
    float cs = cos(swirlAngle);
    float sn = sin(swirlAngle);
    vec2 spun = mat2(cs, -sn, sn, cs) * dMouse;
    sampleP = mix(sampleP, m + spun * (1.0 - 0.22 * uVortex * exp(-distM * 2.5)), 0.85);
  }

  // 可逆时空涟漪折射（前进扩散，倒滚沿原路精准收缩）
  float rippleInk = 0.0;
  float rippleGold = 0.0;
  vec2 rippleDisp = vec2(0.0);

  for (int i = 0; i < 12; i++) {
    if (i >= uRippleCount) break;
    vec4 rp = uRipples[i];
    float age = uTime - rp.z;
    if (age > 0.0 && age < 8.5) {
      vec2 rc = (rp.xy - 0.5) * vec2(aspect, 1.0);
      vec2 diff = p - rc;
      float d = length(diff) + 0.0001;
      float radius = age * 0.34 * (0.85 + 0.2 * rp.w);
      float fade = smoothstep(0.0, 0.22, age) * exp(-age * 0.42) * rp.w;
      float band = exp(-pow((d - radius) * 14.0, 2.0));
      float innerBand = exp(-pow((d - radius * 0.72) * 18.0, 2.0));
      float wave = sin((d - radius) * 38.0) * band * fade;

      rippleDisp += (diff / d) * wave * 0.048;
      rippleInk += band * fade * 0.95;
      rippleGold += innerBand * fade * 0.55;
    }
  }
  sampleP += rippleDisp;

  // 3D 连续穿行缩放（向前滚感觉持续深入，倒滚则抽离回退）
  float speedBoost = clamp(abs(uVel) * 0.055, 0.0, 0.32);
  float zCoord = uTime * 0.165;
  vec3 qBase = vec3(sampleP * (1.65 - speedBoost * 0.45), zCoord);

  // 二阶域扭曲 FBM（营造水墨在宣纸与气流中的翻卷流动感）
  vec3 q = vec3(
    fbm(qBase + vec3(0.0, 0.0, 0.0)),
    fbm(qBase + vec3(5.2, 1.3, 2.7)),
    zCoord * 0.7
  );
  float f = fbm(vec3(sampleP * 2.1 + q.xy * 1.45, zCoord * 1.15 + q.x * 0.55));
  float ridge = fbm(vec3(sampleP * 3.4 - q.yx * 1.1, zCoord * 0.85 + 3.1));

  // 细腻的千里江山等高线（克制而有东方精密感）
  float contourFreq = 15.0;
  float contourRaw = abs(fract(f * contourFreq + 0.5) - 0.5) / max(fwidth(f * contourFreq), 0.001);
  float contourLine = 1.0 - smoothstep(0.55, 1.55, contourRaw);

  vec3 bg, mist, ink, greenCol, redCol;
  float nightAmt;
  samplePalette(uPhase, bg, mist, ink, greenCol, redCol, nightAmt);

  // 合成基底水墨云海
  vec3 col = mix(bg, mist, smoothstep(0.24, 0.78, f));

  // 苔青山岚带
  float greenVeil = smoothstep(0.46, 0.82, ridge) * smoothstep(0.28, 0.72, q.y);
  col = mix(col, greenCol, greenVeil * mix(0.26, 0.34, nightAmt));

  // 浓淡焦墨 / 暮夜微光褶皱
  float inkWash = smoothstep(0.56, 0.90, f * 0.65 + q.x * 0.55);
  col = mix(col, ink, inkWash * mix(0.22, 0.16, nightAmt));

  // 等高线山脊丝线
  col = mix(col, mix(ink, greenCol, 0.55), contourLine * mix(0.11, 0.18, nightAmt));

  // 午时与子夜之间在涡流边缘渗出朱砂气韵
  float cinnabarEdge = smoothstep(0.68, 0.92, ridge * q.x * 1.65);
  col = mix(col, redCol, cinnabarEdge * mix(0.16, 0.32, nightAmt));

  // 鼠标风眼朱砂微晕与漩涡蓄力光环
  float cursorGlow = exp(-distM * distM * 26.0);
  col = mix(col, redCol, cursorGlow * (0.14 + uVortex * 0.36));
  if (uVortex > 0.01) {
    float ring = exp(-pow((distM - (0.18 - uVortex * 0.08)) * 34.0, 2.0));
    col = mix(col, mix(redCol, vec3(0.96, 0.83, 0.56), nightAmt), ring * uVortex * 0.65);
  }

  // 叠加可逆时空涟漪色彩（朱砂外环 + 泥金内环）
  vec3 goldCol = vec3(0.89, 0.72, 0.42);
  col = mix(col, redCol, clamp(rippleInk * 0.62, 0.0, 0.78));
  col = mix(col, goldCol, clamp(rippleGold * 0.48, 0.0, 0.6));

  // 微距宣纸纸纹（低频柔和不刺眼）
  float paperGrain = hash31(vec3(floor(gl_FragCoord.xy * 0.75), floor(uPhase * 4.0) + 1.0)) - 0.5;
  col += paperGrain * mix(0.032, 0.024, nightAmt);

  // 柔和画卷四周微暗角
  float vig = 1.0 - smoothstep(0.45, 1.38, length(p * vec2(0.82, 1.0)));
  col *= mix(0.84, 1.0, vig);

  fragColor = vec4(col, 1.0);
}`;

  const PARTICLE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeed; // x, y, z0, size
layout(location = 2) in vec4 aKind; // colorType, speed, phase, orbit

uniform vec2 uRes;
uniform float uTime;
uniform float uVel;
uniform float uPhase;
uniform vec2 uMouse;
uniform float uVortex;
uniform vec4 uRipples[12];
uniform int uRippleCount;

out vec2 vLocal;
out vec3 vColor;
out float vAlpha;
out float vStreak;

// 确定性 3D 穿时坐标函数（完全时间可逆！）
vec3 evalParticle(vec4 seed, vec4 kind, float t, float aspect) {
  float z = fract(seed.z - t * (0.045 + kind.y * 0.055));
  float depth = 0.08 + z * 0.96;

  // 螺旋气韵漂移
  float ang = kind.z + t * (0.28 + kind.y * 0.35) + seed.z * 6.2831;
  float driftX = sin(ang + seed.y * 3.1) * (0.08 + kind.w * 0.14);
  float driftY = cos(ang * 0.85 + seed.x * 2.7) * (0.07 + kind.w * 0.12);

  vec2 xy = (seed.xy * 2.0 - 1.0) * vec2(aspect * 0.95, 0.95) + vec2(driftX, driftY);

  // 光标 3D 镜头视差
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);
  xy -= m * (0.22 / depth) * 0.42;

  // 透视投影到屏幕规范空间
  vec2 screenP = xy / (depth * 1.15);

  // 鼠标风眼排斥 / 长按引力漩涡吸入
  vec2 dM = screenP - m;
  float distM = length(dM) + 0.0001;
  if (uVortex > 0.01) {
    float pull = uVortex * exp(-distM * 2.1) * 0.48;
    float spin = uVortex * exp(-distM * 1.9) * 1.95;
    float cs = cos(spin);
    float sn = sin(spin);
    vec2 spun = mat2(cs, -sn, sn, cs) * dM;
    screenP = mix(screenP, m + spun * (1.0 - pull), 0.75);
  } else {
    float breeze = exp(-distM * distM * 14.0) * 0.055;
    screenP += (dM / distM) * breeze;
  }

  // 可逆时空涟漪对 3D 粒子的推开力
  for (int i = 0; i < 12; i++) {
    if (i >= uRippleCount) break;
    vec4 rp = uRipples[i];
    float age = t - rp.z;
    if (age > 0.0 && age < 8.5) {
      vec2 rc = (rp.xy - 0.5) * vec2(aspect, 1.0);
      vec2 diff = screenP - rc;
      float d = length(diff) + 0.0001;
      float radius = age * 0.34 * (0.85 + 0.2 * rp.w);
      float ring = exp(-pow((d - radius) * 11.0, 2.0));
      float fade = smoothstep(0.0, 0.18, age) * exp(-age * 0.40) * rp.w;
      screenP += (diff / d) * ring * fade * 0.16;
    }
  }

  return vec3(screenP, z);
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);

  vec3 nowState = evalParticle(aSeed, aKind, uTime, aspect);
  // 根据滚轮时间速度计算前一瞬间位置，自动拉出超空间墨韵星轨！
  float dt = clamp(uVel * 0.042, -0.45, 0.45);
  vec3 prevState = evalParticle(aSeed, aKind, uTime - dt, aspect);

  vec2 pNow = nowState.xy;
  vec2 pPrev = prevState.xy;
  float z = nowState.z;

  // 若跨越深度循环边界（fract 跳变），取消拉伸避免跨屏长线
  vec2 seg = pNow - pPrev;
  if (abs(nowState.z - prevState.z) > 0.4 || length(seg) > 0.45) {
    seg = vec2(0.0);
  }

  float segLen = length(seg);
  vec2 dir = segLen > 0.0005 ? (seg / segLen) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  // 景深尺寸与柔边
  float nearFactor = 1.0 - z;
  float baseRadius = (0.0024 + aSeed.w * 0.0052) * (0.45 + nearFactor * 1.65);
  float halfLen = baseRadius + segLen * 0.92;
  float halfThick = baseRadius * mix(1.0, 0.52, clamp(segLen * 7.5, 0.0, 1.0));

  vec2 center = pNow - seg * 0.5;
  vec2 worldPos = center + dir * (aCorner.x * halfLen) + perp * (aCorner.y * halfThick);

  vec2 clipPos = vec2(worldPos.x / aspect, worldPos.y) * 2.0;
  gl_Position = vec4(clipPos, 0.0, 1.0);

  vLocal = aCorner;
  vStreak = clamp(segLen * 10.0, 0.0, 1.0);

  // 随四时循环平滑切换粒子配色（宣纸墨/青/朱 -> 子夜泥金/青岚/发光朱砂）
  float s = fract(uPhase) * 4.0;
  float nightAmt = smoothstep(1.2, 2.4, s) * (1.0 - smoothstep(3.2, 4.0, s));
  // 衔接 3.2->4.0 回落至 0
  if (s >= 3.0) {
    nightAmt = 1.0 - smoothstep(3.1, 3.95, s);
  } else if (s >= 2.0) {
    nightAmt = mix(0.82, 1.0, smoothstep(2.0, 3.0, s));
  } else if (s >= 1.0) {
    nightAmt = mix(0.08, 0.82, smoothstep(1.0, 2.0, s));
  } else {
    nightAmt = mix(0.0, 0.08, smoothstep(0.0, 1.0, s));
  }

  vec3 dayInk = vec3(0.13, 0.12, 0.10);
  vec3 dayGreen = vec3(0.28, 0.39, 0.29);
  vec3 dayRed = vec3(0.73, 0.22, 0.17);

  vec3 nightGold = vec3(0.97, 0.86, 0.64);
  vec3 nightGreen = vec3(0.49, 0.72, 0.56);
  vec3 nightRed = vec3(0.96, 0.38, 0.26);

  vec3 cInk = mix(dayInk, nightGold, nightAmt);
  vec3 cGreen = mix(dayGreen, nightGreen, nightAmt);
  vec3 cRed = mix(dayRed, nightRed, nightAmt);

  if (aKind.x < 0.58) {
    vColor = cInk;
  } else if (aKind.x < 0.84) {
    vColor = cGreen;
  } else {
    vColor = cRed;
  }

  // 远近淡入淡出，避免边缘突兀闪烁
  float depthAlpha = smoothstep(0.02, 0.14, z) * smoothstep(1.0, 0.68, z);
  float baseAlpha = mix(0.44, 0.72, nightAmt) * (0.45 + nearFactor * 0.75);
  vAlpha = depthAlpha * baseAlpha * (1.0 + vStreak * 0.35);
}`;

  const PARTICLE_FS = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec3 vColor;
in float vAlpha;
in float vStreak;

out vec4 fragColor;

void main() {
  // 胶囊/墨滴柔和衰减
  float r = length(vLocal);
  float soft = smoothstep(1.0, mix(0.18, 0.05, vStreak), r);
  float alpha = soft * soft * vAlpha;
  if (alpha < 0.004) discard;
  fragColor = vec4(vColor, alpha);
}`;

  // ---------- WebGL2 渲染器初始化 ----------
  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + info);
    }
    return sh;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('Program link error: ' + info);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  function createWebGLRenderer() {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) return null;

    const fieldProg = createProgram(gl, FULLSCREEN_VS, FIELD_FS);
    const particleProg = createProgram(gl, PARTICLE_VS, PARTICLE_FS);

    const fieldVao = gl.createVertexArray();

    // 粒子实例数据
    const COUNT = isMobile ? 6500 : 15000;
    const cornerData = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1
    ]);
    const seedData = new Float32Array(COUNT * 4);
    const kindData = new Float32Array(COUNT * 4);

    // 确定性伪随机生成器（每次打开都美感稳定均衡）
    let s = 20261127;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 0; i < COUNT; i++) {
      const o = i * 4;
      seedData[o + 0] = rnd();                 // x
      seedData[o + 1] = rnd();                 // y
      seedData[o + 2] = rnd();                 // z0
      seedData[o + 3] = Math.pow(rnd(), 2.1);  // size（大部分细腻微尘，少量醒目大墨滴）

      kindData[o + 0] = rnd();                 // colorType
      kindData[o + 1] = rnd();                 // speed
      kindData[o + 2] = rnd() * Math.PI * 2;   // phase
      kindData[o + 3] = rnd();                 // orbit
    }

    const pVao = gl.createVertexArray();
    gl.bindVertexArray(pVao);

    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cornerData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const seedBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seedData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    const kindBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
    gl.bufferData(gl.ARRAY_BUFFER, kindData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    const fLoc = {
      uRes: gl.getUniformLocation(fieldProg, 'uRes'),
      uTime: gl.getUniformLocation(fieldProg, 'uTime'),
      uVel: gl.getUniformLocation(fieldProg, 'uVel'),
      uPhase: gl.getUniformLocation(fieldProg, 'uPhase'),
      uMouse: gl.getUniformLocation(fieldProg, 'uMouse'),
      uMouseVel: gl.getUniformLocation(fieldProg, 'uMouseVel'),
      uVortex: gl.getUniformLocation(fieldProg, 'uVortex'),
      uRipples: gl.getUniformLocation(fieldProg, 'uRipples'),
      uRippleCount: gl.getUniformLocation(fieldProg, 'uRippleCount')
    };

    const pLoc = {
      uRes: gl.getUniformLocation(particleProg, 'uRes'),
      uTime: gl.getUniformLocation(particleProg, 'uTime'),
      uVel: gl.getUniformLocation(particleProg, 'uVel'),
      uPhase: gl.getUniformLocation(particleProg, 'uPhase'),
      uMouse: gl.getUniformLocation(particleProg, 'uMouse'),
      uVortex: gl.getUniformLocation(particleProg, 'uVortex'),
      uRipples: gl.getUniformLocation(particleProg, 'uRipples'),
      uRippleCount: gl.getUniformLocation(particleProg, 'uRippleCount')
    };

    const rippleUniformBuf = new Float32Array(MAX_RIPPLES * 4);

    engineTag.textContent = `WEBGL2 · ${(COUNT / 1000).toFixed(1)}K`;

    return {
      isWebGL: true,
      resize(w, h) {
        gl.viewport(0, 0, w, h);
      },
      render() {
        const phase = mod(state.time, CYCLE_LEN) / CYCLE_LEN;
        const rCount = state.ripples.length;
        for (let i = 0; i < rCount; i++) {
          const r = state.ripples[i];
          const o = i * 4;
          rippleUniformBuf[o + 0] = r.x;
          rippleUniformBuf[o + 1] = 1.0 - r.y; // WebGL Y 轴朝上
          rippleUniformBuf[o + 2] = r.birthTime;
          rippleUniformBuf[o + 3] = r.strength;
        }

        // Pass 1: 水墨云海与折射涟漪
        gl.disable(gl.BLEND);
        gl.useProgram(fieldProg);
        gl.bindVertexArray(fieldVao);
        gl.uniform2f(fLoc.uRes, state.width, state.height);
        gl.uniform1f(fLoc.uTime, state.time);
        gl.uniform1f(fLoc.uVel, state.vel);
        gl.uniform1f(fLoc.uPhase, phase);
        gl.uniform2f(fLoc.uMouse, state.smoothMX, 1.0 - state.smoothMY);
        gl.uniform2f(fLoc.uMouseVel, state.mouseVX, -state.mouseVY);
        gl.uniform1f(fLoc.uVortex, state.vortex);
        gl.uniform4fv(fLoc.uRipples, rippleUniformBuf);
        gl.uniform1i(fLoc.uRippleCount, rCount);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Pass 2: 15,000 颗 3D 穿时粒子与星轨
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(particleProg);
        gl.bindVertexArray(pVao);
        gl.uniform2f(pLoc.uRes, state.width, state.height);
        gl.uniform1f(pLoc.uTime, state.time);
        gl.uniform1f(pLoc.uVel, state.vel);
        gl.uniform1f(pLoc.uPhase, phase);
        gl.uniform2f(pLoc.uMouse, state.smoothMX, 1.0 - state.smoothMY);
        gl.uniform1f(pLoc.uVortex, state.vortex);
        gl.uniform4fv(pLoc.uRipples, rippleUniformBuf);
        gl.uniform1i(pLoc.uRippleCount, rCount);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, COUNT);

        gl.bindVertexArray(null);
      }
    };
  }

  // ---------- 优雅降级：Canvas 2D 保底渲染器 ----------
  function createFallback2DRenderer() {
    const ctx = canvas.getContext('2d');
    const count = 900;
    const pts = Array.from({ length: count }, (_, i) => ({
      x: Math.sin(i * 12.9898) * 0.5 + 0.5,
      y: Math.cos(i * 78.233) * 0.5 + 0.5,
      z: (i / count),
      c: i % 5
    }));
    engineTag.textContent = 'CANVAS 2D';
    return {
      isWebGL: false,
      resize() {},
      render() {
        const w = state.width;
        const h = state.height;
        const phase = mod(state.time, CYCLE_LEN) / CYCLE_LEN;
        const dark = phase > 0.42 && phase < 0.92;
        ctx.fillStyle = dark ? '#161411' : '#efe8d8';
        ctx.fillRect(0, 0, w, h);

        for (const p of pts) {
          const z = mod(p.z - state.time * 0.06, 1.0);
          const scale = 1 / (0.15 + z * 0.9);
          const px = w * 0.5 + (p.x - 0.5) * w * 0.7 * scale;
          const py = h * 0.5 + (p.y - 0.5) * h * 0.7 * scale;
          const r = (1.5 + (1 - z) * 2.5) * state.dpr;
          ctx.fillStyle = p.c === 0
            ? (dark ? 'rgba(224,82,60,0.7)' : 'rgba(181,56,44,0.6)')
            : (dark ? 'rgba(240,224,190,0.55)' : 'rgba(33,31,25,0.45)');
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
  }

  let renderer = null;
  try {
    renderer = createWebGLRenderer();
  } catch (err) {
    console.warn('WebGL2 init fallback:', err);
  }
  if (!renderer) {
    renderer = createFallback2DRenderer();
  }

  // ---------- 尺寸自适应 ----------
  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    state.width = Math.max(1, Math.floor(window.innerWidth * state.dpr));
    state.height = Math.max(1, Math.floor(window.innerHeight * state.dpr));
    canvas.width = state.width;
    canvas.height = state.height;
    renderer.resize(state.width, state.height);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 拓印导出高清 PNG（带右下角朱砂印章款识） ----------
  function exportStampedPng() {
    const out = document.createElement('canvas');
    out.width = state.width;
    out.height = state.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);

    const pad = Math.round(28 * state.dpr);
    const eraTitle = ERA_NAMES[state.eraIndex] || ERA_NAMES[0];
    const signText = `${eraTitle} · T${state.time >= 0 ? '+' : ''}${state.time.toFixed(1)} · BOOE.XYZ`;

    // 落款小字
    ctx.save();
    ctx.font = `${Math.round(12 * state.dpr)}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = state.darkTone ? 'rgba(243,232,210,0.72)' : 'rgba(33,31,25,0.62)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(signText, out.width - pad - Math.round(54 * state.dpr), out.height - pad - Math.round(6 * state.dpr));

    // 朱砂方印「止一」
    const sealSize = Math.round(40 * state.dpr);
    const sx = out.width - pad - sealSize;
    const sy = out.height - pad - sealSize;
    ctx.translate(sx + sealSize / 2, sy + sealSize / 2);
    ctx.rotate(-0.08);
    ctx.fillStyle = '#b5382c';
    ctx.fillRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize);
    ctx.strokeStyle = 'rgba(247,242,231,0.85)';
    ctx.lineWidth = Math.max(1.5, 1.8 * state.dpr);
    ctx.strokeRect(-sealSize / 2 + 3 * state.dpr, -sealSize / 2 + 3 * state.dpr, sealSize - 6 * state.dpr, sealSize - 6 * state.dpr);
    ctx.fillStyle = '#f7f2e7';
    ctx.font = `900 ${Math.round(16 * state.dpr)}px "Noto Serif SC", SimSun, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('止一', 0, state.dpr * 1);
    ctx.restore();

    const a = document.createElement('a');
    a.download = `booe-ink-field-${Date.now()}.png`;
    a.href = out.toDataURL('image/png');
    a.click();
    showToast(`已拓印「${eraTitle}」高清画卷`);
  }

  // ---------- 鼠标、滚轮、触控与键盘交互 ----------
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    markInteracted();
    // 归一化滚轮增量（适配像素/行/页三种滚轮模式）
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;
    else if (e.deltaMode === 2) dy *= 400;
    const impulse = Math.max(-14, Math.min(14, dy * 0.018));
    state.vel = Math.max(-22, Math.min(22, state.vel + impulse));
  }, { passive: false });

  function updatePointer(clientX, clientY) {
    const nx = Math.max(0, Math.min(1, clientX / Math.max(1, window.innerWidth)));
    const ny = Math.max(0, Math.min(1, clientY / Math.max(1, window.innerHeight)));
    state.mouseVX = Math.max(-0.25, Math.min(0.25, (nx - state.mouseX) * 2.4));
    state.mouseVY = Math.max(-0.25, Math.min(0.25, (ny - state.mouseY) * 2.4));
    state.mouseX = nx;
    state.mouseY = ny;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    markInteracted();
    canvas.setPointerCapture(e.pointerId);
    updatePointer(e.clientX, e.clientY);
    state.pressing = true;
    state.pressStartMs = performance.now();
  });

  canvas.addEventListener('pointermove', (e) => {
    updatePointer(e.clientX, e.clientY);
  });

  function endPress(e) {
    if (!state.pressing) return;
    state.pressing = false;
    const heldMs = performance.now() - state.pressStartMs;
    const nx = state.mouseX;
    const ny = state.mouseY;
    if (heldMs > 300) {
      // 长按聚气后松手：高强度墨浪爆散！
      const power = Math.min(1.85, 1.1 + heldMs / 900);
      addRipple(nx, ny, power);
      sound.burst(nx, ny);
    } else {
      // 轻点落印：清透可逆涟漪
      addRipple(nx, ny, 0.95);
      sound.pluck(nx, ny, 0.95);
    }
    if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }

  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', () => { state.pressing = false; });

  // 底部时序尺拖拽（兼顾桌面与手机精确穿梭/倒流）
  function scrubToClientX(clientX) {
    const rect = scrubber.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const baseCycle = Math.floor(state.time / CYCLE_LEN) * CYCLE_LEN;
    const nextTime = baseCycle + ratio * CYCLE_LEN;
    const delta = nextTime - state.time;
    state.vel = Math.max(-18, Math.min(18, delta * 14));
    state.time = nextTime;
  }

  scrubber.addEventListener('pointerdown', (e) => {
    markInteracted();
    state.draggingScrubber = true;
    scrubber.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
  });

  scrubber.addEventListener('pointermove', (e) => {
    if (!state.draggingScrubber) return;
    scrubToClientX(e.clientX);
  });

  scrubber.addEventListener('pointerup', (e) => {
    state.draggingScrubber = false;
    if (scrubber.hasPointerCapture(e.pointerId)) scrubber.releasePointerCapture(e.pointerId);
  });

  scrubber.addEventListener('pointercancel', () => { state.draggingScrubber = false; });

  // 四时按钮平滑穿梭跳转
  eraBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      markInteracted();
      const idx = Number(btn.dataset.era);
      const targetPhase = idx * 0.25 + 0.04;
      const curPhase = mod(state.time, CYCLE_LEN) / CYCLE_LEN;
      let diff = targetPhase - curPhase;
      if (diff > 0.5) diff -= 1.0;
      if (diff < -0.5) diff += 1.0;
      state.vel = diff * CYCLE_LEN * 2.2;
      sound.pluck(idx / 3, 0.4, 0.8);
    });
  });

  // 顶部控制按钮
  function togglePause() {
    state.paused = !state.paused;
    state.targetVel = state.paused ? 0.0 : 0.34;
    if (state.paused) state.vel *= 0.2;
    btnPause.setAttribute('aria-pressed', String(state.paused));
    btnPause.textContent = state.paused ? '续流' : '定格';
  }

  btnPause.addEventListener('click', togglePause);
  btnSound.addEventListener('click', () => sound.toggle());
  btnGuide.addEventListener('click', () => {
    const next = guideBox.classList.toggle('is-hidden');
    btnGuide.setAttribute('aria-pressed', String(!next));
  });
  btnStamp.addEventListener('click', () => {
    state.exportRequested = true;
  });

  // 键盘快捷键：空格定格，左右方向键前进/倒流
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'ArrowRight') {
      markInteracted();
      state.vel = Math.min(18, state.vel + 3.2);
    } else if (e.key === 'ArrowLeft') {
      markInteracted();
      state.vel = Math.max(-18, state.vel - 3.2);
    }
  });

  // ---------- 主循环（切后台自动暂停省电） ----------
  let lastTs = performance.now();
  let lastUiUpdate = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) {
      lastTs = now;
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
    lastTs = now;

    // 1. 光标平滑与微风速度衰减
    state.smoothMX += (state.mouseX - state.smoothMX) * Math.min(1, dt * 10);
    state.smoothMY += (state.mouseY - state.smoothMY) * Math.min(1, dt * 10);
    state.mouseVX *= Math.pow(0.04, dt);
    state.mouseVY *= Math.pow(0.04, dt);

    // 2. 长按聚气漩涡（按住时局部凝滞时间感）
    const targetVortex = state.pressing ? 1.0 : 0.0;
    state.vortex += (targetVortex - state.vortex) * Math.min(1, dt * (state.pressing ? 4.5 : 8.0));

    // 3. 时间飞轮惯性与阻尼
    if (!state.draggingScrubber) {
      const restVel = state.paused ? 0.0 : (state.pressing ? 0.04 : state.targetVel);
      state.vel += (restVel - state.vel) * Math.min(1, dt * 2.35);
      const prevTime = state.time;
      state.time += state.vel * dt;

      // 倒流时光穿过已有涟漪原点时，触发清脆逆向微鸣！
      if (state.vel < -0.35 && sound.enabled) {
        for (const r of state.ripples) {
          if (prevTime > r.birthTime && state.time <= r.birthTime && !r.revChimed) {
            r.revChimed = true;
            sound.pluck(r.x, r.y, 0.7, true);
          } else if (state.time > r.birthTime + 0.4) {
            r.revChimed = false;
          }
        }
      }
    }

    sound.updateWind(state.vel);

    // 4. 渲染本帧
    renderer.render();

    // 5. 若请求拓印，在渲染完立即无损导出
    if (state.exportRequested) {
      state.exportRequested = false;
      exportStampedPng();
    }

    // 6. 低频更新顶部昼夜主题与底部时序尺（避免每帧 DOM 抖动）
    if (now - lastUiUpdate > 50) {
      lastUiUpdate = now;
      const phase = mod(state.time, CYCLE_LEN) / CYCLE_LEN;
      const era = Math.floor(phase * 4) % 4;
      const isDark = phase > 0.38 && phase < 0.90;

      if (isDark !== state.darkTone) {
        state.darkTone = isDark;
        document.body.dataset.tone = isDark ? 'dark' : 'light';
      }

      if (era !== state.eraIndex) {
        state.eraIndex = era;
        eraBtns.forEach((b, idx) => b.classList.toggle('is-active', idx === era));
      }

      const pct = (phase * 100).toFixed(2);
      scrubberThumb.style.left = pct + '%';
      scrubber.setAttribute('aria-valuenow', String(Math.round(phase * 100)));

      const sign = state.time >= 0 ? '+' : '-';
      const absT = Math.abs(state.time).toFixed(1).padStart(5, '0');
      timeCodeEl.textContent = `T ${sign}${absT}`;

      if (state.vel < -0.25) {
        timeDirEl.textContent = state.vel < -4 ? '↞ 疾速倒流' : '← 时光回溯';
        timeDirEl.classList.add('is-rev');
      } else if (state.vel > 3.5) {
        timeDirEl.textContent = '↠ 穿时探索';
        timeDirEl.classList.remove('is-rev');
      } else if (Math.abs(state.vel) < 0.08) {
        timeDirEl.textContent = '· 凝滞静观';
        timeDirEl.classList.remove('is-rev');
      } else {
        timeDirEl.textContent = '→ 缓行探索';
        timeDirEl.classList.remove('is-rev');
      }
    }
  }

  // 开场给一缕克制的初始水墨涟漪，让进入第一秒就有生命感
  setTimeout(() => {
    if (!state.hasInteracted) addRipple(0.54, 0.46, 0.85);
  }, 450);

  requestAnimationFrame(frame);
})();
