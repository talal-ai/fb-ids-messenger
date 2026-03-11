/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        heading: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.025em',
        tighter: '-0.04em',
      },
      boxShadow: {
        'glass': '0 0 0 1px rgba(255,255,255,0.04), 0 4px 24px -4px rgba(0,0,0,0.24)',
        'glass-hover': '0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px -8px rgba(0,0,0,0.32)',
        'accent': '0 4px 14px -2px rgba(59, 130, 246, 0.35)',
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out forwards',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
