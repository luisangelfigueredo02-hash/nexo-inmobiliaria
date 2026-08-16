/* =========================================================
   NEXO 2.0 — APP.JS
   Inventario · Búsqueda · Filtros · Favoritos
   Detalle · Mapa · NEXO IA · UI
========================================================= */

(() => {
  "use strict";

  /* =========================================================
     ESTADO
  ========================================================= */

  const state = {
    properties: [],
    filtered: [],
    filter: "all",

    favorites: new Set(
      loadFavorites()
    ),

    loading: false,

    aiConversation: []
  };

  /* =========================================================
     HELPERS DOM
  ========================================================= */

  const $ = selector =>
    document.querySelector(selector);

  const $$ = selector =>
    [...document.querySelectorAll(selector)];

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

  /* =========================================================
     INIT
  ========================================================= */

  async function init() {

    bindSearch();

    bindFilters();

    bindQuickSearch();

    await loadProperties();

    /*
     * Si la página llega con ?property=ID,
     * abrimos directamente esa propiedad.
     */
    openPropertyFromURL();

  }

  /* =========================================================
     FAVORITOS
  ========================================================= */

  function loadFavorites() {

    try {

      const saved =
        localStorage.getItem(
          "nexo_favorites"
        );

      if (!saved) {
        return [];
      }

      const parsed =
        JSON.parse(saved);

      return Array.isArray(parsed)
        ? parsed.map(String)
        : [];

    } catch (_) {

      return [];

    }

  }

  function saveFavorites() {

    try {

      localStorage.setItem(
        "nexo_favorites",
        JSON.stringify(
          [...state.favorites]
        )
      );

    } catch (error) {

      console.warn(
        "NEXO favorites:",
        error
      );

    }

  }

  function toggleFavorite(
    id,
    button
  ) {

    const key =
      String(id);

    if (
      state.favorites.has(key)
    ) {

      state.favorites.delete(key);

      if (button) {

        button.textContent =
          "♡";

        button.setAttribute(
          "aria-label",
          "Guardar en favoritos"
        );

      }

      showToast(
        "Eliminado de favoritos"
      );

    } else {

      state.favorites.add(key);

      if (button) {

        button.textContent =
          "♥";

        button.setAttribute(
          "aria-label",
          "Quitar de favoritos"
        );

      }

      showToast(
        "Guardado en favoritos"
      );

    }

    saveFavorites();

  }

  /* =========================================================
     API
  ========================================================= */

  async function api(
    url,
    options = {}
  ) {

    const config = {
      credentials: "include",
      ...options,
      headers: {
        Accept:
          "application/json",
        ...(options.body
          ? {
              "Content-Type":
                "application/json"
            }
          : {}),
        ...(options.headers || {})
      }
    };

    const response =
      await fetch(
        url,
        config
      );

    let data = null;

    try {

      data =
        await response.json();

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

  /* =========================================================
     INVENTARIO
  ========================================================= */

  async function loadProperties() {

    setLoading(true);

    try {

      const data =
        await api(
          "/api/properties?status=available&limit=200"
        );

      state.properties =
        Array.isArray(
          data?.properties
        )
          ? data.properties
          : Array.isArray(data)
            ? data
            : [];

      applyCurrentView();

    } catch (error) {

      console.error(
        "NEXO inventory:",
        error
      );

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

    let list =
      [...state.properties];

    if (
      state.filter !== "all"
    ) {

      list =
        list.filter(
          property => {

            const type =
              normalize(
                property.property_type ||
                property.type ||
                ""
              );

            return type.includes(
              normalize(
                state.filter
              )
            );

          }
        );

    }

    state.filtered =
      list;

    renderProperties(
      list
    );

    updateCount(
      list.length
    );

  }

  /* =========================================================
     SEARCH
  ========================================================= */

  function bindSearch() {

    const form =
      $("#searchForm");

    const input =
      $("#searchInput");

    if (!form || !input) {
      return;
    }

    form.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        const query =
          input.value.trim();

        if (!query) {

          await loadProperties();

          scrollToInventory();

          return;

        }

        await search(
          query
        );

      }
    );

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

  async function search(
    query
  ) {

    if (!query) {
      return;
    }

    setLoading(true);

    try {

      /*
       * Intentamos primero el endpoint
       * inteligente del Worker.
       */

      const data =
        await api(
          "/api/search",
          {
            method: "POST",
            body: JSON.stringify({
              query
            })
          }
        );

      const results =
        Array.isArray(
          data?.properties
        )
          ? data.properties
          : Array.isArray(data)
            ? data
            : [];

      state.filtered =
        results;

      renderProperties(
        results
      );

      updateCount(
        results.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();

    } catch (error) {

      /*
       * Fallback local.
       *
       * Esto permite que el buscador siga funcionando
       * aunque /api/search todavía no exista.
       */

      console.warn(
        "NEXO search fallback:",
        error
      );

      const results =
        localSearch(
          query
        );

      state.filtered =
        results;

      renderProperties(
        results
      );

      updateCount(
        results.length,
        `Resultados para “${query}”`
      );

      scrollToInventory();

    } finally {

      setLoading(false);

    }

  }

  function localSearch(
    query
  ) {

    const q =
      normalize(query);

    if (!q) {
      return [...state.properties];
    }

    /*
     * Detectar búsquedas como:
     *
     * "3 habitaciones"
     * "3 habitaciones La Habana"
     */

    const bedroomMatch =
      q.match(
        /(\d+)\s*(habitaciones?|hab|dormitorios?)/i
      );

    const bedrooms =
      bedroomMatch
        ? Number(
            bedroomMatch[1]
          )
        : null;

    /*
     * Detectar baños.
     */

    const bathroomMatch =
      q.match(
        /(\d+)\s*(baños?|banos?)/i
      );

    const bathrooms =
      bathroomMatch
        ? Number(
            bathroomMatch[1]
          )
        : null;

    /*
     * Quitamos términos numéricos de la consulta
     * para hacer una búsqueda textual más útil.
     */

    const textQuery =
      normalize(
        q
          .replace(
            /(\d+)\s*(habitaciones?|hab|dormitorios?)/gi,
            ""
          )
          .replace(
            /(\d+)\s*(baños?|banos?)/gi,
            ""
          )
      ).trim();

    return state.properties.filter(
      property => {

        const searchable =
          normalize(
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
          searchable.includes(
            textQuery
          );

        const bedroomMatch =
          bedrooms === null ||
          Number(
            property.bedrooms
          ) === bedrooms;

        const bathroomMatch =
          bathrooms === null ||
          Number(
            property.bathrooms
          ) === bathrooms;

        return (
          textMatch &&
          bedroomMatch &&
          bathroomMatch
        );

      }
    );

  }

  /* =========================================================
     QUICK SEARCH
  ========================================================= */

  function bindQuickSearch() {

    $$(
      "[data-search]"
    ).forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            const query =
              button.dataset.search ||
              "";

            const input =
              $("#searchInput");

            if (input) {
              input.value =
                query;
            }

            await search(
              query
            );

          }
        );

      }
    );

  }

  /* =========================================================
     FILTERS
  ========================================================= */

  function bindFilters() {

    $$(".filter")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              /*
               * Importante:
               * Solo manejamos filtros que realmente
               * pertenezcan al inventario.
               */

              $$(".filter")
                .forEach(
                  item =>
                    item.classList.remove(
                      "active"
                    )
                );

              button.classList.add(
                "active"
              );

              state.filter =
                button.dataset.filter ||
                "all";

              applyCurrentView();

            }
          );

        }
      );

  }

  /* =========================================================
     RENDER PROPERTIES
  ========================================================= */

  function renderProperties(
    properties
  ) {

    const grid =
      $("#propertyGrid");

    if (!grid) {
      return;
    }

    if (!properties.length) {

      grid.innerHTML = `
        <div class="empty">

          <strong>
            No encontramos propiedades.
          </strong>

          <br>

          Prueba otra búsqueda
          o cambia los filtros.

        </div>
      `;

      return;

    }

    grid.innerHTML =
      properties
        .map(
          createPropertyCard
        )
        .join("");

    attachPropertyEvents();

  }

  /* =========================================================
     PROPERTY CARD
  ========================================================= */

  function createPropertyCard(
    property
  ) {

    const id =
      property.id ??
      property.property_id ??
      "";

    const photos =
      parsePhotos(
        property.photos
      );

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
      state.favorites.has(
        String(id)
      );

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
              favorite
                ? "true"
                : "false"
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
              -webkit-backdrop-filter:blur(12px);
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
            ${formatPrice(
              property.price
            )}
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
              ${escapeHtml(
                bedrooms
              )}
              hab.
            </span>

            <span>
              ${escapeHtml(
                bathrooms
              )}
              baños
            </span>

            <span>
              ${escapeHtml(
                area
              )}
              m²
            </span>

          </div>

        </div>

      </article>
    `;

  }

  /* =========================================================
     PROPERTY EVENTS
  ========================================================= */

  function attachPropertyEvents() {

    $$(".property")
      .forEach(
        card => {

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

              openProperty(
                id
              );

            }
          );

        }
      );

    $$(".nexo-favorite")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            event => {

              event.preventDefault();

              event.stopPropagation();

              toggleFavorite(
                button.dataset.favorite,
                button
              );

            }
          );

        }
      );

  }

  /* =========================================================
     PROPERTY DETAIL
  ========================================================= */

  async function openProperty(
    id
  ) {

    if (!id) {
      return;
    }

    /*
     * Primero buscamos la propiedad que ya está
     * cargada en memoria.
     */

    let property =
      state.properties.find(
        item =>
          String(
            item.id
          ) ===
          String(id)
      );

    /*
     * Intentamos obtener la versión completa
     * desde el Worker.
     */

    try {

      const data =
        await api(
          `/api/properties/${encodeURIComponent(id)}`
        );

      const remote =
        data?.property ||
        data;

      if (remote) {
        property = remote;
      }

    } catch (error) {

      console.warn(
        "NEXO property detail:",
        error
      );

    }

    if (!property) {

      showToast(
        "No encontramos esta propiedad."
      );

      return;

    }

    /*
     * Actualizamos la URL sin recargar.
     */

    try {

      const url =
        new URL(
          window.location.href
        );

      url.searchParams.set(
        "property",
        id
      );

      window.history.pushState(
        {},
        "",
        url
      );

    } catch (_) {}

    showPropertyModal(
      property
    );

  }

  /* =========================================================
     OPEN PROPERTY FROM URL
  ========================================================= */

  function openPropertyFromURL() {

    try {

      const params =
        new URLSearchParams(
          window.location.search
        );

      const id =
        params.get(
          "property"
        );

      if (!id) {
        return;
      }

      /*
       * Esperamos a que el inventario esté disponible.
       */

      if (
        state.properties.length
      ) {

        openProperty(
          id
        );

      }

    } catch (_) {}

  }

  /* =========================================================
     PROPERTY MODAL
  ========================================================= */

  function showPropertyModal(
    property
  ) {

    closeExistingModal();

    const photos =
      parsePhotos(
        property.photos
      );

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

    const location =
      [
        property.neighborhood,
        property.city,
        property.province
      ]
        .filter(Boolean)
        .join(" · ");

    const id =
      property.id ??
      property.property_id ??
      "";

    const favorite =
      state.favorites.has(
        String(id)
      );

    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      "nexoPropertyModal";

    modal.innerHTML = `
      <div
        data-modal-overlay
        style="
          position:fixed;
          inset:0;
          z-index:9999;
          background:rgba(0,0,0,.48);
          backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px);
          display:flex;
          align-items:flex-end;
          justify-content:center;
        "
      >

        <div
          role="dialog"
          aria-modal="true"
          aria-label="${escapeAttr(title)}"
          style="
            width:min(900px,100%);
            max-height:94vh;
            overflow:auto;
            background:#fff;
            border-radius:30px 30px 0 0;
            box-shadow:0 -20px 80px rgba(0,0,0,.22);
          "
        >

          <div
            style="
              position:relative;
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
                      min-height:220px;
                      object-fit:cover;
                      display:block;
                    "
                  >
                `
                : `
                  <div
                    style="
                      height:250px;
                      display:grid;
                      place-items:center;
                      background:#eee;
                      color:#888;
                      font-weight:800;
                    "
                  >
                    NEXO
                  </div>
                `
            }

            <button
              type="button"
              data-close-modal
              aria-label="Cerrar"
              style="
                position:absolute;
                z-index:3;
                top:15px;
                right:15px;
                width:42px;
                height:42px;
                border:0;
                border-radius:50%;
                background:rgba(255,255,255,.9);
                backdrop-filter:blur(12px);
                -webkit-backdrop-filter:blur(12px);
                font-size:21px;
                line-height:1;
              "
            >
              ×
            </button>

          </div>

          <div
            style="
              padding:22px;
            "
          >

            <div
              style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
              "
            >

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
                  property.type ||
                  "Propiedad"
                )}
              </div>

              <button
                type="button"
                data-modal-favorite
                aria-label="${
                  favorite
                    ? "Quitar de favoritos"
                    : "Guardar en favoritos"
                }"
                aria-pressed="${
                  favorite
                    ? "true"
                    : "false"
                }"
                style="
                  width:42px;
                  height:42px;
                  border:1px solid #eee;
                  border-radius:50%;
                  background:#f7f7f8;
                  font-size:19px;
                "
              >
                ${favorite ? "♥" : "♡"}
              </button>

            </div>

            <h2
              style="
                margin:10px 50px 5px 0;
                font-size:clamp(34px,7vw,58px);
                line-height:.92;
                letter-spacing:-.07em;
              "
            >
              ${escapeHtml(title)}
            </h2>

            <div
              style="
                font-size:24px;
                font-weight:800;
                letter-spacing:-.04em;
              "
            >
              ${formatPrice(
                property.price
              )}
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
                display:grid;
                grid-template-columns:
                  repeat(3,minmax(0,1fr));
                gap:8px;
                margin-top:22px;
              "
            >

              ${detailStat(
                property.bedrooms,
                "Habitaciones"
              )}

              ${detailStat(
                property.bathrooms,
                "Baños"
              )}

              ${detailStat(
                property.square_meters ??
                property.area,
                "m²"
              )}

            </div>

            ${
              property.description
                ? `
                  <div
                    style="
                      margin-top:24px;
                      padding-top:20px;
                      border-top:1px solid #eee;
                    "
                  >

                    <div
                      style="
                        margin-bottom:8px;
                        font-size:13px;
                        font-weight:800;
                      "
                    >
                      Descripción
                    </div>

                    <div
                      style="
                        color:#666;
                        font-size:13px;
                        line-height:1.6;
                      "
                    >
                      ${escapeHtml(
                        property.description
                      )}
                    </div>

                  </div>
                `
                : ""
            }

            <div
              style="
                display:flex;
                gap:9px;
                flex-wrap:wrap;
                margin-top:24px;
              "
            >

              ${
                property.latitude &&
                property.longitude
                  ? `
                    <a
                      href="/mapa/?property=${encodeURIComponent(id)}"
                      style="
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        padding:13px 17px;
                        border-radius:14px;
                        background:#111;
                        color:#fff;
                        font-size:12px;
                        font-weight:750;
                      "
                    >
                      Ver en el mapa →
                    </a>
                  `
                  : ""
              }

              ${
                property.owner_phone ||
                property.phone
                  ? `
                    <a
                      href="tel:${escapeAttr(
                        property.owner_phone ||
                        property.phone
                      )}"
                      style="
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        padding:13px 17px;
                        border-radius:14px;
                        background:#f0f0f2;
                        color:#111;
                        font-size:12px;
                        font-weight:750;
                      "
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

    document.body.appendChild(
      modal
    );

    const closeButton =
      modal.querySelector(
        "[data-close-modal]"
      );

    if (closeButton) {

      closeButton.addEventListener(
        "click",
        () => {
          closeExistingModal(
            true
          );
        }
      );

    }

    const overlay =
      modal.querySelector(
        "[data-modal-overlay]"
      );

    if (overlay) {

      overlay.addEventListener(
        "click",
        event => {

          if (
            event.target ===
            overlay
          ) {

            closeExistingModal(
              true
            );

          }

        }
      );

    }

    const favoriteButton =
      modal.querySelector(
        "[data-modal-favorite]"
      );

    if (favoriteButton) {

      favoriteButton.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          toggleFavorite(
            id,
            favoriteButton
          );

          const active =
            state.favorites.has(
              String(id)
            );

          favoriteButton.textContent =
            active
              ? "♥"
              : "♡";

          favoriteButton.setAttribute(
            "aria-pressed",
            active
              ? "true"
              : "false"
          );

        }
      );

    }

    document.body.style.overflow =
      "hidden";

  }

  function detailStat(
    value,
    label
  ) {

    return `
      <div
        style="
          padding:14px;
          border-radius:16px;
          background:#f5f5f7;
        "
      >

        <div
          style="
            font-size:18px;
            font-weight:800;
          "
        >
          ${escapeHtml(
            value ??
            "—"
          )}
        </div>

        <div
          style="
            margin-top:3px;
            color:#777;
            font-size:10px;
          "
        >
          ${escapeHtml(label)}
        </div>

      </div>
    `;

  }

  function closeExistingModal(
    updateURL = false
  ) {

    const modal =
      $("#nexoPropertyModal");

    if (modal) {
      modal.remove();
    }

    document.body.style.overflow =
      "";

    if (updateURL) {

      try {

        const url =
          new URL(
            window.location.href
          );

        url.searchParams.delete(
          "property"
        );

        window.history.pushState(
          {},
          "",
          url
        );

      } catch (_) {}

    }

  }

  /* =========================================================
     NEXO IA
  ========================================================= */

  function openAI() {

    closeExistingAIModal();

    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      "nexoAIModal";

    modal.innerHTML = `
      <div
        data-ai-overlay
        style="
          position:fixed;
          inset:0;
          z-index:9999;
          background:rgba(0,0,0,.48);
          backdrop-filter:blur(10px);
          -webkit-backdrop-filter:blur(10px);
          display:flex;
          align-items:flex-end;
          justify-content:center;
        "
      >

        <div
          style="
            width:min(760px,100%);
            max-height:90vh;
            display:flex;
            flex-direction:column;
            overflow:hidden;
            background:#111;
            color:#fff;
            border-radius:28px 28px 0 0;
            box-shadow:0 -20px 80px rgba(0,0,0,.3);
          "
        >

          <div
            style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              padding:17px 18px;
              border-bottom:1px solid rgba(255,255,255,.1);
            "
          >

            <div>

              <div
                style="
                  font-size:16px;
                  font-weight:800;
                "
              >
                NEXO IA
              </div>

              <div
                style="
                  margin-top:3px;
                  color:#999;
                  font-size:10px;
                "
              >
                Tu asistente inmobiliario
              </div>

            </div>

            <button
              type="button"
              data-close-ai
              aria-label="Cerrar"
              style="
                width:40px;
                height:40px;
                border:0;
                border-radius:50%;
                background:#242426;
                color:#fff;
                font-size:20px;
              "
            >
              ×
            </button>

          </div>

          <div
            id="nexoAIChat"
            style="
              flex:1;
              min-height:260px;
              max-height:55vh;
              overflow:auto;
              padding:18px;
            "
          >

            <div
              style="
                max-width:85%;
                padding:13px 15px;
                border-radius:18px 18px 18px 5px;
                background:#242426;
                color:#ddd;
                font-size:13px;
                line-height:1.5;
              "
            >
              Hola. Soy NEXO IA.
              <br><br>
              Dime qué propiedad estás buscando
              y trataré de ayudarte con el inventario
              disponible.
            </div>

          </div>

          <form
            id="nexoAIForm"
            style="
              display:flex;
              gap:8px;
              padding:12px;
              border-top:1px solid rgba(255,255,255,.1);
            "
          >

            <input
              id="nexoAIInput"
              type="text"
              autocomplete="off"
              placeholder="Ej. Busco una casa en La Habana..."
              style="
                flex:1;
                min-width:0;
                height:46px;
                padding:0 14px;
                border:0;
                outline:0;
                border-radius:15px;
                background:#242426;
                color:#fff;
                font-size:13px;
              "
            >

            <button
              type="submit"
              style="
                height:46px;
                padding:0 17px;
                border:0;
                border-radius:15px;
                background:#fff;
                color:#111;
                font-size:12px;
                font-weight:800;
              "
            >
              Enviar
            </button>

          </form>

        </div>

      </div>
    `;

    document.body.appendChild(
      modal
    );

    document.body.style.overflow =
      "hidden";

    const close =
      modal.querySelector(
        "[data-close-ai]"
      );

    close?.addEventListener(
      "click",
      closeExistingAIModal
    );

    const overlay =
      modal.querySelector(
        "[data-ai-overlay]"
      );

    overlay?.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          overlay
        ) {

          closeExistingAIModal();

        }

      }
    );

    const form =
      $("#nexoAIForm");

    form?.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        const input =
          $("#nexoAIInput");

        const message =
          input?.value.trim();

        if (!message) {
          return;
        }

        input.value = "";

        sendAIMessage(
          message
        );

      }
    );

    setTimeout(
      () =>
        $("#nexoAIInput")?.focus(),
      100
    );

  }

  function closeExistingAIModal() {

    const modal =
      $("#nexoAIModal");

    if (modal) {
      modal.remove();
    }

    /*
     * Solo restauramos el scroll si tampoco
     * existe el modal de propiedad.
     */

    if (
      !$("#nexoPropertyModal")
    ) {

      document.body.style.overflow =
        "";

    }

  }

  async function sendAIMessage(
    message
  ) {

    addAIMessage(
      message,
      true
    );

    state.aiConversation.push({
      role: "user",
      content: message
    });

    const typing =
      addAITyping();

    try {

      /*
       * Si el Worker dispone de /api/ai,
       * NEXO utilizará ese endpoint.
       */

      const data =
        await api(
          "/api/ai",
          {
            method: "POST",
            body: JSON.stringify({
              message,
              conversation:
                state.aiConversation
            })
          }
        );

      typing.remove();

      const answer =
        data?.answer ||
        data?.message ||
        data?.response ||
        "No pude generar una respuesta.";

      addAIMessage(
        answer,
        false
      );

      state.aiConversation.push({
        role: "assistant",
        content: answer
      });

    } catch (error) {

      console.warn(
        "NEXO IA endpoint:",
        error
      );

      typing.remove();

      /*
       * Fallback inteligente local.
       * No inventa propiedades.
       */

      const results =
        localSearch(
          message
        );

      let answer = "";

      if (results.length) {

        const names =
          results
            .slice(0, 5)
            .map(
              property => {

                const title =
                  property.title ||
                  property.property_type ||
                  "Propiedad";

                const location =
                  [
                    property.neighborhood,
                    property.city
                  ]
                    .filter(Boolean)
                    .join(" · ");

                return `• ${title}${
                  location
                    ? ` — ${location}`
                    : ""
                } — ${formatPrice(
                  property.price
                )}`;

              }
            )
            .join("\n");

        answer =
          `Encontré ${results.length} ${
            results.length === 1
              ? "propiedad"
              : "propiedades"
          } que podrían coincidir:\n\n${names}\n\n` +
          `Estas son propiedades del inventario actual de NEXO.`;

      } else {

        answer =
          "No encontré coincidencias claras en el inventario actual. " +
          "Prueba indicando una ciudad, zona, tipo de propiedad " +
          "o número de habitaciones.";

      }

      addAIMessage(
        answer,
        false
      );

      state.aiConversation.push({
        role: "assistant",
        content: answer
      });

    }

  }

  function addAIMessage(
    message,
    user
  ) {

    const chat =
      $("#nexoAIChat");

    if (!chat) {
      return;
    }

    const bubble =
      document.createElement(
        "div"
      );

    bubble.style.cssText = `
      max-width:85%;
      margin:${user ? "10px 0 10px auto" : "10px 0"};
      padding:13px 15px;
      border-radius:${
        user
          ? "18px 18px 5px 18px"
          : "18px 18px 18px 5px"
      };
      background:${
        user
          ? "#fff"
          : "#242426"
      };
      color:${
        user
          ? "#111"
          : "#ddd"
      };
      font-size:13px;
      line-height:1.5;
      white-space:pre-line;
    `;

    bubble.textContent =
      message;

    chat.appendChild(
      bubble
    );

    chat.scrollTop =
      chat.scrollHeight;

  }

  function addAITyping() {

    const chat =
      $("#nexoAIChat");

    const bubble =
      document.createElement(
        "div"
      );

    bubble.style.cssText = `
      max-width:85%;
      margin:10px 0;
      padding:13px 15px;
      border-radius:18px 18px 18px 5px;
      background:#242426;
      color:#999;
      font-size:13px;
    `;

    bubble.textContent =
      "NEXO IA está pensando…";

    chat.appendChild(
      bubble
    );

    chat.scrollTop =
      chat.scrollHeight;

    return bubble;

  }

  /*
   * Se mantiene disponible globalmente porque
   * index.html utiliza onclick="openAI()".
   */

  window.openAI =
    openAI;

  /* =========================================================
     UI
  ========================================================= */

  function setLoading(
    value
  ) {

    state.loading =
      Boolean(value);

    /*
     * No mostramos una pantalla de carga invasiva.
     * Solo modificamos visualmente el contador cuando
     * sea necesario.
     */

    const count =
      $("#propertyCount");

    if (
      state.loading &&
      count &&
      !state.properties.length
    ) {

      count.textContent =
        "Cargando...";

    }

  }

  function updateCount(
    count,
    label
  ) {

    const element =
      $("#propertyCount");

    if (!element) {
      return;
    }

    if (label) {

      element.textContent =
        label;

      return;

    }

    element.textContent =
      `${count} ${
        count === 1
          ? "propiedad"
          : "propiedades"
      }`;

  }

  function showInventoryMessage(
    title,
    description
  ) {

    const grid =
      $("#propertyGrid");

    if (!grid) {
      return;
    }

    grid.innerHTML = `
      <div class="empty">

        <strong>
          ${escapeHtml(title)}
        </strong>

        <br>

        ${escapeHtml(description)}

        <br><br>

        <button
          type="button"
          id="nexoRetryInventory"
          style="
            padding:10px 14px;
            border:0;
            border-radius:12px;
            background:#111;
            color:#fff;
            font-size:11px;
            font-weight:750;
          "
        >
          Intentar nuevamente
        </button>

      </div>
    `;

    $("#nexoRetryInventory")
      ?.addEventListener(
        "click",
        loadProperties
      );

  }

  function showToast(
    message
  ) {

    /*
     * Utilizamos un toast propio.
     */

    let toast =
      $("#nexoToast");

    if (!toast) {

      toast =
        document.createElement(
          "div"
        );

      toast.id =
        "nexoToast";

      toast.style.cssText = `
        position:fixed;
        z-index:11000;
        left:50%;
        bottom:25px;
        transform:translate(-50%,20px);
        opacity:0;
        pointer-events:none;
        max-width:calc(100% - 30px);
        padding:11px 15px;
        border-radius:999px;
        background:#111;
        color:#fff;
        font-size:11px;
        font-weight:700;
        text-align:center;
        transition:
          opacity .25s ease,
          transform .25s ease;
      `;

      document.body.appendChild(
        toast
      );

    }

    toast.textContent =
      message;

    toast.style.opacity =
      "1";

    toast.style.transform =
      "translate(-50%,0)";

    clearTimeout(
      toast._timer
    );

    toast._timer =
      setTimeout(
        () => {

          toast.style.opacity =
            "0";

          toast.style.transform =
            "translate(-50%,20px)";

        },
        2400
      );

  }

  function scrollToInventory() {

    const section =
      $("#propiedades");

    if (!section) {
      return;
    }

    setTimeout(
      () => {

        section.scrollIntoView({
          behavior:
            "smooth",
          block:
            "start"
        });

      },
      50
    );

  }

  /* =========================================================
     PHOTOS
  ========================================================= */

  function parsePhotos(
    value
  ) {

    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {

      return value
        .filter(Boolean)
        .map(
          item =>
            String(item).trim()
        )
        .filter(Boolean);

    }

    if (
      typeof value !==
      "string"
    ) {

      return [];

    }

    const text =
      value.trim();

    if (!text) {
      return [];
    }

    /*
     * Primero intentamos JSON.
     */

    try {

      const parsed =
        JSON.parse(text);

      if (
        Array.isArray(parsed)
      ) {

        return parsed
          .filter(Boolean)
          .map(
            item =>
              String(item).trim()
          )
          .filter(Boolean);

      }

    } catch (_) {}

    /*
     * Después aceptamos:
     *
     * URL1
     * URL2
     *
     * URL1,URL2
     *
     * URL1|URL2
     */

    return text
      .split(
        /[\n,|]+/
      )
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);

  }

  /* =========================================================
     PRICE
  ========================================================= */

  function formatPrice(
    value
  ) {

    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {

      return "Precio no disponible";

    }

    const number =
      Number(
        String(value)
          .replace(
            /[^\d.-]/g,
            ""
          )
      );

    if (
      !Number.isFinite(number)
    ) {

      return "Precio no disponible";

    }

    return "$" +
      number.toLocaleString(
        "en-US",
        {
          maximumFractionDigits:0
        }
      );

  }

  /* =========================================================
     NORMALIZE
  ========================================================= */

  function normalize(
    value
  ) {

    return String(
      value ?? ""
    )
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .toLowerCase()
      .trim();

  }

  /* =========================================================
     ESCAPE HTML
  ========================================================= */

  function escapeHtml(
    value
  ) {

    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      char => ({
        "&":
          "&amp;",
        "<":
          "&lt;",
        ">":
          "&gt;",
        '"':
          "&quot;",
        "'":
          "&#039;"
      }[char])
    );

  }

  function escapeAttr(
    value
  ) {

    return escapeHtml(
      value
    );

  }

  /* =========================================================
     SAFE URL
  ========================================================= */

  function safeUrl(
    value
  ) {

    if (!value) {
      return "";
    }

    try {

      const url =
        new URL(
          String(value),
          window.location.origin
        );

      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
      ) {

        return "";

      }

      return url.href;

    } catch (_) {

      return "";

    }

  }

  /* =========================================================
     KEYBOARD
  ========================================================= */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        $("#nexoPropertyModal")
      ) {

        closeExistingModal(
          true
        );

        return;

      }

      if (
        $("#nexoAIModal")
      ) {

        closeExistingAIModal();

      }

    }
  );

  /* =========================================================
     BROWSER BACK BUTTON
  ========================================================= */

  window.addEventListener(
    "popstate",
    () => {

      const params =
        new URLSearchParams(
          window.location.search
        );

      const id =
        params.get(
          "property"
        );

      if (!id) {

        closeExistingModal();

        return;

      }

      if (
        state.properties.length
      ) {

        openProperty(
          id
        );

      }

    }
  );

})();