import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Brand green — deep/desaturated on purpose (flat, functional B2B
        // tool, not a consumer app). Kept separate from the semantic
        // status colors below so "brand" and "success" don't collide.
        brand: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          200: "#BBF7D0",
          300: "#86EFAC",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          800: "#166534",
          900: "#14532D",
          950: "#0B2818",
        },
      },
    },
  },
  plugins: [],
};

export default config;
