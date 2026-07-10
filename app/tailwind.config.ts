import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          card: "var(--surface-1)",
          raised: "var(--surface-2)",
        },
        border: {
          DEFAULT: "var(--hairline)",
          strong: "var(--hairline-strong)",
        },
        fg: {
          DEFAULT: "var(--text-primary)",
          muted: "var(--text-secondary)",
          subtle: "var(--text-tertiary)",
        },
        accent: "var(--accent)",
        hbot: "var(--accent-hbot)",
        ir: "var(--accent-ir)",
        pemf: "var(--accent-pemf)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "sans-serif"],
        hollow: ["var(--font-heading-hollow)", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s var(--ease) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
