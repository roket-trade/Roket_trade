import { useEffect, useRef } from "react";

type Candle = { o: number; c: number; h: number; l: number; v: number; t: number };
type Label = { text: string; idx: number; born: number; buy: boolean };

// Purely simulated candles — no market data is used.
export function CandleChart() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const green = v("--primary"), red = v("--destructive"), grid = v("--border");
    const muted = v("--muted-foreground"), blue = v("--secondary"), fg = v("--primary-foreground");

    const W = 14, AXIS_R = 62, AXIS_B = 24, SPEED = 18; // px per second
    const candles: Candle[] = [];
    let price = 64250, time = Date.now() - 200 * 60000, serial = 0;
    const next = (): Candle => {
      const up = Math.random() < 0.6;
      const move = (Math.random() * 90 + 10) * (up ? 1 : -0.85);
      const o = price, c = price + move;
      price = c;
      time += 60000;
      serial++;
      return { o, c, h: Math.max(o, c) + Math.random() * 40, l: Math.min(o, c) - Math.random() * 40, v: Math.random() * 0.8 + 0.2, t: time };
    };
    for (let i = 0; i < 120; i++) candles.push(next());
    const labels: Label[] = [];
    let offset = 0, last = performance.now(), raf = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      offset += dt * SPEED;
      while (offset >= W) {
        offset -= W;
        candles.shift();
        candles.push(next());
        if (serial % 6 === 0) labels.push({ text: "BUY", idx: serial, born: t, buy: true });
        if (serial % 6 === 3) labels.push({ text: `Profit +$${Math.floor(Math.random() * 40 + 10)}`, idx: serial, born: t, buy: false });
      }

      const plotW = w - AXIS_R, plotH = h - AXIS_B;
      const priceH = plotH * 0.78, volTop = priceH + 6, volH = plotH - volTop;
      const visible = Math.ceil(plotW / W) + 2;
      const view = candles.slice(-visible);
      const xOf = (i: number) => plotW - (view.length - i) * W - offset + W;

      // smooth y-range
      const vals = view.flatMap((c) => [c.h, c.l]);
      const max = Math.max(...vals) + 20, min = Math.min(...vals) - 20;
      const y = (p: number) => 12 + ((max - p) / (max - min)) * (priceH - 24);

      ctx.clearRect(0, 0, w, h);
      ctx.font = "11px 'DM Sans', sans-serif";
      ctx.lineWidth = 1;

      // horizontal grid + price labels
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const stepP = (max - min) / 6;
      for (let i = 0; i <= 6; i++) {
        const p = min + stepP * i, yy = Math.round(y(p)) + 0.5;
        ctx.strokeStyle = grid; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = muted;
        ctx.fillText(p.toFixed(2), plotW + 8, yy);
      }

      // vertical grid + time labels every 10 candles (move with candles)
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      view.forEach((c, i) => {
        const minute = Math.round(c.t / 60000);
        if (minute % 10 !== 0) return;
        const xx = Math.round(xOf(i) + W / 2) + 0.5;
        if (xx > plotW) return;
        ctx.strokeStyle = grid; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = muted;
        const d = new Date(c.t);
        ctx.fillText(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, xx, plotH + 6);
      });

      // separator above volume
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(0, volTop - 3); ctx.lineTo(plotW, volTop - 3); ctx.stroke();

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, plotW, plotH); ctx.clip();
      view.forEach((c, i) => {
        const x = xOf(i), col = c.c >= c.o ? green : red;
        // volume
        ctx.globalAlpha = 0.35; ctx.fillStyle = col;
        const vh = c.v * volH;
        ctx.fillRect(x + 2, plotH - vh, W - 4, vh);
        ctx.globalAlpha = 1;
        // wick + body
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(Math.round(x + W / 2) + 0.5, y(c.h)); ctx.lineTo(Math.round(x + W / 2) + 0.5, y(c.l)); ctx.stroke();
        const top = y(Math.max(c.o, c.c));
        ctx.fillRect(x + 2, top, W - 4, Math.max(1.5, y(Math.min(c.o, c.c)) - top));
      });

      // labels attached to their candle, sliding with it
      for (let i = labels.length - 1; i >= 0; i--) {
        const L = labels[i]!;
        const age = (t - L.born) / 3000;
        const ci = view.length - 1 - (serial - L.idx);
        const c = view[ci];
        if (age > 1 || !c) { labels.splice(i, 1); continue; }
        const lx = xOf(ci) + W / 2, ly = y(c.h) - 22 - age * 30;
        ctx.globalAlpha = Math.min(1, age * 6, (1 - age) * 3);
        ctx.font = "700 12px 'Space Grotesk', sans-serif";
        const tw = ctx.measureText(L.text).width + 16;
        ctx.fillStyle = L.buy ? blue : green;
        ctx.shadowColor = L.buy ? blue : green; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.roundRect(lx - tw / 2, ly - 11, tw, 22, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(L.text, lx, ly);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // live price tag
      const lastC = view[view.length - 1]!;
      const py = y(lastC.c), col = lastC.c >= lastC.o ? green : red;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(plotW, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(plotW + 2, py - 9, AXIS_R - 4, 18, 3); ctx.fill();
      ctx.fillStyle = fg; ctx.font = "700 11px 'DM Sans', sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(lastC.c.toFixed(2), plotW + 6, py);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-label="Simulated candlestick chart animation" />;
}
