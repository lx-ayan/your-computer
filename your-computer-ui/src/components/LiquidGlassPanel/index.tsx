/**
 * 独立液态玻璃容器（WebGL2 + CSS backdrop）
 *
 * - refraction: 折射强度 0~100
 * - frost: 磨砂强度 0~10
 * - opacity: 玻璃底色不透明度 0~1（越小越透）
 * - tint / aberration / bevelDepth / radius 同 LiquidGlass 语义
 *
 * 原理：下层 CSS backdrop-filter 负责「透出并模糊真实背景」；
 * 上层 WebGL2 在透明画布上绘制折射/色散/高光，避免整块画布盖死背景。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type LiquidGlassPanelConfig = {
  /** 折射强度，常用 0~100 */
  refraction?: number;
  /** 磨砂强度，常用 0~10 */
  frost?: number;
  /** 底色不透明度 0~1，越小越透明 */
  opacity?: number;
  /** 色散 */
  aberration?: number;
  /** 边缘厚度 */
  bevelDepth?: number;
  /** 冷白/着色 0~1；深色玻璃可配低 tint */
  tint?: number;
  /** 深色玻璃模式：底色偏黑 */
  dark?: boolean;
};

export const DEFAULT_LIQUID_GLASS_PANEL_CONFIG: Required<
  Omit<LiquidGlassPanelConfig, "dark">
> & { dark: boolean } = {
  refraction: 42,
  frost: 3.2,
  opacity: 0.28,
  aberration: 8,
  bevelDepth: 1.6,
  tint: 0.22,
  dark: false,
};

export function resolvePanelConfig(
  config?: LiquidGlassPanelConfig,
): Required<LiquidGlassPanelConfig> {
  return {
    refraction: config?.refraction ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.refraction,
    frost: config?.frost ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.frost,
    opacity: config?.opacity ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.opacity,
    aberration: config?.aberration ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.aberration,
    bevelDepth: config?.bevelDepth ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.bevelDepth,
    tint: config?.tint ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.tint,
    dark: config?.dark ?? DEFAULT_LIQUID_GLASS_PANEL_CONFIG.dark,
  };
}

const VS = `#version 300 es
in vec2 a;
out vec2 vUv;
void main(){
  vUv = vec2(a.x * .5 + .5, .5 - a.y * .5);
  gl_Position = vec4(a, 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uRefr;
uniform float uFrost;
uniform float uOpacity;
uniform float uAberr;
uniform float uBevel;
uniform float uTint;
uniform float uDark;
uniform float uTime;
uniform float uRadius;
in vec2 vUv;
out vec4 fragColor;

float sdRoundBox(vec2 p, vec2 b, float r){
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.) + length(max(q, 0.)) - r;
}

float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1., 0.));
  float c = hash(i + vec2(0., 1.));
  float d = hash(i + vec2(1., 1.));
  vec2 u = f * f * (3. - 2. * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1. - u.x) + (d - b) * u.x * u.y;
}

void main(){
  vec2 p = (vUv * 2. - 1.) * uRes * .5;
  vec2 halfSize = uRes * .5 - 1.5;
  float radius = clamp(uRadius, 0., min(halfSize.x, halfSize.y));
  float d = sdRoundBox(p, halfSize, radius);

  // 圆角外完全透明，露出真实背景
  if (d > 2.) {
    fragColor = vec4(0.);
    return;
  }

  float inside = 1. - smoothstep(-1., 1.2, d);
  float edge = 1. - smoothstep(0., max(uBevel * 4., 1.), abs(d));

  // 法线近似 → 折射偏移（可视化波纹/拉丝）
  float e = 1.5;
  vec2 n = normalize(vec2(
    sdRoundBox(p + vec2(e, 0.), halfSize, radius) - sdRoundBox(p - vec2(e, 0.), halfSize, radius),
    sdRoundBox(p + vec2(0., e), halfSize, radius) - sdRoundBox(p - vec2(0., e), halfSize, radius)
  ) + 1e-5);

  float t = clamp(-d / max(uRes.y * .08, 8.), 0., 1.);
  float k = pow(1. - pow(t, .32), 2.);
  float refrAmt = clamp(uRefr / 100., 0., 1.5);
  float refrAmp = refrAmt * 18. * k;
  vec2 offset = -n * refrAmp / max(uRes.y, 1.);

  // 色散：RGB 错位 + 折射波纹
  float ca = uAberr * .012 * k * (0.4 + refrAmt);
  float n0 = noise((vUv + offset) * uRes * .11 + uTime * .22);
  float n1 = noise((vUv + offset + n * ca) * uRes * .13 - uTime * .18);
  float n2 = noise((vUv + offset - n * ca) * uRes * .1 + uTime * .16);
  float wave = noise(vUv * uRes * .045 + n * refrAmp * .02 + uTime * .35);

  vec3 baseDark = vec3(0.12, 0.13, 0.15);
  vec3 baseLight = vec3(0.92, 0.94, 0.98);
  vec3 base = mix(baseLight, baseDark, uDark);

  // 磨砂：噪声打散 + 提亮（frost=0 时不掺颗粒）
  float frostMix = clamp(uFrost / 10., 0., 1.);
  vec3 grain = vec3(n0, n1, n2);
  vec3 col = mix(base, mix(base, grain, .55), frostMix * .65);

  // 冷白着色
  col = mix(col, vec3(0.88, 0.94, 1.0), uTint * .55);

  // 边缘折射高光 / 色散条（低 opacity、无 frost 时仍可见）
  vec2 Ld = normalize(vec2(-0.55, 0.75));
  float rim = pow(max(dot(n, Ld), 0.), 1.6) * edge;
  float band = k * edge * (0.45 + refrAmt);
  vec3 caustic = vec3(n0, n1, n2);
  col += rim * mix(vec3(1.), vec3(0.75, 0.9, 1.), uDark) * (0.55 + refrAmt * 0.9);
  col += band * caustic * vec3(0.55, 0.85, 1.15) * (0.35 + refrAmt * 0.8);
  col += band * wave * vec3(1.0, 0.95, 0.85) * (0.2 + refrAmt * 0.45);
  col += edge * (1. - uDark) * 0.18;
  col -= (1. - edge) * uDark * 0.06 * frostMix;

  // 填充可极透；折射边带单独抬 alpha，避免被 frost/opacity 乘没
  float fillA = clamp(uOpacity, 0., 1.) * inside * (0.55 + frostMix * 0.35);
  float edgeA = band * (0.28 + refrAmt * 0.55 + uAberr * 0.012);
  float alpha = clamp(max(fillA, edgeA), 0., 0.92);

  fragColor = vec4(col * alpha, alpha);
}
`;

function createGl(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("WebGL2 unavailable");
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "shader error";
    gl.deleteShader(s);
    throw new Error(log);
  }
  return s;
}

type Props = {
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
  config?: LiquidGlassPanelConfig;
  /** 圆角 px */
  radius?: number;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "content">;

export function LiquidGlassPanel({
  children,
  className,
  contentClassName = "flex h-full min-h-0 w-full flex-col",
  style,
  config,
  radius = 22,
  ...rest
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [webglOk, setWebglOk] = useState(true);
  const resolved = useMemo(() => resolvePanelConfig(config), [config]);
  const cfgRef = useRef(resolved);
  cfgRef.current = resolved;
  const radiusRef = useRef(radius);
  radiusRef.current = radius;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(0, Math.round(el.clientWidth));
      const h = Math.max(0, Math.round(el.clientHeight));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0 || !webglOk) return;

    let gl: WebGL2RenderingContext;
    try {
      gl = createGl(canvas);
    } catch (err) {
      console.warn("[LiquidGlassPanel] fallback CSS only", err);
      setWebglOk(false);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(size.w * dpr));
    canvas.height = Math.max(1, Math.round(size.h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);

    let prog: WebGLProgram | null = null;
    let raf = 0;
    let disposed = false;

    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VS);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
      prog = gl.createProgram();
      if (!prog) throw new Error("createProgram failed");
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(prog, "uRes");
      const uRefr = gl.getUniformLocation(prog, "uRefr");
      const uFrost = gl.getUniformLocation(prog, "uFrost");
      const uOpacity = gl.getUniformLocation(prog, "uOpacity");
      const uAberr = gl.getUniformLocation(prog, "uAberr");
      const uBevel = gl.getUniformLocation(prog, "uBevel");
      const uTint = gl.getUniformLocation(prog, "uTint");
      const uDark = gl.getUniformLocation(prog, "uDark");
      const uTime = gl.getUniformLocation(prog, "uTime");
      const uRadius = gl.getUniformLocation(prog, "uRadius");

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const t0 = performance.now();
      const frame = () => {
        if (disposed) return;
        const c = cfgRef.current;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.uniform2f(uRes, size.w, size.h);
        gl.uniform1f(uRefr, c.refraction);
        gl.uniform1f(uFrost, c.frost);
        gl.uniform1f(uOpacity, c.opacity);
        gl.uniform1f(uAberr, c.aberration);
        gl.uniform1f(uBevel, c.bevelDepth);
        gl.uniform1f(uTint, c.tint);
        gl.uniform1f(uDark, c.dark ? 1 : 0);
        gl.uniform1f(uTime, (performance.now() - t0) * 0.001);
        gl.uniform1f(uRadius, radiusRef.current);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    } catch (err) {
      console.warn("[LiquidGlassPanel] shader failed", err);
      setWebglOk(false);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (prog) gl.deleteProgram(prog);
    };
  }, [size.w, size.h, webglOk]);

  const frost01 = Math.min(1, Math.max(0, resolved.frost / 10));
  const blurPx = frost01 <= 0 ? 0 : 10 + frost01 * 36;
  const baseRgb = resolved.dark ? "22, 22, 26" : "248, 249, 251";
  const fillAlpha = Math.min(0.85, Math.max(0.04, resolved.opacity));

  return (
    <div
      {...rest}
      ref={rootRef}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        isolation: "isolate",
        background: `rgba(${baseRgb}, ${fillAlpha})`,
        border: resolved.dark
          ? "1px solid rgba(255,255,255,0.28)"
          : "1px solid rgba(255,255,255,0.55)",
        boxShadow: resolved.dark
          ? "0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35)"
          : "0 12px 40px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)",
        ...(blurPx > 0
          ? {
              backdropFilter: `blur(${blurPx}px) saturate(${140 + resolved.refraction}%)`,
              WebkitBackdropFilter: `blur(${blurPx}px) saturate(${140 + resolved.refraction}%)`,
            }
          : null),
        ...style,
      }}
    >
      {webglOk ? (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ borderRadius: radius }}
          aria-hidden
        />
      ) : null}
      <div
        className={contentClassName}
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          width: "100%",
          minHeight: 0,
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}
