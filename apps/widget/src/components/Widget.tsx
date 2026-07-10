import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createWidgetApi } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  stepId: string;
  type: 'single' | 'multiple' | 'text' | 'number';
  label: string;
  options?: string[];
  optionImages?: Record<string, string | string[]>;
  required: boolean;
  order: number;
}

interface WidgetConfig {
  estimatorId: string;
  publicKey: string;
  title: string;
  branding: {
    logoUrl?: string;
    primaryColor?: string;
    backgroundColor?: string;
    textColor?: string;
    fontFamily?: string;
    bookingUrl?: string;
  };
  questions: Question[];
  tenantName: string;
  serviceAreaBehavior: 'block' | 'warn';
  leadConfig: { required: string[]; optional: string[] };
}

interface EstimateResult {
  min: number;
  max: number;
  currency: string;
}

interface WidgetProps {
  publicKey: string;
  apiUrl: string;
}

type WidgetStep = 'loading' | 'form' | 'submitting' | 'revealed' | 'error' | 'out_of_area';

interface LeadState {
  name: string;
  phone: string;
  email: string;
  zip: string;
}

interface LeadErrors {
  name?: string;
  phone?: string;
  email?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Light phone check — at least 7 digits (works across international formats).
function isValidPhone(phone: string) {
  return (phone.match(/\d/g) ?? []).length >= 7;
}

function fmtCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Monthly payment estimate (simple: 6.99% APR / 30 years)
function fmtMonthly(amount: number, currency: string) {
  const monthly = (amount * (0.0699 / 12)) / (1 - Math.pow(1 + 0.0699 / 12, -360));
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(monthly);
}

// ── Hardcoded option images (fallback when DB images not set) ─────────────────

const OPTION_IMAGES: Record<string, string> = {
  'Pool Only':             'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?w=600&q=80&fit=crop',
  'Pool & Spa':            'https://images.unsplash.com/photo-1560185127-6a9b2a70c3f6?w=600&q=80&fit=crop',
  'Regular 15x30':         'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=600&q=80&fit=crop',
  'Medium 17x35':          'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600&q=80&fit=crop',
  'Large 20x40':           'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=600&q=80&fit=crop',
  'Freeform / Curvy':      'https://images.unsplash.com/photo-1622547748225-3fc4abd2cca0?w=600&q=80&fit=crop',
  'Straight / Modern':     'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&q=80&fit=crop',
  'Bubblers':              'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=600&q=80&fit=crop',
  'Deck Jets':             'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&q=80&fit=crop',
  'Sheet Fall':            'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=600&q=80&fit=crop',
  'Natural Rock':          'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=600&q=80&fit=crop',
  'Water Bowls':           'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=600&q=80&fit=crop',
  'Fire Water Bowls':      'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=600&q=80&fit=crop',
  'Premium White Plaster': 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=600&q=80&fit=crop',
  'Shimmer Quartz':        'https://images.unsplash.com/photo-1505562861526-9f69eebbef06?w=600&q=80&fit=crop',
  'PebbleTec':             'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=600&q=80&fit=crop',
  'Coping Only':           'https://images.unsplash.com/photo-1572331165267-854da2b021cf?w=600&q=80&fit=crop',
  'Concrete':              'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80&fit=crop',
  // Pool Upgrades
  'Salt Water':            'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=600&q=80&fit=crop',
  'LED Color Lighting':    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=600&q=80&fit=crop',
  'Pool Automation':       'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=600&q=80&fit=crop',
  'Umbrella Sleeve':       'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=600&q=80&fit=crop',
  'Glass Trim Tile':       'https://images.unsplash.com/photo-1505562861526-9f69eebbef06?w=600&q=80&fit=crop',
  'Hand Rail':             'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=600&q=80&fit=crop',
  // Solar / Equipment
  'No':                    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80&fit=crop',
  'Yes':                   'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=600&q=80&fit=crop',
  'Cartridge':             'https://images.unsplash.com/photo-1562184552-997c461f7777?w=600&q=80&fit=crop',
  'Media / Sand':          'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=600&q=80&fit=crop',
  'e3 / Eco Technology':   'https://images.unsplash.com/photo-1497440001374-f26997328c1b?w=600&q=80&fit=crop',
};

// Placeholder gradients cycling for options without images
const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg, #0f4c81, #1a7abf)',
  'linear-gradient(135deg, #0d6b5e, #14a38a)',
  'linear-gradient(135deg, #4a1878, #7c3aed)',
  'linear-gradient(135deg, #7c1d1d, #c2410c)',
  'linear-gradient(135deg, #1e3a5f, #2563eb)',
  'linear-gradient(135deg, #064e3b, #059669)',
];

// The booking page (booking.html) is served from the same origin as this widget
// bundle. Find that origin from our own <script> tag so the "Book Your Appointment"
// CTA works whether the widget is embedded on a customer site or previewed here.
function widgetOrigin(): string {
  try {
    const scripts = Array.from(document.getElementsByTagName('script'));
    const self = scripts.find((s) => s.src && s.src.includes('widget.iife'));
    if (self) return new URL(self.src).origin;
  } catch {
    /* fall through */
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

// Build a SHORT booking-page URL. We pass only the estimator's public key + the
// API base; the booking page fetches the calendar/logo/name itself. (Passing the
// logo inline can overflow the URL length when it's a base64 data URI.)
function bookingPageUrl(cfg: WidgetConfig, apiUrl: string): string | null {
  if (!cfg.branding.bookingUrl) return null;
  const params = new URLSearchParams({ key: cfg.publicKey, api: apiUrl });
  return `${widgetOrigin()}/booking.html?${params.toString()}`;
}

// Normalize an option's images (single URL, array, or hardcoded fallback) to a
// list of at most 2 URLs.
function imageList(
  optionImages: Record<string, string | string[]> | undefined,
  opt: string,
): string[] {
  const v = optionImages?.[opt];
  let urls: string[];
  if (Array.isArray(v)) urls = v;
  else if (typeof v === 'string' && v) urls = [v];
  else urls = OPTION_IMAGES[opt] ? [OPTION_IMAGES[opt] as string] : [];
  return urls.filter(Boolean).slice(0, 2);
}

// ── Image card (with optional 2-image carousel) ───────────────────────────────

function ImageCard({
  label,
  imgUrls,
  selected,
  onClick,
  placeholderIndex,
}: {
  label: string;
  imgUrls: string[];
  selected: boolean;
  onClick: () => void;
  placeholderIndex?: number;
}) {
  const placeholder = PLACEHOLDER_GRADIENTS[(placeholderIndex ?? 0) % PLACEHOLDER_GRADIENTS.length];
  const [idx, setIdx] = useState(0);
  const hasImages = imgUrls.length > 0;
  const multi = imgUrls.length > 1;
  const current = imgUrls[Math.min(idx, imgUrls.length - 1)];

  const step = (e: React.MouseEvent, dir: 1 | -1) => {
    e.stopPropagation(); // don't toggle selection when using the arrows
    setIdx((i) => (i + dir + imgUrls.length) % imgUrls.length);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={selected}
      className={`ep-card${selected ? ' ep-card--selected' : ''}`}
      style={{ background: hasImages ? '#0f2035' : placeholder }}
    >
      {hasImages ? (
        <img className="ep-card-img" src={current} alt={label} loading="lazy" />
      ) : (
        <span className="ep-card-ph" style={{ background: placeholder }} />
      )}
      <span className="ep-card-label">{label}</span>
      {hasImages && <span className="ep-card-scrim" />}

      {multi && (
        <>
          <button type="button" className="ep-caro ep-caro--prev" onClick={(e) => step(e, -1)} aria-label="Previous image">‹</button>
          <button type="button" className="ep-caro ep-caro--next" onClick={(e) => step(e, 1)} aria-label="Next image">›</button>
          <span className="ep-caro-dots" aria-hidden="true">
            {imgUrls.map((_, i) => (
              <span key={i} className={`ep-caro-dot${i === Math.min(idx, imgUrls.length - 1) ? ' ep-caro-dot--on' : ''}`} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}

// ── Collapsed question: compact text pills ─────────────────────────────────────

function OptionsPills({
  question,
  answers,
  onPick,
}: {
  question: Question;
  answers: Record<string, unknown>;
  onPick: (id: string, opt: string) => void;
}) {
  const { id, type, options } = question;
  if (!options || options.length === 0) return null;
  const answer = answers[id];
  const selectedArr: string[] = type === 'multiple' && Array.isArray(answer) ? (answer as string[]) : [];
  const selectedSingle = type !== 'multiple' && typeof answer === 'string' ? answer : '';
  const isSel = (opt: string) => (type === 'multiple' ? selectedArr.includes(opt) : selectedSingle === opt);

  return (
    <div className="ep-pills">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`ep-pill${isSel(opt) ? ' ep-pill--selected' : ''}`}
          onClick={() => onPick(id, opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Options grid ───────────────────────────────────────────────────────────────

function OptionsGrid({
  question,
  answers,
  onAnswer,
}: {
  question: Question;
  answers: Record<string, unknown>;
  onAnswer: (id: string, val: unknown) => void;
}) {
  const { id, type, options, optionImages } = question;
  if (!options || options.length === 0) return null;

  const answer = answers[id];
  const selectedArr: string[] =
    type === 'multiple' ? (Array.isArray(answer) ? (answer as string[]) : []) : [];
  const selectedSingle: string =
    type === 'single' ? (typeof answer === 'string' ? answer : '') : '';

  const isSelected = (opt: string) =>
    type === 'multiple' ? selectedArr.includes(opt) : selectedSingle === opt;

  const handleClick = (opt: string) => {
    if (type === 'multiple') {
      const next = selectedArr.includes(opt)
        ? selectedArr.filter((v) => v !== opt)
        : [...selectedArr, opt];
      onAnswer(id, next);
    } else {
      // Clicking the selected option again clears it (questions are skippable).
      onAnswer(id, selectedSingle === opt ? '' : opt);
    }
  };

  const cols = options.length <= 2 ? 2 : options.length === 3 ? 3 : 2;

  return (
    <div className="ep-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {options.map((opt, i) => (
        <ImageCard
          key={opt}
          label={opt}
          imgUrls={imageList(optionImages, opt)}
          selected={isSelected(opt)}
          onClick={() => handleClick(opt)}
          placeholderIndex={i}
        />
      ))}
    </div>
  );
}

// ── Main Widget ───────────────────────────────────────────────────────────────

export function Widget({ publicKey, apiUrl }: WidgetProps) {
  const api = useRef(createWidgetApi(apiUrl));
  const sessionId = useRef(`ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  // Per-step funnel tracking — fire each step_view/step_complete at most once so
  // the dashboard's "Drop-off Per Step" table can aggregate views vs completions.
  const trackedSteps = useRef({ viewed: new Set<string>(), completed: new Set<string>() });

  const trackStepView = (cfg: WidgetConfig, stepId: string) => {
    if (trackedSteps.current.viewed.has(stepId)) return;
    trackedSteps.current.viewed.add(stepId);
    api.current.trackEvent({ estimatorId: cfg.estimatorId, eventType: 'step_view', stepId, sessionId: sessionId.current });
  };

  const [step, setStep] = useState<WidgetStep>('loading');
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [lead, setLead] = useState<LeadState>({ name: '', phone: '', email: '', zip: '' });
  const [leadErrors, setLeadErrors] = useState<LeadErrors>({});
  const [honeypot, setHoneypot] = useState(''); // spam trap — must stay empty
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [error, setError] = useState('');
  const [areaWarning, setAreaWarning] = useState(false);
  // Accordion: only one question is "expanded" (image cards) at a time; the rest
  // render as compact text pills. Null until config loads.
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  // Load config
  useEffect(() => {
    api.current
      .getConfig(publicKey)
      .then((cfg) => {
        setConfig(cfg);
        setStep('form');
        // Open the first question and pre-select its first answer (single-choice).
        const first = cfg.questions[0];
        if (first) {
          setActiveQuestionId(first.id);
          if (first.type === 'single' && first.options && first.options[0]) {
            setAnswers((prev) => ({ ...prev, [first.id]: first.options![0] }));
          }
          trackStepView(cfg, first.id);
        }
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to load estimator');
        setStep('error');
      });
  }, [publicKey]);

  const handleAnswer = useCallback((questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  // Emit step_complete once per question the moment it has a non-empty answer.
  useEffect(() => {
    if (!config) return;
    for (const q of config.questions) {
      const a = answers[q.id];
      const answered = Array.isArray(a)
        ? a.length > 0
        : typeof a === 'string'
          ? a.trim() !== ''
          : a != null;
      if (answered && !trackedSteps.current.completed.has(q.id)) {
        trackedSteps.current.completed.add(q.id);
        api.current.trackEvent({
          estimatorId: config.estimatorId,
          eventType: 'step_complete',
          stepId: q.id,
          sessionId: sessionId.current,
        });
      }
    }
  }, [answers, config]);

  const validateLead = () => {
    const errs: LeadErrors = {};
    if (!lead.name.trim()) errs.name = 'Name is required';
    if (!lead.phone.trim()) errs.phone = 'Phone is required';
    else if (!isValidPhone(lead.phone)) errs.phone = 'Enter a valid phone number';
    if (!lead.email.trim()) errs.email = 'Email is required';
    else if (!isValidEmail(lead.email)) errs.email = 'Enter a valid email address';
    setLeadErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!config) return;
    // Honeypot filled → silently treat as spam; don't submit.
    if (honeypot.trim() !== '') return;
    if (!validateLead()) return;
    setStep('submitting');

    try {
      const res = await api.current.submit({
        estimatorPublicKey: publicKey,
        lead: {
          name: lead.name.trim(),
          phone: lead.phone.trim(),
          email: lead.email.trim(),
          zip: lead.zip.trim() || undefined,
        },
        answers,
        sessionId: sessionId.current,
        company: honeypot,
      });

      api.current.trackEvent({
        estimatorId: config.estimatorId,
        eventType: 'submit',
        sessionId: sessionId.current,
      });

      setResult(res.estimate);
      setStep('revealed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      const isOutOfArea =
        msg.toLowerCase().includes('service area') || msg.toLowerCase().includes('out of area');

      if (isOutOfArea) {
        api.current.trackEvent({
          estimatorId: config.estimatorId,
          eventType: 'gated_out',
          sessionId: sessionId.current,
        });
        if (config.serviceAreaBehavior === 'warn') {
          setAreaWarning(true);
          setStep('form');
        } else {
          setStep('out_of_area');
        }
      } else {
        setError(msg);
        setStep('error');
      }
    }
  };

  // ── Derived branding ───────────────────────────────────────────────────────
  const brandColor = config?.branding?.primaryColor ?? '#06b6d4';
  const fontFamily = config?.branding?.fontFamily
    ? `${config.branding.fontFamily}, system-ui, sans-serif`
    : 'system-ui, sans-serif';
  // Theme colors are branding-driven: --ep-bg / --ep-text override the defaults, and
  // the rail/surface/border/muted shades derive from them (see WIDGET_CSS). This lets
  // a tenant pick a light (white) or dark widget without a separate theme flag.
  const rootStyle = {
    fontFamily,
    ['--ep-brand' as string]: brandColor,
    ...(config?.branding?.backgroundColor ? { ['--ep-bg']: config.branding.backgroundColor } : {}),
    ...(config?.branding?.textColor ? { ['--ep-text']: config.branding.textColor } : {}),
  } as React.CSSProperties;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="ep-root" style={rootStyle}>
        <style>{WIDGET_CSS}</style>
        <div className="ep-shell ep-shell--loading">
          <div className="ep-skeleton-rail" />
          <div className="ep-skeleton-main">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ep-skeleton-block">
                <span className="ep-skeleton-line" />
                <div className="ep-skeleton-cards">
                  <span />
                  <span />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="ep-root" style={rootStyle}>
        <style>{WIDGET_CSS}</style>
        <div className="ep-shell ep-shell--message">
          <div className="ep-message ep-message--error">
            {error || 'Something went wrong. Please try again.'}
          </div>
        </div>
      </div>
    );
  }

  // ── Out of area ────────────────────────────────────────────────────────────
  if (step === 'out_of_area') {
    return (
      <div className="ep-root" style={rootStyle}>
        <style>{WIDGET_CSS}</style>
        <div className="ep-shell ep-shell--message">
          <div className="ep-message">
            <div className="ep-message-icon">📍</div>
            <h3>Outside Service Area</h3>
            <p>
              Sorry, we don&apos;t currently serve zip code <strong>{lead.zip}</strong>. Please
              contact us directly for more information.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form (two-column) ──────────────────────────────────────────────────
  if ((step === 'form' || step === 'submitting' || step === 'revealed') && config) {
    const isSubmitting = step === 'submitting';
    const isRevealed = step === 'revealed';
    const leadValid =
      lead.name.trim().length > 0 && isValidPhone(lead.phone) && isValidEmail(lead.email);
    const logoUrl = config.branding.logoUrl;
    const bookingHref = bookingPageUrl(config, apiUrl);

    return (
      <div className="ep-root" style={rootStyle}>
        <style>{WIDGET_CSS}</style>
        <div className="ep-shell">
          {/* ── Left rail: branding + reveal CTA + price card ── */}
          <div className="ep-rail-logo">
            <span className="ep-rail-orgname">{config.tenantName || config.title}</span>
            {logoUrl && (
              <img src={logoUrl} alt={config.tenantName || 'Logo'} className="ep-logo-img" />
            )}
          </div>

          <div className={`ep-rail-cta${!isRevealed ? ' ep-rail-cta--locked' : ''}`}>
            {!isRevealed && (
              <button
                type="button"
                className="ep-reveal"
                onClick={handleSubmit}
                disabled={!leadValid || isSubmitting}
              >
                {isSubmitting ? 'Calculating…' : 'Reveal Your Price'}
              </button>
            )}

            <div className="ep-price">
              {isRevealed && result ? (
                <>
                  <p className="ep-price-eyebrow">Your Estimate</p>
                  <p className="ep-price-value">
                    {fmtCurrency(result.min, result.currency)} –{' '}
                    {fmtCurrency(result.max, result.currency)}
                  </p>
                  <p className="ep-price-mo">
                    {fmtMonthly((result.min + result.max) / 2, result.currency)} / Mo O.A.C
                  </p>
                  <p className="ep-price-fine">6.99% APR / 30 years</p>
                </>
              ) : (
                <div className="ep-price-locked" aria-hidden="true">
                  <p className="ep-price-eyebrow">Your Estimate</p>
                  <p className="ep-price-value ep-blur">$52,400 – $78,900</p>
                  <p className="ep-price-mo ep-blur">$486 / Mo O.A.C</p>
                  <span className="ep-lock">🔒</span>
                </div>
              )}
            </div>

            {isRevealed && bookingHref && (
              <a
                className="ep-book"
                href={bookingHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Book Your Appointment
              </a>
            )}
          </div>

          {/* ── Right column: questions + lead form ── */}
          <div className="ep-main">
            {config.title && <p className="ep-main-title">{config.title}</p>}

            {config.questions.map((q) => (
              <div key={q.id} className="ep-question">
                <p className="ep-q-label">
                  {q.label}
                  {q.required && <span className="ep-req"> *</span>}
                </p>

                {(q.type === 'single' || q.type === 'multiple') && q.options ? (
                  q.id === activeQuestionId ? (
                    <OptionsGrid question={q} answers={answers} onAnswer={handleAnswer} />
                  ) : (
                    <OptionsPills
                      question={q}
                      answers={answers}
                      onPick={(id, opt) => {
                        // Opening a collapsed question expands it AND applies the pick.
                        setActiveQuestionId(id);
                        trackStepView(config, id);
                        handleAnswer(
                          id,
                          q.type === 'multiple'
                            ? (Array.isArray(answers[id]) ? (answers[id] as string[]) : []).includes(opt)
                              ? (answers[id] as string[]).filter((v) => v !== opt)
                              : [...((answers[id] as string[]) ?? []), opt]
                            : opt,
                        );
                      }}
                    />
                  )
                ) : q.type === 'text' || q.type === 'number' ? (
                  <input
                    className="ep-input"
                    type={q.type === 'number' ? 'number' : 'text'}
                    value={
                      typeof answers[q.id] === 'string' || typeof answers[q.id] === 'number'
                        ? String(answers[q.id])
                        : ''
                    }
                    onChange={(e) =>
                      handleAnswer(
                        q.id,
                        q.type === 'number'
                          ? e.target.value === ''
                            ? ''
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                    placeholder={q.required ? 'Required' : 'Optional'}
                  />
                ) : null}
              </div>
            ))}

            <div className="ep-divider" />

            {areaWarning && (
              <div className="ep-warning">
                ⚠️ Zip code <strong>{lead.zip}</strong> may be outside our primary service area. You
                can still submit.
              </div>
            )}

            {/* Lead form — Name / Phone / Email required, Zip optional */}
            <div className="ep-lead-grid">
              <div className="ep-field">
                <label className="ep-label" htmlFor="ep-name">
                  Name <span className="ep-req">*</span>
                </label>
                <input
                  id="ep-name"
                  className={`ep-input${leadErrors.name ? ' ep-input--error' : ''}`}
                  type="text"
                  value={lead.name}
                  onChange={(e) => {
                    setLead((l) => ({ ...l, name: e.target.value }));
                    setLeadErrors((er) => ({ ...er, name: undefined }));
                  }}
                  placeholder="Jane Smith"
                  autoComplete="name"
                />
                {leadErrors.name && <p className="ep-err">{leadErrors.name}</p>}
              </div>

              <div className="ep-field">
                <label className="ep-label" htmlFor="ep-phone">
                  Phone <span className="ep-req">*</span>
                </label>
                <input
                  id="ep-phone"
                  className={`ep-input${leadErrors.phone ? ' ep-input--error' : ''}`}
                  type="tel"
                  value={lead.phone}
                  onChange={(e) => {
                    setLead((l) => ({ ...l, phone: e.target.value }));
                    setLeadErrors((er) => ({ ...er, phone: undefined }));
                  }}
                  placeholder="(555) 555-5555"
                  autoComplete="tel"
                />
                {leadErrors.phone && <p className="ep-err">{leadErrors.phone}</p>}
              </div>

              <div className="ep-field">
                <label className="ep-label" htmlFor="ep-email">
                  Email <span className="ep-req">*</span>
                </label>
                <input
                  id="ep-email"
                  className={`ep-input${leadErrors.email ? ' ep-input--error' : ''}`}
                  type="email"
                  value={lead.email}
                  onChange={(e) => {
                    setLead((l) => ({ ...l, email: e.target.value }));
                    setLeadErrors((er) => ({ ...er, email: undefined }));
                  }}
                  placeholder="you@email.com"
                  autoComplete="email"
                />
                {leadErrors.email && <p className="ep-err">{leadErrors.email}</p>}
              </div>

              <div className="ep-field">
                <label className="ep-label" htmlFor="ep-zip">
                  Zip Code
                </label>
                <input
                  id="ep-zip"
                  className="ep-input"
                  type="text"
                  value={lead.zip}
                  onChange={(e) => {
                    setLead((l) => ({ ...l, zip: e.target.value }));
                    setAreaWarning(false);
                  }}
                  placeholder="90210"
                  autoComplete="postal-code"
                  maxLength={10}
                />
              </div>
            </div>

            {/* Honeypot — visually hidden; real users never fill it */}
            <div className="ep-hp" aria-hidden="true">
              <label htmlFor="ep-company">Company</label>
              <input
                id="ep-company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            {/* Mobile reveal CTA (the rail CTA is hidden on narrow screens) */}
            {!isRevealed && (
              <button
                type="button"
                className="ep-reveal ep-reveal--mobile"
                onClick={handleSubmit}
                disabled={!leadValid || isSubmitting}
              >
                {isSubmitting ? 'Calculating…' : 'Reveal Your Price'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Scoped styles ─────────────────────────────────────────────────────────────
// Everything is namespaced under .ep-root so the embed never leaks styles into
// (or inherits from) the host page. Dynamic brand color comes in via --ep-brand.

const WIDGET_CSS = `
.ep-root, .ep-root * { box-sizing: border-box; }
.ep-root {
  /* Base theme colors — overridable per-tenant via inline --ep-bg / --ep-text. */
  --ep-bg: #0a1628;
  --ep-text: #e2e8f0;
  /* Everything else derives from bg + text, so it works for a dark OR light bg. */
  --ep-rail: color-mix(in srgb, var(--ep-bg) 90%, var(--ep-text) 10%);
  --ep-surface: color-mix(in srgb, var(--ep-bg) 85%, var(--ep-text) 15%);
  --ep-border: color-mix(in srgb, var(--ep-bg) 72%, var(--ep-text) 28%);
  --ep-muted: color-mix(in srgb, var(--ep-text) 55%, var(--ep-bg) 45%);
  color: var(--ep-text);
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}

/* ── Shell / layout ── */
.ep-shell {
  display: grid;
  grid-template-columns: minmax(200px, 300px) 1fr;
  /* Split the brand rail 50/50 — logo centered in the top half, the Reveal CTA +
     price card centered in the bottom half — so the price isn't cramped at the
     very bottom edge. */
  grid-template-rows: 1fr 1fr;
  grid-template-areas: "logo main" "cta main";
  /* Fill the host container (the iframe, which is given a fixed one-page height by
     the embed snippet) so the rail + questions form a single-page box with the
     questions column scrolling internally. */
  height: 100%;
  min-height: 480px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  background: var(--ep-bg);
  border: 1px solid var(--ep-border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 60px -24px rgba(3, 12, 26, 0.7);
}
.ep-shell--message { grid-template-columns: 1fr; grid-template-rows: 1fr; grid-template-areas: "main"; height: auto; min-height: 220px; }

.ep-rail-logo {
  grid-area: logo;
  background: var(--ep-rail);
  border-right: 1px solid var(--ep-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 28px 20px 8px;
}
.ep-rail-orgname {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ep-muted);
  text-align: center;
}
.ep-rail-cta {
  grid-area: cta;
  background: var(--ep-rail);
  border-right: 1px solid var(--ep-border);
  border-top: 1px solid color-mix(in srgb, var(--ep-brand) 32%, transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Sit at the top of the bottom half (i.e. the vertical middle of the rail) so the
     Reveal button + blurred price card group together near the center, under the
     divider — not floating low. The logo stays centered in the top half. */
  justify-content: flex-start;
  gap: 14px;
  padding: 22px 20px 16px;
}
.ep-logo-img { max-width: 100%; max-height: 74px; object-fit: contain; display: block; }

/* ── Reveal CTA ── */
.ep-reveal {
  width: 100%;
  max-width: 220px;
  border: none;
  border-radius: 999px;
  padding: 13px 24px;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, var(--ep-brand), #0891b2);
  box-shadow: 0 10px 24px -10px var(--ep-brand);
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.15s, box-shadow 0.15s;
}
.ep-reveal:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 30px -10px var(--ep-brand); }
.ep-reveal:active:not(:disabled) { transform: translateY(0) scale(0.98); }
.ep-reveal:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ep-reveal:disabled { background: var(--ep-border); opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.ep-reveal--mobile { display: none; margin: 20px auto 4px; }

/* ── Price card ── */
.ep-price {
  position: relative;
  width: 100%;
  background: var(--ep-surface);
  border: 1px solid color-mix(in srgb, var(--ep-brand) 30%, transparent);
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
}
.ep-price-eyebrow { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--ep-muted); }
.ep-price-value { margin: 0 0 4px; font-size: 22px; font-weight: 800; color: var(--ep-text); letter-spacing: -0.02em; }
.ep-price-mo { margin: 0; font-size: 13px; color: var(--ep-muted); }
.ep-price-fine { margin: 2px 0 0; font-size: 10px; color: var(--ep-muted); }
.ep-price-note { margin: 12px 0 0; font-size: 12px; font-weight: 500; color: var(--ep-brand); }
.ep-book {
  display: block; width: 100%; max-width: 220px; margin: 14px auto 0;
  padding: 13px 18px; border-radius: 12px; box-sizing: border-box;
  text-align: center; text-decoration: none;
  font-size: 14px; font-weight: 700; color: #fff; cursor: pointer;
  background: linear-gradient(135deg, #16a34a, #0d9488);
  box-shadow: 0 10px 24px -10px #16a34a;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s;
}
.ep-book:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -10px #16a34a; }
.ep-book:active { transform: translateY(0) scale(0.98); }
.ep-book:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ep-blur { filter: blur(7px); user-select: none; }
.ep-price-locked .ep-lock { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -20%); font-size: 22px; opacity: 0.9; }

/* ── Main column ── */
/* min-height:0 lets this grid item shrink so overflow-y:auto actually scrolls
   (grid items default to min-height:auto, which would overflow the shell). */
.ep-main { grid-area: main; overflow-y: auto; min-height: 0; padding: 26px 22px 28px; }
.ep-main::-webkit-scrollbar { width: 10px; }
.ep-main::-webkit-scrollbar-thumb { background: var(--ep-border); border-radius: 8px; border: 3px solid var(--ep-bg); }
.ep-main-title { margin: 0 0 18px; text-align: center; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ep-muted); }

.ep-question { margin-bottom: 24px; }
.ep-q-label { margin: 0 0 12px; text-align: center; font-size: 15px; font-weight: 500; color: var(--ep-text); }
.ep-req { color: var(--ep-brand); }

/* ── Option grid + cards ── */
.ep-grid { display: grid; gap: 10px; }
.ep-card {
  position: relative;
  border: 2px solid transparent;
  border-radius: 12px;
  overflow: hidden;
  padding: 0;
  aspect-ratio: 4 / 3;
  cursor: pointer;
  background: var(--ep-surface);
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.15s, box-shadow 0.15s;
}
.ep-card:hover { transform: translateY(-2px); box-shadow: 0 12px 22px -12px rgba(0,0,0,0.6); }
.ep-card:focus-visible { outline: none; border-color: var(--ep-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ep-brand) 40%, transparent); }
.ep-card--selected { border-color: var(--ep-brand); box-shadow: 0 0 0 1px var(--ep-brand), 0 10px 22px -12px var(--ep-brand); }
.ep-card-img, .ep-card-ph { width: 100%; height: 100%; object-fit: cover; display: block; }
.ep-card-label {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 7px 8px; font-size: 12.5px; font-weight: 600; text-align: center; color: #fff;
  background: rgba(0,0,0,0.55); transition: background 0.15s;
}
.ep-card--selected .ep-card-label { background: var(--ep-brand); }
.ep-card-scrim { position: absolute; bottom: 0; left: 0; right: 0; height: 42%; background: linear-gradient(to top, rgba(0,0,0,0.5), transparent); pointer-events: none; }

/* ── 2-image carousel arrows ── */
.ep-caro {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 26px; height: 26px; border-radius: 50%;
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1; font-weight: 700;
  color: #fff; background: rgba(0,0,0,0.5);
  transition: background 0.15s, transform 0.15s;
}
.ep-caro:hover { background: rgba(0,0,0,0.75); }
.ep-caro--prev { left: 6px; }
.ep-caro--next { right: 6px; }
.ep-caro-dots { position: absolute; bottom: 6px; left: 0; right: 0; display: flex; justify-content: center; gap: 5px; pointer-events: none; }
.ep-caro-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.5); }
.ep-caro-dot--on { background: #fff; }

/* ── Collapsed question: clean 2-column text pills ── */
.ep-pills {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 560px;
  margin: 0 auto;
}
.ep-pill {
  padding: 15px 16px; border-radius: 14px;
  border: 1px solid var(--ep-border); background: var(--ep-surface);
  color: var(--ep-text); font-size: 14px; font-weight: 600; text-align: center; cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.ep-pill:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--ep-brand) 50%, transparent); }
.ep-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ep-brand) 35%, transparent); }
.ep-pill--selected { border-color: var(--ep-brand); background: var(--ep-brand); color: #fff; }

/* ── Inputs / lead form ── */
.ep-divider { height: 1px; background: var(--ep-border); margin: 6px 0 22px; }
.ep-lead-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ep-field { min-width: 0; }
.ep-label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: var(--ep-muted); }
.ep-input {
  width: 100%; padding: 11px 12px; font: inherit; font-size: 14px;
  color: var(--ep-text); background: var(--ep-surface);
  border: 1.5px solid var(--ep-border); border-radius: 9px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ep-input::placeholder { color: var(--ep-muted); opacity: 0.8; }
.ep-input:focus { border-color: var(--ep-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ep-brand) 25%, transparent); }
.ep-input--error { border-color: #f87171; }
.ep-err { margin: 4px 0 0; font-size: 11px; color: #f87171; }

.ep-warning { margin-bottom: 16px; padding: 10px 14px; font-size: 13px; color: #fde68a; background: #422006; border: 1px solid #92400e; border-radius: 9px; }

/* Honeypot — off-screen, not display:none (bots skip display:none) */
.ep-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

/* ── Messages (error / out-of-area) ── */
.ep-message { max-width: 460px; margin: 0 auto; padding: 40px 28px; text-align: center; }
.ep-message-icon { font-size: 38px; margin-bottom: 14px; }
.ep-message h3 { margin: 0 0 10px; font-size: 20px; font-weight: 700; color: var(--ep-text); }
.ep-message p { margin: 0; font-size: 14px; line-height: 1.7; color: var(--ep-muted); }
.ep-message strong { color: var(--ep-text); }
.ep-message--error { color: #fca5a5; background: #3f0a0a; border: 1px solid #7f1d1d; border-radius: 10px; font-size: 14px; font-weight: 500; }

/* ── Loading skeleton ── */
.ep-shell--loading { grid-template-rows: 1fr; grid-template-areas: "logo main"; height: min(560px, 80vh); }
.ep-skeleton-rail { grid-area: logo; background: var(--ep-rail); border-right: 1px solid var(--ep-border); }
.ep-skeleton-main { grid-area: main; padding: 28px 24px; }
.ep-skeleton-block { margin-bottom: 26px; }
.ep-skeleton-line { display: block; height: 16px; width: 55%; margin: 0 auto 14px; background: var(--ep-border); border-radius: 6px; animation: ep-pulse 1.4s ease-in-out infinite; }
.ep-skeleton-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ep-skeleton-cards span { height: 90px; background: var(--ep-surface); border-radius: 10px; animation: ep-pulse 1.4s ease-in-out infinite; }
@keyframes ep-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* ── Responsive: collapse to a single column on narrow embeds ── */
@media (max-width: 480px) {
  .ep-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas: "logo" "main" "cta";
    height: auto;
  }
  .ep-rail-logo { border-right: none; border-bottom: 1px solid var(--ep-border); padding: 22px 20px; }
  .ep-rail-cta { border-right: none; border-top: 1px solid var(--ep-border); }
  .ep-main { overflow-y: visible; }
  /* On mobile the reveal button lives inside the flow (below fields); the rail CTA
     only shows the price card. */
  .ep-rail-cta .ep-reveal { display: none; }
  .ep-reveal--mobile { display: block; }
  .ep-rail-cta--locked { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .ep-root *, .ep-root *::before, .ep-root *::after { transition: none !important; animation: none !important; }
}
`;
