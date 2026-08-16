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
        "Content-Type, Accept"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================================================
    // JSON
    // =========================================================

    function json(data, status = 200, extraHeaders = {}) {

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
    // AUTENTICACIÓN
    // =========================================================

    async function createAdminToken() {

      if (!env.ADMIN) {
        return null;
      }

      const encoder =
        new TextEncoder();

      const key =
        await crypto.subtle.importKey(
          "raw",
          encoder.encode(env.ADMIN),
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
          encoder.encode(
            "NEXO-ADMIN-SESSION"
          )
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

      const expected =
        await createAdminToken();

      return match[1] === expected;
    }

    // =========================================================
    // LOGIN
    // =========================================================

    const loginPage = `
<!DOCTYPE html>
<html lang="es">
<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>NEXO — Acceso</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  background:#f5f5f3;
  color:#171717;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.login{
  width:100%;
  max-width:390px;
  background:white;
  border:1px solid #e7e7e7;
  border-radius:24px;
  padding:32px;
  box-shadow:0 20px 60px rgba(0,0,0,.08);
}

.logo{
  font-size:32px;
  font-weight:800;
  letter-spacing:5px;
  margin-bottom:8px;
}

.subtitle{
  color:#777;
  margin-bottom:30px;
  line-height:1.5;
}

label{
  display:block;
  margin-bottom:8px;
  font-size:14px;
  font-weight:600;
}

input{
  width:100%;
  padding:15px;
  border:1px solid #ddd;
  border-radius:12px;
  font-size:16px;
  outline:none;
}

button{
  width:100%;
  margin-top:16px;
  padding:15px;
  border:0;
  border-radius:12px;
  background:#171717;
  color:white;
  font-size:16px;
  font-weight:700;
}

.error{
  display:none;
  margin-top:15px;
  padding:12px;
  border-radius:10px;
  background:#fdeaea;
  color:#9b1c1c;
}

.error.show{
  display:block;
}

</style>

</head>

<body>

<div class="login">

<div class="logo">NEXO</div>

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

<button id="loginButton">
Entrar
</button>

<div id="error" class="error"></div>

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
async event => {

event.preventDefault();

error.classList.remove("show");

button.disabled = true;
button.textContent = "Comprobando...";

try{

const response =
await fetch(
"/api/admin/login",
{
method:"POST",
headers:{
"Content-Type":
"application/json"
},
credentials:"same-origin",
body:JSON.stringify({
password:password.value
})
}
);

const result =
await response.json();

if(
!response.ok ||
!result.success
){
throw new Error(
result.error ||
"Contraseña incorrecta."
);
}

window.location.href =
"/admin.html";

}catch(err){

error.textContent =
err.message ||
"No se pudo iniciar sesión.";

error.classList.add("show");

password.value="";
password.focus();

}finally{

button.disabled=false;
button.textContent="Entrar";

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
          typeof body.password === "string"
            ? body.password
            : "";

        if (!env.ADMIN) {

          return json(
            {
              success:false,
              error:
                "La contraseña de administrador no está configurada."
            },
            500
          );
        }

        if (password !== env.ADMIN) {

          return json(
            {
              success:false,
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
            success:true
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
            success:false,
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
          success:true
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
        await isAdminAuthenticated(request);

      if (!authenticated) {

        return new Response(
          loginPage,
          {
            status:200,
            headers:{
              "Content-Type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }
    }

    // =========================================================
    // PROTEGER ESCRITURAS
    // =========================================================

    const isWrite =
      ["POST","PUT","DELETE"]
        .includes(request.method);

    const isPropertyAPI =
      url.pathname === "/api/properties" ||
      url.pathname.startsWith(
        "/api/properties/"
      );

    if (
      isWrite &&
      isPropertyAPI
    ) {

      const authenticated =
        await isAdminAuthenticated(request);

      if (!authenticated) {

        return json(
          {
            success:false,
            error:"No autorizado."
          },
          401
        );
      }
    }

    // =========================================================
    // UTILIDADES DE DIRECCIONES
    // =========================================================

    function clean(value) {

      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .trim()
        .replace(/\s+/g," ");
    }

    function normalizeAddress(value) {

      return clean(value)
        .replace(/\bAv\.\s*/gi,"Avenida ")
        .replace(/\bAv\s+/gi,"Avenida ")
        .replace(/\bAve\.\s*/gi,"Avenida ")
        .replace(/\bAve\s+/gi,"Avenida ")
        .replace(/\bNo\.\s*/gi," ")
        .replace(/\bNro\.\s*/gi," ")
        .replace(/\s+/g," ")
        .trim();
    }

    function unique(values) {

      return [
        ...new Set(
          values
            .map(clean)
            .filter(Boolean)
        )
      ];
    }

    // =========================================================
    // GEOCODIFICACIÓN
    // =========================================================

    async function nominatimSearch(query) {

      try {

        const endpoint =
          "https://nominatim.openstreetmap.org/search" +
          "?format=jsonv2" +
          "&limit=5" +
          "&addressdetails=1" +
          "&countrycodes=cu" +
          "&q=" +
          encodeURIComponent(query);

        const response =
          await fetch(
            endpoint,
            {
              headers:{
                "User-Agent":
                  "NEXO-Inmueble/2.0",
                "Accept":
                  "application/json"
              }
            }
          );

        if (!response.ok) {
          return [];
        }

        const data =
          await response.json();

        return Array.isArray(data)
          ? data
          : [];

      } catch(error) {

        console.error(
          "NEXO NOMINATIM:",
          error
        );

        return [];
      }
    }

    function validResult(result) {

      if (!result) {
        return false;
      }

      const lat =
        Number(result.lat);

      const lon =
        Number(result.lon);

      return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= 19 &&
        lat <= 24 &&
        lon >= -85 &&
        lon <= -74
      );
    }

    function scoreResult(
      result,
      city,
      neighborhood,
      address
    ) {

      if (!validResult(result)) {
        return -999;
      }

      const text =
        String(
          result.display_name || ""
        ).toLowerCase();

      let score = 0;

      const cityWords =
        clean(city)
          .toLowerCase()
          .split(/\s+/)
          .filter(x => x.length > 2);

      const neighborhoodWords =
        clean(neighborhood)
          .toLowerCase()
          .split(/\s+/)
          .filter(x => x.length > 2);

      const addressWords =
        normalizeAddress(address)
          .toLowerCase()
          .split(/\s+/)
          .filter(x => x.length > 2);

      for(
        const word of cityWords
      ){

        if(text.includes(word)){
          score += 5;
        }
      }

      for(
        const word of neighborhoodWords
      ){

        if(text.includes(word)){
          score += 8;
        }
      }

      for(
        const word of addressWords
      ){

        if(text.includes(word)){
          score += 3;
        }
      }

      return score;
    }

    async function geocodeAddress({
      city,
      neighborhood,
      address,
      province
    }) {

      city =
        clean(city);

      neighborhood =
        clean(neighborhood);

      address =
        normalizeAddress(address);

      province =
        clean(province);

      if (!address) {

        return {
          success:false,
          latitude:null,
          longitude:null,
          display_name:null,
          query:null,
          confidence:"none"
        };
      }

      const queries = [];

      // -------------------------------------------------------
      // 1. Dirección completa
      // -------------------------------------------------------

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

      // -------------------------------------------------------
      // 2. Dirección + municipio + ciudad
      // -------------------------------------------------------

      if(neighborhood){

        queries.push(
          [
            address,
            neighborhood,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 3. Dirección + ciudad
      // -------------------------------------------------------

      queries.push(
        [
          address,
          city,
          "Cuba"
        ]
          .filter(Boolean)
          .join(", ")
      );

      // -------------------------------------------------------
      // 4. Dirección original sin normalizar
      // -------------------------------------------------------

      const original =
        clean(address)
          .replace(
            /\bAvenida\b/gi,
            "Ave"
          );

      if(original !== address){

        queries.push(
          [
            original,
            neighborhood,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // 5. Calle/avenida + municipio
      // -------------------------------------------------------

      const simplified =
        address
          .replace(
            /entre.*$/i,
            ""
          )
          .replace(
            /edificio.*$/i,
            ""
          )
          .trim();

      if(
        simplified &&
        simplified !== address
      ){

        queries.push(
          [
            simplified,
            neighborhood,
            city,
            "Cuba"
          ]
            .filter(Boolean)
            .join(", ")
        );
      }

      // -------------------------------------------------------
      // Eliminar duplicados
      // -------------------------------------------------------

      const uniqueQueries =
        unique(queries);

      let bestResult = null;
      let bestScore = -999;
      let bestQuery = null;

      // -------------------------------------------------------
      // Buscar
      // -------------------------------------------------------

      for(
        const query
        of uniqueQueries
      ){

        const results =
          await nominatimSearch(query);

        for(
          const result
          of results
        ){

          const score =
            scoreResult(
              result,
              city,
              neighborhood,
              address
            );

          if(score > bestScore){

            bestScore = score;
            bestResult = result;
            bestQuery = query;

          }
        }

        /*
         * Si tenemos una coincidencia bastante buena,
         * no seguimos haciendo llamadas innecesarias.
         */

        if(bestScore >= 18){
          break;
        }
      }

      if(
        bestResult &&
        validResult(bestResult)
      ){

        const latitude =
          Number(bestResult.lat);

        const longitude =
          Number(bestResult.lon);

        return {
          success:true,
          latitude,
          longitude,
          display_name:
            bestResult.display_name ||
            null,
          query:bestQuery,
          confidence:
            bestScore >= 18
              ? "high"
              : bestScore >= 8
                ? "medium"
                : "low"
        };
      }

      return {
        success:false,
        latitude:null,
        longitude:null,
        display_name:null,
        query:null,
        confidence:"none"
      };
    }

    // =========================================================
    // GET TODAS LAS PROPIEDADES
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

        return json({
          success:true,
          properties:
            result.results || []
        });

      } catch(error) {

        console.error(
          "NEXO GET:",
          error
        );

        return json(
          {
            success:false,
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
          clean(body.property_type);

        const city =
          clean(body.city);

        const province =
          clean(body.province);

        const neighborhood =
          clean(body.neighborhood) ||
          null;

        const address =
          clean(body.address) ||
          null;

        if(
          !propertyType ||
          !city
        ){

          return json(
            {
              success:false,
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
          clean(body.description) ||
          null;

        const ownerName =
          clean(
            body.contact_name ??
            body.owner_name
          ) || null;

        const ownerPhone =
          clean(
            body.contact_phone ??
            body.owner_phone
          ) || null;

        const notes =
          clean(body.notes) ||
          null;

        const status =
          clean(body.status) ||
          "available";

        let photos = "[]";

        if(
          body.photos !== null &&
          body.photos !== undefined
        ){

          photos =
            typeof body.photos === "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
        }

        // -----------------------------------------------------
        // GEOCODIFICAR
        // -----------------------------------------------------

        const geo =
          await geocodeAddress({
            city,
            neighborhood,
            address,
            province
          });

        const latitude =
          geo.success
            ? geo.latitude
            : null;

        const longitude =
          geo.success
            ? geo.longitude
            : null;

        // -----------------------------------------------------
        // INSERT
        // -----------------------------------------------------

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
                ?,?,?,?,?,?,
                ?,?,?,?,?,?,
                ?,?,?,?
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

        return json(
          {
            success:true,

            message:
              "Propiedad creada correctamente.",

            id:
              result.meta?.last_row_id ||
              null,

            geocoded:
              geo.success,

            latitude,
            longitude,

            confidence:
              geo.confidence,

            location:
              geo.display_name,

            geocode_query:
              geo.query
          },
          201
        );

      } catch(error) {

        console.error(
          "NEXO CREATE:",
          error
        );

        return json(
          {
            success:false,
            error:
              "No se pudo crear la propiedad.",
            detail:
              error?.message || null
          },
          500
        );
      }
    }

    // =========================================================
    // RE-GEOCODIFICAR PROPIEDAD EXISTENTE
    // =========================================================

    const geocodeMatch =
      url.pathname.match(
        /^\/api\/properties\/(\d+)\/geocode$/
      );

    if(
      geocodeMatch &&
      request.method === "POST"
    ){

      const id =
        Number(
          geocodeMatch[1]
        );

      try{

        const property =
          await env.DB
            .prepare(`
              SELECT
                id,
                city,
                neighborhood,
                address
              FROM properties
              WHERE id = ?
            `)
            .bind(id)
            .first();

        if(!property){

          return json(
            {
              success:false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        const geo =
          await geocodeAddress({
            city:property.city,
            neighborhood:
              property.neighborhood,
            address:
              property.address,
            province:""
          });

        if(!geo.success){

          return json(
            {
              success:false,
              error:
                "NEXO no encontró una coordenada confiable para esta dirección.",
              id,
              latitude:null,
              longitude:null,
              confidence:"none"
            },
            422
          );
        }

        await env.DB
          .prepare(`
            UPDATE properties
            SET
              latitude = ?,
              longitude = ?
            WHERE id = ?
          `)
          .bind(
            geo.latitude,
            geo.longitude,
            id
          )
          .run();

        return json({
          success:true,
          id,
          latitude:
            geo.latitude,
          longitude:
            geo.longitude,
          confidence:
            geo.confidence,
          location:
            geo.display_name,
          query:
            geo.query
        });

      }catch(error){

        console.error(
          "NEXO REGEOCODE:",
          error
        );

        return json(
          {
            success:false,
            error:
              "No se pudo geocodificar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // EDITAR PROPIEDAD
    // =========================================================

    const editMatch =
      url.pathname.match(
        /^\/api\/properties\/(\d+)$/
      );

    if(
      editMatch &&
      request.method === "PUT"
    ){

      const id =
        Number(
          editMatch[1]
        );

      try{

        const body =
          await request.json();

        const propertyType =
          clean(body.property_type);

        const city =
          clean(body.city);

        const province =
          clean(body.province);

        if(
          !propertyType ||
          !city
        ){

          return json(
            {
              success:false,
              error:
                "El tipo de propiedad y la ciudad son obligatorios."
            },
            400
          );
        }

        const neighborhood =
          clean(body.neighborhood) ||
          null;

        const address =
          clean(body.address) ||
          null;

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
          clean(body.description) ||
          null;

        const ownerName =
          clean(
            body.contact_name ??
            body.owner_name
          ) || null;

        const ownerPhone =
          clean(
            body.contact_phone ??
            body.owner_phone
          ) || null;

        const notes =
          clean(body.notes) ||
          null;

        const status =
          clean(body.status) ||
          "available";

        let photos = "[]";

        if(
          body.photos !== null &&
          body.photos !== undefined
        ){

          photos =
            typeof body.photos === "string"
              ? body.photos
              : JSON.stringify(
                  body.photos
                );
        }

        const geo =
          await geocodeAddress({
            city,
            neighborhood,
            address,
            province
          });

        const latitude =
          geo.success
            ? geo.latitude
            : null;

        const longitude =
          geo.success
            ? geo.longitude
            : null;

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
              id
            )
            .run();

        if(!result.meta?.changes){

          return json(
            {
              success:false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success:true,
          message:
            "Propiedad actualizada correctamente.",
          geocoded:
            geo.success,
          latitude,
          longitude,
          confidence:
            geo.confidence,
          location:
            geo.display_name
        });

      }catch(error){

        console.error(
          "NEXO UPDATE:",
          error
        );

        return json(
          {
            success:false,
            error:
              "No se pudo actualizar la propiedad.",
            detail:
              error?.message || null
          },
          500
        );
      }
    }

    // =========================================================
    // ELIMINAR
    // =========================================================

    if(
      editMatch &&
      request.method === "DELETE"
    ){

      const id =
        Number(
          editMatch[1]
        );

      try{

        const result =
          await env.DB
            .prepare(`
              DELETE FROM properties
              WHERE id = ?
            `)
            .bind(id)
            .run();

        if(!result.meta?.changes){

          return json(
            {
              success:false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success:true,
          message:
            "Propiedad eliminada correctamente."
        });

      }catch(error){

        console.error(
          "NEXO DELETE:",
          error
        );

        return json(
          {
            success:false,
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

    if(
      editMatch &&
      request.method === "GET"
    ){

      const id =
        Number(
          editMatch[1]
        );

      try{

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
            .bind(id)
            .first();

        if(!property){

          return json(
            {
              success:false,
              error:
                "Propiedad no encontrada."
            },
            404
          );
        }

        return json({
          success:true,
          property
        });

      }catch(error){

        console.error(
          "NEXO PROPERTY:",
          error
        );

        return json(
          {
            success:false,
            error:
              "Error al consultar la propiedad."
          },
          500
        );
      }
    }

    // =========================================================
    // ASSETS
    // =========================================================

    return env.ASSETS.fetch(request);
  }
};