import React from 'react';
import { Link } from 'react-router-dom';
import { Linkedin, Instagram, Mail, MapPin, ArrowUpRight } from 'lucide-react';
import { Image } from '@/components/ui/image';

export function Footer() {
  const links = [
    { label: 'Home', path: '/' },
    { label: 'Tech', path: '/tech' },
    { label: 'Products', path: '/products' },
    { label: 'Contact', path: '/contact' },
  ];

  return (
    <footer className="relative border-t border-cyan/10 bg-obsidian mt-24">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent" />
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <Link to="/" className="flex items-center mb-6">
              <Image src="https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/4e5a46552_companyname.png" alt="Warg Robotics" fittingType="fit" className="h-12 w-48" />
            </Link>
            <p className="text-titanium/50 text-sm leading-relaxed max-w-sm mb-6">
              Precision-engineered modular FPV vehicles, low-latency HD video transmission and autonomous flight supervisory software. The pilot's seat to the future of FPV exploration.
            </p>
            <div className="flex items-center gap-3">
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="w-10 h-10 flex items-center justify-center border border-cyan/20 hover:border-cyan hover:bg-cyan/5 transition-all micro-border">
                <Linkedin className="w-4 h-4 text-titanium/60 hover:text-cyan transition-colors" />
              </a>
              <a href="https://instagram.com" target="_blank" rel="noreferrer" className="w-10 h-10 flex items-center justify-center border border-cyan/20 hover:border-cyan hover:bg-cyan/5 transition-all micro-border">
                <Instagram className="w-4 h-4 text-titanium/60 hover:text-cyan transition-colors" />
              </a>
              <a href="mailto:hello@wargrobotics.com" className="w-10 h-10 flex items-center justify-center border border-cyan/20 hover:border-cyan hover:bg-cyan/5 transition-all micro-border">
                <Mail className="w-4 h-4 text-titanium/60 hover:text-cyan transition-colors" />
              </a>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="text-[10px] font-mono-data text-orange uppercase tracking-widest mb-5">Navigation</div>
            <ul className="space-y-3">
              {links.map((l) => (
                <li key={l.path}>
                  <Link to={l.path} className="text-sm text-titanium/60 hover:text-cyan transition-colors flex items-center gap-1 group">
                    {l.label}
                    <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-4">
            <div className="text-[10px] font-mono-data text-orange uppercase tracking-widest mb-5">Contact</div>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-cyan/60 mt-0.5 shrink-0" />
                <span className="text-titanium/60">Indiranagar, Bengaluru, IN 560001</span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-cyan/60 shrink-0" />
                <a href="mailto:hello@wargrobotics.com" className="text-titanium/60 hover:text-cyan transition-colors">hello@wargrobotics.com</a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 pt-6 border-t border-cyan/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-[10px] font-mono-data text-titanium/30 uppercase tracking-widest">
            © 2026 WARG ROBOTICS — ALL SYSTEMS OPERATIONAL
          </div>
          <div className="text-[10px] font-mono-data text-titanium/30 uppercase tracking-widest">
            BUILT FOR PILOTS · MODULAR BY DESIGN
          </div>
        </div>
      </div>
    </footer>
  );
}
