// Runs before the CSS so the page never flashes the wrong theme. Kept outside the HTML so the
// Content-Security-Policy needs no 'unsafe-inline' for scripts.
(function () {
  var theme;
  try { theme = localStorage.getItem("theme"); } catch (e) {}
  if (theme !== "light" && theme !== "dark") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0e0e14" : "#fbfbfd");
})();
