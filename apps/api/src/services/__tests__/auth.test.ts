import { describe, it, expect } from 'vitest';
import { generateOtpCode, hashCode } from '../auth.service';

describe('OTP utilities', () => {
  describe('generateOtpCode', () => {
    it('generates a code of the specified length', () => {
      const code = generateOtpCode(6);
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('pads shorter codes with leading zeros', () => {
      // Run many times to catch edge cases
      for (let i = 0; i < 100; i++) {
        const code = generateOtpCode(6);
        expect(code).toHaveLength(6);
      }
    });
  });

  describe('hashCode', () => {
    it('returns a consistent SHA-256 hash', () => {
      const hash1 = hashCode('123456');
      const hash2 = hashCode('123456');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    it('returns different hashes for different codes', () => {
      const hash1 = hashCode('123456');
      const hash2 = hashCode('654321');
      expect(hash1).not.toBe(hash2);
    });
  });
});
