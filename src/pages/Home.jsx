import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import { Radio, Cpu, Gauge, ArrowRight, ArrowUpRight, Satellite, Waypoints, ShieldCheck } from 'lucide-react';
import { SectionLabel, TechCard, TelemetryStat } from '@/components/ui/TechUI';
import { CarSlideshow } from '@/components/CarSlideshow';
import { PlaneSlideshow } from '@/components/PlaneSlideshow';

const HERO_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/3b9c79f37_generated_image.png';
const HERO_VIDEO = 'https://media.base44.com/videos/public/6a6228d5d9e17113e1c6cb59/4dd95d01b_mini.mov';
const PLANE_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/3b9c79f37_generated_image.png';
const CARBON_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/5b2b144c9_generated_6300604b.png';
const PCB_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/0da43da98_generated_7d5339a4.png';
const DRONE_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/5cd6fe23e_generated_c3706111.png';
const CAR_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/72682c54e_generated_2dbc0f0a.png';

function HeroTelemetry() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      setMouse({ x, y });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      {/* Horizon vector line */}
      <div
        className="absolute left-0 right-0 top-1/2 h-px bg-cyan/30 origin-center"
        style={{ transform: `rotate(${mouse.y * 6}deg)` }}
      />
      {/* Pitch lines */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative" style={{ transform: `translate(${mouse.x * 20}px, ${mouse.y * 20}px)` }}>
          <div className="w-32 h-px bg-cyan/20 absolute -left-16 top-6" />
          <div className="w-24 h-px bg-cyan/20 absolute -left-12 -top-6" />
          <div className="w-20 h-px bg-cyan/20 absolute -left-10 top-16" />
        </div>
      </div>
      {/* Yaw indicator */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <span className="text-[10px] font-mono-data text-cyan/60">YAW</span>
        <div className="w-40 h-px bg-cyan/20 relative">
          <div className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-cyan animate-pulse-glow" style={{ left: `${50 + mouse.x * 40}%` }} />
        </div>
      </div>
      {/* Corner HUD */}
      <div className="absolute top-28 left-8 lg:left-16 flex flex-col gap-1">
        <span className="text-[10px] font-mono-data text-cyan/60 uppercase tracking-widest">FEED://FPV.LINK.HD</span>
        <span className="text-[10px] font-mono-data text-orange/60 uppercase tracking-widest">REC ● 1080p30</span>
      </div>
      <div className="absolute top-28 right-8 lg:right-16 text-right flex flex-col gap-1">
        <span className="text-[10px] font-mono-data text-cyan/60 uppercase tracking-widest">SIGNAL 98%</span>
        <span className="text-[10px] font-mono-data text-cyan/60 uppercase tracking-widest">35ms LATENCY</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative h-screen min-h-[700px] w-full overflow-hidden bg-obsidian">
      <video src={HERO_VIDEO} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/40 to-obsidian/60" />
      <div className="absolute inset-0 bg-gradient-to-r from-obsidian/80 via-transparent to-transparent" />
      <HeroTelemetry />

      <div className="relative z-20 h-full max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col justify-end pb-20 lg:pb-28">
        <div className="max-w-3xl animate-slide-lock">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-2 h-2 bg-cyan rounded-full animate-pulse-glow" />
            <span className="text-[10px] font-mono-data text-cyan uppercase tracking-widest">Next-Gen Modular FPV Systems</span>
          </div>
          <h1 className="text-titanium font-bold tracking-tight text-4xl md:text-6xl lg:text-7xl leading-[0.95] mb-6">
            Real World<br />
            <span className="text-cyan text-glow-cyan">Unreal Experience</span>
          </h1>
          <p className="text-titanium/60 text-base lg:text-lg max-w-xl leading-relaxed mb-8">
            Experience the real world in digital style. Cockpit powered with digital low latency video feed from an easy to pilot vehicle on ground and air. This is the pilot's seat to the future.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              to="/products"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-cyan text-obsidian font-bold text-sm tracking-wide clip-corner hover:bg-titanium transition-colors group"
            >
              BUILD MY FPV
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/tech"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-cyan/30 text-titanium font-semibold text-sm tracking-wide clip-corner hover:border-cyan hover:bg-cyan/5 transition-all"
            >
              EXPLORE THE TECH
            </Link>
          </div>
        </div>

        {/* Hero telemetry stats */}
        <div className="hidden lg:grid grid-cols-4 gap-px mt-16 border border-cyan/10 bg-cyan/10">
          {[
            { label: 'VIDEO LATENCY', value: '35', unit: 'ms', color: 'cyan' },
            { label: 'HD RESOLUTION', value: '1080p30', unit: '/ 720p60', color: 'cyan' },
            { label: 'MAX RANGE', value: '12', unit: 'km', color: 'orange' },
            { label: 'TRANSMISSION', value: 'DIGITAL', unit: '', color: 'orange' },
          ].map((s) => (
            <div key={s.label} className="bg-obsidian/80 backdrop-blur-sm p-5 flex flex-col gap-1">
              <span className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest">{s.label}</span>
              <span className={`font-mono-data text-2xl font-bold ${s.color === 'orange' ? 'text-orange' : 'text-cyan'}`}>
                {s.value}<span className="text-sm text-titanium/40 ml-1">{s.unit}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent" />
    </section>
  );
}

function Capabilities() {
  return (
    <section className="relative px-6 lg:px-10 py-24 lg:py-32">
      <div className="max-w-[1440px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 mb-20">
          <div>
            <SectionLabel>System Architecture</SectionLabel>
            <h2 className="text-titanium font-bold tracking-tight text-2xl md:text-4xl mb-6">
              Technology that powers new age experience.
            </h2>
          </div>
          <div className="lg:pt-4">
            <p className="text-titanium/50 text-lg leading-relaxed">
              We integrate precision-engineered proprietary HD video transmission system and autonomous flight supervisory software into drone and rover platforms, combining two different solutions into one.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <TechCard
            icon={Radio}
            title="Low-Latency Digital Video Transmission System"
            description="Crystal-clear digital high definition video and telemetry with low latency and high reliability."
            specs={[
              { label: 'LATENCY', value: '35ms' },
              { label: 'FRAME RATE', value: '30fps' },
              { label: 'RANGE', value: '12km' },
              { label: 'SIGNAL', value: 'DIGITAL' },
            ]}
            color="cyan"
          />
          <TechCard
            icon={Cpu}
            title="Supervisory Flight Envelope & Safety Net"
            description="Supervisory autonomous intelligence layer that acts as a virtual safety net around manual flight. Prevents crash or collision to make piloting easy and fun."
            specs={[
              { label: 'GEOFENCING', value: 'DYNAMIC' },
              { label: 'ZONE', value: 'GROUND & AIR' },
            ]}
            color="orange"
          />
        </div>
      </div>
    </section>
  );
}

function ProductSpotlight({ image, slideshow, reverse, label, title, description, specs, linkText = 'BUILD THIS PLATFORM' }) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <div className={reverse ? 'lg:order-2' : ''}>
        <div className="relative corner-frame micro-border bg-card/40 overflow-hidden clip-corner">
          {slideshow === 'car' ? (
            <CarSlideshow className="w-full aspect-[4/3]" />
          ) : slideshow === 'plane' ? (
            <PlaneSlideshow className="w-full aspect-[4/3]" />
          ) : (
            <Image src={image} alt={title} fittingType="fill" className="w-full aspect-[4/3] object-cover" />
          )}
          <div className="absolute top-4 left-4 text-[10px] font-mono-data text-cyan/70 uppercase tracking-widest">
            {label}
          </div>
        </div>
      </div>
      <div className={reverse ? 'lg:order-1' : ''}>
        <SectionLabel color={reverse ? 'orange' : 'cyan'}>{reverse ? 'EXPLORE THE SKY' : 'EXPLORE THE LAND'}</SectionLabel>
        <h3 className="text-titanium font-bold text-3xl lg:text-4xl mb-4">{title}</h3>
        <p className="text-titanium/50 text-lg leading-relaxed mb-8">{description}</p>
        <div className="grid grid-cols-2 gap-px bg-cyan/10 border border-cyan/10">
          {specs.map((s) => (
            <div key={s.label} className="bg-obsidian/80 p-4">
              <div className="text-[9px] font-mono-data text-titanium/30 uppercase tracking-widest mb-1">{s.label}</div>
              <div className="font-mono-data text-lg font-bold text-cyan">{s.value}</div>
            </div>
          ))}
        </div>
        <Link to="/products" className="inline-flex items-center gap-2 mt-8 text-cyan font-semibold text-sm hover:gap-3 transition-all">
          {linkText} <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function PlatformLineup() {
  return (
    <section className="relative px-6 lg:px-10 py-24 lg:py-32 border-t border-cyan/5">
      <div className="absolute inset-0 grid-lines opacity-30" />
      <div className="max-w-[1440px] mx-auto relative">
        <div className="text-center mb-20">
          <SectionLabel>Real Time FPV Vehicles</SectionLabel>
          <h2 className="text-titanium font-bold tracking-tight text-3xl md:text-5xl max-w-2xl mx-auto">
            One architecture.<br />Infinite configurations.
          </h2>
        </div>
        <div className="space-y-24 lg:space-y-32">
          <ProductSpotlight
            slideshow="car"
            label="GROUND / FPV.CAR"
            title="Warg Ground - FPV Cars"
            description="Pilot any terrain in real time. Introducing fpv cars with carbon fibre chassis, vibrant designs and live HD video link. Choose your vehicle and cockpit to build your own ground fpv."
            specs={[
              { label: 'TOP SPEED', value: '35km/h' },
              { label: 'WEIGHT', value: '400g' },
              { label: 'DRIVE', value: 'AWD' },
              { label: 'RUNTIME', value: '3hrs' },
            ]}
            linkText="BUILD MY FPV CAR"
          />
          <ProductSpotlight
            slideshow="plane"
            reverse
            label="AIR / FPV.PLANE"
            title="Warg Air — FPV Planes"
            description="Fly high in the sky. Introducing fpv fixed wing planes and quads. Enabled with easy to pilot crash avoidance intelligence, these birds require no pilot training. View the world from the above with low latency & high range digital video transmission."
            specs={[
              { label: 'TOP SPEED', value: '80km/h' },
              { label: 'WEIGHT', value: '~200g' },
              { label: 'MAX FLIGHT TIME', value: '35min' },
              { label: 'MAX RANGE', value: '12km' },
            ]}
            linkText="BUILD MY FPV PLANE"
          />
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const stats = [
    { icon: Gauge, label: 'GLASS-TO-GLASS LATENCY', value: '35ms', color: 'cyan' },
    { icon: Waypoints, label: 'AUTONOMY LEVEL', value: 'L4', color: 'orange' },
    { icon: Satellite, label: 'MAX LINK RANGE', value: '12km', color: 'cyan' },
    { icon: ShieldCheck, label: 'ENCRYPTION STANDARD', value: 'AES-256', color: 'orange' },
  ];
  return (
    <section className="relative px-6 lg:px-10 py-20 border-y border-cyan/10 bg-card/30">
      <div className="max-w-[1440px] mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-3">
            <s.icon className={`w-6 h-6 ${s.color === 'orange' ? 'text-orange' : 'text-cyan'}`} />
            <div className={`font-mono-data text-3xl lg:text-4xl font-bold ${s.color === 'orange' ? 'text-orange' : 'text-cyan'}`}>{s.value}</div>
            <div className="text-[10px] font-mono-data text-titanium/40 uppercase tracking-widest">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />
      <Capabilities />
      <PlatformLineup />
      <Stats />
    </>
  );
}
