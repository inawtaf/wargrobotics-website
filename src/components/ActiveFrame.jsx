import React, { useState, useEffect } from 'react';
import { Activity, Crosshair, Radio } from 'lucide-react';

export function ActiveFrame() {
  const [time, setTime] = useState('');
  const [latency, setLatency] = useState(4.2);
  const [scrollVel, setScrollVel] = useState(0);
  const [lastScroll, setLastScroll] = useState(0);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const h = String(d.getUTCHours()).padStart(2, '0');
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      setTime(`${h}:${m}:${s}`);
      setLatency((19 + Math.random() * 2).toFixed(0));
    };
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let raf;
    const onScroll = () => {
      const now = Date.now();
      const y = window.scrollY;
      const vel = Math.abs(y - lastScroll) / Math.max(now - lastScrollTime, 1) * 100;
      setScrollVel(Math.min(Math.round(vel), 99));
      setLastScroll(y);
      lastScrollTime = now;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrollVel(0));
    };
    let lastScrollTime = Date.now();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [lastScroll]);

  const marker = (label, value, color = 'cyan') => (
    <div className="hidden md:flex items-center gap-2 text-[9px] font-mono-data uppercase tracking-widest">
      <span className="text-titanium/30">{label}</span>
      <span className={color === 'orange' ? 'text-orange' : 'text-cyan'}>{value}</span>
    </div>
  );

  return (
    <>
      {/* Left vertical frame */}
      <div className="fixed left-0 top-0 bottom-0 w-8 z-40 hidden lg:flex flex-col items-center justify-between py-24 border-r border-cyan/5 bg-obsidian/40 pointer-events-none">
        <div className="text-[9px] font-mono-data text-cyan/40 uppercase tracking-widest" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          WARG.SYS / v4.2.0
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-cyan/40" />
          <Activity className="w-3 h-3 text-cyan/50" />
          <div className="w-px h-12 bg-gradient-to-t from-transparent to-cyan/40" />
        </div>
        <div className="text-[9px] font-mono-data text-orange/40 uppercase tracking-widest" style={{ writingMode: 'vertical-rl' }}>
          FRAME.SYNC OK
        </div>
      </div>

      {/* Right vertical frame */}
      <div className="fixed right-0 top-0 bottom-0 w-8 z-40 hidden lg:flex flex-col items-center justify-between py-24 border-l border-cyan/5 bg-obsidian/40 pointer-events-none">
        {marker('T+', time)}
        <div className="flex flex-col items-center gap-2">
          <Crosshair className="w-3 h-3 text-cyan/40 animate-pulse-glow" />
          <Radio className="w-3 h-3 text-orange/40" />
        </div>
        <div className="flex flex-col items-end gap-1">
          {marker('LAT', `${latency}ms`)}
          {marker('VEL', `${String(scrollVel).padStart(2, '0')}m/s`)}
        </div>
      </div>
    </>
  );
}
