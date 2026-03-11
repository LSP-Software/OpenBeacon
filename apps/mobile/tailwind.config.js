/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        text: 'hsl(var(--text) / <alpha-value>)',
        "text-secondary": 'hsl(var(--text-secondary) / <alpha-value>)',
        "text-muted": 'hsl(var(--text-muted) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        "on-primary": 'hsl(var(--on-primary) / <alpha-value>)',
        "primary-dim": 'hsl(var(--primary-dim) / <alpha-value>)',
        "input-background": 'hsl(var(--input-background) / <alpha-value>)',
        "input-border": 'hsl(var(--input-border) / <alpha-value>)',
        "input-border-focused": 'hsl(var(--input-border-focused) / <alpha-value>)',
      }
    },
  },
  plugins: [],
};
