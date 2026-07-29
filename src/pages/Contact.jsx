import React, { useState } from 'react';
import { MapPin, Mail, Phone, Linkedin, Instagram, Send, Check, Radio, Building2, Clock } from 'lucide-react';
import { PageHeader, SectionLabel } from '@/components/ui/TechUI';

function MissionBriefingForm() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ callsign: '', email: '', objective: 'General Inquiry', briefing: '' });

  const objectives = ['General Inquiry', 'Product Pre-Order', 'B2B Deployment', 'Custom Service Quote', 'Press / Media'];

  return (
    <div className="corner-frame border border-cyan/20 bg-card/60 p-8 lg:p-10 clip-corner">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-cyan/10">
        <div>
          <div className="text-[9px] font-mono-data text-orange uppercase tracking-widest">Mission Briefing</div>
          <div className="text-titanium font-bold text-xl">File a transmission</div>
        </div>
        <Radio className="w-6 h-6 text-cyan animate-pulse-glow" />
      </div>

      {submitted ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-6 bg-cyan/10 border border-cyan flex items-center justify-center">
            <Check className="w-8 h-8 text-cyan" />
          </div>
          <h3 className="text-titanium font-bold text-2xl mb-3">Transmission received</h3>
          <p className="text-titanium/50 max-w-sm mx-auto">
            Your briefing has been logged. Command will respond within 48 hours. Reference: WARG-COM-{Math.floor(Math.random() * 90000 + 10000)}
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-[9px] font-mono-data text-cyan/60 uppercase tracking-widest mb-2">Callsign / Name</label>
              <input required type="text" value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value })} className="w-full bg-obsidian/60 border border-cyan/15 px-4 py-3 text-sm text-titanium focus:border-cyan focus:outline-none transition-colors" placeholder="Pilot callsign" />
            </div>
            <div>
              <label className="block text-[9px] font-mono-data text-cyan/60 uppercase tracking-widest mb-2">Comms Channel (Email)</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-obsidian/60 border border-cyan/15 px-4 py-3 text-sm text-titanium focus:border-cyan focus:outline-none transition-colors" placeholder="pilot@email.com" />
            </div>
          </div>
          <div>
            <label className="block text-[9px] font-mono-data text-cyan/60 uppercase tracking-widest mb-2">Objective</label>
            <select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} className="w-full bg-obsidian/60 border border-cyan/15 px-4 py-3 text-sm text-titanium focus:border-cyan focus:outline-none transition-colors">
              {objectives.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-mono-data text-cyan/60 uppercase tracking-widest mb-2">Briefing Details</label>
            <textarea required rows={5} value={form.briefing} onChange={(e) => setForm({ ...form, briefing: e.target.value })} className="w-full bg-obsidian/60 border border-cyan/15 px-4 py-3 text-sm text-titanium focus:border-cyan focus:outline-none transition-colors resize-none" placeholder="Describe your mission parameters, requirements, or questions..." />
          </div>
          <button type="submit" className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 bg-cyan text-obsidian font-bold text-sm tracking-wide clip-corner hover:bg-titanium transition-colors">
            TRANSMIT <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}

export default function Contact() {
  return (
    <>
      <PageHeader
        label="Contact Us"
        title="Open a channel to command."
        description="Whether you're pre-ordering a build, deploying a B2B fleet, or exploring custom services — file a mission briefing and our team will respond within 48 hours."
      />

      <section className="px-6 lg:px-10 pb-24">
        <div className="max-w-[1440px] mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16">
          {/* Left: contact info */}
          <div>
            <SectionLabel>Direct Channels</SectionLabel>
            <h2 className="text-titanium font-bold tracking-tight text-3xl md:text-4xl mb-8">
              Reach the Warg command center.
            </h2>

            <div className="space-y-px bg-cyan/10 border border-cyan/10 mb-12">
              <div className="bg-obsidian/90 p-6 flex items-center gap-5">
                <div className="w-12 h-12 flex items-center justify-center border border-cyan/30 shrink-0">
                  <Building2 className="w-5 h-5 text-cyan" />
                </div>
                <div>
                  <div className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest mb-1">Headquarters</div>
                  <div className="text-titanium font-medium">Indiranagar</div>
                  <div className="text-titanium/50 text-sm">Bengaluru, IN 560001</div>
                </div>
              </div>
              <div className="bg-obsidian/90 p-6 flex items-center gap-5">
                <div className="w-12 h-12 flex items-center justify-center border border-cyan/30 shrink-0">
                  <Mail className="w-5 h-5 text-cyan" />
                </div>
                <div>
                  <div className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest mb-1">Email</div>
                  <a href="mailto:hello@wargrobotics.com" className="text-titanium font-medium hover:text-cyan transition-colors">hello@wargrobotics.com</a>
                </div>
              </div>
              <div className="bg-obsidian/90 p-6 flex items-center gap-5">
                <div className="w-12 h-12 flex items-center justify-center border border-cyan/30 shrink-0">
                  <Phone className="w-5 h-5 text-cyan" />
                </div>
                <div>
                  <div className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest mb-1">Phone</div>
                  <div className="text-titanium font-medium">+91 993 398 0810</div>
                </div>
              </div>
              <div className="bg-obsidian/90 p-6 flex items-center gap-5">
                <div className="w-12 h-12 flex items-center justify-center border border-orange/30 shrink-0">
                  <Clock className="w-5 h-5 text-orange" />
                </div>
                <div>
                  <div className="text-[9px] font-mono-data text-titanium/40 uppercase tracking-widest mb-1">Operating Hours</div>
                  <div className="text-titanium font-medium">Mon–Fri 09:00–18:00 IST</div>
                  <div className="text-titanium/50 text-sm">Support 24/7 for enterprise partners</div>
                </div>
              </div>
            </div>

            <SectionLabel color="orange">Social Channels</SectionLabel>
            <div className="flex gap-4">
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="flex-1 corner-frame micro-border bg-card/40 p-5 flex items-center gap-4 hover:bg-card/70 transition-all">
                <Linkedin className="w-6 h-6 text-cyan" />
                <div>
                  <div className="text-titanium font-bold text-sm">LinkedIn</div>
                  <div className="text-titanium/40 text-xs">@wargrobotics</div>
                </div>
              </a>
              <a href="https://instagram.com" target="_blank" rel="noreferrer" className="flex-1 corner-frame micro-border bg-card/40 p-5 flex items-center gap-4 hover:bg-card/70 transition-all">
                <Instagram className="w-6 h-6 text-orange" />
                <div>
                  <div className="text-titanium font-bold text-sm">Instagram</div>
                  <div className="text-titanium/40 text-xs">@wargrobotics</div>
                </div>
              </a>
            </div>

            {/* Map placeholder grid */}
            <div className="mt-12 corner-frame border border-cyan/15 bg-card/20 aspect-[16/7] relative overflow-hidden clip-corner">
              <div className="absolute inset-0 grid-lines opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-8 h-8 text-cyan mx-auto mb-2 animate-pulse-glow" />
                  <div className="text-[10px] font-mono-data text-cyan/60 uppercase tracking-widest">12.9716° N, 77.5946° E</div>
                  <div className="text-titanium/40 text-xs mt-1">Bengaluru Command Center</div>
                </div>
              </div>
              <div className="absolute top-3 left-3 text-[9px] font-mono-data text-cyan/40 uppercase tracking-widest">TAC.MAP / SECTOR-4</div>
            </div>
          </div>

          {/* Right: form */}
          <MissionBriefingForm />
        </div>
      </section>
    </>
  );
}
