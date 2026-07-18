import { useEffect, useRef } from "react";
import type { Sample } from "../lib/engine";

/**
 * The signature element: a live dual-trace oscilloscope.
 * Cyan area = throughput (Mbps). Amber line = latency probes (ms).
 * Draws continuously while the test runs; the frozen trace IS the result.
 */
export default function Scope({
  samples,
  running,
}: {
  samples: Sample[];
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Graticule
      ctx.strokeStyle = "rgba(139, 152, 169, 0.12)";
      ctx.lineWidth = 1;
      const cols = 12;
      const rows = 5;
      for (let i = 1; i < cols; i++) {
        ctx.beginPath();
        ctx.moveTo((w / cols) * i + 0.5, 0);
        ctx.lineTo((w / cols) * i + 0.5, h);
        ctx.stroke();
      }
      for (let i = 1; i < rows; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (h / rows) * i + 0.5);
        ctx.lineTo(w, (h / rows) * i + 0.5);
        ctx.stroke();
      }

      const data = samplesRef.current;
      if (data.length === 0) {
        if (running) raf = requestAnimationFrame(draw);
        return;
      }

      const tMax = Math.max(data[data.length - 1].t, 4000);
      const x = (t: number) => (t / tMax) * w;

      // Throughput trace (area, cyan)
      const tps = data.filter((s) => s.mbps !== undefined);
      const mbpsMax = Math.max(...tps.map((s) => s.mbps ?? 0), 10) * 1.15;
      if (tps.length > 1) {
        ctx.beginPath();
        ctx.moveTo(x(tps[0].t), h);
        for (const s of tps) ctx.lineTo(x(s.t), h - ((s.mbps ?? 0) / mbpsMax) * h);
        ctx.lineTo(x(tps[tps.length - 1].t), h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(94, 234, 212, 0.28)");
        grad.addColorStop(1, "rgba(94, 234, 212, 0.02)");
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < tps.length; i++) {
          const px = x(tps[i].t);
          const py = h - ((tps[i].mbps ?? 0) / mbpsMax) * h;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "#5EEAD4";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Latency trace (dots + line, amber)
      const lat = data.filter((s) => s.rttMs !== undefined);
      if (lat.length > 0) {
        const rttMax = Math.max(...lat.map((s) => s.rttMs ?? 0), 60) * 1.2;
        ctx.beginPath();
        for (let i = 0; i < lat.length; i++) {
          const px = x(lat[i].t);
          const py = h - ((lat[i].rttMs ?? 0) / rttMax) * h;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(255, 180, 84, 0.85)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        for (const s of lat) {
          ctx.beginPath();
          ctx.arc(x(s.t), h - ((s.rttMs ?? 0) / rttMax) * h, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "#FFB454";
          ctx.fill();
        }
      }

      // Sweep line while running
      if (running) {
        const px = x(data[data.length - 1].t);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.strokeStyle = "rgba(94, 234, 212, 0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, samples.length === 0]);

  return (
    <div className="scope">
      <canvas ref={canvasRef} className="scope__canvas" />
      <div className="scope__legend">
        <span><i className="dot dot--cyan" /> throughput</span>
        <span><i className="dot dot--amber" /> latency probes</span>
      </div>
    </div>
  );
}
