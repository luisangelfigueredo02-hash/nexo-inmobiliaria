export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type"
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

    function json(
      data,
      status = 200,
      extraHeaders = {}
    ) {

      return new Response(
        JSON.stringify(data),
        {
          status,

          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",

            ...corsHeaders,
            ...extraHeaders
          }
        }
      );
    }

    // =========================================================
    // AUTENTICACIÓN ADMIN
    // =========================================================

    async function createAdminToken() {

      if (!env.ADMIN) {
        return null;
      }

      const encoder =
        new TextEncoder();

      const keyData =
        encoder.encode(env.ADMIN);

      const messageData =
        encoder.encode(
          "NEXO-ADMIN-SESSION"
        );

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

    async function isAdminAuthenticated(
      request
    ) {

      if (!env.ADMIN) {
        return false;
      }

      const cookieHeader =
        request.headers.get("Cookie") || "";

      const match =
        cookieHeader.match(
          /(?:^|;\s*)nexo_admin=([^;]+)/
        );

      if (!match) {
        return false;
      }

      const expectedToken =
        await createAdminToken();

      return (
        match[1] === expectedToken
      );
    }

    // =========================================================
    // GEOCODIFICACIÓN AUTOMÁTICA
    // =========================================================
    //
    // Dirección
    //     ↓
    // Nominatim / OpenStreetMap
    //     ↓
    // latitude + longitude
    //
    // IMPORTANTE:
    // Esta función solo se ejecuta al crear una propiedad
    // o cuando cambian sus datos de ubicación.
    //
    // =========================================================

    async function geocodeProperty({
      address,
      neighborhood,
      city
    }) {

      const parts = [
        address,
        neighborhood,
        city,
        "La Habana",
        "Cuba"
      ]
        .filter(
          value =>
            typeof value === "string" &&
            value.trim()
        )
        .map(
          value => value.trim()
        );

      const searchText =
        [...new Set(parts)]
          .join(", ");

      if (!searchText) {

        return {
          success: false,
          reason:
            "No hay suficiente información de dirección."
        };
      }

      try {

        const nominatimUrl =
          new URL(
            "https://nominatim.openstreetmap.org/search"
          );

        nominatimUrl.searchParams.set(
          "q",
          searchText
        );

        nominatimUrl.searchParams.set(
          "format",
          "jsonv2"
        );

        nominatimUrl.searchParams.set(
          "addressdetails",
          "1"
        );

        nominatimUrl.searchParams.set(
          "limit",
          "5"
        );

        nominatimUrl.searchParams.set(
          "countrycodes",
          "cu"
        );

        const response =
          await fetch(
            nominatimUrl.toString(),
            {
              method: "GET",

              headers: {
                "Accept":
                  "application/json",

                "User-Agent":
                  "NEXO-Inmueble/1.0 (https://nexo-inmobiliaria.luisangelfigueredo02.workers.dev/)"
              }
            }
          );

        if (!response.ok) {

          console.error(
            "NEXO NOMINATIM HTTP:",
            response.status
          );

          return {
            success: false,
            reason:
              "El servicio de ubicación no respondió correctamente."
          };
        }

        const results =
          await response.json();

        if (
          !Array.isArray(results) ||
          results.length === 0
        ) {

          return {
            success: false,
            reason:
              "No se encontró una ubicación suficientemente clara para esa dirección."
          };
        }

        // =====================================================
        // BUSCAR EL MEJOR RESULTADO
        // =====================================================

        let selected =
          null;

        for (
          const result of results
        ) {

          const lat =
            Number(result.lat);

          const lon =
            Number(result.lon);

          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon)
          ) {
            continue;
          }

          const addressData =
            result.address || {};

          const resultCountry =
            String(
              addressData.country_code || ""
            ).toLowerCase();

          if (
            resultCountry === "cu"
          ) {

            selected = result;
            break;
          }
        }

        if (!selected) {

          selected =
            results.find(
              result =>
                Number.isFinite(
                  Number(result.lat)
                ) &&
                Number.isFinite(
                  Number(result.lon)
                )
            );
        }

        if (!selected) {

          return {
            success: false,
            reason:
              "La búsqueda no devolvió coordenadas válidas."
          };
        }

        const latitude =
          Number(selected.lat);

        const longitude =
          Number(selected.lon);

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {

          return {
            success: false,
            reason:
              "Las coordenadas obtenidas no son válidas."
          };
        }

        // =====================================================
        // INFORMACIÓN DEVUELTA
        // =====================================================

        return {
          success: true,

          latitude,

          longitude,

          display_name:
            selected.display_name ||
            searchText,

          importance:
            selected.importance ??
            null,

          place_id:
            selected.place_id ??
            null
        };

      } catch (error) {

        console.error(
          "NEXO GEOCODING:",
          error
        );

        return {
          success: false,

          reason:
            "No fue posible consultar el servicio de ubicación."
        };
      }
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
        0 20px 60px rgba(0, 0, 0, .08);
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

      error.classList.add(
        "show"
      );

      password.value = "";

      password.focus();

    } finally {

      button.disabled = false;

      button.textContent =
        "Entrar";
    }

  });

</script>

</body>
</html>
`;

    // =========================================================
    // LOGIN
    // =========================================================

    if (
      url.pathname ===
        "/api/admin/login" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const password =
          typeof body.password ===
            "string"
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
      url.pathname ===
        "/api/admin/logout" &&
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
    // PROTEGER PANEL ADMIN
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
    // OBTENER PROPIEDADES
    // =========================================================

    if (
      url.pathname ===
        "/api/properties" &&
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
      url.pathname ===
        "/api/properties" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const propertyType =
          typeof body.property_type ===
            "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city ===
            "string"
            ? body.city.trim()
            : "";

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

        const neighborhood =
          typeof body.neighborhood ===
            "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address ===
            "string"
            ? body.address.trim()
            : null;

        // =====================================================
        // GEOCODIFICAR AUTOMÁTICAMENTE
        // =====================================================

        let latitude = null;

        let longitude = null;

        let geocoding = null;

        if (
          address ||
          neighborhood ||
          city
        ) {

          geocoding =
            await geocodeProperty({
              address,
              neighborhood,
              city
            });

          if (
            geocoding.success
          ) {

            latitude =
              geocoding.latitude;

            longitude =
              geocoding.longitude;
          }
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
          typeof body.description ===
            "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.owner_name ===
            "string"
            ? body.owner_name.trim()
            : null;

        const ownerPhone =
          typeof body.owner_phone ===
            "string"
            ? body.owner_phone.trim()
            : null;

        const notes =
          typeof body.notes ===
            "string"
            ? body.notes.trim()
            : null;

        const status =
          typeof body.status ===
            "string" &&
          body.status.trim()
            ? body.status.trim()
            : "available";

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {

          photos =
            typeof body.photos ===
              "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
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
              neighborhood,
              address,
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

        // =====================================================
        // RESPUESTA
        // =====================================================

        if (
          geocoding &&
          !geocoding.success
        ) {

          return json(
            {
              success: true,

              message:
                "Propiedad creada, pero no se pudo determinar automáticamente su ubicación.",

              warning:
                geocoding.reason,

              geocoded: false,

              id:
                result.meta?.last_row_id ||
                null
            },
            201
          );
        }

        return json(
          {
            success: true,

            message:
              "Propiedad creada correctamente.",

            geocoded:
              Boolean(
                geocoding?.success
              ),

            latitude,

            longitude,

            location:
              geocoding?.display_name ||
              null,

            id:
              result.meta?.last_row_id ||
              null
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
          typeof body.property_type ===
            "string"
            ? body.property_type.trim()
            : "";

        const city =
          typeof body.city ===
            "string"
            ? body.city.trim()
            : "";

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

        const neighborhood =
          typeof body.neighborhood ===
            "string"
            ? body.neighborhood.trim()
            : null;

        const address =
          typeof body.address ===
            "string"
            ? body.address.trim()
            : null;

        // =====================================================
        // OBTENER PROPIEDAD ACTUAL
        // =====================================================

        const existing =
          await env.DB
            .prepare(`
              SELECT
                id,
                city,
                neighborhood,
                address,
                latitude,
                longitude
              FROM properties
              WHERE id = ?
            `)
            .bind(Number(id))
            .first();

        if (!existing) {

          return json(
            {
              success: false,

              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        // =====================================================
        // DETECTAR CAMBIOS DE UBICACIÓN
        // =====================================================

        const oldAddress =
          existing.address || "";

        const oldNeighborhood =
          existing.neighborhood || "";

        const oldCity =
          existing.city || "";

        const newAddress =
          address || "";

        const newNeighborhood =
          neighborhood || "";

        const newCity =
          city || "";

        const locationChanged =
          oldAddress !== newAddress ||
          oldNeighborhood !==
            newNeighborhood ||
          oldCity !== newCity;

        let latitude =
          existing.latitude ?? null;

        let longitude =
          existing.longitude ?? null;

        let geocoding = null;

        // =====================================================
        // SOLO GEOCODIFICAR SI ES NECESARIO
        // =====================================================

        if (
          locationChanged ||
          latitude === null ||
          longitude === null
        ) {

          geocoding =
            await geocodeProperty({
              address,
              neighborhood,
              city
            });

          if (
            geocoding.success
          ) {

            latitude =
              geocoding.latitude;

            longitude =
              geocoding.longitude;

          } else {

            // Si no encontramos nueva ubicación
            // y la dirección cambió, no conservamos
            // coordenadas antiguas que corresponderían
            // a otra dirección.

            if (
              locationChanged
            ) {

              latitude = null;

              longitude = null;
            }
          }
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
          typeof body.description ===
            "string"
            ? body.description.trim()
            : null;

        const ownerName =
          typeof body.owner_name ===
            "string"
            ? body.owner_name.trim()
            : null;

        const ownerPhone =
          typeof body.owner_phone ===
            "string"
            ? body.owner_phone.trim()
            : null;

        const notes =
          typeof body.notes ===
            "string"
            ? body.notes.trim()
            : null;

        const status =
          typeof body.status ===
            "string" &&
          body.status.trim()
            ? body.status.trim()
            : "available";

        let photos = "[]";

        if (
          body.photos !== undefined &&
          body.photos !== null
        ) {

          photos =
            typeof body.photos ===
              "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
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
              neighborhood,
              address,
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

        // =====================================================
        // RESPUESTA CON ADVERTENCIA
        // =====================================================

        if (
          geocoding &&
          !geocoding.success
        ) {

          return json(
            {
              success: true,

              message:
                "Propiedad actualizada, pero no se pudo determinar automáticamente su ubicación.",

              warning:
                geocoding.reason,

              geocoded: false,

              latitude: null,

              longitude: null
            }
          );
        }

        return json(
          {
            success: true,

            message:
              "Propiedad actualizada correctamente.",

            geocoded:
              geocoding
                ? Boolean(
                    geocoding.success
                  )
                : Boolean(
                    latitude !== null &&
                    longitude !== null
                  ),

            latitude,

            longitude,

            location:
              geocoding?.display_name ||
              null
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
            .bind(Number(id))
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
                AND status = 'available'
            `)
            .bind(Number(id))
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