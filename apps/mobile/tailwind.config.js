const { hairlineWidth } = require("nativewind/theme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        action: "hsl(var(--action) / <alpha-value>)",
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          soft: "hsl(var(--success-soft) / <alpha-value>)",
        },
        input: "hsl(var(--input))",
        brand: "hsl(var(--brand) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        "warning-border": "hsl(var(--warning-border) / <alpha-value>)",
        "warning-text": "hsl(var(--warning-text) / <alpha-value>)",
        "warning-accent": "hsl(var(--warning-accent) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground))",
          text: "hsl(var(--primary-text) / <alpha-value>)",
          soft: "hsl(var(--primary-soft) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground))",
          text: "hsl(var(--destructive-text) / <alpha-value>)",
          soft: "hsl(var(--destructive-soft) / <alpha-value>)",
        },
        muted: "hsl(var(--muted) / <alpha-value>)",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      textColor: {
        secondary: "hsl(var(--text-secondary) / <alpha-value>)",
        tertiary: "hsl(var(--text-tertiary) / <alpha-value>)",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
      },
      borderColor: {
        border: "hsl(var(--border) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [],
};
