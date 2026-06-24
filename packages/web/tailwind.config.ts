import type { Config } from 'tailwindcss';

const config: Config = {
  // Class-based dark mode; the <html> element carries the `dark` class.
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand accent for the like / validation affordances.
        nyx: {
          accent: '#fe2c55',
          accent2: '#25f4ee',
        },
      },
      keyframes: {
        'pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
        'slide-out': {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(120%)', opacity: '0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'toast-in': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        pop: 'pop 0.4s ease-out',
        'slide-out': 'slide-out 0.35s ease-in forwards',
        'spin-slow': 'spin-slow 1.1s linear infinite',
        'toast-in': 'toast-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
