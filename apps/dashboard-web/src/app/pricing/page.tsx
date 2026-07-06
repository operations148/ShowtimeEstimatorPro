'use client';

import { useState } from 'react';
import Link from 'next/link';

const FEATURES = [
  { icon: '⊞', label: 'Interactive estimator for your website' },
  { icon: '🌐', label: 'Embed on any page of your website' },
  { icon: '🎨', label: 'Custom branding — colors, logo & fonts' },
  { icon: '📱', label: 'Mobile-responsive design' },
  { icon: '👥', label: 'Unlimited lead submissions' },
  { icon: '🔔', label: 'Instant email notifications per lead' },
  { icon: '🛡', label: 'Built-in spam protection' },
  { icon: '📍', label: 'Service area zip code gating' },
  { icon: '📊', label: 'Analytics dashboard & drop-off insights' },
  { icon: '⬇', label: 'Data export (CSV)' },
  { icon: '🔄', label: 'Unlimited estimator changes' },
  { icon: '🎧', label: 'Dedicated onboarding & email support' },
];

const FAQS = [
  {
    q: "What does '1 website' mean?",
    a: "Your plan covers one website (domain). You can embed the estimator on as many pages of that site as you want — your homepage, service pages, landing pages — all included.",
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. There are no long-term contracts. You can cancel your subscription at any time from your account settings and you will not be billed again.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit and debit cards (Visa, Mastercard, American Express, Discover) processed securely through Stripe.',
  },
  {
    q: 'What kind of support is included?',
    a: 'Every plan includes dedicated onboarding assistance and ongoing email support. We help you get your estimator set up and live as quickly as possible.',
  },
  {
    q: 'How quickly can I get set up?',
    a: 'Most customers have their estimator live within 24 hours of signing up. Our onboarding team walks you through every step.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left text-white text-sm font-medium hover:text-cyan-400 transition-colors"
      >
        <span>{q}</span>
        <span className="ml-4 shrink-0 text-cyan-400 text-lg">{open ? '∧' : '∨'}</span>
      </button>
      {open && (
        <p className="pb-5 text-sm text-cyan-200/70 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

export default function PricingPage() {
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
          <Link href="/pricing" style={{ color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Pricing</Link>
          <Link href="/contact" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 14 }}>Contact</Link>
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
      <section style={{ textAlign: 'center', padding: '80px 24px 60px' }}>
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
          Pricing
        </span>
        <h1
          style={{
            fontSize: 'clamp(36px, 6vw, 64px)',
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            marginBottom: 16,
          }}
        >
          Simple, Honest Pricing
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, margin: 0 }}>
          One plan. Everything included. No hidden fees.
        </p>
      </section>

      {/* ── Pricing Card ── */}
      <section style={{ display: 'flex', justifyContent: 'center', padding: '0 24px 80px' }}>
        <div
          style={{
            background: '#111d2e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: '40px 48px',
            width: '100%',
            maxWidth: 480,
          }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Pro Plan</h2>
          <p style={{ color: '#00cfff', fontSize: 14, marginBottom: 28, opacity: 0.85 }}>
            Everything you need to capture leads and grow your business
          </p>

          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.03em' }}>$149</span>
            <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', marginLeft: 4 }}>/month</span>
          </div>
          <p style={{ color: '#00cfff', fontSize: 13, marginBottom: 32 }}>Billed monthly</p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 36px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FEATURES.map((f) => (
              <li key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                <span style={{ color: '#00cfff', fontSize: 16, lineHeight: 1 }}>✓</span>
                <span style={{ color: 'rgba(255,255,255,0.88)' }}>{f.label}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/signup"
            style={{
              display: 'block',
              background: 'linear-gradient(90deg, #00cfff 0%, #0099ff 100%)',
              color: '#0a1628',
              fontWeight: 700,
              fontSize: 16,
              textAlign: 'center',
              padding: '16px',
              borderRadius: 10,
              textDecoration: 'none',
              marginBottom: 14,
            }}
          >
            Sign Up
          </Link>
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
            No contract. Cancel anytime.
          </p>
        </div>
      </section>

      {/* ── Stats ── */}
      <section
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 0,
          borderTop: '1px solid rgba(255,255,255,0.07)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '48px 24px',
        }}
      >
        {[
          { value: '$60k+', label: 'Average pool project', sub: 'One job pays for 20+ months' },
          { value: '$149', label: 'Per month', sub: 'Less than 0.5% of a single conversion' },
          { value: '24/7', label: 'Lead capture', sub: 'Nights, weekends & holidays' },
        ].map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              maxWidth: 280,
              textAlign: 'center',
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
              padding: '0 32px',
            }}
          >
            <div style={{ fontSize: 40, fontWeight: 800, color: '#00cfff', letterSpacing: '-0.02em' }}>{s.value}</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{s.sub}</div>
          </div>
        ))}
      </section>

      {/* ── Everything Included ── */}
      <section style={{ padding: '80px 48px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, textAlign: 'center', marginBottom: 48 }}>Everything Included</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.label}
              style={{
                background: '#111d2e',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <span style={{ fontSize: 20, width: 28, textAlign: 'center', color: '#00cfff' }}>{f.icon}</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ padding: '0 48px 80px', maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, textAlign: 'center', marginBottom: 40 }}>
          Frequently Asked Questions
        </h2>
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none', borderRadius: 12, overflow: 'hidden', padding: '0 24px' }}>
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section
        style={{
          background: 'linear-gradient(180deg, rgba(0,100,200,0.12) 0%, rgba(0,207,255,0.06) 100%)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          textAlign: 'center',
          padding: '80px 24px',
        }}
      >
        <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, marginBottom: 16, letterSpacing: '-0.02em' }}>
          Your Next Lead Could Be Tonight
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15, marginBottom: 36 }}>
          Pool builders are capturing leads 24/7. Your website should be too.
        </p>
        <Link
          href="/signup"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'linear-gradient(90deg, #00cfff 0%, #0099ff 100%)',
            color: '#0a1628',
            fontWeight: 700,
            fontSize: 15,
            padding: '14px 28px',
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          Sign Up →
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer style={{ padding: '56px 48px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 48, marginBottom: 48 }}>
          {/* Brand */}
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

          {/* Pages */}
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Pages</h4>
            {['Home', 'Pricing', 'Contact'].map((p) => (
              <div key={p} style={{ marginBottom: 10 }}>
                <Link
                  href={p === 'Home' ? '/' : `/${p.toLowerCase()}`}
                  style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}
                >
                  {p}
                </Link>
              </div>
            ))}
          </div>

          {/* Company */}
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Company</h4>
            {['Terms of Service', 'Privacy Policy'].map((p) => (
              <div key={p} style={{ marginBottom: 10 }}>
                <Link
                  href={`/${p.toLowerCase().replace(/ /g, '-')}`}
                  style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}
                >
                  {p}
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
            {/* X */}
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>𝕏</a>
            {/* Facebook */}
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>f</a>
            {/* LinkedIn */}
            <a href="#" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, textDecoration: 'none' }}>in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
