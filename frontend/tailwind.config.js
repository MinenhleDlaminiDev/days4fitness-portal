/** @type {import('tailwindcss').Config} */

// Semantic colours resolve to the CSS custom properties in src/styles.css, so
// one set of class names covers both themes. Values are "R G B" triples, which
// keeps Tailwind's slash-opacity modifiers (bg-surface/80) working.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // NB: do not add a colour named `base` — it collides with Tailwind's
        // core `text-base` font-size utility. The page background reads
        // --c-base directly in styles.css instead.
        surface: token("c-surface"),
        raised: token("c-raised"),
        sunken: token("c-sunken"),

        strong: token("c-text-strong"),
        body: token("c-text-body"),
        copy: token("c-text"),
        muted: token("c-text-muted"),
        subtle: token("c-text-subtle"),
        faint: token("c-text-faint"),

        line: token("c-border"),
        "line-strong": token("c-border-strong"),

        accent: token("c-accent"),

        brand: {
          DEFAULT: token("c-brand"),
          strong: token("c-brand-strong"),
          soft: token("c-brand-soft"),
          tint: token("c-brand-tint")
        },

        success: {
          soft: token("c-success-soft"),
          border: token("c-success-border"),
          text: token("c-success-text")
        },
        danger: {
          soft: token("c-danger-soft"),
          border: token("c-danger-border"),
          text: token("c-danger-text"),
          strong: token("c-danger-strong"),
          tint: token("c-danger-tint"),
          solid: token("c-danger-solid")
        },
        info: {
          soft: token("c-info-soft"),
          border: token("c-info-border"),
          text: token("c-info-text")
        },
        warn: {
          soft: token("c-warn-soft"),
          border: token("c-warn-border"),
          text: token("c-warn-text"),
          tint: token("c-warn-tint"),
          solid: token("c-warn-solid")
        }
      }
    }
  },
  plugins: []
};
