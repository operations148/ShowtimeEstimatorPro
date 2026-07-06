'use client';

import { useState } from 'react';
import Link from 'next/link';

const INDUSTRIES = [
  'Pool Service',
  'Construction',
  'HVAC',
  'Landscaping',
  'Cleaning Services',
  'Plumbing',
  'Electrical',
  'Other',
];

export default function ContactPage() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    company: '',
    industry: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [industryOpen, setIndustryOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0d1f35',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: '#00cfff',
    marginBottom: 6,
    display: 'block',
  };

  return (
    <div
      style={{
        background: '#0a1628',
        minHeight: '100vh',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: '#fff',
      }}
    >
      {/* ── Nav ── */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 48px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #00cfff 0%, #0080ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ≋
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
            Estimator<span style={{ color: '#00cfff' }}>Pro</span>
          </span>
        </Link>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 14 }}>Home</Link>
          <Link href="/pricing" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 14 }}>Pricing</Link>
          <Link href="/contact" style={{ color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Contact</Link>
          <Link
            href="/signup"
            style={{
              background: 'linear-gradient(90deg, #00cfff 0%, #0099ff 100%)',
              color: '#0a1628',
              fontWeight: 700,
              fontSize: 14,
              padding: '8px 20px',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ textAlign: 'center', padding: '80px 24px 48px' }}>
        <span
          style={{
            display: 'inline-block',
            background: 'rgba(0,207,255,0.12)',
            color: '#00cfff',
            border: '1px solid rgba(0,207,255,0.3)',
            borderRadius: 20,
            padding: '4px 16px',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 24,
          }}
        >
          Contact
        </span>
        <h1
          style={{
            fontSize: 'clamp(36px, 6vw, 56px)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            marginBottom: 16,
          }}
        >
          Let&apos;s Talk
        </h1>
        <p
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 15,
            maxWidth: 520,
            margin: '0 auto',
            lineHeight: 1.6,
          }}
        >
          Have a question, need support, or interested in a partnership? We&apos;re here to help —
          send us a message and we&apos;ll get back to you shortly.
        </p>
      </section>

      {/* ── Form Card ── */}
      <section style={{ display: 'flex', justifyContent: 'center', padding: '0 24px 80px' }}>
        <div
          style={{
            background: '#111d2e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: '36px 40px',
            width: '100%',
            maxWidth: 540,
          }}
        >
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Message Sent!</h3>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>
                We&apos;ll get back to you within 1 business day.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Send Us a Message</h2>

              {/* Row 1: Full Name + Email */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>
                    Full Name <span style={{ color: '#00cfff' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="John Smith"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>
                    Email <span style={{ color: '#00cfff' }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="john@company.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Row 2: Phone + Company */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Phone Number</label>
                  <input
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Company Name</label>
                  <input
                    type="text"
                    placeholder="ABC Services"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Industry dropdown */}
              <div style={{ marginBottom: 16, position: 'relative' }}>
                <label style={labelStyle}>Industry</label>
                <button
                  type="button"
                  onClick={() => setIndustryOpen(!industryOpen)}
                  style={{
                    ...inputStyle,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: form.industry ? '#fff' : 'rgba(255,255,255,0.35)',
                  }}
                >
                  <span>{form.industry || 'Select your industry'}</span>
                  <span style={{ fontSize: 12 }}>∨</span>
                </button>
                {industryOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#111d2e',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      zIndex: 10,
                      marginTop: 4,
                      overflow: 'hidden',
                    }}
                  >
                    {INDUSTRIES.map((ind) => (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => {
                          setForm({ ...form, industry: ind });
                          setIndustryOpen(false);
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 16px',
                          fontSize: 14,
                          color: form.industry === ind ? '#00cfff' : 'rgba(255,255,255,0.85)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,207,255,0.08)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                        }}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Message</label>
                <textarea
                  rows={4}
                  placeholder="Tell us about your business and what you are looking for..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: 100,
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  background: 'linear-gradient(90deg, #00cfff 0%, #0099ff 100%)',
                  color: '#0a1628',
                  fontWeight: 700,
                  fontSize: 15,
                  padding: '14px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: 14,
                }}
              >
                Send Message
              </button>

              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', margin: 0 }}>
                By submitting this form, you agree to our{' '}
                <Link href="/privacy-policy" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'underline' }}>
                  Privacy Policy
                </Link>
                .
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '56px 48px 32px',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 48, marginBottom: 48 }}>
          <div>
            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', marginBottom: 16 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, #00cfff 0%, #0080ff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                }}
              >
                ≋
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
                Estimator<span style={{ color: '#00cfff' }}>Pro</span>
              </span>
            </Link>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, maxWidth: 260 }}>
              Interactive estimators that qualify leads, set expectations, and capture contact info — embedded right on your website.
            </p>
          </div>

          <div>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Pages</h4>
            {[
              { label: 'Home', href: '/' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Contact', href: '/contact' },
            ].map((p) => (
              <div key={p.label} style={{ marginBottom: 10 }}>
                <Link href={p.href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>
                  {p.label}
                </Link>
              </div>
            ))}
          </div>

          <div>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Company</h4>
            {[
              { label: 'Terms of Service', href: '/terms-of-service' },
              { label: 'Privacy Policy', href: '/privacy-policy' },
            ].map((p) => (
              <div key={p.label} style={{ marginBottom: 10 }}>
                <Link href={p.href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>
                  {p.label}
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
            © 2026 EstimatorPro. All rights reserved.
          </span>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>𝕏</a>
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>f</a>
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
