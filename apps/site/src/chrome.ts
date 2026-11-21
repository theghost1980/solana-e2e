/** Page chrome: theme, mobile menu, language choice, copy button and the interactive diagram. */
import desktopDiagram from "./assets/how-it-works.svg?raw";
import mobileDiagram from "./assets/how-it-works-mobile.svg?raw";

const lang = document.documentElement.lang === "es" ? "es" : "en";
const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode: the choice just isn't remembered
    }
  },
};

// ------------------------------------------------------------------ theme
function setupTheme() {
  const button = document.querySelector<HTMLButtonElement>(".theme-toggle");
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (theme: "light" | "dark") => {
    document.documentElement.dataset.theme = theme;
    meta?.setAttribute("content", theme === "dark" ? "#0e0e14" : "#fbfbfd");
    button?.setAttribute("aria-pressed", String(theme === "dark"));
  };
  apply(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  button?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", next);
    apply(next);
  });
}

// ------------------------------------------------------------------ mobile menu
function setupMenu() {
  const dialog = document.querySelector<HTMLDialogElement>(".menu-dialog");
  if (!dialog) return;
  document.querySelector(".menu-open")?.addEventListener("click", () => dialog.showModal());
  dialog.querySelector(".menu-close")?.addEventListener("click", () => dialog.close());
  dialog.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => dialog.close()));
}

// ------------------------------------------------------------------ language
function setupLanguage() {
  document.querySelectorAll<HTMLElement>("[data-lang-choice]").forEach((element) =>
    element.addEventListener("click", () => {
      store.set("lang", element.dataset.langChoice!);
      if (element instanceof HTMLButtonElement) document.getElementById("lang-bar")?.setAttribute("hidden", "");
    }),
  );
  // Keep the section when switching language.
  document.querySelectorAll<HTMLAnchorElement>("a.lang-switch, a.lang-bar-go").forEach((link) =>
    link.addEventListener("click", () => {
      if (location.hash) link.hash = location.hash;
    }),
  );
  // Suggest, never redirect: only on a first visit whose browser language is the other one.
  const preferred = (navigator.language || "").slice(0, 2).toLowerCase();
  const other = lang === "en" ? "es" : "en";
  if (!store.get("lang") && preferred === other) document.getElementById("lang-bar")?.removeAttribute("hidden");
}

// ------------------------------------------------------------------ copy install command
function setupCopy() {
  const button = document.querySelector<HTMLButtonElement>(".copy-install");
  const status = document.querySelector("[data-copy-status]");
  button?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy!);
      button.classList.add("copied");
      if (status) status.textContent = lang === "es" ? "Copiado" : "Copied";
    } catch {
      if (status) status.textContent = lang === "es" ? "No se pudo copiar" : "Could not copy";
    }
    setTimeout(() => {
      button.classList.remove("copied");
      if (status) status.textContent = "";
    }, 1500);
  });
}

// ------------------------------------------------------------------ diagram
const THEME_BRIDGE = `
  svg {
    --e2e-fg: var(--ink); --e2e-muted: var(--ink-3); --e2e-accent: var(--brand-green);
    --e2e-accent-2: var(--accent); --e2e-border: var(--line); --e2e-box: var(--surface-2);
    display: block; width: 100%; height: auto;
  }
  :host(.manual) .box, :host(.manual) #arrow-mock { animation: none !important; }
  :host(.manual) .dot { display: none; }
`;

function setupDiagram() {
  const hosts = [...document.querySelectorAll<HTMLElement>("[data-diagram]")];
  for (const host of hosts) {
    const root = host.attachShadow({ mode: "open" });
    // The SVGs are ours (src/assets), so injecting them is safe; the shadow root keeps their CSS,
    // ids and animations from clashing with the page or with each other.
    root.innerHTML = (host.dataset.diagram === "mobile" ? mobileDiagram : desktopDiagram).replace(
      /(role="img")\s+aria-labelledby="[^"]*"/,
      'aria-hidden="true"',
    );
    const style = document.createElement("style");
    style.textContent = THEME_BRIDGE;
    root.append(style);
  }

  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-step]")];
  const detail = document.querySelector<HTMLElement>("[data-step-detail]");
  const hint = detail?.innerHTML ?? "";
  let pinned: string | null = null;

  const show = (step: string | null) => {
    for (const host of hosts) {
      host.classList.toggle("manual", step !== null);
      host.shadowRoot?.querySelectorAll(".step").forEach((group) => group.classList.toggle("active", group.id === `step-${step}`));
    }
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.step === step)));
    if (detail) {
      const template = step ? document.querySelector<HTMLTemplateElement>(`template[data-step-text="${step}"]`) : null;
      detail.innerHTML = template ? template.innerHTML : hint;
    }
  };

  for (const tab of tabs) {
    tab.setAttribute("aria-pressed", "false");
    tab.addEventListener("mouseenter", () => show(tab.dataset.step!));
    tab.addEventListener("focus", () => show(tab.dataset.step!));
    tab.addEventListener("mouseleave", () => show(pinned));
    tab.addEventListener("blur", () => show(pinned));
    tab.addEventListener("click", () => {
      pinned = pinned === tab.dataset.step ? null : tab.dataset.step!;
      show(pinned);
    });
  }
}

export function setupChrome(): void {
  setupTheme();
  setupMenu();
  setupLanguage();
  setupCopy();
  setupDiagram();
}
