import React from 'react';
import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import { Radio, Cpu, Gauge, Waypoints, Satellite, ShieldCheck, Layers, Zap, Navigation, ArrowRight } from 'lucide-react';
import { PageHeader, SectionLabel, TechCard } from '@/components/ui/TechUI';

const PCB_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/0da43da98_generated_7d5339a4.png';
const GOLD_IMG = 'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/f16dcc4c8_generated_c6ec4a2d.png';

function HardwareSection() {
  const hardware = [
    { icon: Radio, title: 'Digital HD Video Link', description: 'Digital video transmission with 35ms glass-to-glass latency and AES-256 encryption.', specs: [{ label: 'RESOLUTION', value: '1080p30 / 720p60' }, { label: 'LATENCY', value: '35ms' }, { label: 'FPS', value: '30' }] },
    { icon: Zap, title: 'Telemetry and Control Integration', description: 'Stream high-res video and customizable telemetry streams side-by-side along with control inputs.', specs: [{ label: 'ADD TELEMETRY', value: 'YES' }, { label: 'CONTROL LINK', value: 'YES' }] },
    { icon: ShieldCheck, title: 'Immersive-Ready', description: 'Engineered for AR/VR goggles, HDMI ground stations, and custom HUD overlays.', specs: [{ label: 'AR/VR GOGGLES', value: 'SUPPORTED' }, { label: 'HDMI', value: 'TV AND MONITOR' }] },
  ];
  return (
    <section className="relative px-6 lg:px-10 py-20 lg:py-28">
      <div className="max-w-[1440px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 mb-16">
          <div>
            <SectionLabel color="cyan">Technology I — Warg Vision System</SectionLabel>
            <h2 className="text-titanium font-bold tracking-tight text-2xl md:text-4xl">
              HD transmission engineered for low-latency and high range.
            </h2>
          </div>
          <p className="text-titanium/50 text-lg leading-relaxed lg:pt-4">
            High-speed manual flight and immersive cockpit ops require real-time visual feedback. Traditional analog video lacks clarity, while standard digital links suffer from latency spikes that lead to disorientation and control failure. Warg Vision System bridges this gap, providing a wireless high-definition, low-latency digital video link, along with a bidirectional data link for telemetry and control.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {hardware.map((h) => (
            <TechCard key={h.title} icon={h.icon} title={h.title} description={h.description} specs={h.specs} color="cyan" />
          ))}
        </div>
      </div>
    </section>
  );
}

function SoftwareSection() {
  return (
    <section className="relative px-6 lg:px-10 py-20 lg:py-28 border-t border-cyan/5">
      <div className="max-w-[1440px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <SectionLabel color="orange">Technology II — Warg Flight Control System</SectionLabel>
            <h2 className="text-titanium font-bold tracking-tight text-2xl md:text-4xl">
              Intuitive control meets active flight boundary protection.
            </h2>
          </div>
          <p className="text-titanium/50 text-lg leading-relaxed lg:pt-4">
            Piloting complex platforms like FPV drones typically requires hundreds of hours of training, and a split-second mistake usually results in hull loss.<br />Our supervisory autonomy layer acts as a virtual safety net around manual flight. It allows anyone fly freely without the risk of straying out of bounds or crashing into the terrain.
          </p>
        </div>
      </div>
    </section>
  );
}

function PipelineSection() {
  const pipeline = [
    { num: '01', title: 'Perception', desc: 'Vision + Telemetry data builds a live world model at 20 Hz.' },
    { num: '02', title: 'Planning', desc: 'Define custom 3D safe zone.' },
    { num: '03', title: 'Control', desc: 'Flight supervision software translates raw manual input into actuator commands.' },
    { num: '04', title: 'Transmission', desc: 'HD video and telemetry stream to the pilot and control signals to the drone at 35ms latency.' },
  ];
  return (
    <section className="relative px-6 lg:px-10 py-20 lg:py-28 border-t border-cyan/5 bg-card/20">
      <div className="absolute inset-0 grid-lines opacity-30" />
      <div className="max-w-[1440px] mx-auto relative">
        <div className="text-center mb-16">
          <SectionLabel>System Pipeline</SectionLabel>
          <h2 className="text-titanium font-bold tracking-tight text-3xl md:text-5xl max-w-2xl mx-auto">
            The perception-to-pilot loop.
          </h2>
        </div>
        <div className="grid md:grid-cols-4 gap-px bg-cyan/10 border border-cyan/10">
          {pipeline.map((p) => (
            <div key={p.num} className="bg-obsidian/90 p-6 lg:p-8 group hover:bg-card/60 transition-colors">
              <div className="font-mono-data text-3xl font-bold text-cyan/30 group-hover:text-cyan transition-colors mb-6">{p.num}</div>
              <h3 className="text-titanium font-bold text-lg mb-2">{p.title}</h3>
              <p className="text-titanium/40 text-sm leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Tech() {
  return (
    <>
      <HardwareSection />
      <SoftwareSection />
      <PipelineSection />

      <section className="relative px-6 lg:px-10 py-24 lg:py-32 overflow-hidden">
        <Image src={PCB_IMG} alt="Exploded view of HD transmission PCB" fittingType="fill" className="absolute inset-0 w-full h-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-l from-obsidian via-obsidian/90 to-obsidian/60" />
        <div className="max-w-[1440px] mx-auto relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <div className="max-w-xl">
            <SectionLabel>Open Architecture</SectionLabel>
            <h2 className="text-titanium font-bold tracking-tight text-3xl md:text-4xl mb-4">
              Built for builders. Open by design.
            </h2>
            <p className="text-titanium/60 text-lg leading-relaxed">
              Every module follows an open mechanical and electrical standard. Mix Warg components with your own — the architecture stays compatible.
            </p>
          </div>
          <Link to="/products" className="inline-flex items-center gap-2 px-8 py-4 bg-cyan text-obsidian font-bold text-sm tracking-wide clip-corner hover:bg-titanium transition-colors shrink-0">
            START BUILDING <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
