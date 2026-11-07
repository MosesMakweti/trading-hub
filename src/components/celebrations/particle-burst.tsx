"use client";

import { useEffect, useRef } from "react";

/**
 * A short, restrained particle burst for major celebrations: thin flecks in
 * the ink colour and the amber accent, falling and fading over ~1.6s. Drawn
 * on a canvas (no dependency), once, then gone. The caller only renders it
 * when animations are on and the trader hasn't asked for reduced motion.
 */
export function ParticleBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(canvas);
    const colours = [styles.getPropertyValue("--foreground").trim(), styles.getPropertyValue("--warning").trim()].filter(Boolean);
    const count = 90;
    const parts = Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 4 + Math.random() * 6;
      return {
        x: w / 2,
        y: h * 0.42,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        len: 4 + Math.random() * 6,
        colour: colours[i % colours.length] || "currentColor",
      };
    });

    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      const life = Math.min(1, elapsed / 1600);
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.18;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - life * life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.strokeStyle = p.colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-p.len / 2, 0);
        ctx.lineTo(p.len / 2, 0);
        ctx.stroke();
        ctx.restore();
      }
      if (life < 1) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
