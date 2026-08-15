const API_URL =
  "https://nexo-inmobiliaria.luisangelfigueredo02.workers.dev";

/* ==========================================
   CARGAR PROPIEDADES
========================================== */

async function loadProperties() {
  const section = document.querySelector("#propiedades");

  if (!section) {
    console.error("NEXO: no existe #propiedades");
    return;
  }

  const grid = section.querySelector(".properties-grid");

  if (!grid) {
    console.error("NEXO: no existe .properties-grid");
    return;
  }

  grid.innerHTML = `
    <div class="nexo-loading">
      Cargando propiedades...
    </div>
  `;

  try {
    const response = await fetch(
      `${API_URL}/api/properties`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Error HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        data.error ||
        "No se pudieron cargar las propiedades."
      );
    }

    renderProperties(
      grid,
      data.properties || []
    );

  } catch (error) {

    console.error("NEXO:", error);

    grid.innerHTML = `
      <div class="nexo-empty">
        <strong>No pudimos cargar las propiedades.</strong>
        <span>Inténtalo nuevamente en unos segundos.</span>
      </div>
    `;
  }
}


/* ==========================================
   MOSTRAR PROPIEDADES
========================================== */

function renderProperties(
  grid,
  properties
) {

  if (!properties.length) {

    grid.innerHTML = `
      <div class="nexo-empty">
        <strong>No hay propiedades disponibles.</strong>
        <span>Pronto tendremos nuevas opciones para ti.</span>
      </div>
    `;

    return;
  }


  grid.innerHTML = properties
    .map(property => {

      const photos =
        parsePhotos(property.photos);

      const firstPhoto =
        photos.length > 0
          ? photos[0]
          : null;


      const price =
        formatPrice(property.price);


      const location =
        [property.city, property.neighborhood]
          .filter(Boolean)
          .map(escapeHTML)
          .join(" · ");


      return `

        <article
          class="property-card"
          data-property-id="${property.id}"
        >

          <!-- FOTO -->

          <div class="property-image">

            ${
              firstPhoto
                ? `
                  <img
                    src="${escapeAttribute(firstPhoto)}"
                    alt="${escapeAttribute(
                      property.property_type ||
                      "Propiedad"
                    )}"
                    loading="lazy"
                    onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                  >

                  <div
                    class="property-placeholder"
                    style="display:none;"
                  >
                    NEXO
                  </div>
                `
                : `
                  <div class="property-placeholder">
                    <span>NEXO</span>
                  </div>
                `
            }

            <div class="property-image-overlay"></div>

            <div class="property-badge">
              ${escapeHTML(
                property.property_type ||
                "Propiedad"
              )}
            </div>

          </div>


          <!-- INFORMACIÓN -->

          <div class="property-content">

            <div class="property-heading">

              <div>

                <h3>
                  ${escapeHTML(
                    property.city ||
                    "Ubicación"
                  )}
                </h3>

                ${
                  property.neighborhood
                    ? `
                      <p class="property-location">
                        ${escapeHTML(
                          property.neighborhood
                        )}
                      </p>
                    `
                    : ""
                }

              </div>

            </div>


            <!-- CARACTERÍSTICAS -->

            <div class="property-details">

              ${
                property.bedrooms !== null &&
                property.bedrooms !== undefined
                  ? `
                    <span>
                      <span class="detail-icon">
                        🛏️
                      </span>

                      ${property.bedrooms}
                      ${
                        Number(property.bedrooms) === 1
                          ? " habitación"
                          : " habitaciones"
                      }
                    </span>
                  `
                  : ""
              }


              ${
                property.bathrooms !== null &&
                property.bathrooms !== undefined
                  ? `
                    <span>
                      <span class="detail-icon">
                        🚿
                      </span>

                      ${property.bathrooms}
                      ${
                        Number(property.bathrooms) === 1
                          ? " baño"
                          : " baños"
                      }
                    </span>
                  `
                  : ""
              }


              ${
                property.square_meters !== null &&
                property.square_meters !== undefined
                  ? `
                    <span>
                      <span class="detail-icon">
                        📐
                      </span>

                      ${property.square_meters} m²
                    </span>
                  `
                  : ""
              }

            </div>


            <!-- PRECIO -->

            <div class="property-bottom">

              <div class="property-price">

                <small>
                  Precio
                </small>

                <strong>
                  ${price}
                </strong>

              </div>


              <button
                type="button"
                class="property-button"
                onclick="viewProperty(${property.id})"
              >
                Ver propiedad
                <span>→</span>
              </button>

            </div>

          </div>

        </article>

      `;

    })
    .join("");
}


/* ==========================================
   FOTOS
========================================== */

function parsePhotos(value) {

  if (!value) {
    return [];
  }


  if (Array.isArray(value)) {

    return value
      .filter(photo =>
        typeof photo === "string" &&
        photo.trim()
      )
      .map(photo => photo.trim());

  }


  if (typeof value === "string") {

    const cleanValue =
      value.trim();


    if (!cleanValue) {
      return [];
    }


    try {

      const parsed =
        JSON.parse(cleanValue);


      if (Array.isArray(parsed)) {

        return parsed
          .filter(photo =>
            typeof photo === "string" &&
            photo.trim()
          )
          .map(photo => photo.trim());

      }

    } catch (error) {

      /*
        Si photos no es JSON,
        intentamos interpretarlo
        como una URL individual.
      */

      if (
        cleanValue.startsWith("http://") ||
        cleanValue.startsWith("https://")
      ) {
        return [cleanValue];
      }

    }

  }


  return [];
}


/* ==========================================
   FORMATO DEL PRECIO
========================================== */

function formatPrice(price) {

  if (
    price === null ||
    price === undefined ||
    price === ""
  ) {
    return "Consultar";
  }


  const numericPrice =
    Number(price);


  if (!Number.isFinite(numericPrice)) {
    return "Consultar";
  }


  return numericPrice.toLocaleString(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }
  );
}


/* ==========================================
   VER PROPIEDAD
========================================== */

async function viewProperty(id) {

  if (!id) {
    return;
  }


  try {

    const response =
      await fetch(
        `${API_URL}/api/properties/${id}`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Error HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    if (!data.success) {

      throw new Error(
        data.error ||
        "No se pudo cargar la propiedad."
      );

    }


    const property =
      data.property;


    /*
      Por ahora mostramos la información
      en una ventana sencilla.

      Más adelante reemplazaremos esto
      por una página individual premium
      para cada propiedad.
    */

    const title =
      property.property_type ||
      "Propiedad";


    const location =
      [
        property.city,
        property.neighborhood
      ]
        .filter(Boolean)
        .join(" · ");


    const description =
      property.description ||
      "Sin descripción disponible.";


    const price =
      formatPrice(property.price);


    alert(
      `${title}\n\n` +
      `${location}\n\n` +
      `${price}\n\n` +
      `${description}`
    );


  } catch (error) {

    console.error(
      "NEXO:",
      error
    );


    alert(
      "No se pudo cargar la propiedad."
    );

  }
}


/* ==========================================
   SEGURIDAD
========================================== */

function escapeHTML(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );
}


function escapeAttribute(value) {

  return escapeHTML(value);
}


/* ==========================================
   INICIAR NEXO
========================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    loadProperties();

  }
);