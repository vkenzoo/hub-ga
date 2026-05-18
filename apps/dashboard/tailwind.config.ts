import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#131313",
        surface2: "#1a1a1a",
        line: "#262626",
        line2: "#404040",
        text: "#fafafa",
        text2: "#a3a3a3",
        muted: "#737373",
        accent: "#22c55e",
        accentDim: "#16a34a",
        brand: "#ec2d7c",
        brandDim: "#c91d65",
        info: "#3b82f6",
        warn: "#fbbf24",
        danger: "#ef4444",
      },
      fontFamily: {
        sans: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
      },
      letterSpacing: {
        wide2: "0.04em",
        wider: "0.08em",
        widest: "0.16em",
      },
    },
  },
  plugins: [forms],
} satisfies Config;
