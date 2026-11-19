import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: {
          50: "#EEF5EC",
          100: "#DDEEDF",
          500: "#36A064",
          600: "#258450",
          700: "#1B6B3F",
          800: "#14502F",
          900: "#0E3B24",
        },
        sun: "#F2B705",
        alert: "#C23B2E",
        paper: "#F2F6EE",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
