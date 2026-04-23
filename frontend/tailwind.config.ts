import forms from "@tailwindcss/forms";
import type { Config } from "tailwindcss";

export default {
    content: ["./index.html", "./src/**/*.{vue,ts}"],
    theme: {
        extend: {
            fontFamily: {
                sans: ["Inter", "system-ui", "sans-serif"],
            },
            colors: {
                primary: "hsl(var(--color-primary-h) var(--color-primary-s) var(--color-primary-l) / <alpha-value>)",
                appbg: "hsl(var(--color-app-bg-h) var(--color-app-bg-s) var(--color-app-bg-l) / <alpha-value>)",
                surface: "hsl(var(--color-surface-h) var(--color-surface-s) var(--color-surface-l) / <alpha-value>)",
                border: "hsl(var(--color-border-h) var(--color-border-s) var(--color-border-l) / <alpha-value>)",
                text: "hsl(var(--color-text-h) var(--color-text-s) var(--color-text-l) / <alpha-value>)",
                muted: "hsl(var(--color-muted-h) var(--color-muted-s) var(--color-muted-l) / <alpha-value>)",
            },
            borderRadius: {
                app: "var(--radius-base)",
            },
            fontSize: {
                base: "var(--font-size-base)",
            },
        },
    },
    plugins: [forms],
} satisfies Config;
