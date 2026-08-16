"use strict";

/* =========================================================
   NEXO — APP.JS
   Frontend principal
   Propiedades + búsqueda + filtros + NEXO IA
   Compatible con el Worker actual
   ========================================================= */

const NEXO = {
  properties: [],
  filtered: [],
  filter: "all",
  search: "",
  conversation: [],
  session: null
};

/* =========================================================
   UTILIDADES
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") {
    return "Precio a consultar";
  }

  const n = Number(String(value).replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(n)) {
    return String(value);
  }

  return "$" + n.toLocaleString("en-US");
}

function propertyType(p) {
  return p.property_type || p.type || "Propiedad";
}

function propertyTitle(p) {
  return p.title || p.name || propertyType(p);
}

function propertyLocation(p) {
  return [
    p.neighborhood,
    p.city,
    p.province
  ].filter(Boolean).join(", ") || "Cuba";
}

function propertyPhoto(p) {
  let photos = p.photos;

  if (!photos) return "";

  if (Array.isArray(photos)) {
    return photos[0] || "";
  }

  if (typeof photos === "string") {
    try {
      const parsed = JSON.parse(photos);

      if (Array.isArray(parsed)) {
        return parsed[0] || "";
      }
    } catch (_) {}

    return photos
      .split(/[\n,|]+/)
      .map(x => x.trim())
      .find(Boolean) || "";
  }

  return "";
}

/* =========================================================
   SESSION DE NEXO IA
   ========================================================= */

function getSession() {
  if (NEXO.session) return NEXO.session;

  try {
    NEXO.session =
      localStorage.getItem("nexo_ai_session");

    if (!NEXO.session) {
      NEXO.session =
        "nexo-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 10);

      localStorage.setItem(
        "nexo_ai_session",
        NEXO.session
      );
    }
  } catch (_) {
    NEXO.session =
      "nexo-" +
      Date.now().toString(36);
  }

  return NEXO.session;
}

/* =========================================================
   PROPIEDADES
   ========================================================= */

async function loadProperties() {
  const grid = $("#propertyGrid");
  const count = $("#propertyCount");

  if (!grid) return;

  grid.innerHTML =
    '<div class="loading">Cargando propiedades...</div>';

  try {
    const response = await fetch(
      "/api/properties",
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status
      );
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      NEXO.properties = data;
    } else if (Array.isArray(data.properties)) {
      NEXO.properties = data.properties;
    } else if (Array.isArray(data.data)) {
      NEXO.properties = data.data;
    } else {
      NEXO.properties = [];
    }

    applyFilters();

  } catch (error) {
    console.error(
      "NEXO /api/properties:",
      error
    );

    grid.innerHTML = `
      <div class="empty">
        <strong>No pudimos cargar las propiedades.</strong>
        <br>
        <small>Inténtalo nuevamente.</small>
      </div>
    `;

    if (count) {
      count.textContent = "Error";
    }
  }
}

/* =========================================================
   FILTROS
   ========================================================= */

function applyFilters() {
  let result = [...NEXO.properties];

  if (NEXO.filter !== "all") {
    result = result.filter(p =>
      normalize(propertyType(p)) ===
      normalize(NEXO.filter)
    );
  }

  if (NEXO.search) {
    const terms =
      normalize(NEXO.search)
        .split(/\s+/)
        .filter(Boolean);

    result = result.filter(p => {
      const text = [
        p.title,
        p.name,
        p.property_type,
        p.type,
        p.city,
        p.province,
        p.neighborhood,
        p.address,
        p.description,
        p.bedrooms,
        p.bathrooms,
        p.square_meters,
        p.price
      ]
        .filter(v => v !== null && v !== undefined)
        .map(normalize)
        .join(" ");

      return terms.every(term =>
        text.includes(term)
      );
    });
  }

  NEXO.filtered = result;

  renderProperties();
}

/* =========================================================
   TARJETAS
   ========================================================= */

function renderProperties() {
  const grid = $("#propertyGrid");
  const count = $("#propertyCount");

  if (!grid) return;

  if (count) {
    count.textContent =
      `${NEXO.filtered.length} ${
        NEXO.filtered.length === 1
          ? "propiedad"
          : "propiedades"
      }`;
  }

  if (!NEXO.filtered.length) {
    grid.innerHTML = `
      <div class="empty">
        <strong>No encontramos propiedades.</strong>
        <br>
        <small>
          Prueba otra búsqueda o cambia el filtro.
        </small>
      </div>
    `;
    return;
  }

  grid.innerHTML =
    NEXO.filtered.map(renderProperty).join("");
}

function renderProperty(p) {
  const id = p.id ?? "";
  const photo = propertyPhoto(p);

  const image = photo
    ? `
      <img
        src="${escapeHTML(photo)}"
        alt="${escapeHTML(propertyTitle(p))}"
        loading="lazy"
        onerror="this.style.display='none'"
      >
    `
    : "";

  const bedrooms =
    p.bedrooms ?? p.rooms ?? "—";

  const bathrooms =
    p.bathrooms ?? "—";

  const area =
    p.square_meters ?? p.area ?? "—";

  return `
    <article class="property">

      <a href="/propiedad.html?id=${encodeURIComponent(id)}">

        <div class="property-image">

          ${image}

          <div class="property-badge">
            ${escapeHTML(propertyType(p))}
          </div>

        </div>

        <div class="property-body">

          <div class="property-price">
            ${escapeHTML(formatPrice(p.price))}
          </div>

          <div class="property-title">
            ${escapeHTML(propertyTitle(p))}
          </div>

          <div class="property-location">
            ${escapeHTML(propertyLocation(p))}
          </div>

          <div class="property-meta">
            <span>🛏 ${escapeHTML(bedrooms)}</span>
            <span>🛁 ${escapeHTML(bathrooms)}</span>
            <span>㎡ ${escapeHTML(area)}</span>
          </div>

        </div>

      </a>

    </article>
  `;
}

/* =========================================================
   BÚSQUEDA
   ========================================================= */

function setupSearch() {
  const form = $("#searchForm");
  const input = $("#searchInput");

  if (!form) return;

  form.addEventListener("submit", event => {
    event.preventDefault();

    NEXO.search =
      input?.value.trim() || "";

    applyFilters();

    $("#propiedades")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  document
    .querySelectorAll("[data-search]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const value =
          button.dataset.search || "";

        if (input) {
          input.value = value;
        }

        NEXO.search = value;

        applyFilters();

        $("#propiedades")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
}

/* =========================================================
   FILTROS DE INTERFAZ
   ========================================================= */

function setupFilters() {
  document
    .querySelectorAll("[data-filter]")
    .forEach(button => {
      button.addEventListener("click", () => {

        document
          .querySelectorAll(".filter")
          .forEach(item =>
            item.classList.remove("active")
          );

        button.classList.add("active");

        NEXO.filter =
          button.dataset.filter || "all";

        applyFilters();
      });
    });
}

/* =========================================================
   NEXO IA — PANEL
   ========================================================= */

let aiPanel;
let aiMessages;
let aiInput;

function createAIPanel() {
  if ($("#nexoAI")) {
    aiPanel = $("#nexoAI");
    aiMessages = $("#nexoAIMessages");
    aiInput = $("#nexoAIInput");
    return;
  }

  const panel =
    document.createElement("section");

  panel.id = "nexoAI";

  panel.innerHTML = `
    <div class="nexo-ai-window">

      <header class="nexo-ai-header">

        <div>
          <strong>NEXO IA</strong>
          <small>
            Tu asistente inmobiliario
          </small>
        </div>

        <button
          type="button"
          id="closeNexoAI"
          aria-label="Cerrar"
        >×</button>

      </header>

      <div
        class="nexo-ai-messages"
        id="nexoAIMessages"
      >
        <div class="nexo-ai-message bot">
          Hola. Soy NEXO IA.
          <br><br>
          Dime qué estás buscando y te ayudaré
          a encontrar propiedades disponibles.
        </div>
      </div>

      <div class="nexo-ai-suggestions">

        <button data-ai-question="¿Qué propiedades tienes en La Habana?">
          La Habana
        </button>

        <button data-ai-question="Muéstrame casas disponibles.">
          Casas
        </button>

        <button data-ai-question="¿Qué apartamentos tienes disponibles?">
          Apartamentos
        </button>

      </div>

      <form
        class="nexo-ai-form"
        id="nexoAIForm"
      >

        <input
          id="nexoAIInput"
          type="text"
          autocomplete="off"
          placeholder="Pregúntale a NEXO IA..."
        >

        <button type="submit">
          ↑
        </button>

      </form>

    </div>
  `;

  document.body.appendChild(panel);

  injectAIStyles();

  aiPanel = $("#nexoAI");
  aiMessages = $("#nexoAIMessages");
  aiInput = $("#nexoAIInput");

  $("#closeNexoAI")?.addEventListener(
    "click",
    closeAI
  );

  $("#nexoAIForm")?.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      askAI(
        aiInput?.value || ""
      );
    }
  );

  document
    .querySelectorAll("[data-ai-question]")
    .forEach(button => {
      button.addEventListener("click", () => {
        askAI(
          button.dataset.aiQuestion || ""
        );
      });
    });
}

function openAI() {
  createAIPanel();

  aiPanel.classList.add("open");

  setTimeout(() => {
    aiInput?.focus();
  }, 150);
}

function closeAI() {
  aiPanel?.classList.remove("open");
}

/* =========================================================
   MENSAJES
   ========================================================= */

function addAIMessage(
  text,
  type = "bot",
  properties = []
) {
  if (!aiMessages) return;

  const message =
    document.createElement("div");

  message.className =
    "nexo-ai-message " + type;

  message.textContent =
    text || "";

  if (
    type === "bot" &&
    Array.isArray(properties) &&
    properties.length
  ) {
    const list =
      document.createElement("div");

    list.className =
      "nexo-ai-properties";

    properties
      .slice(0, 5)
      .forEach(p => {

        const link =
          document.createElement("a");

        link.href =
          "/propiedad.html?id=" +
          encodeURIComponent(p.id ?? "");

        link.innerHTML = `
          <strong>
            ${escapeHTML(propertyTitle(p))}
          </strong>
          <small>
            ${escapeHTML(formatPrice(p.price))}
            ·
            ${escapeHTML(propertyLocation(p))}
          </small>
        `;

        list.appendChild(link);
      });

    message.appendChild(list);
  }

  aiMessages.appendChild(message);

  aiMessages.scrollTop =
    aiMessages.scrollHeight;
}

function addTyping() {
  const element =
    document.createElement("div");

  element.className =
    "nexo-ai-message bot";

  element.textContent =
    "NEXO IA está pensando…";

  aiMessages.appendChild(element);

  aiMessages.scrollTop =
    aiMessages.scrollHeight;

  return element;
}

/* =========================================================
   RESPUESTA DEL WORKER
   ========================================================= */

function parseAIResponse(data) {
  if (!data) {
    return {
      text: "No recibí una respuesta.",
      properties: []
    };
  }

  let text =
    data.answer ||
    data.response ||
    data.message ||
    data.reply ||
    data.text ||
    data.content ||
    "";

  let properties =
    Array.isArray(data.properties)
      ? data.properties
      : Array.isArray(data.results)
        ? data.results
        : [];

  if (
    typeof text === "object" &&
    text !== null
  ) {
    text =
      text.answer ||
      text.response ||
      text.message ||
      JSON.stringify(text);
  }

  return {
    text: String(
      text ||
      "NEXO IA no devolvió una respuesta."
    ),
    properties
  };
}

/* =========================================================
   CONSULTA A /api/ia
   ========================================================= */

async function askAI(question) {
  const clean =
    String(question || "").trim();

  if (!clean) return;

  createAIPanel();

  aiPanel.classList.add("open");

  addAIMessage(
    clean,
    "user"
  );

  if (aiInput) {
    aiInput.value = "";
  }

  const typing =
    addTyping();

  try {
    /*
     * IMPORTANTE:
     * El Worker actual utiliza:
     * X-NEXO-SESSION
     * y conversation
     */

    const payload = {
      message: clean,
      conversation:
        NEXO.conversation
    };

    const response =
      await fetch(
        "/api/ia",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json",

            "X-NEXO-SESSION":
              getSession()
          },

          body:
            JSON.stringify(payload)
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = {
        response: raw
      };
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Error ${response.status}`
      );
    }

    const result =
      parseAIResponse(data);

    typing.remove();

    addAIMessage(
      result.text,
      "bot",
      result.properties
    );

    /*
     * Guardamos la conversación en el formato
     * que utiliza el Worker.
     */

    NEXO.conversation.push({
      role: "user",
      content: clean
    });

    NEXO.conversation.push({
      role: "assistant",
      content: result.text
    });

    /*
     * Evita enviar una conversación
     * excesivamente grande.
     */

    if (NEXO.conversation.length > 20) {
      NEXO.conversation =
        NEXO.conversation.slice(-20);
    }

  } catch (error) {

    console.error(
      "NEXO IA:",
      error
    );

    typing.remove();

    addAIMessage(
      "No pude conectar con NEXO IA en este momento. Inténtalo nuevamente.",
      "bot"
    );
  }
}

/* =========================================================
   ESTILOS IA
   ========================================================= */

function injectAIStyles() {
  if ($("#nexoAIStyles")) return;

  const style =
    document.createElement("style");

  style.id =
    "nexoAIStyles";

  style.textContent = `
    #nexoAI{
      position:fixed;
      z-index:5000;
      inset:0;
      display:none;
      pointer-events:none;
    }

    #nexoAI.open{
      display:block;
    }

    .nexo-ai-window{
      position:absolute;
      right:18px;
      bottom:18px;
      width:min(420px,calc(100% - 28px));
      height:min(650px,calc(100dvh - 36px));
      display:flex;
      flex-direction:column;
      overflow:hidden;
      pointer-events:auto;
      border:1px solid rgba(0,0,0,.08);
      border-radius:28px;
      background:rgba(255,255,255,.97);
      backdrop-filter:blur(25px);
      -webkit-backdrop-filter:blur(25px);
      box-shadow:0 30px 100px rgba(0,0,0,.25);
    }

    .nexo-ai-header{
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:17px;
      border-bottom:1px solid rgba(0,0,0,.07);
    }

    .nexo-ai-header strong{
      display:block;
      font-size:15px;
    }

    .nexo-ai-header small{
      display:block;
      margin-top:2px;
      color:#777;
      font-size:10px;
    }

    .nexo-ai-header button{
      width:34px;
      height:34px;
      border:0;
      border-radius:50%;
      background:#eeeef0;
      color:#555;
      font-size:20px;
    }

    .nexo-ai-messages{
      flex:1;
      overflow-y:auto;
      padding:17px;
    }

    .nexo-ai-message{
      max-width:88%;
      margin-bottom:10px;
      padding:11px 13px;
      border-radius:17px;
      font-size:13px;
      line-height:1.5;
      white-space:pre-wrap;
    }

    .nexo-ai-message.bot{
      margin-right:auto;
      background:#f0f0f2;
      color:#222;
      border-bottom-left-radius:6px;
    }

    .nexo-ai-message.user{
      margin-left:auto;
      background:#111;
      color:#fff;
      border-bottom-right-radius:6px;
    }

    .nexo-ai-properties{
      display:grid;
      gap:7px;
      margin-top:9px;
    }

    .nexo-ai-properties a{
      display:block;
      padding:10px;
      border-radius:13px;
      background:#fff;
      border:1px solid rgba(0,0,0,.07);
      color:#111;
    }

    .nexo-ai-properties strong{
      display:block;
      font-size:11px;
    }

    .nexo-ai-properties small{
      display:block;
      margin-top:3px;
      color:#777;
      font-size:9px;
    }

    .nexo-ai-suggestions{
      display:flex;
      gap:7px;
      overflow-x:auto;
      padding:0 13px 10px;
      scrollbar-width:none;
    }

    .nexo-ai-suggestions::-webkit-scrollbar{
      display:none;
    }

    .nexo-ai-suggestions button{
      flex:none;
      padding:8px 10px;
      border:0;
      border-radius:999px;
      background:#eeeef0;
      color:#555;
      font-size:10px;
    }

    .nexo-ai-form{
      display:flex;
      gap:7px;
      padding:10px;
      border-top:1px solid rgba(0,0,0,.07);
    }

    .nexo-ai-form input{
      flex:1;
      min-width:0;
      height:43px;
      padding:0 12px;
      border:1px solid rgba(0,0,0,.07);
      border-radius:13px;
      outline:0;
      background:#f3f3f5;
      font-size:13px;
    }

    .nexo-ai-form button{
      width:43px;
      height:43px;
      border:0;
      border-radius:13px;
      background:#111;
      color:#fff;
      font-size:18px;
    }

    @media(max-width:600px){
      .nexo-ai-window{
        right:8px;
        bottom:8px;
        width:calc(100% - 16px);
        height:calc(100dvh - 16px);
        border-radius:24px;
      }
    }
  `;

  document.head.appendChild(style);
}

/* =========================================================
   INICIO
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    setupSearch();
    setupFilters();

    const aiButton =
      $("#openAI");

    if (aiButton) {
      aiButton.addEventListener(
        "click",
        openAI
      );
    }

    loadProperties();
  }
);