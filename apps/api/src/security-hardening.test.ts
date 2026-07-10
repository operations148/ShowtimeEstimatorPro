import { describe, it, expect } from 'vitest';
import { escapeCsv } from './services/export.service';
import { matchesImageMagic } from './routes/media';
import { leftmostIp } from './middleware/rate-limiter';

// ── M5: CSV / spreadsheet formula-injection escaping ─────────────────────────
describe('M5 — escapeCsv neutralizes formula injection', () => {
  it("prefixes a leading = + - @ with a single quote so Excel/Sheets treats it as text", () => {
    // Without the fix these would begin with = / + / - / @ and execute as formulas.
    expect(escapeCsv('=1+2')).toBe("'=1+2");
    expect(escapeCsv('+cmd')).toBe("'+cmd");
    expect(escapeCsv('-2+3')).toBe("'-2+3");
    expect(escapeCsv('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes a formula that also contains a comma/quote (both protections apply)', () => {
    // Leading '=' → prefix "'", plus comma/quote → RFC-4180 quoting with doubled quotes.
    expect(escapeCsv('=HYPERLINK("http://x"),y')).toBe('"\'=HYPERLINK(""http://x""),y"');
  });

  it('leaves ordinary values untouched', () => {
    expect(escapeCsv('Jane Smith')).toBe('Jane Smith');
    expect(escapeCsv('123')).toBe('123');
  });
});

// ── L1: upload magic-byte validation (don't trust client Content-Type) ───────
describe('L1 — matchesImageMagic validates real file bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);

  it('accepts real PNG/JPEG/WebP bytes for the matching MIME', () => {
    expect(matchesImageMagic(png, 'image/png')).toBe(true);
    expect(matchesImageMagic(jpeg, 'image/jpeg')).toBe(true);
    expect(matchesImageMagic(webp, 'image/webp')).toBe(true);
  });

  it('rejects a script/HTML payload masquerading as an image (the smuggling case)', () => {
    const html = Buffer.from('<script>alert(1)</script>\n\n\n');
    expect(matchesImageMagic(html, 'image/png')).toBe(false);
    expect(matchesImageMagic(html, 'image/jpeg')).toBe(false);
  });

  it('rejects a PNG body declared as JPEG, and too-short buffers', () => {
    expect(matchesImageMagic(png, 'image/jpeg')).toBe(false);
    expect(matchesImageMagic(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false);
  });
});

// ── H2: rate-limiter keys on the left-most (real client) XFF entry ───────────
describe('H2 — leftmostIp uses the real client, not the whole XFF chain', () => {
  it('returns the first entry (the client) and ignores downstream proxies', () => {
    // Vercel sets XFF as "client, proxy, …". Using the whole string was the bug:
    // an attacker could prepend a value per request for a fresh bucket.
    expect(leftmostIp('1.2.3.4, 10.0.0.1, 10.0.0.2')).toBe('1.2.3.4');
    expect(leftmostIp('  5.6.7.8  , proxy')).toBe('5.6.7.8');
  });

  it('falls back to a stable key when the header is missing', () => {
    expect(leftmostIp(undefined)).toBe('unknown');
    expect(leftmostIp('')).toBe('unknown');
  });
});
