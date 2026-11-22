const { hairlineWidth, platformSelect } = require("nativewind/theme");

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
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        action: "rgb(var(--action) / <alpha-value>)",
        container: "rgb(var(--container) / <alpha-value>)",
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          soft: "rgb(var(--success-soft) / <alpha-value>)",
        },
        input: "rgb(var(--input) / <alpha-value>)",
        brand: "rgb(var(--action) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-border": "rgb(var(--warning-border) / <alpha-value>)",
        "warning-text": "rgb(var(--warning-text) / <alpha-value>)",
        "warning-accent": "rgb(var(--warning-accent) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--action) / <alpha-value>)",
          foreground: "rgb(255 255 255 / <alpha-value>)",
          text: "rgb(var(--primary-text) / <alpha-value>)",
          soft: "rgb(var(--primary-soft) / <alpha-value>)",
          "soft-foreground": "rgb(var(--primary-soft-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive) / <alpha-value>)",
          foreground: "rgb(255 255 255 / <alpha-value>)",
          text: "rgb(var(--destructive-text) / <alpha-value>)",
          soft: "rgb(var(--destructive-soft) / <alpha-value>)",
        },
        muted: "rgb(var(--text-secondary) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--foreground) / <alpha-value>)",
        },
      },
      fontFamily: {
        mono: platformSelect({ android: "monospace", ios: "'Courier New'" }),
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
        secondary: "rgb(var(--text-secondary) / <alpha-value>)",
        tertiary: "rgb(var(--text-tertiary) / <alpha-value>)",
        "secondary-foreground": "rgb(var(--secondary-foreground) / <alpha-value>)",
      },
      borderColor: {
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [],
};
