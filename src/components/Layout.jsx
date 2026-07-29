import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Image } from '@/components/ui/image';
import { ActiveFrame } from './ActiveFrame';
import { Footer } from './Footer';

const NAV_LINKS = [
  { label: 'Home', path: '/' },
  { label: 'Tech', path: '/tech' },
  { label: 'Products', path: '/products' },
  { label: 'Contact', path: '/contact' },
];

export default function Layout() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-obsidian text-titanium relative">
      <ActiveFrame />
      {/* Top telemetry ticker */}
      <div className="fixed top-0 left-0 right-0 z-[60] border-b border-cyan/10 bg-obsidian/80 backdrop-blur-md">
        <div className="hidden md:flex items-center justify-between px-4 py-1 text-[10px] font-mono-data text-cyan/60 uppercase">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-cyan rounded-full animate-pulse-glow" />
            SYS://WARG.CORE — LINK ACTIVE
          </span>
          <span className="text-orange/70">LATENCY 20ms · 1080p30 · ENCRYPTED</span>
        </div>
      </div>

      {/* Main nav */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-obsidian/95 backdrop-blur-md border-b border-cyan/10' : 'bg-transparent'}`}>
        <nav className="max-w-[1440px] mx-auto px-6 lg:px-10 flex items-center justify-between" style={{ paddingTop: '1.75rem', paddingBottom: '1rem' }}>
          <Link to="/" className="flex items-center group">
            <Image src="https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/4e5a46552_companyname.png" alt="Warg Robotics" fittingType="fit" className="h-9 w-36" />
          </Link>

          <div className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`relative px-4 py-2 text-sm font-medium tracking-wide transition-colors ${active ? 'text-cyan' : 'text-titanium/70 hover:text-titanium'}`}
                >
                  {link.label}
                  {active && <span className="absolute bottom-0 left-4 right-4 h-px bg-cyan text-glow-cyan" />}
                </Link>
              );
            })}
          </div>

          <div className="hidden lg:block">
            <Link
              to="/products"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan text-obsidian font-semibold text-sm tracking-wide clip-corner hover:bg-titanium transition-colors"
            >
              BUILD MY FPV
            </Link>
          </div>

          <button
            className="lg:hidden p-2 text-titanium"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </nav>

        {mobileOpen && (
          <div className="lg:hidden bg-obsidian/98 backdrop-blur-md border-t border-cyan/10">
            <div className="flex flex-col px-6 py-4 gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-4 py-3 text-sm font-medium border-l-2 ${location.pathname === link.path ? 'border-cyan text-cyan' : 'border-transparent text-titanium/70'}`}
                >
                  {link.label}
                </Link>
              ))}
              <Link to="/products" className="mt-2 px-4 py-3 bg-cyan text-obsidian font-semibold text-sm text-center clip-corner">
                BUILD MY FPV
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="pt-16">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
