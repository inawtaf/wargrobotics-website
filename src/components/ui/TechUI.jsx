import React from 'react';
import { cn } from '@/lib/utils';

export function SectionLabel({ children, color = 'cyan' }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className={cn('w-6 h-px', color === 'orange' ? 'bg-orange' : 'bg-cyan')} />
      <span className={cn('text-[10px] font-mono-data uppercase tracking-widest', color === 'orange' ? 'text-orange' : 'text-cyan/80')}>
        {children}
      </span>
    </div>
  );
}

export function TelemetryStat({ label, value, unit, color = 'cyan' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest">{label}</span>
      <span className={cn('font-mono-data text-xl font-bold', color === 'orange' ? 'text-orange' : 'text-cyan')}>
        {value}<span className="text-xs text-titanium/40 ml-1">{unit}</span>
      </span>
    </div>
  );
}

export function TechCard({ icon: Icon, title, description, specs, color = 'cyan' }) {
  return (
    <div className="corner-frame micro-border bg-card/60 p-6 lg:p-8 group transition-all hover:bg-card/90">
      <div className="flex items-center justify-between mb-6">
        <div className={cn('w-12 h-12 flex items-center justify-center border', color === 'orange' ? 'border-orange/30' : 'border-cyan/30')}>
          <Icon className={cn('w-6 h-6', color === 'orange' ? 'text-orange' : 'text-cyan')} />
        </div>
        <span className="text-[9px] font-mono-data text-titanium/30 uppercase tracking-widest">
          {color === 'orange' ? 'OPT.SYS' : 'CORE.SYS'}
        </span>
      </div>
      <h3 className="text-titanium font-bold text-lg mb-3">{title}</h3>
      <p className="text-titanium/50 text-sm leading-relaxed mb-6">{description}</p>
      {specs && (
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-cyan/10">
          {specs.map((s) => (
            <div key={s.label}>
              <div className="text-[9px] font-mono-data text-titanium/30 uppercase tracking-widest mb-1">{s.label}</div>
              <div className={cn('font-mono-data text-sm font-bold', color === 'orange' ? 'text-orange' : 'text-cyan')}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ label, title, description }) {
  return (
    <section className="relative px-6 lg:px-10 pt-32 lg:pt-40 pb-16 overflow-hidden">
      <div className="absolute inset-0 grid-lines opacity-50" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-32 bg-gradient-to-b from-cyan/40 to-transparent" />
      <div className="max-w-[1440px] mx-auto relative">
        <SectionLabel>{label}</SectionLabel>
        <h1 className="text-titanium font-bold tracking-tight text-4xl md:text-5xl lg:text-6xl mb-6 max-w-3xl">
          {title}
        </h1>
        <p className="text-titanium/50 text-lg max-w-2xl leading-relaxed">{description}</p>
      </div>
    </section>
  );
}
