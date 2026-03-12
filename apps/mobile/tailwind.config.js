/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: 'hsl(var(--brand) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        "secondary": 'hsl(var(--secondary) / <alpha-value>)',
        "muted": 'hsl(var(--muted) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        "on-primary": 'hsl(var(--on-primary) / <alpha-value>)',
        "primary-dim": 'hsl(var(--primary-dim) / <alpha-value>)',
        "input-background": 'hsl(var(--input-background) / <alpha-value>)',
        "input-border": 'hsl(var(--input-border) / <alpha-value>)',
        "input-border-focused": 'hsl(var(--input-border-focused) / <alpha-value>)',
      },
      textColor: {
        "secondary": 'hsl(var(--text-secondary) / <alpha-value>)',
      },
      borderColor: {
        "border": 'hsl(var(--border) / <alpha-value>)',
      }
    },
  },
  plugins: [],
};
