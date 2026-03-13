/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "hsl(var(--brand) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        secondary: "hsl(var(--secondary) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        "on-primary": "hsl(var(--on-primary) / <alpha-value>)",
        "input-border": "hsl(var(--input-border) / <alpha-value>)",
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
      },
      borderColor: {
        border: "hsl(var(--border) / <alpha-value>)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require("tailwindcss-animate")],
};
