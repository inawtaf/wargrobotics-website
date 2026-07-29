import React, { useState } from 'react';
import { Check, User, Mail, Phone } from 'lucide-react';

export function PreOrderForm({ onSubmit }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-[9px] font-mono-data text-orange uppercase tracking-widest mb-2">Contact Details</div>
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titanium/30" />
        <input
          type="text"
          name="name"
          required
          value={form.name}
          onChange={handleChange}
          placeholder="Full Name"
          className="w-full pl-10 pr-4 py-3 bg-obsidian border border-cyan/20 text-titanium text-sm placeholder:text-titanium/30 focus:border-cyan focus:outline-none clip-corner"
        />
      </div>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titanium/30" />
        <input
          type="email"
          name="email"
          required
          value={form.email}
          onChange={handleChange}
          placeholder="Email Address"
          className="w-full pl-10 pr-4 py-3 bg-obsidian border border-cyan/20 text-titanium text-sm placeholder:text-titanium/30 focus:border-cyan focus:outline-none clip-corner"
        />
      </div>
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titanium/30" />
        <input
          type="tel"
          name="phone"
          required
          value={form.phone}
          onChange={handleChange}
          placeholder="Phone Number"
          className="w-full pl-10 pr-4 py-3 bg-obsidian border border-cyan/20 text-titanium text-sm placeholder:text-titanium/30 focus:border-cyan focus:outline-none clip-corner"
        />
      </div>
      <button
        type="submit"
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-cyan text-white font-bold text-sm tracking-wide clip-corner hover:bg-titanium transition-colors"
      >
        <Check className="w-4 h-4" /> CONFIRM PRE-ORDER
      </button>
    </form>
  );
}
