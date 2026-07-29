import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import { Car, Plane, Check, ShoppingCart, Cpu, Eye, Gauge, Weight, Radio, ArrowRight, Tag } from 'lucide-react';
import { SectionLabel } from '@/components/ui/TechUI';
import { CarSlideshow, CAR_IMAGES } from '@/components/CarSlideshow';
import { PlaneSlideshow, PLANE_IMAGES } from '@/components/PlaneSlideshow';
import { PreOrderForm } from '@/components/PreOrderForm';

const CAR_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/72682c54e_generated_2dbc0f0a.png';
const PLANE_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/3b9c79f37_generated_image.png';
const PCB_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/0da43da98_generated_7d5339a4.png';
const GOGGLES_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/ba9e93097_generated_f5fa1c56.png';

const CONTROLLERS = [
  { id: 'digital-fpv', name: 'Digital FPV', desc: '720p HD 60fps camera with digital video feed.', price: 17000, latency: '35ms', autonomy: 'NO', fov: '60°', range: '2km', img: 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/e77a93ca9_3.png' },
  { id: 'digital-fpv-wide', name: 'Digital FPV – Wide Angle', desc: '1080p HD 30fps wide angle camera with digital video feed for wider vision.', price: 20000, latency: '35ms', autonomy: 'YES', fov: '160°', range: '12km', img: 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/e3445e823_4.png' },
];

const GOGGLES = [
  { id: 'warg-hd-goggles', name: 'Warg HD Goggles', desc: 'High definition display for outdoor and remote piloting.', price: 15000, res: '1080p30', fov: '150°', img: 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/37b7bee7a_goggle.png' },
  { id: 'warg-hdmi', name: 'Warg HDMI Display', desc: 'Plug in to your TV/monitor or any other device display with HDMI output.', price: 10000, res: '1080p30', fov: '150°', img: 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/cb1ff2b0d_hdmi.png' },
];

const PRODUCTS = {
  cars: {
    name: 'FPV Cars',
    label: 'GROUND SYSTEMS',
    tagline: 'Modular ground FPV vehicles built for speed and terrain.',
    chassis: [
      { id: 'classic-pony', name: 'Classis Pony', desc: 'Lightweight 1/10 carbon chassis for high-speed ground FPV.', price: 14000, weight: '500g', speed: '15km/h', range: '2km', img: CAR_IMAGES[0], tag: 'GROUND' },
      { id: 'explorer-jeep', name: 'Explorer Jeep', desc: 'Reinforced AWD chassis with active suspension for any terrain.', price: 17000, weight: '700g', speed: '25km/h', range: '5km', img: CAR_IMAGES[1], tag: 'GROUND' },
      { id: 'mustang-fire-red', name: 'Mustang Fire', desc: 'High-speed rally chassis tuned for flat terrain and racing.', price: 18000, weight: '600g', speed: '35km/h', range: '2km', img: CAR_IMAGES[2], tag: 'GROUND' },
    ],
  },
  planes: {
    name: 'FPV Planes',
    label: 'AIR SYSTEMS',
    tagline: 'FPV aircraft engineered for long-range flight.',
    chassis: [
      { id: 'fixed-wing-sports', name: 'Fixed Wing - Sports', desc: 'Agile fixed-wing platform for sport FPV flying and racing.', price: 20000, weight: '250g', speed: '85km/h', range: '12km', img: PLANE_IMAGES[0], tag: 'AIR' },
      { id: 'nano-quad', name: 'Nano Quad', desc: '2-inch nano quad for quick explorations. Auto stabilize with collision avoidance.', price: 20000, weight: '150g', speed: '60km/h', range: '5km', img: PLANE_IMAGES[2], tag: 'AIR' },
      { id: 'mini-quad', name: 'Mini Quad', desc: 'Versatile explorer wing for scenic FPV and aerial tours.', price: 15000, weight: '250g', speed: '50km/h', range: '7km', img: PLANE_IMAGES[3], tag: 'AIR' },
    ],
  },
};

function OptionCard({ option, selected, onSelect, fields }) {
  return (
    <button
      onClick={onSelect}
      className={`relative text-left corner-frame bg-card/50 overflow-hidden clip-corner transition-all w-full ${selected ? 'ring-2 ring-cyan bg-card/80' : 'micro-border hover:bg-card/70'}`}
    >
      <div className="flex gap-4 p-4">
        <div className="relative w-24 h-24 shrink-0 overflow-hidden border border-cyan/15">
          {option.images ? (
            <CarSlideshow className="w-full h-full" showDots={false} />
          ) : option.planeImages ? (
            <PlaneSlideshow className="w-full h-full" showDots={false} />
          ) : (
            <Image src={option.img} alt={option.name} fittingType="fill" className="w-full h-full object-cover" />
          )}
          {selected && (
            <div className="absolute top-1 right-1 w-5 h-5 bg-cyan text-white flex items-center justify-center">
              <Check className="w-3 h-3" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-titanium font-bold text-base">{option.name}</h4>
            <span className="font-mono-data text-cyan font-bold text-sm whitespace-nowrap">₹{option.price.toLocaleString('en-IN')}</span>
          </div>
          <p className="text-titanium/50 text-xs leading-relaxed mb-3 line-clamp-2">{option.desc}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {fields.map((f) => (
              <div key={f.label}>
                <span className="text-[8px] font-mono-data text-titanium/30 uppercase tracking-widest">{f.label} </span>
                <span className="font-mono-data text-xs font-bold text-orange">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

function FormSection({ step, title, subtitle, options, selected, onSelect, fieldsFn }) {
  return (
    <div>
      <div className="flex items-baseline gap-4 mb-6">
        <span className="font-mono-data text-3xl font-bold text-cyan/20">{step}</span>
        <div>
          <h2 className="text-titanium font-bold text-xl lg:text-2xl">{title}</h2>
          {subtitle && <p className="text-titanium/40 text-sm mt-1">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-3">
        {options.map((o) => (
          <OptionCard key={o.id} option={o} selected={selected?.id === o.id} onSelect={() => onSelect(o)} fields={fieldsFn(o)} />
        ))}
      </div>
    </div>
  );
}

function BuildSummary({ config, product, total, stage, onOrder, onFormSubmit }) {
  const rows = [
    { key: 'chassis', label: 'CHASSIS', icon: product === 'planes' ? Plane : Car },
    { key: 'controller', label: 'VISION', icon: Cpu },
    { key: 'goggles', label: 'DISPLAY', icon: Eye },
  ];
  const allSelected = config.chassis && config.controller && config.goggles;

  return (
    <div className="lg:sticky lg:top-28">
      <div className="corner-frame bg-card/70 backdrop-blur-sm border border-cyan/20 p-6 clip-corner">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-cyan/10">
          <div>
            <div className="text-[9px] font-mono-data text-orange uppercase tracking-widest">Build Manifest</div>
            <div className="text-titanium font-bold text-lg">My Custom FPV</div>
          </div>
          <Tag className="w-5 h-5 text-cyan" />
        </div>

        <div className="space-y-3 mb-6">
          {rows.map((r) => {
            const item = config[r.key];
            return (
              <div key={r.key} className={`flex items-center gap-3 p-3 border ${item ? 'border-cyan/20 bg-cyan/5' : 'border-titanium/10'}`}>
                <r.icon className={`w-4 h-4 shrink-0 ${item ? 'text-cyan' : 'text-titanium/20'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest">{r.label}</div>
                  <div className={`text-sm font-medium truncate ${item ? 'text-titanium' : 'text-titanium/30'}`}>{item ? item.name : '— Not selected'}</div>
                </div>
              </div>
            );
          })}
        </div>

        {config.chassis && (
          <div className="grid grid-cols-3 gap-2 mb-6 pb-6 border-b border-cyan/10">
            <div className="text-center">
              <Gauge className="w-4 h-4 text-cyan/60 mx-auto mb-1" />
              <div className="font-mono-data text-xs text-titanium">{config.chassis.speed}</div>
            </div>
            <div className="text-center">
              <Weight className="w-4 h-4 text-cyan/60 mx-auto mb-1" />
              <div className="font-mono-data text-xs text-titanium">{config.chassis.weight}</div>
            </div>
            <div className="text-center">
              <Radio className="w-4 h-4 text-cyan/60 mx-auto mb-1" />
              <div className="font-mono-data text-xs text-titanium">{config.chassis.range}</div>
            </div>
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between mb-6 pt-4 border-t border-cyan/10">
            <span className="text-titanium font-bold">Total Build</span>
            <span className="font-mono-data text-2xl font-bold text-cyan text-glow-cyan">₹{total.toLocaleString('en-IN')}</span>
          </div>
        )}

        {stage === 'confirmed' ? (
          <div className="border border-cyan/30 bg-cyan/5 p-5 text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-cyan/10 border border-cyan flex items-center justify-center">
              <Check className="w-6 h-6 text-cyan" />
            </div>
            <div className="text-titanium font-bold mb-1">Pre-order confirmed</div>
            <div className="text-[9px] font-mono-data text-orange uppercase tracking-widest mb-1">Order Reference</div>
            <div className="font-mono-data text-lg font-bold text-cyan">WARG-{Math.floor(Math.random() * 90000 + 10000)}</div>
            <p className="text-titanium/40 text-xs mt-3">We'll contact you with next steps. Est. ship: 6-8 weeks.</p>
          </div>
        ) : stage === 'form' ? (
          <PreOrderForm onSubmit={onFormSubmit} />
        ) : (
          <button
            onClick={onOrder}
            disabled={!allSelected}
            className={`w-full inline-flex items-center justify-center gap-2 px-6 py-4 font-bold text-sm tracking-wide clip-corner transition-all ${allSelected ? 'bg-orange text-white hover:bg-cyan hover:text-white' : 'bg-titanium/10 text-titanium/30 cursor-not-allowed'}`}
          >
            <ShoppingCart className="w-4 h-4" /> {allSelected ? 'PLACE PRE-ORDER' : 'SELECT ALL COMPONENTS'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Products() {
  const [tab, setTab] = useState('cars');
  const [config, setConfig] = useState({ chassis: null, controller: null, goggles: null });
  const [stage, setStage] = useState('idle');

  const product = PRODUCTS[tab];
  const total = Object.values(config).reduce((sum, o) => sum + (o?.price || 0), 0);

  const switchTab = (t) => {
    setTab(t);
    setConfig({ chassis: null, controller: null, goggles: null });
    setStage('idle');
  };

  const select = (key, option) => {
    setConfig((c) => ({ ...c, [key]: c[key]?.id === option.id ? null : option }));
    setStage('idle');
  };

  return (
    <>
      <section className="relative px-6 lg:px-10 pt-32 lg:pt-40 pb-12 overflow-hidden">
        <div className="absolute inset-0 grid-lines opacity-40" />
        <div className="max-w-[1440px] mx-auto relative">
          <SectionLabel>Modular Assembly Lab</SectionLabel>
          <h1 className="text-titanium font-bold tracking-tight text-4xl md:text-5xl lg:text-6xl mb-6">
            Build your own FPV vehicle.
          </h1>
          <p className="text-titanium/50 text-lg max-w-2xl leading-relaxed">
            Two independent product lines — FPV Cars and FPV Planes. Scroll through the vertical builder, select your components, and pre-order your custom build. Your manifest updates live as you configure.
          </p>
        </div>
      </section>

      {/* Product tabs */}
      <section className="px-6 lg:px-10 pb-12">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid grid-cols-2 gap-px bg-cyan/10 border border-cyan/15 max-w-md">
            {Object.entries(PRODUCTS).map(([key, p]) => {
              const Icon = key === 'cars' ? Car : Plane;
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => switchTab(key)}
                  className={`flex items-center justify-center gap-3 px-6 py-4 transition-all ${active ? 'bg-cyan text-white' : 'bg-card/40 text-titanium/60 hover:bg-card/70'}`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-bold text-sm">{p.name}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 text-[10px] font-mono-data text-cyan/60 uppercase tracking-widest">
            {product.label} — {product.tagline}
          </div>
        </div>
      </section>

      {/* Vertical flowing form */}
      <section className="px-6 lg:px-10 pb-24">
        <div className="max-w-[1440px] mx-auto grid lg:grid-cols-3 gap-8 lg:gap-12">
          <div className="lg:col-span-2 space-y-16">
            <FormSection
              step="01"
              title="Select your chassis"
              subtitle={tab === 'planes' ? "Choose the fuselage of your aircraft." : "Choose the foundation of your build."}
              options={product.chassis}
              selected={config.chassis}
              onSelect={(o) => select('chassis', o)}
              fieldsFn={(o) => [
                { label: 'TOP SPEED', value: o.speed },
                { label: 'WEIGHT', value: o.weight },
                ...(tab === 'cars' ? [{ label: 'RANGE', value: o.range }] : []),
              ]}
            />
            <FormSection
              step="02"
              title="Choose your Vision System"
              subtitle="The vision — real time digital video feed from your vehicle"
              options={CONTROLLERS}
              selected={config.controller}
              onSelect={(o) => select('controller', o)}
              fieldsFn={(o) => [
                { label: 'LATENCY', value: o.latency },
                { label: 'WIDE ANGLE', value: o.autonomy },
                { label: 'FOV', value: o.fov },
                { label: 'RANGE', value: o.range },
              ]}
            />
            <FormSection
              step="03"
              title="Select your display"
              subtitle="What the pilot sees — HD goggles with low-latency link."
              options={GOGGLES}
              selected={config.goggles}
              onSelect={(o) => select('goggles', o)}
              fieldsFn={(o) => [
                { label: 'DISPLAY', value: o.res },
                { label: 'FOV', value: o.fov },
              ]}
            />
          </div>

          <div className="lg:col-span-1">
            <BuildSummary config={config} product={tab} total={total} stage={stage} onOrder={() => setStage('form')} onFormSubmit={() => setStage('confirmed')} />
          </div>
        </div>
      </section>
    </>
  );
}
