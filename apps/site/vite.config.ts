import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Where the site is published. Used for canonical, hreflang, sitemap and OG URLs. */
export const SITE_URL = "https://solana-e2e.saturnomangieri.com";

const here = (path: string) => resolve(import.meta.dirname, path);
const walletVersion = JSON.parse(readFileSync(here("../../packages/wallet/package.json"), "utf8")).version as string;

type Dict = Record<string, string>;
const load = (lang: string): Dict => JSON.parse(readFileSync(here(`src/i18n/${lang}.json`), "utf8"));

/**
 * index.html, es/index.html and 404.html are stubs (`<!-- page:en -->`). This plugin replaces them with
 * src/page.html (or src/404.html) rendered in that language: `{{key}}` comes from src/i18n/<lang>.json,
 * plus a few build-time values. No translation code runs in the browser.
 */
function renderPages(): Plugin {
  return {
    name: "solana-e2e:render-pages",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const match = /<!-- page:(en|es|404) -->/.exec(html);
        if (!match) return html;
        const page = match[1]!;
        const lang = page === "es" ? "es" : "en";
        const template = readFileSync(here(page === "404" ? "src/404.html" : "src/page.html"), "utf8");
        const dict = load(lang);
        const other = lang === "en" ? "es" : "en";
        const values: Dict = {
          ...dict,
          lang,
          otherLang: other,
          version: walletVersion,
          siteUrl: SITE_URL,
          pageUrl: lang === "en" ? `${SITE_URL}/` : `${SITE_URL}/es/`,
          otherUrl: other === "en" ? "/" : "/es/",
          ogImage: `${SITE_URL}/og-${lang}.png`,
          ogLocale: lang === "en" ? "en_US" : "es_ES",
          logo: readFileSync(here("public/brand/logo-horizontal.svg"), "utf8").replace(/id="t"/, 'id="logo-title"').replace(/aria-labelledby="t"/, 'aria-labelledby="logo-title"'),
        };
        const rendered = template.replace(/\{\{(\w+)\}\}/g, (_all, key: string) => {
          if (!(key in values)) throw new Error(`[render-pages] missing key "${key}" for ${page}`);
          return values[key]!;
        });
        const leftover = /\{\{\w+\}\}/.exec(rendered);
        if (leftover) throw new Error(`[render-pages] unresolved ${leftover[0]} in ${page}`);
        return rendered;
      },
    },
    // Re-render when the template or the dictionaries change in dev.
    handleHotUpdate({ file, server }) {
      if (/src[\\/](page|404)\.html$|src[\\/]i18n[\\/].+\.json$/.test(file)) server.ws.send({ type: "full-reload" });
    },
  };
}

export default defineConfig({
  plugins: [renderPages()],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: { input: { main: here("index.html"), es: here("es/index.html"), notFound: here("404.html") } },
  },
});
