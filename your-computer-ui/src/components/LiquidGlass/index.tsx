/**
 * LiquidGlass v2.0 — 真折射液态玻璃（WebGL）+ 四个控件
 * 作者：画心人 · MIT License · 零依赖（React 18+）
 *
 *   <LiquidGlass>        容器：自适应尺寸，子节点叠在玻璃上，支持动态磨砂参数
 *   <LiquidGlassCanvas>  一块 WebGL 画布：把背景画进去，再按 shapes 画出玻璃
 *   useSpring()          弹簧（默认 k 300 / ζ 0.5，会过冲）
 *   <GlassTabBar> <GlassToggle> <GlassSlider> <GlassCard>   四个控件
 *
 * 注意：同屏玻璃 ≤ 5 块；所有像素参数已自动 × min(devicePixelRatio, 2)。
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';

export type GlassShape = {
  x: number; y: number; w: number; h: number;   // 中心点 + 宽高（CSS px）
  r?: number;        // 圆角，默认 min(w,h)/2
  frost?: number;    // 0 透明玻璃 … 1 白色磨砂（开关静止态）
  mag?: number;      // 放大倍数（滑块放大镜），默认 1
  str?: number;      // 折射倍数，默认 1
  layer?: 0 | 1;     // 1 = 叠在 0 层玻璃上面（如标签栏指示器）
  tint?: number;     // 冷白着色 0~1
};
export type GlassParams = {strength?: number; chroma?: number; blur?: number; band?: number; edgeW?: number; edgeOp?: number; lightAng?: number; light?: number; merge?: number};
export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/** 容器对外磨砂配置（对应调试面板参数名） */
export type LiquidGlassConfig = {
  /** 折射强度 / Scale，常用 0~100 */
  scale?: number;
  /** 色散 / Aberration */
  aberration?: number;
  /** 边缘厚度 / Bevel Depth */
  bevelDepth?: number;
  /** 磨砂强度 / Frost，常用 0~10，内部映射到 0~1 */
  frost?: number;
  /** 冷白着色 / Tint，0~1 */
  tint?: number;
};

export const DEFAULT_LIQUID_GLASS_CONFIG: Required<LiquidGlassConfig> = {
  scale: 54,
  aberration: 10,
  bevelDepth: 2,
  frost: 2.4,
  tint: 0.34,
};

export function resolveLiquidGlassConfig(
  config?: LiquidGlassConfig,
): Required<LiquidGlassConfig> {
  // 用 nullish 合并，保证显式传入 0 生效（不会被默认值吞掉）
  return {
    scale: config?.scale ?? DEFAULT_LIQUID_GLASS_CONFIG.scale,
    aberration: config?.aberration ?? DEFAULT_LIQUID_GLASS_CONFIG.aberration,
    bevelDepth: config?.bevelDepth ?? DEFAULT_LIQUID_GLASS_CONFIG.bevelDepth,
    frost: config?.frost ?? DEFAULT_LIQUID_GLASS_CONFIG.frost,
    tint: config?.tint ?? DEFAULT_LIQUID_GLASS_CONFIG.tint,
  };
}

/** scale/frost 均为 0 时关闭玻璃效果，走纯色容器 */
export function isLiquidGlassDisabled(
  config: Required<LiquidGlassConfig>,
): boolean {
  return config.scale <= 0 && config.frost <= 0;
}

function configToGlass(
  config: Required<LiquidGlassConfig>,
  size: {w: number; h: number},
  radius: number,
): {params: GlassParams; shape: GlassShape} {
  const frost01 = Math.min(1, Math.max(0, config.frost / 10));
  const blur =
    config.frost <= 0 && config.scale <= 0 ? 0 : 1.2 + frost01 * 4;
  return {
    params: {
      strength: config.scale,
      chroma: config.aberration,
      edgeW: config.bevelDepth,
      blur,
      band: 56,
      edgeOp: config.bevelDepth <= 0 ? 0 : 0.72,
      light: config.scale <= 0 ? 0 : 0.28,
    },
    shape: {
      x: size.w / 2,
      y: size.h / 2,
      w: size.w,
      h: size.h,
      r: radius,
      frost: frost01,
      tint: config.tint,
      str: 1,
    },
  };
}

const containerBackground: Painter = (c, w, h) => {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fcfcfd');
  g.addColorStop(0.45, '#f8f9f9');
  g.addColorStop(1, '#eef1f1');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
};

const VS = `attribute vec2 a;
varying vec2 vUv;
void main() { vUv = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;
const FS = `precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform int uN;
uniform vec4 uR[8]; uniform vec4 uS[8]; uniform vec4 uT[8];
uniform vec4 uP; uniform vec4 uE; uniform vec2 uM; varying vec2 vUv;
float sdRB(vec2 p, vec2 b, float r){ r = min(r, min(b.x, b.y)); vec2 q = abs(p) - b + r; return min(max(q.x,q.y),0.) + length(max(q,0.)) - r; }
float smin(float a, float b, float k){ if(k <= .01) return min(a,b); float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b,a,h) - k*h*(1.-h); }
float scene(vec2 p, float L){
  float d = 1e5;
  for(int i=0;i<8;i++){
    if(i < uN){
      if(abs(uT[i].x - L) <= .5){
        d = smin(d, sdRB(p - uR[i].xy, uR[i].zw, uS[i].x), uM.x);
      }
    }
  }
  return d;
}
vec3 tap(vec2 px, vec2 ca){ vec2 u = px/uRes; vec2 c = ca/uRes; return vec3(texture2D(uTex, clamp(u+c,.001,.999)).r, texture2D(uTex, clamp(u,.001,.999)).g, texture2D(uTex, clamp(u-c,.001,.999)).b); }
vec4 glass(vec2 p, float L){
  float d = scene(p, L); if(d > 3.) return vec4(0.);
  float e = 1.5; vec2 g = normalize(vec2(scene(p+vec2(e,0.),L)-scene(p-vec2(e,0.),L), scene(p+vec2(0.,e),L)-scene(p-vec2(0.,e),L)) + 1e-6);
  float best = 1e5; vec4 R = uR[0]; vec4 S = uS[0]; vec4 Tt = uT[0];
  for(int i=0;i<8;i++){
    if(i < uN){
      if(abs(uT[i].x - L) <= .5){
        float di = sdRB(p - uR[i].xy, uR[i].zw, uS[i].x);
        if(di < best){ best = di; R = uR[i]; S = uS[i]; Tt = uT[i]; }
      }
    }
  }
  float t = clamp(-d/max(uP.w,1.), 0., 1.); float k = pow(1. - pow(t, .30), 2.);
  vec2 q = p; if(S.z > 1.001) q = R.xy + (p - R.xy)/S.z;
  vec2 refr = -g*k*uP.x*S.w; vec2 ca = -g*k*uP.y*S.w; vec2 bp = q + refr; float bs = uP.z;
  vec3 s = tap(bp,ca) + tap(bp+vec2(bs,0.),ca) + tap(bp-vec2(bs,0.),ca) + tap(bp+vec2(0.,bs),ca) + tap(bp-vec2(0.,bs),ca); s /= 5.;
  vec3 col = s*1.06 + vec3(.015,.025,.048);
  col += smoothstep(R.w*.35, -R.w*1.1, p.y-R.y) * vec3(.055,.075,.105);
  col = mix(col, vec3(.97,.98,1.), S.y*.85);
  col = mix(col, vec3(.88,.94,1.), max(uM.y, Tt.y));
  vec2 Ld = vec2(cos(uE.z), sin(uE.z)); float rim = 1. - smoothstep(0., 7., -d);
  col += uE.w * rim * pow(max(dot(g, Ld), 0.), 2.);
  col += uE.w * .45 * rim * pow(max(dot(g, -Ld), 0.), 3.);
  float line = 1. - smoothstep(0., uE.x, abs(d)); col = mix(col, vec3(1.), line*uE.y);
  float inside = 1. - smoothstep(-.8, .8, d);
  return vec4(col, max(inside, line*uE.y));
}
void main(){
  vec2 p = vUv*uRes; vec3 c = texture2D(uTex, vUv).rgb;
  vec4 a = glass(p, 0.); c = mix(c, a.rgb, a.a);
  vec4 b = glass(p, 1.); c = mix(c, b.rgb, b.a);
  gl_FragColor = vec4(c, 1.);
}`;
const MAXN = 8;

export const defaultBackground: Painter = (c, w, h, t) => {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#e3edfc'); g.addColorStop(0.45, '#9cc0f5'); g.addColorStop(1, '#f2c4e0');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,.65)'; c.font = `800 ${Math.min(w * 0.3, h * 0.5)}px Inter, "Segoe UI", Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Glass', w / 2 + 10 * Math.sin(t * 0.4), h / 2); c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,.4)'; for (let y = 30; y < h; y += 56) c.fillRect(0, y, w, 1.5);
};

/** 一块 WebGL 画布：每帧调用 paint 画背景 → 上传纹理 → 画玻璃。children 绝对定位叠在上面（文字、图标）。 */
export function LiquidGlassCanvas(props: {width: number; height: number; shapes: GlassShape[]; params?: GlassParams; paint?: Painter; style?: React.CSSProperties; children?: React.ReactNode; onWebglError?: (err: Error) => void} & React.HTMLAttributes<HTMLDivElement>) {
  const {width, height, shapes, params = {}, paint = defaultBackground, style, children, onWebglError, ...rest} = props;
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({shapes, params, paint});
  live.current = {shapes, params, paint};
  const onErrorRef = useRef(onWebglError);
  onErrorRef.current = onWebglError;
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
  useEffect(() => {
    const canvas = cv.current; if (!canvas) return;
    // Strict Mode 卸载后 context 可能已失效，强制换新 canvas 节点再取 context
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', {premultipliedAlpha: false, antialias: true});
    } catch {
      gl = null;
    }
    if (!gl || gl.isContextLost()) {
      onErrorRef.current?.(new Error('WebGL unavailable'));
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('createShader failed');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? 'shader';
        gl.deleteShader(s);
        throw new Error(log);
      }
      return s;
    };

    let prog: WebGLProgram | null = null;
    let raf = 0;
    try {
      prog = gl.createProgram();
      if (!prog) throw new Error('createProgram failed');
      const vs = compile(gl.VERTEX_SHADER, VS);
      const fs = compile(gl.FRAGMENT_SHADER, FS);
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? 'program');
      }
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const U = (n: string) => gl.getUniformLocation(prog!, n);
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d');
    if (!ctx) {
      onErrorRef.current?.(new Error('2d context unavailable'));
      return;
    }

    const loop = (now: number) => {
      if (gl.isContextLost()) return;
      const {shapes: sh0, params: p, paint: pt} = live.current;
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      pt(ctx, width, height, t);
      const n = Math.min(sh0.length, MAXN);
      const R = new Float32Array(MAXN * 4);
      const S = new Float32Array(MAXN * 4);
      const T = new Float32Array(MAXN * 4);
      sh0.slice(0, n).forEach((o, i) => {
        R.set([o.x * dpr, o.y * dpr, (o.w * dpr) / 2, (o.h * dpr) / 2], i * 4);
        S.set([(o.r ?? Math.min(o.w, o.h) / 2) * dpr, o.frost ?? 0, o.mag ?? 1, o.str ?? 1], i * 4);
        T.set([o.layer ?? 0, o.tint ?? 0, 0, 0], i * 4);
      });
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
      gl.uniform1i(U('uTex'), 0);
      gl.uniform2f(U('uRes'), canvas.width, canvas.height);
      gl.uniform1i(U('uN'), n);
      gl.uniform4fv(U('uR'), R);
      gl.uniform4fv(U('uS'), S);
      gl.uniform4fv(U('uT'), T);
      gl.uniform4f(U('uP'), (p.strength ?? 48) * dpr, (p.chroma ?? 12) * dpr, (p.blur ?? 1.2) * dpr, (p.band ?? 60) * dpr);
      gl.uniform4f(U('uE'), (p.edgeW ?? 1.5) * dpr, p.edgeOp ?? 0.85, p.lightAng ?? -2.2, p.light ?? 0.35);
      gl.uniform2f(U('uM'), (p.merge ?? 0) * dpr, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      // 不主动 loseContext，避免 React Strict Mode 二次挂载拿到失效 context
    };
  }, [width, height, dpr]);
  return (
    <div {...rest} style={{position: 'relative', width, height, overflow: 'hidden', touchAction: 'none', userSelect: 'none', ...style}}>
      <canvas ref={cv} width={Math.round(width * dpr)} height={Math.round(height * dpr)} style={{position: 'absolute', inset: 0, width, height}} />
      {children}
    </div>
  );
}

/** 弹簧：值会追向 target。默认 k 300 / ζ 0.5（按钮按压，会冲过头再晃回来）。 */
export function useSpring(target: number, k = 300, z = 0.5) {
  const s = useRef({x: target, v: 0});
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const st = s.current, acc = -k * (st.x - target) - 2 * z * Math.sqrt(k) * st.v;
      st.v += acc * dt; st.x += st.v * dt;
      force((n) => n + 1);
      if (Math.abs(st.x - target) > 1e-4 || Math.abs(st.v) > 1e-4) raf = requestAnimationFrame(tick);
      else { st.x = target; st.v = 0; }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, k, z]);
  return s.current;
}
const local = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };

/* ---------- 01 底部标签栏：拖动指示器会顺着方向拉长，停下弹一下 ---------- */
export function GlassTabBar({tabs, value, onChange, width = 390, height = 120, paint}: {tabs: string[]; value: number; onChange: (i: number) => void; width?: number; height?: number; paint?: Painter}) {
  const [drag, setDrag] = useState<number | null>(null);
  const pos = useSpring(drag ?? value, 300, 0.5), press = useSpring(drag === null ? 0 : 1, 1000, 1);
  const bw = width - 24, bh = 72, by = height - bh / 2 - 12, tw = (bw - 16) / tabs.length, x0 = width / 2 - bw / 2 + 8;
  const st = Math.min(0.5, Math.abs(pos.v) * 0.06), sc = 1 + 0.3 * press.x;
  const at = (x: number) => Math.min(tabs.length - 1, Math.max(0, (x - x0) / tw - 0.5));
  return (
    <LiquidGlassCanvas width={width} height={height} paint={paint} params={{strength: 40, band: 36}}
      shapes={[{x: width / 2, y: by, w: bw, h: bh, tint: 0.1}, {x: x0 + tw * (pos.x + 0.5), y: by, w: (tw - 8) * (1 + st) * sc, h: (bh - 14) * (1 - st * 0.35) * sc, layer: 1, mag: 1.12, tint: 0.08}]}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(at(local(e).x)); }}
      onPointerMove={(e) => { if (drag !== null) setDrag(at(local(e).x)); }}
      onPointerUp={() => { if (drag !== null) onChange(Math.round(drag)); setDrag(null); }}>
      {tabs.map((t, i) => (
        <div key={t} style={{position: 'absolute', left: x0 + tw * (i + 0.5), top: by, transform: 'translate(-50%,-50%)', fontSize: 14, fontWeight: 700, color: Math.abs(pos.x - i) < 0.5 ? '#2f6fe0' : '#24324a', pointerEvents: 'none'}}>{t}</div>
      ))}
    </LiquidGlassCanvas>
  );
}

/* ---------- 02 开关：平时白色滑块，按下变透明玻璃珠；横纵弹簧阻尼不同 → 果冻感 ---------- */
export function GlassToggle({checked, onChange, paint}: {checked: boolean; onChange: (v: boolean) => void; paint?: Painter}) {
  const [down, setDown] = useState(false);
  const frac = useSpring(checked ? 1 : 0, 1000, 1), pr = useSpring(down ? 1 : 0, 1000, 1);
  const sx = useSpring(down ? 1.12 : 1, 250, 0.6), sy = useSpring(down ? 0.9 : 1, 250, 0.7);
  const W = 140, H = 80, tw = 88, th = 40, tx = (W - tw) / 2, kx = tx + 20 + frac.x * (tw - 40), ks = 34 + 22 * pr.x;
  const bg: Painter = (c, w, h, t) => {
    (paint ?? defaultBackground)(c, w, h, t);
    const v = frac.x; c.fillStyle = `rgb(${(205 - 153 * v) | 0},${(210 - 11 * v) | 0},${(220 - 131 * v) | 0})`;
    c.beginPath(); c.roundRect(tx, H / 2 - th / 2, tw, th, th / 2); c.fill();
  };
  return (
    <LiquidGlassCanvas width={W} height={H} paint={bg} params={{strength: 26, chroma: 8, band: 24}} role="switch" aria-checked={checked}
      shapes={[{x: kx, y: H / 2, w: ks * sx.x, h: ks * sy.x, frost: 1 - pr.x, mag: 1 + 0.25 * pr.x, str: 1.3}]}
      onPointerDown={() => setDown(true)} onPointerUp={() => { setDown(false); onChange(!checked); }} onPointerLeave={() => setDown(false)} />
  );
}

/* ---------- 03 滑块：拖动时滑块变成放大镜，压在轨道上 ---------- */
export function GlassSlider({value, onChange, width = 320, paint}: {value: number; onChange: (v: number) => void; width?: number; paint?: Painter}) {
  const [drag, setDrag] = useState(false);
  const pr = useSpring(drag ? 1 : 0, 1000, 1);
  const H = 90, tx = 30, tw = width - 60, ty = H / 2, s = 1 + 0.9 * pr.x;
  const bg: Painter = (c, w, h, t) => {
    (paint ?? defaultBackground)(c, w, h, t);
    c.fillStyle = 'rgba(30,40,60,.18)'; c.beginPath(); c.roundRect(tx, ty - 5, tw, 10, 5); c.fill();
    c.fillStyle = '#3d7ff0'; c.beginPath(); c.roundRect(tx, ty - 5, Math.max(10, value * tw), 10, 5); c.fill();
    c.fillStyle = 'rgba(30,40,60,.45)'; for (let i = 0; i <= 10; i++) c.fillRect(tx + (tw * i) / 10 - 1, ty + 14, 2, i % 5 ? 6 : 12);
  };
  const set = (e: React.PointerEvent) => onChange(Math.min(1, Math.max(0, (local(e).x - tx) / tw)));
  return (
    <LiquidGlassCanvas width={width} height={H} paint={bg} params={{strength: 30, band: 30}}
      shapes={[{x: tx + value * tw, y: ty, w: 40 * s * 1.25, h: 40 * s * 0.9, frost: 1 - pr.x, mag: 1 + 0.9 * pr.x}]}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); set(e); }}
      onPointerMove={(e) => { if (drag) set(e); }} onPointerUp={() => setDrag(false)} />
  );
}

/* ---------- 04 玻璃卡片：拖到哪里，哪里的背景就被弯折 ---------- */
export function GlassCard({width = 640, height = 420, cardW = 300, cardH = 190, paint, children}: {width?: number; height?: number; cardW?: number; cardH?: number; paint?: Painter; children?: React.ReactNode}) {
  const [p, setP] = useState({x: width / 2, y: height / 2});
  const grab = useRef<{dx: number; dy: number} | null>(null);
  return (
    <LiquidGlassCanvas width={width} height={height} paint={paint} params={{strength: 60, chroma: 14, band: 70}} shapes={[{x: p.x, y: p.y, w: cardW, h: cardH, r: 44}]}
      onPointerDown={(e) => { const q = local(e); if (Math.abs(q.x - p.x) < cardW / 2 && Math.abs(q.y - p.y) < cardH / 2) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); grab.current = {dx: q.x - p.x, dy: q.y - p.y}; } }}
      onPointerMove={(e) => { if (grab.current) { const q = local(e); setP({x: q.x - grab.current.dx, y: q.y - grab.current.dy}); } }}
      onPointerUp={() => { grab.current = null; }}>
      <div style={{position: 'absolute', left: p.x - cardW / 2, top: p.y - cardH / 2, width: cardW, height: cardH, padding: 24, boxSizing: 'border-box', color: '#fff', textShadow: '0 1px 8px rgba(20,30,70,.35)', pointerEvents: 'none'}}>
        {children ?? <><div style={{fontSize: 13, opacity: 0.85}}>YeMotion · 第二期</div><div style={{fontSize: 36, fontWeight: 900, marginTop: 30}}>画心人</div></>}
      </div>
    </LiquidGlassCanvas>
  );
}

/* ---------- 05 容器：自适应父级尺寸，动态磨砂参数，子节点叠在玻璃上 ---------- */
export type LiquidGlassProps = {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** 内容层 class，默认纵向 flex；整窗包裹可用横向 */
  contentClassName?: string;
  /** Scale / Aberration / Bevel Depth / Frost / Tint */
  config?: LiquidGlassConfig;
  /** 背景绘制；默认浅灰以贴近 Finder 侧栏 */
  paint?: Painter;
  /** 玻璃圆角（CSS px） */
  radius?: number;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>;

function cssFrostFallback(
  config: Required<LiquidGlassConfig>,
): React.CSSProperties {
  if (isLiquidGlassDisabled(config)) {
    return {
      background: 'var(--finder-sidebar, #f8f9f9)',
      border: 'none',
      boxShadow: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    };
  }
  const frost01 = Math.min(1, Math.max(0, config.frost / 10));
  const blur = frost01 <= 0 ? 0 : 12 + frost01 * 28;
  const white = 0.55 + config.tint * 0.25 + frost01 * 0.2;
  return {
    background: `rgba(248, 249, 249, ${Math.min(0.92, white)})`,
    border: 'none',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
    ...(blur > 0
      ? {
          backdropFilter: `blur(${blur}px) saturate(${120 + config.scale}%)`,
          WebkitBackdropFilter: `blur(${blur}px) saturate(${120 + config.scale}%)`,
        }
      : {backdropFilter: 'none', WebkitBackdropFilter: 'none'}),
  };
}

export function LiquidGlass({
  children,
  className,
  contentClassName = 'flex h-full min-h-0 w-full flex-col',
  style,
  config,
  paint = containerBackground,
  radius = 16,
  ...rest
}: LiquidGlassProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w: 0, h: 0});
  const [useFallback, setUseFallback] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const resolved = useMemo(() => resolveLiquidGlassConfig(config), [config]);
  const disabled = isLiquidGlassDisabled(resolved);
  const glass = useMemo(
    () =>
      !disabled && size.w > 0 && size.h > 0
        ? configToGlass(resolved, size, radius)
        : null,
    [disabled, resolved, size, radius],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      // 用 layout 尺寸，避免父级 CSS transform/scale 污染 getBoundingClientRect
      const w = Math.max(0, Math.round(el.clientWidth));
      const h = Math.max(0, Math.round(el.clientHeight));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : {w, h}));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 尺寸变化时换新 canvas，避开复用失效 WebGL context
  useEffect(() => {
    if (size.w > 0 && size.h > 0) setCanvasKey((k) => k + 1);
  }, [size.w, size.h]);

  const flat = disabled || useFallback;
  const content = (
    <div
      className={contentClassName}
      style={{
        position: flat ? 'relative' : 'absolute',
        inset: 0,
        minHeight: 0,
        height: '100%',
        width: '100%',
        pointerEvents: 'auto',
        zIndex: 1,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );

  return (
    <div
      {...rest}
      ref={rootRef}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radius,
        ...(disabled || useFallback ? cssFrostFallback(resolved) : null),
        ...style,
      }}
    >
      {!disabled && !useFallback && glass ? (
        <LiquidGlassCanvas
          key={canvasKey}
          width={size.w}
          height={size.h}
          shapes={[glass.shape]}
          params={glass.params}
          paint={paint}
          onWebglError={(err) => {
            console.warn('[LiquidGlass] fallback to CSS frost:', err.message);
            setUseFallback(true);
          }}
          style={{position: 'absolute', inset: 0, borderRadius: radius}}
        >
          {content}
        </LiquidGlassCanvas>
      ) : (
        content
      )}
    </div>
  );
}
