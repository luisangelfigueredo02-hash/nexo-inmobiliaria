/* =========================================================
   NEXO 2.0 — APP.JS
   Búsqueda · Inventario · Favoritos · IA · UI
========================================================= */

(() => {
  "use strict";

  const state = {
    properties: [],
    filtered: [],
    filter: "all",
    favorites: new Set(
      JSON.parse(localStorage.getItem("nexo_favorites") || "[]")
    ),
    aiConversation: [],
    loading: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindSearch();
    bindFilters();
    bindQuickSearch();
    await loadProperties();
  }

  /* =========================================================
     API
  ========================================================= */

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

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
        "No se pudo completar la solicitud."
      );
    }

    return data;
  }

  /* =========================================================
     INVENTARIO
  ========================================================= */

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

      showInventoryMessage(
        "No pudimos cargar las propiedades.",
        "Inténtalo nuevamente."
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

        return type.includes(
          normalize(state.filter)
        );

      });

    }

    state.filtered = list;

    renderProperties(list);

    updateCount(list.length);
  }

  /* =========================================================
     SEARCH
  ========================================================= */

  function bindSearch() {

    const form = $("#searchForm");
    const input = $("#searchInput");

    if (!form || !input) return;

    form.addEventListener("submit", async event => {

      event.preventDefault();

      const query = input.value.trim();

      if (!query) {
        await loadProperties();
        return;
      }

      await search(query);

    });

    input.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Escape" &&
          input.value
        ) {
          input.value = "";
          applyCurrentView();
        }

      }
    );
  }

  async function search(query) {

    setLoading(true);

    try {

      /*
       * Primero intentamos utilizar el buscador
       * inteligente del Worker.
       */

      const data = await api(
        "/api/search",
        {
          method: "POST",
          body: JSON.stringify({
            query
          })
        }
      );

      const results =
        Array.isArray(data?.properties)
          ? data.properties
          : [];

      state.filtered = results;

      renderProperties(results);

      updateCount(
        results.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();

    } catch (error) {

      /*
       * Fallback local.
       * Si el endpoint de búsqueda todavía no está
       * disponible, NEXO sigue funcionando.
       */

      console.warn(
        "NEXO search fallback:",
        error
      );

      const local = localSearch(query);

      state.filtered = local;

      renderProperties(local);

      updateCount(
        local.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();

    } finally {

      setLoading(false);
    }
  }

  function localSearch(query) {

    const q = normalize(query);

    const numbers =
      query.match(/\d+/g) || [];

    const bedrooms =
      numbers.length
        ? Number(numbers[0])
        : null;

    return state.properties.filter(property => {

      const searchable = normalize([
        property.title,
        property.property_type,
        property.city,
        property.province,
        property.neighborhood,
        property.address,
        property.description
      ].join(" "));

      const textMatch =
        searchable.includes(q);

      const bedroomMatch =
        bedrooms === null ||
        Number(property.bedrooms) === bedrooms;

      return textMatch || bedroomMatch;

    });
  }

  /* =========================================================
     QUICK SEARCH
  ========================================================= */

  function bindQuickSearch() {

    $$("[data-search]").forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const query =
            button.dataset.search || "";

          const input = $("#searchInput");

          if (input) {
            input.value = query;
          }

          search(query);

        }
      );

    });
  }

  /* =========================================================
     FILTERS
  ========================================================= */

  function bindFilters() {

    $$(".filter").forEach(button => {

      button.addEventListener(
        "click",
        () => {

          $$(".filter").forEach(
            item =>
              item.classList.remove("active")
          );

          button.classList.add("active");

          state.filter =
            button.dataset.filter || "all";

          applyCurrentView();

        }
      );

    });

  }

  /* =========================================================
     RENDER PROPERTIES
  ========================================================= */

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

    grid.innerHTML =
      properties
        .map(createPropertyCard)
        .join("");

    attachPropertyEvents();
  }

  function createPropertyCard(property) {

    const id =
      property.id ??
      property.property_id ??
      "";

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

    const type =
      property.property_type ||
      property.type ||
      "Propiedad";

    const location =
      [
        property.neighborhood,
        property.city,
        property.province
      ]
        .filter(Boolean)
        .join(" · ");

    const bedrooms =
      property.bedrooms ??
      "—";

    const bathrooms =
      property.bathrooms ??
      "—";

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
            style="
              position:absolute;
              z-index:5;
              right:12px;
              top:12px;
              width:38px;
              height:38px;
              border:0;
              border-radius:50%;
              background:rgba(255,255,255,.86);
              backdrop-filter:blur(12px);
              color:#111;
              font-size:18px;
              line-height:1;
            "
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
            ${escapeHtml(
              location || "Cuba"
            )}
          </div>

          <div class="property-meta">

            <span>
              ${escapeHtml(bedrooms)}
              hab.
            </span>

            <span>
              ${escapeHtml(bathrooms)}
              baños
            </span>

            <span>
              ${escapeHtml(area)}
              m²
            </span>

          </div>

        </div>

      </article>
    `;
  }

  function attachPropertyEvents() {

    $$(".property").forEach(card => {

      card.addEventListener(
        "click",
        event => {

          if (
            event.target.closest(
              ".nexo-favorite"
            )
          ) {
            return;
          }

          const id =
            card.dataset.propertyId;

          openProperty(id);

        }
      );

    });

    $$(".nexo-favorite").forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          toggleFavorite(
            button.dataset.favorite,
            button
          );

        }
      );

    });

  }

  /* =========================================================
     PROPERTY DETAIL
  ========================================================= */

  async function openProperty(id) {

    if (!id) return;

    try {

      const data =
        await api(
          `/api/properties/${encodeURIComponent(id)}`
        );

      const property =
        data?.property ||
        data;

      if (!property) {
        throw new Error(
          "No encontramos esta propiedad."
        );
      }

      showPropertyModal(property);

    } catch (error) {

      /*
       * Si el endpoint individual no existe todavía,
       * utilizamos el objeto que ya tenemos en memoria.
       */

      const property =
        state.properties.find(
          item =>
            String(item.id) === String(id)
        );

      if (property) {
        showPropertyModal(property);
      } else {
        showToast(error.message);
      }

    }

  }

  function showPropertyModal(property) {

    closeExistingModal();

    const photos =
      parsePhotos(property.photos);

    const image =
      photos[0] ||
      property.image ||
      property.photo ||
      "";

    const title =
      property.title ||
      property.property_type ||
      "Propiedad";

    const location =
      [
        property.neighborhood,
        property.city,
        property.province
      ]
        .filter(Boolean)
        .join(" · ");

    const modal =
      document.createElement("div");

    modal.id = "nexoPropertyModal";

    modal.innerHTML = `
      <div
        style="
          position:fixed;
          inset:0;
          z-index:9999;
          background:rgba(0,0,0,.48);
          backdrop-filter:blur(8px);
          display:flex;
          align-items:flex-end;
          justify-content:center;
        "
      >

        <div
          style="
            width:min(900px,100%);
            max-height:94vh;
            overflow:auto;
            background:#fff;
            border-radius:30px 30px 0 0;
            box-shadow:0 -20px 80px rgba(0,0,0,.22);
          "
        >

          ${
            image
              ? `
                <img
                  src="${safeUrl(image)}"
                  alt="${escapeAttr(title)}"
                  style="
                    width:100%;
                    max-height:52vh;
                    object-fit:cover;
                  "
                >
              `
              : ""
          }

          <div
            style="
              padding:22px;
            "
          >

            <button
              type="button"
              data-close-modal
              style="
                float:right;
                width:40px;
                height:40px;
                border:0;
                border-radius:50%;
                background:#f0f0f2;
                font-size:20px;
              "
            >
              ×
            </button>

            <div
              style="
                color:#777;
                font-size:10px;
                font-weight:750;
                text-transform:uppercase;
                letter-spacing:.08em;
              "
            >
              ${escapeHtml(
                property.property_type ||
                "Propiedad"
              )}
            </div>

            <h2
              style="
                margin:10px 50px 5px 0;
                font-size:38px;
                line-height:.95;
                letter-spacing:-.07em;
              "
            >
              ${escapeHtml(title)}
            </h2>

            <div
              style="
                font-size:23px;
                font-weight:800;
                letter-spacing:-.04em;
              "
            >
              ${formatPrice(property.price)}
            </div>

            <div
              style="
                margin-top:7px;
                color:#777;
                font-size:12px;
              "
            >
              ${escapeHtml(
                location || "Cuba"
              )}
            </div>

            <div
              style="
                display:flex;
                gap:18px;
                flex-wrap:wrap;
                margin-top:22px;
                padding:15px 0;
                border-top:1px solid #eee;
                border-bottom:1px solid #eee;
                font-size:12px;
              "
            >

              <span>
                <strong>
                  ${escapeHtml(
                    property.bedrooms ?? "—"
                  )}
                </