/* NEXO — banner de modo demostración (compartido por todas las páginas públicas).
   Se activa cuando /api/config reporta demo_mode=true. Idempotente. */
(function () {
  function showDemoBanner() {
    if (document.getElementById("demo-banner")) return;
    var b = document.createElement("div");
    b.id = "demo-banner";
    b.setAttribute("role", "note");
    b.innerHTML = "\uD83E\uDDEA <strong>Modo demostraci\u00f3n</strong> \u2014 el inventario mostrado es de ejemplo.";
    b.style.cssText = "position:sticky;top:0;z-index:1200;background:linear-gradient(90deg,#b45309,#c2410c);color:#fff;text-align:center;padding:8px 12px;font-size:13px;font-weight:500;font-family:system-ui,sans-serif;";
    document.body.prepend(b);
  }
  window.showDemoBanner = showDemoBanner;
  fetch("/api/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) { if (c && c.demo_mode) showDemoBanner(); })
    .catch(function () { /* sin config: sin banner */ });
})();
