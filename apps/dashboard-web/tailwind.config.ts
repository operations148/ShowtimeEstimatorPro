import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        dark: {
          bg: '#0a1628',
          surface: '#0f1f35',
          card: '#111d2e',
          border: '#1e3048',
          hover: '#162030',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
    },
  },
  plugins: [],
};

export default config;
