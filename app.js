const API_URL =
  "https://nexo-inmobiliaria.luisangelfigueredo02.workers.dev";

async function loadProperties() {
  const section = document.querySelector("#propiedades");

  if (!section) {
    console.error("NEXO: no existe #propiedades");
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/api/properties`
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        data.error || "No se pudieron cargar las propiedades."
      );
    }

    renderProperties(
      section,
      data.properties || []
    );

  } catch (error) {
    console.error("NEXO:", error);

    let grid =
      section.querySelector(".properties-grid");

    if (!grid) {
      grid = document.createElement("div");
      grid.className = "properties-grid";
      section.appendChild(grid);
    }

    grid.innerHTML = `
      <div class="nexo-empty">
        No se pudieron cargar las propiedades.
      </div>
    `;
  }
}


function renderProperties(section, properties) {

  let grid =
    section.querySelector(".properties-grid");

  if (!grid) {
    grid = document.createElement("div");
    grid.className = "properties-grid";
    section.appendChild(grid);
  }


  if (!properties.length) {
    grid.innerHTML = `
      <div class="nexo-empty">
        Actualmente no hay propiedades disponibles.
      </div>
    `;

    return;
  }


  grid.innerHTML = properties
    .map(property => {

      const price =
        property.price !== null &&
        property.price !== undefined
          ? Number(property.price).toLocaleString(
              "en-US",
              {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0
              }
            )
          : "Consultar precio";


      return `
        <article class="property-card">

          <div class="property-image">
            <div class="property-placeholder">
              NEXO
            </div>
          </div>

          <div class="property-content">

            <span class="property-type">
              ${escapeHTML(
                property.property_type || ""
              )}
            </span>

            <h3>
              ${escapeHTML(
                property.city || ""
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

            <div class="property-details">

              ${
                property.bedrooms != null
                  ? `
                    <span>
                      🛏 ${property.bedrooms}
                    </span>
                  `
                  : ""
              }

              ${
                property.bathrooms != null
                  ? `
                    <span>
                      🚿 ${property.bathrooms}
                    </span>
                  `
                  : ""
              }

              ${
                property.square_meters != null
                  ? `
                    <span>
                      📐 ${property.square_meters} m²
                    </span>
                  `
                  : ""
              }

            </div>

            <div class="property-bottom">

              <strong>
                ${price}
              </strong>

              <button
                type="button"
                onclick="viewProperty(${property.id})"
              >
                Ver propiedad
              </button>

            </div>

          </div>

        </article>
      `;

    })
    .join("");
}


async function viewProperty(id) {

  try {

    const response =
      await fetch(
        `${API_URL}/api/properties/${id}`
      );

    const data =
      await response.json();

    if (!data.success) {
      alert(
        data.error ||
        "No se pudo cargar la propiedad."
      );

      return;
    }

    const property =
      data.property;

    alert(
      `${property.property_type || ""}\n` +
      `${property.city || ""}` +
      `${
        property.neighborhood
          ? " — " +
            property.neighborhood
          : ""
      }\n\n` +
      `${property.description || ""}`
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


function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


document.addEventListener(
  "DOMContentLoaded",
  loadProperties
);