import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palet dari video referensi (bagian 2): Ink Black, Olive Green, Amber Gold.
        ink: {
          DEFAULT: "#0E0E10",
          800: "#131408",
          900: "#0E0E10",
          950: "#08080A",
        },
        olive: {
          50: "#F4F7E3",
          100: "#E6ECC6",
          200: "#CDD79A",
          300: "#B0BE66",
          400: "#8B9A3B",
          500: "#6B7722",
          600: "#4F5915",
          700: "#3B430D",
          800: "#292F08",
          900: "#1B1F05",
          950: "#111405",
        },
        gold: {
          DEFAULT: "#CD8117",
          light: "#E8A33B",
          dark: "#A5660F",
        },
        cream: "#F3EFDF",
        alert: "#E5484D",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 60px -12px rgba(205, 129, 23, 0.45)",
        panel: "inset 0 1px 0 0 rgba(255, 255, 255, 0.06)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to right, rgba(243, 239, 223, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(243, 239, 223, 0.06) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
    },
  },
  plugins: [],
};

export default config;
