/* =========================================================
   NEXO 2.0 — APP.JS
   Inventario · Búsqueda · Filtros · Favoritos
   Detalle · Mapa · NEXO IA · UI
========================================================= */

(() => {
  "use strict";

  const state = {
    properties: [],
    filtered: [],
    filter: "all",
    favorites: new Set(loadFavorites()),
    loading: false,
    aiConversation: []
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindSearch();
    bindFilters();
    bindQuickSearch();
    await loadProperties();
    openPropertyFromURL();
  }

  function loadFavorites() {
    try {
      const saved = localStorage.getItem("nexo_favorites");
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(
        "nexo_favorites",
        JSON.stringify([...state.favorites])
      );
    } catch (error) {
      console.warn("NEXO favorites:", error);
    }
  }

  function toggleFavorite(id, button) {
    const key = String(id);

    if (state.favorites.has(key)) {
      state.favorites.delete(key);

      if (button) {
        button.textContent = "♡";
        button.setAttribute("aria-label", "Guardar en favoritos");
        button.setAttribute("aria-pressed", "false");
      }

      showToast("Eliminado de favoritos");
    } else {
      state.favorites.add(key);

      if (button) {
        button.textContent = "♥";
        button.setAttribute("aria-label", "Quitar de favoritos");
        button.setAttribute("aria-pressed", "true");
      }

      showToast("Guardado en favoritos");
    }

    saveFavorites();
  }

  async function api(url, options = {}) {
    const config = {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {})
      }
    };

    const response = await fetch(url, config);

    let data = null;

    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Error HTTP ${response.status}`
      );
    }

    return data;
  }

  async function loadProperties() {
    setLoading(true);

    try {
      const data = await api(
        "/api/properties?status=available&limit=200"
      );

      state.properties =
        Array.isArray(data?.properties)
          ? data.properties
          : Array.isArray(data)
            ? data
            : [];

      applyCurrentView();
    } catch (error) {
      console.error("NEXO inventory:", error);

      state.properties = [];

      showInventoryMessage(
        "No pudimos cargar las propiedades.",
        "Comprueba tu conexión e inténtalo nuevamente."
      );

      updateCount(0);
    } finally {
      setLoading(false);
    }
  }

  function applyCurrentView() {
    let list = [...state.properties];

    if (state.filter !== "all") {
      list = list.filter(property => {
        const type = normalize(
          property.property_type ||
          property.type ||
          ""
        );

        return type.includes(normalize(state.filter));
      });
    }

    state.filtered = list;
    renderProperties(list);
    updateCount(list.length);
  }

  function bindSearch() {
    const form = $("#searchForm");
    const input = $("#searchInput");

    if (!form || !input) return;

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const query = input.value.trim();

      if (!query) {
        await loadProperties();
        scrollToInventory();
        return;
      }

      await search(query);
    });

    input.addEventListener("keydown", event => {
      if (event.key === "Escape" && input.value) {
        input.value = "";
        applyCurrentView();
      }
    });
  }

  async function search(query) {
    if (!query) return;

    setLoading(true);

    try {
      const data = await api("/api/search", {
        method: "POST",
        body: JSON.stringify({ query })
      });

      const results =
        Array.isArray(data?.properties)
          ? data.properties
          : Array.isArray(data)
            ? data
            : [];

      state.filtered = results;

      renderProperties(results);

      updateCount(
        results.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();
    } catch (error) {
      console.error("NEXO search:", error);

      const results = localSearch(query);

      state.filtered = results;

      renderProperties(results);

      updateCount(
        results.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();
    } finally {
      setLoading(false);
    }
  }

  function localSearch(query) {
    const q = normalize(query);

    if (!q) return [...state.properties];

    const bedroomMatch = q.match(
      /(\d+)\s*(habitaciones?|hab|dormitorios?)/i
    );

    const bedrooms = bedroomMatch
      ? Number(bedroomMatch[1])
      : null;

    const bathroomMatch = q.match(
      /(\d+)\s*(baños?|banos?)/i
    );

    const bathrooms = bathroomMatch
      ? Number(bathroomMatch[1])
      : null;

    const priceMatch = q.match(
      /(?:menos de|max(?:imo)?|hasta|por debajo de)\s*\$?\s*([\d.,]+)\s*(k|mil)?/i
    );

    let maxPrice = null;

    if (priceMatch) {
      let value = Number(
        priceMatch[1]
          .replace(/\./g, "")
          .replace(/,/g, "")
      );

      if (priceMatch[2]?.toLowerCase() === "k") {
        value *= 1000;
      }

      if (Number.isFinite(value)) {
        maxPrice = value;
      }
    }

    const textQuery = normalize(
      q
        .replace(
          /(\d+)\s*(habitaciones?|hab|dormitorios?)/gi,
          ""
        )
        .replace(
          /(\d+)\s*(baños?|banos?)/gi,
          ""
        )
        .replace(
          /(?:menos de|max(?:imo)?|hasta|por debajo de)\s*\$?\s*([\d.,]+)\s*(k|mil)?/gi,
          ""
        )
    ).trim();

    return state.properties.filter(property => {
      const searchable = normalize(
        [
          property.title,
          property.name,
          property.property_type,
          property.type,
          property.city,
          property.province,
          property.municipality,
          property.neighborhood,
          property.address,
          property.description
        ].join(" ")
      );

      const textMatch =
        !textQuery ||
        textQuery
          .split(/\s+/)
          .filter(Boolean)
          .every(term => searchable.includes(term));

      const bedroomMatch =
        bedrooms === null ||
        Number(property.bedrooms) === bedrooms;

      const bathroomMatch =
        bathrooms === null ||
        Number(property.bathrooms) === bathrooms;

      const numericPrice = Number(property.price);

      const priceMatchResult =
        maxPrice === null ||
        (
          Number.isFinite(numericPrice) &&
          numericPrice <= maxPrice
        );

      return (
        textMatch &&
        bedroomMatch &&
        bathroomMatch &&
        priceMatchResult
      );
    });
  }

  function bindQuickSearch() {
    $$("[data-search]").forEach(button => {
      button.addEventListener("click", async () => {
        const query = button.dataset.search || "";

        const input = $("#searchInput");

        if (input) {
          input.value = query;
        }

        await search(query);
      });
    });
  }

  function bindFilters() {
    $$(".filter").forEach(button => {
      button.addEventListener("click", () => {
        $$(".filter").forEach(item =>
          item.classList.remove("active")
        );

        button.classList.add("active");

        state.filter =
          button.dataset.filter || "all";

        applyCurrentView();
      });
    });
  }

  function renderProperties(properties) {
    const grid = $("#propertyGrid");

    if (!grid) return;

    if (!properties.length) {
      grid.innerHTML = `
        <div class="empty">
          <strong>No encontramos propiedades.</strong>
          <br>
          Prueba otra búsqueda o cambia los filtros.
        </div>
      `;

      return;
    }

    grid.innerHTML = properties
      .map(createPropertyCard)
      .join("");

    attachPropertyEvents();
  }

  function createPropertyCard(property) {
    const id =
      property.id ??
      property.property_id ??
      "";

    const photos = parsePhotos(property.photos);

    const image =
      photos[0] ||
      property.image ||
      property.photo ||
      "";

    const title =
      property.title ||
      property.name ||
      property.property_type ||
      "Propiedad";

    const type =
      property.property_type ||
      property.type ||
      "Propiedad";

    const location = [
      property.neighborhood,
      property.city,
      property.province
    ]
      .filter(Boolean)
      .join(" · ");

    const bedrooms =
      property.bedrooms ?? "—";

    const bathrooms =
      property.bathrooms ?? "—";

    const area =
      property.square_meters ??
      property.area ??
      "—";

    const favorite =
      state.favorites.has(String(id));

    return `
      <article
        class="property"
        data-property-id="${escapeAttr(id)}"
      >
        <div class="property-image">
          ${
            image
              ? `
                <img
                  src="${safeUrl(image)}"
                  alt="${escapeAttr(title)}"
                  loading="lazy"
                  decoding="async"
                  onerror="this.style.display='none'"
                >
              `
              : `
                <div
                  style="
                    width:100%;
                    height:100%;
                    display:grid;
                    place-items:center;
                    color:#777;
                    font-size:12px;
                  "
                >
                  NEXO
                </div>
              `
          }

          <span class="property-badge">
            ${escapeHtml(type)}
          </span>

          <button
            type="button"
            class="nexo-favorite"
            data-favorite="${escapeAttr(id)}"
            aria-label="${
              favorite
                ? "Quitar de favoritos"
                : "Guardar en favoritos"
            }"
            aria-pressed="${
              favorite ? "true" : "false"
            }"
          >
            ${favorite ? "♥" : "♡"}
          </button>
        </div>

        <div class="property-body">
          <div class="property-price">
            ${formatPrice(property.price)}
          </div>

          <div class="property-title">
            ${escapeHtml(title)}
          </div>

          <div class="property-location">
            ${escapeHtml(location || "Cuba")}
          </div>

          <div class="property-meta">
            <span>${escapeHtml(String(bedrooms))} hab.</span>
            <span>${escapeHtml(String(bathrooms))} baños</span>
            <span>${escapeHtml(String(area))} m²</span>
          </div>
        </div>
      </article>
    `;
  }

  function attachPropertyEvents() {
    $$(".property").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-favorite]")) return;

        const id =
          card.dataset.propertyId;

        if (!id) return;

        window.location.href =
          `?property=${encodeURIComponent(id)}`;
      });
    });

    $$("[data-favorite]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();

        toggleFavorite(
          button.dataset.favorite,
          button
        );
      });
    });
  }

  function openPropertyFromURL() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const id =
      params.get("property");

    if (!id) return;

    const property =
      state.properties.find(
        item =>
          String(item.id) === String(id)
      );

    if (property) {
      openProperty(property);
    } else {
      loadSingleProperty(id);
    }
  }

  async function loadSingleProperty(id) {
    try {
      const data =
        await api(
          `/api/properties/${encodeURIComponent(id)}`
        );

      const property =
        data?.property ||
        data;

      if (property) {
        openProperty(property);
      }
    } catch (error) {
      console.error(
        "NEXO property:",
        error
      );

      showToast(
        "No pudimos cargar esta propiedad."
      );
    }
  }

  function openProperty(property) {
    const modal =
      $("#propertyModal");

    if (!modal) return;

    const photos =
      parsePhotos(property.photos);

    const image =
      photos[0] ||
      property.image ||
      property.photo ||
      "";

    const title =
      property.title ||
      property.name ||
      property.property_type ||
      "Propiedad";

    const location = [
      property.neighborhood,
      property.city,
      property.province
    ]
      .filter(Boolean)
      .join(" · ");

    modal.innerHTML = `
      <div class="property-modal-backdrop">
        <div class="property-modal-content">
          <button
            type="button"
            class="property-modal-close"
            aria-label="Cerrar"
          >
            ×
          </button>

          ${
            image
              ? `
                <img
                  class="property-modal-image"
                  src="${safeUrl(image)}"
                  alt="${escapeAttr(title)}"
                >
              `
              : ""
          }

          <div class="property-modal-body">
            <div class="property-price">
              ${formatPrice(property.price)}
            </div>

            <h2>
              ${escapeHtml(title)}
            </h2>

            <p>
              ${escapeHtml(location || "Cuba")}
            </p>

            <div class="property-meta">
              <span>${escapeHtml(String(property.bedrooms ?? "—"))} hab.</span>
              <span>${escapeHtml(String(property.bathrooms ?? "—"))} baños</span>
              <span>${escapeHtml(String(
                property.square_meters ??
                property.area ??
                "—"
              ))} m²</span>
            </div>

            ${
              property.description
                ? `
                  <p class="property-description">
                    ${escapeHtml(property.description)}
                  </p>
                `
                : ""
            }

            <div class="property-actions">
              ${
                property.owner_phone ||
                property.phone ||
                property.contact_phone
                  ? `
                    <a
                      class="button"
                      href="tel:${escapeAttr(
                        property.owner_phone ||
                        property.phone ||
                        property.contact_phone
                      )}"
                    >
                      Contactar
                    </a>
                  `
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;

    modal.hidden = false;

    const close =
      modal.querySelector(
        ".property-modal-close"
      );

    close?.addEventListener(
      "click",
      () => {
        modal.hidden = true;
      }
    );
  }

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s$.,-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parsePhotos(value) {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }

    if (typeof value === "string") {
      try {
        const parsed =
          JSON.parse(value);

        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean);
        }
      } catch (_) {}

      return value
        .split(/\s*(?:,|\n)\s*/)
        .map(item => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  function safeUrl(value) {
    const url =
      String(value || "").trim();

    if (
      /^https?:\/\//i.test(url) ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../")
    ) {
      return escapeAttr(url);
    }

    return "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function formatPrice(value) {
    const number =
      Number(value);

    if (!Number.isFinite(number)) {
      return "Consultar";
    }

    return new Intl.NumberFormat(
      "en-US",
      {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
      }
    ).format(number);
  }

  function setLoading(value) {
    state.loading = value;

    document.body.classList.toggle(
      "nexo-loading",
      value
    );
  }

  function updateCount(
    count,
    label
  ) {
    const elements = [
      $("#propertyCount"),
      $("#resultsCount"),
      $("[data-results-count]")
    ].filter(Boolean);

    elements.forEach(element => {
      element.textContent =
        label || `${count} propiedades`;
    });
  }

  function showInventoryMessage(
    title,
    message
  ) {
    const grid =
      $("#propertyGrid");

    if (!grid) return;

    grid.innerHTML = `
      <div class="empty">
        <strong>${escapeHtml(title)}</strong>
        <br>
        ${escapeHtml(message)}
      </div>
    `;
  }

  function scrollToInventory() {
    const target =
      $("#propertyGrid") ||
      $("#inventory");

    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function showToast(message) {
    let toast =
      $("#nexoToast");

    if (!toast) {
      toast =
        document.createElement("div");

      toast.id =
        "nexoToast";

      toast.style.cssText = `
        position:fixed;
        left:50%;
        bottom:24px;
        transform:translateX(-50%);
        z-index:9999;
        padding:12px 18px;
        border-radius:999px;
        background:#111;
        color:#fff;
        font:500 14px/1.2 system-ui,sans-serif;
        box-shadow:0 10px 30px rgba(0,0,0,.18);
        opacity:0;
        transition:opacity .2s ease;
        pointer-events:none;
      `;

      document.body.appendChild(toast);
    }

    toast.textContent =
      message;

    toast.style.opacity = "1";

    clearTimeout(
      toast._timer
    );

    toast._timer =
      setTimeout(() => {
        toast.style.opacity = "0";
      }, 2200);
  }

})();