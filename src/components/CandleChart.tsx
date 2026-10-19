import { useEffect, useRef } from "react";

type Candle = { o: number; c: number; h: number; l: number };
type Label = { text: string; x: number; y: number; born: number; buy: boolean };

// Purely simulated candles — no market data is used.
export function CandleChart() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const green = css.getPropertyValue("--primary").trim();
    const red = css.getPropertyValue("--destructive").trim();
    const grid = css.getPropertyValue("--border").trim();
    const fg = css.getPropertyValue("--primary-foreground").trim();

    const W = 40, N = 30;
    const candles: Candle[] = [];
    let price = 100;
    const next = () => {
      const up = Math.random() < 0.68;
      const move = (Math.random() * 4 + 1) * (up ? 1 : -0.7);
      const o = price, c = price + move;
      price = c;
      return { o, c, h: Math.max(o, c) + Math.random() * 2, l: Math.min(o, c) - Math.random() * 2 };
    };
    for (let i = 0; i < N; i++) candles.push(next());
    const labels: Label[] = [];
    let offset = 0, last = performance.now(), step = 0, raf = 0;

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
      offset += ((t - last) / 1000) * 40;
      last = t;
      if (offset >= W) {
        offset -= W;
        candles.shift();
        candles.push(next());
        step++;
        if (step % 3 === 0) labels.push({ text: "BUY", x: 0, y: 0, born: t, buy: true });
        else if (step % 3 === 1 && labels.length) {
          const p = Math.floor(Math.random() * 40 + 10);
          labels.push({ text: `Profit +$${p}`, x: 0, y: 0, born: t, buy: false });
        }
      }
      const vals = candles.flatMap((c) => [c.h, c.l]);
      const max = Math.max(...vals), min = Math.min(...vals);
      const y = (v: number) => 20 + ((max - v) / (max - min)) * (h - 40);

      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(0, (h / 6) * i); ctx.lineTo(w, (h / 6) * i); ctx.stroke();
      }
      const startX = w - N * W - offset + W;
      candles.forEach((c, i) => {
        const x = startX + i * W;
        const col = c.c >= c.o ? green : red;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x + W / 2, y(c.h)); ctx.lineTo(x + W / 2, y(c.l)); ctx.stroke();
        const top = y(Math.max(c.o, c.c));
        ctx.fillRect(x + 8, top, W - 16, Math.max(2, y(Math.min(c.o, c.c)) - top));
      });

      // labels anchored to the newest candle when born, then float up and fade
      const lastC = candles[candles.length - 1];
      for (let i = labels.length - 1; i >= 0; i--) {
        const L = labels[i];
        const age = (t - L.born) / 2200;
        if (age > 1) { labels.splice(i, 1); continue; }
        if (!L.x) { L.x = startX + (N - 1) * W + W / 2; L.y = y(lastC.h) - 20; }
        L.x -= 40 / 60;
        ctx.globalAlpha = Math.min(1, (1 - age) * 2);
        ctx.font = "700 14px 'Space Grotesk', sans-serif";
        const tw = ctx.measureText(L.text).width + 20;
        const ly = L.y - age * 40;
        ctx.fillStyle = L.buy ? css.getPropertyValue("--secondary").trim() : green;
        ctx.beginPath(); ctx.roundRect(L.x - tw / 2, ly - 14, tw, 28, 8); ctx.fill();
        ctx.fillStyle = fg;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(L.text, L.x, ly);
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-label="Simulated candlestick chart animation" />;
}
