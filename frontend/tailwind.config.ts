import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        muted: "#64748b",
        line: "#e2e8f0",
        accent: "#2563eb",
        up: "#059669",
        down: "#dc2626",
      },
    },
  },
  plugins: [],
} satisfies Config;
