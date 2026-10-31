import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101114",
        panel: "#181a20",
        line: "#2c303a",
        cream: "#ece7df",
        mute: "#9a9388",
        lime: "#d6f25c",
        danger: "#ff6b6b",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Noto Sans SC", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
