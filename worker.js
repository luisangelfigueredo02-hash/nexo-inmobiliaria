export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================================================
    // RESPUESTA JSON
    // =========================================================

    function json(data, status = 200, extraHeaders = {}) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          ...corsHeaders,
          ...extraHeaders
        }
      });
    }

    // =========================================================
    // AUTENTICACIÓN ADMIN
    // =========================================================

    async function createAdminToken() {
      if (!env.ADMIN) return null;

      const encoder = new TextEncoder();

      const keyData = encoder.encode(env.ADMIN);
      const messageData =
        encoder.encode("NEXO-ADMIN-SESSION");

      const key =
        await crypto.subtle.importKey(
          "raw",
          keyData,
          {
            name: "HMAC",
            hash: "SHA-256"
          },
          false,
          ["sign"]
        );

      const signature =
        await crypto.subtle.sign(
          "HMAC",
          key,
          messageData
        );

      const bytes =
        new Uint8Array(signature);

      return btoa(
        String.fromCharCode(...bytes)
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }

    async function isAdminAuthenticated(request) {
      if (!env.ADMIN) return false;

      const cookieHeader =
        request.headers.get("Cookie") || "";

      const match =
        cookieHeader.match(
          /(?:^|;\s*)nexo_admin=([^;]+)/
        );

      if (!match) return false;

      const expectedToken =
        await createAdminToken();

      return match[1] === expectedToken;
    }

    // =========================================================
    // GEOCODIFICACIÓN
    // =========================================================

    /*
      NEXO utiliza Nominatim / OpenStreetMap.

      Objetivo:

      Dirección
      +
      Municipio/Zona
      +
      Ciudad
      +
      Provincia
      +
      Cuba

      -> latitude
      -> longitude

      Si no encuentra una ubicación fiable:
      latitude = null
      longitude = null

      NEXO NO inventará coordenadas.
    */

    function cleanText(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .trim()
        .replace(/\s+/g, " ");
    }

    function buildAddressQueries(data) {
      const address =
        cleanText(data.address);

      const neighborhood =
        cleanText(data.neighborhood);

      const city =
        cleanText(data.city);

      const province =
        cleanText(data.province);

      const queries = [];

      // -------------------------------------------------------
      // 1. Dirección más completa
      // -------------------------------------------------------

      if (address) {
        queries.push(
          [
            address,
            neighborhood,
            city,
            province,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 2. Dirección + ciudad
      // -------------------------------------------------------

      if (
        address &&
        city
      ) {
        queries.push(
          [
            address,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 3. Dirección + zona + Cuba
      // -------------------------------------------------------

      if (
        address &&
        neighborhood
      ) {
        queries.push(
          [
            address,
            neighborhood,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 4. Zona + ciudad + Cuba
      // -------------------------------------------------------

      if (
        neighborhood &&
        city
      ) {
        queries.push(
          [
            neighborhood,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 5. Ciudad + Cuba
      // -------------------------------------------------------

      if (city) {
        queries.push(
          [
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // Eliminar duplicados
      return [
        ...new Set(
          queries.filter(Boolean)
        )
      ];
    }

    function normalizeForComparison(value) {
      return cleanText(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    }

    function resultLooksRelevant(result, data) {
      if (!result) return false;

      const display =
        normalizeForComparison(
          result.display_name || ""
        );

      const city =
        normalizeForComparison(
          data.city || ""
        );

      const neighborhood =
        normalizeForComparison(
          data.neighborhood || ""
        );

      // Debe existir Cuba en el resultado
      if (
        !display.includes("cuba")
      ) {
        return false;
      }

      // Si especificamos ciudad,
      // intentamos comprobar que aparezca.
      if (
        city &&
        !display.includes(city)
      ) {
        // No rechazamos completamente porque
        // Nominatim puede devolver nombres
        // administrativos diferentes.
        return true;
      }

      // Si existe barrio/zona y aparece,
      // es una señal positiva.
      if (
        neighborhood &&
        display.includes(neighborhood)
      ) {
        return true;
      }

      return true;
    }

    async function geocodeProperty(data) {
      const queries =
        buildAddressQueries(data);

      if (!queries.length) {
        return {
          latitude: null,
          longitude: null,
          found: false,
          query: null,
          display_name: null
        };
      }

      /*
        Nominatim tiene una política de uso limitada.
        No hacemos búsquedas masivas.
        Una publicación/actualización = una búsqueda
        principal. Si falla, usamos alternativas dentro
        de la misma operación solamente cuando sea necesario.
      */

      for (
        let i = 0;
        i < queries.length;
        i++
      ) {
        const query =
          queries[i];

        try {
          const searchURL =
            new URL(
              "https://nominatim.openstreetmap.org/search"
            );

          searchURL.searchParams.set(
            "q",
            query
          );

          searchURL.searchParams.set(
            "format",
            "jsonv2"
          );

          searchURL.searchParams.set(
            "limit",
            "3"
          );

          searchURL.searchParams.set(
            "addressdetails",
            "1"
          );

          searchURL.searchParams.set(
            "countrycodes",
            "cu"
          );

          const response =
            await fetch(
              searchURL.toString(),
              {
                method: "GET",
                headers: {
                  "Accept":
                    "application/json",
                  "User-Agent":
                    "NEXO-Inmueble/1.0 (https://nexo-inmobiliaria.luisangelfigueredo02.workers.dev)"
                },
                cf: {
                  cacheTtl: 3600,
                  cacheEverything: false
                }
              }
            );

          if (!response.ok) {
            console.error(
              "NEXO GEOCODE HTTP:",
              response.status,
              query
            );

            continue;
          }

          const results =
            await response.json();

          if (
            !Array.isArray(results) ||
            !results.length
          ) {
            continue;
          }

          const validResult =
            results.find(
              result =>
                resultLooksRelevant(
                  result,
                  data
                )
            );

          if (!validResult) {
            continue;
          }

          const latitude =
            Number(
              validResult.lat
            );

          const longitude =
            Number(
              validResult.lon
            );

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            continue;
          }

          return {
            latitude,
            longitude,
            found: true,
            query,
            display_name:
              validResult.display_name ||
              null
          };
        } catch (error) {
          console.error(
            "NEXO GEOCODE ERROR:",
            error
          );
        }
      }

      return {
        latitude: null,
        longitude: null,
        found: false,
        query:
          queries[0] || null,
        display_name: null
      };
    }

    // =========================================================
    // PÁGINA DE LOGIN
    // =========================================================

    const loginPage = `
<!DOCTYPE html>
<html lang="es">
<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>NEXO — Acceso</title>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 20px;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background: #f5f5f3;
  color: #171717;
}

.login {

  width: 100%;
  max-width: 390px;

  background: #ffffff;

  border: 1px solid #e7e7e7;

  border-radius: 24px;

  padding: 32px;

  box-shadow:
    0 20px 60px rgba(0,0,0,.08);
}

.logo {

  font-size: 32px;
  font-weight: 800;

  letter-spacing: 5px;

  margin-bottom: 8px;
}

.subtitle {

  color: #777;

  margin-bottom: 30px;

  line-height: 1.5;
}

label {

  display: block;

  font-size: 14px;

  font-weight: 600;

  margin-bottom: 8px;
}

input {

  width: 100%;

  padding: 15px;

  border: 1px solid #ddd;

  border-radius: 12px;

  font-size: 16px;

  outline: none;
}

input:focus {
  border-color: #171717;
}

button {

  width: 100%;

  margin-top: 16px;

  padding: 15px;

  border: 0;

  border-radius: 12px;

  background: #171717;

  color: white;

  font-size: 16px;

  font-weight: 700;

  cursor: pointer;
}

button:disabled {

  opacity: .6;

  cursor: not-allowed;
}

.error {

  margin-top: 15px;

  padding: 12px;

  border-radius: 10px;

  background: #fdeaea;

  color: #9b1c1c;

  display: none;
}

.error.show {
  display: block;
}

</style>

</head>

<body>

<div class="login">

<div class="logo">
NEXO
</div>

<div class="subtitle">
Acceso al panel de administración
</div>

<form id="loginForm">

<label for="password">
Contraseña
</label>

<input
  id="password"
  type="password"
  autocomplete="current-password"
  placeholder="Introduce tu contraseña"
  required
>

<button
  id="loginButton"
  type="submit"
>
Entrar
</button>

<div
  id="error"
  class="error"
></div>

</form>

</div>

<script>

const form =
  document.getElementById("loginForm");

const password =
  document.getElementById("password");

const button =
  document.getElementById("loginButton");

const error =
  document.getElementById("error");

form.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    error.classList.remove("show");

    error.textContent = "";

    button.disabled = true;

    button.textContent =
      "Comprobando...";

    try {

      const response =
        await fetch(
          "/api/admin/login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            credentials:
              "same-origin",

            body:
              JSON.stringify({
                password:
                  password.value
              })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.error ||
          "Contraseña incorrecta."
        );
      }

      window.location.href =
        "/admin.html";

    } catch (err) {

      error.textContent =
        err.message ||
        "No se pudo iniciar sesión.";

      error.classList.add("show");

      password.value = "";

      password.focus();

    } finally {

      button.disabled = false;

      button.textContent =
        "Entrar";
    }
  }
);

</script>

</body>
</html>
`;

    // =========================================================
    // LOGIN
    // =========================================================

    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const password =
          typeof body.password === "string"
            ? body.password
            : "";

        if (!env.ADMIN) {

          return json(
            {
              success: false,
              error:
                "La contraseña de administrador no está configurada."
            },
            500
          );
        }

        if (
          password !== env.ADMIN
        ) {

          return json(
            {
              success: false,
              error:
                "Contraseña incorrecta."
            },
            401
          );
        }

        const token =
          await createAdminToken();

        return json(
          {
            success: true
          },
          200,
          {
            "Set-Cookie":
              `nexo_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
          }
        );

      } catch (error) {

        console.error(
          "NEXO LOGIN:",
          error
        );

        return json(
          {
            success: false,
            error:
              "Solicitud de inicio de sesión inválida."
          },
          400
        );
      }
    }

    // =========================================================
    // LOGOUT
    // =========================================================

    if (
      url.pathname === "/api/admin/logout" &&
      request.method === "POST"
    ) {

      return json(
        {
          success: true
        },
        200,
        {
          "Set-Cookie":
            "nexo_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
        }
      );
    }

    // =========================================================
    // PROTEGER ADMIN
    // =========================================================

    if (
      url.pathname === "/admin" ||
      url.pathname === "/admin.html"
    ) {

      const authenticated =
        await isAdminAuthenticated(
          request
        );

      if (!authenticated) {

        return new Response(
          loginPage,
          {
            status: 200,
            headers: {
              "Content-Type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }
    }

    // =========================================================
    // PROTEGER ESCRITURA
    // =========================================================

    const isWriteOperation =
      [
        "POST",
        "PUT",
        "DELETE"
      ].includes(
        request.method
      );

    const isPropertyApi =
      url.pathname ===
        "/api/properties" ||
      url.pathname.startsWith(
        "/api/properties/"
      );

    if (
      isWriteOperation &&
      isPropertyApi
    ) {

      const authenticated =
        await isAdminAuthenticated(
          request
        );

      if (!authenticated) {

        return json(
          {
            success: false,
            error:
              "No autorizado."
          },
          401
        );
      }
    }

    // =========================================================
    // OBTENER TODAS LAS PROPIEDADES
    // =========================================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "GET"
    ) {

      try {

        const result =
          await env.DB
            .prepare(`
              SELECT
                id,
                property_type,
                city,
                neighborhood,
                address,
                latitude,
                longitude,
                bedrooms,
                bathrooms,
                square_meters,
                price,
                description,
                photos,
                owner_name,
                owner_phone,
                notes,
                status,
                created_at
              FROM properties
              WHERE status = 'available'
              ORDER BY created_at DESC
            `)
            .all();

        return json(
          {
            success: true,
            properties:
              result.results || []
          }
        );

      } catch (error) {

        console.error(
          "NEXO GET:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudieron obtener las propiedades."
          },
          500
        );
      }
    }

    // =========================================================
    // CREAR PROPIEDAD
    // =========================================================

    if (
      url.pathname === "/api/properties" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const propertyType =
          cleanText(
            body.property_type
          );

        const city =
          cleanText(
            body.city
          );

        const province =
          cleanText(
            body.province
          );

        const neighborhood =
          cleanText(
            body.neighborhood
          );

        const address =
          cleanText(
            body.address
          );

        if (
          !propertyType ||
          !city
        ) {

          return json(
            {
              success: false,
              error:
                "El tipo de propiedad y la ciudad son obligatorios."
            },
            400
          );
        }

        // =====================================================
        // NÚMEROS
        // =====================================================

        const bedrooms =
          body.bedrooms === "" ||
          body.bedrooms === null ||
          body.bedrooms === undefined
            ? null
            : Number(body.bedrooms);

        const bathrooms =
          body.bathrooms === "" ||
          body.bathrooms === null ||
          body.bathrooms === undefined
            ? null
            : Number(body.bathrooms);

        const squareMeters =
          body.square_meters === "" ||
          body.square_meters === null ||
          body.square_meters === undefined
            ? null
            : Number(body.square_meters);

        const price =
          body.price === "" ||
          body.price === null ||
          body.price === undefined
            ? null
            : Number(body.price);

        // =====================================================
        // TEXTO
        // =====================================================

        const description =
          cleanText(
            body.description
          ) || null;

        /*
          Compatibilidad con el panel actual:

          contact_name
          contact_phone
          contact_email

          y también:

          owner_name
          owner_phone
        */

        const ownerName =
          cleanText(
            body.owner_name ||
            body.contact_name
          ) || null;

        const ownerPhone =
          cleanText(
            body.owner_phone ||
            body.contact_phone
          ) || null;

        const notes =
          cleanText(
            body.notes
          ) || null;

        const status =
          cleanText(
            body.status
          ) || "available";

        // =====================================================
        // FOTOS
        // =====================================================

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {

          if (
            Array.isArray(
              body.photos
            )
          ) {

            photos =
              JSON.stringify(
                body.photos
              );

          } else if (
            typeof body.photos === "string"
          ) {

            try {

              const parsed =
                JSON.parse(
                  body.photos
                );

              photos =
                JSON.stringify(
                  Array.isArray(
                    parsed
                  )
                    ? parsed
                    : [body.photos]
                );

            } catch {

              photos =
                JSON.stringify(
                  body.photos
                    .split(/\n|,/)
                    .map(
                      value =>
                        value.trim()
                    )
                    .filter(Boolean)
                );
            }
          }
        }

        // =====================================================
        // GEOCODIFICACIÓN
        // =====================================================

        let latitude = null;
        let longitude = null;

        let geocodeFound = false;
        let geocodeDisplayName = null;

        if (address) {

          const geocode =
            await geocodeProperty({
              address,
              neighborhood,
              city,
              province
            });

          latitude =
            geocode.latitude;

          longitude =
            geocode.longitude;

          geocodeFound =
            geocode.found;

          geocodeDisplayName =
            geocode.display_name;
        }

        // =====================================================
        // INSERTAR
        // =====================================================

        const result =
          await env.DB
            .prepare(`
              INSERT INTO properties (
                property_type,
                city,
                neighborhood,
                address,
                latitude,
                longitude,
                bedrooms,
                bathrooms,
                square_meters,
                price,
                description,
                photos,
                owner_name,
                owner_phone,
                notes,
                status
              )
              VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?
              )
            `)
            .bind(
              propertyType,
              city,
              neighborhood || null,
              address || null,
              latitude,
              longitude,
              bedrooms,
              bathrooms,
              squareMeters,
              price,
              description,
              photos,
              ownerName,
              ownerPhone,
              notes,
              status
            )
            .run();

        return json(
          {
            success: true,

            message:
              geocodeFound
                ? "Propiedad creada y ubicación encontrada correctamente."
                : "Propiedad creada. No se pudo determinar automáticamente una ubicación exacta.",

            id:
              result.meta?.last_row_id ||
              null,

            location: {
              found:
                geocodeFound,

              latitude,

              longitude,

              display_name:
                geocodeDisplayName
            }
          },
          201
        );

      } catch (error) {

        console.error(
          "NEXO CREATE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo crear la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // EDITAR PROPIEDAD
    // =========================================================

    if (
      url.pathname.startsWith(
        "/api/properties/"
      ) &&
      request.method === "PUT"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

        return json(
          {
            success: false,
            error:
              "ID de propiedad inválido."
          },
          400
        );
      }

      try {

        const body =
          await request.json();

        const propertyType =
          cleanText(
            body.property_type
          );

        const city =
          cleanText(
            body.city
          );

        const province =
          cleanText(
            body.province
          );

        const neighborhood =
          cleanText(
            body.neighborhood
          );

        const address =
          cleanText(
            body.address
          );

        if (
          !propertyType ||
          !city
        ) {

          return json(
            {
              success: false,
              error:
                "El tipo de propiedad y la ciudad son obligatorios."
            },
            400
          );
        }

        const bedrooms =
          body.bedrooms === "" ||
          body.bedrooms === null ||
          body.bedrooms === undefined
            ? null
            : Number(body.bedrooms);

        const bathrooms =
          body.bathrooms === "" ||
          body.bathrooms === null ||
          body.bathrooms === undefined
            ? null
            : Number(body.bathrooms);

        const squareMeters =
          body.square_meters === "" ||
          body.square_meters === null ||
          body.square_meters === undefined
            ? null
            : Number(body.square_meters);

        const price =
          body.price === "" ||
          body.price === null ||
          body.price === undefined
            ? null
            : Number(body.price);

        const description =
          cleanText(
            body.description
          ) || null;

        const ownerName =
          cleanText(
            body.owner_name ||
            body.contact_name
          ) || null;

        const ownerPhone =
          cleanText(
            body.owner_phone ||
            body.contact_phone
          ) || null;

        const notes =
          cleanText(
            body.notes
          ) || null;

        const status =
          cleanText(
            body.status
          ) || "available";

        // =====================================================
        // FOTOS
        // =====================================================

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {

          if (
            Array.isArray(
              body.photos
            )
          ) {

            photos =
              JSON.stringify(
                body.photos
              );

          } else if (
            typeof body.photos === "string"
          ) {

            try {

              const parsed =
                JSON.parse(
                  body.photos
                );

              photos =
                JSON.stringify(
                  Array.isArray(
                    parsed
                  )
                    ? parsed
                    : [body.photos]
                );

            } catch {

              photos =
                JSON.stringify(
                  body.photos
                    .split(/\n|,/)
                    .map(
                      value =>
                        value.trim()
                    )
                    .filter(Boolean)
                );
            }
          }
        }

        // =====================================================
        // GEOCODIFICAR NUEVAMENTE
        // =====================================================

        let latitude = null;
        let longitude = null;

        if (address) {

          const geocode =
            await geocodeProperty({
              address,
              neighborhood,
              city,
              province
            });

          latitude =
            geocode.latitude;

          longitude =
            geocode.longitude;
        }

        // =====================================================
        // UPDATE
        // =====================================================

        const result =
          await env.DB
            .prepare(`
              UPDATE properties

              SET
                property_type = ?,
                city = ?,
                neighborhood = ?,
                address = ?,
                latitude = ?,
                longitude = ?,
                bedrooms = ?,
                bathrooms = ?,
                square_meters = ?,
                price = ?,
                description = ?,
                photos = ?,
                owner_name = ?,
                owner_phone = ?,
                notes = ?,
                status = ?

              WHERE id = ?
            `)
            .bind(
              propertyType,
              city,
              neighborhood || null,
              address || null,
              latitude,
              longitude,
              bedrooms,
              bathrooms,
              squareMeters,
              price,
              description,
              photos,
              ownerName,
              ownerPhone,
              notes,
              status,
              Number(id)
            )
            .run();

        if (
          !result.meta?.changes
        ) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json(
          {
            success: true,
            message:
              "Propiedad actualizada correctamente.",
            latitude,
            longitude
          }
        );

      } catch (error) {

        console.error(
          "NEXO UPDATE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo actualizar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // ELIMINAR PROPIEDAD
    // =========================================================

    if (
      url.pathname.startsWith(
        "/api/properties/"
      ) &&
      request.method === "DELETE"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

        return json(
          {
            success: false,
            error:
              "ID de propiedad inválido."
          },
          400
        );
      }

      try {

        const result =
          await env.DB
            .prepare(`
              DELETE FROM properties
              WHERE id = ?
            `)
            .bind(
              Number(id)
            )
            .run();

        if (
          !result.meta?.changes
        ) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json(
          {
            success: true,
            message:
              "Propiedad eliminada correctamente."
          }
        );

      } catch (error) {

        console.error(
          "NEXO DELETE:",
          error
        );

        return json(
          {
            success: false,
            error:
              "No se pudo eliminar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // PROPIEDAD INDIVIDUAL
    // =========================================================

    if (
      url.pathname.startsWith(
        "/api/properties/"
      ) &&
      request.method === "GET"
    ) {

      const id =
        url.pathname
          .split("/")
          .pop();

      if (
        !id ||
        !/^\d+$/.test(id)
      ) {

        return json(
          {
            success: false,
            error:
              "ID de propiedad inválido."
          },
          400
        );
      }

      try {

        const property =
          await env.DB
            .prepare(`
              SELECT
                id,
                property_type,
                city,
                neighborhood,
                address,
                latitude,
                longitude,
                bedrooms,
                bathrooms,
                square_meters,
                price,
                description,
                photos,
                owner_name,
                owner_phone,
                notes,
                status,
                created_at
              FROM properties
              WHERE id = ?
            `)
            .bind(
              Number(id)
            )
            .first();

        if (!property) {

          return json(
            {
              success: false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json(
          {
            success: true,
            property
          }
        );

      } catch (error) {

        console.error(
          "NEXO PROPERTY:",
          error
        );

        return json(
          {
            success: false,
            error:
              "Error al consultar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    return env.ASSETS.fetch(
      request
    );
  }
};