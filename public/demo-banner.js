/* NEXO — banner de modo demostración (compartido por todas las páginas públicas).
   Se activa cuando /api/config reporta demo_mode=true. Idempotente. */
(function () {
  function showDemoBanner() {
    if (document.getElementById("demo-banner")) return;
    var b = document.createElement("div");
    b.id = "demo-banner";
    b.setAttribute("role", "note");
    // Icono SVG inline (los emoji dependen de la fuente del SO y pueden verse como tofu).
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px;" aria-hidden="true"><path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8.5 2h7"/><path d="M7 15h10"/></svg>' +
      "<strong>Modo demostraci\u00f3n</strong> \u2014 el inventario mostrado es de ejemplo.";
    b.style.cssText = "position:sticky;top:0;z-index:1200;background:linear-gradient(90deg,#b45309,#c2410c);color:#fff;text-align:center;padding:8px 12px;font-size:13px;font-weight:500;font-family:system-ui,sans-serif;";
    document.body.prepend(b);
  }
  window.showDemoBanner = showDemoBanner;
  fetch("/api/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) { if (c && c.demo_mode) showDemoBanner(); })
    .catch(function () { /* sin config: sin banner */ });
})();
