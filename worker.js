/// worker.js
// worker.js - NEXO Master API, SEO & AI Engine
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Configuración global de WhatsApp
    const WHATSAPP_PHONE = env.WHATSAPP_PHONE || "+5350000000";

    // CORS y Seguridad de Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const isAdmin = (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return false;
      const token = authHeader.replace("Bearer ", "");
      return token === env.ADMIN_TOKEN;
    };

    const normalizeImages = (imagesStr) => {
      if (!imagesStr) return [];
      try {
        const parsed = JSON.parse(imagesStr);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") return [parsed];
        return [];
      } catch (e) {
        if (imagesStr.startsWith("http") || imagesStr.startsWith("/")) return [imagesStr];
        return [];
      }
    };

    // --- ENTRADA DE SEO INTERCEPTOR ---
    if (url.pathname === "/property.html" && method === "GET") {
      const id = url.searchParams.get("id");
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/property";
      assetUrl.search = "";
      assetUrl.hash = "";
      const assetRes = await env.ASSETS.fetch(new Request(assetUrl)).catch(() => null);
      let htmlContent = assetRes && assetRes.ok ? await assetRes.text() : PROPERTY_HTML_TEMPLATE;

      if (id) {
        try {
          const property = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(id).first();
          if (property) {
            const images = normalizeImages(property.images);
            const mainImage = images[0] || "https://nexo.estate/placeholder.jpg";
            
            const seoTags = `
              <title>${property.title} | NEXO Premium</title>
              <meta name="description" content="${property.description ? property.description.substring(0, 155) : 'Propiedad exclusiva en NEXO'}.">
              <meta property="og:title" content="${property.title} - NEXO">
              <meta property="og:description" content="${property.description ? property.description.substring(0, 155) : ''}">
              <meta property="og:image" content="${mainImage}">
              <meta property="og:type" content="website">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="${property.title}">
              <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "RealEstateListing",
                "name": "${property.title}",
                "description": "${property.description}",
                "price": "${property.price}",
                "priceCurrency": "USD",
                "address": {
                  "@type": "PostalAddress",
                  "addressLocality": "${property.city}",
                  "addressRegion": "${property.province}"
                }
              }
              </script>
            `;
            htmlContent = htmlContent.replace("<!-- SEO_TAGS -->", seoTags);
          }
        } catch (err) { console.error("Error en SEO dinámico:", err); }
      }
      return new Response(htmlContent, { headers: { "Content-Type": "text/html" } });
    }

    // --- ENDPOINTS MEDIA Y CONFIG ---
    if (url.pathname.startsWith("/media/") && env.BUCKET_IMAGENES && (method === "GET" || method === "HEAD")) {
      const key = decodeURIComponent(url.pathname.slice("/media/".length));
      const object = method === "HEAD" ? await env.BUCKET_IMAGENES.head(key) : await env.BUCKET_IMAGENES.get(key);
      if (!object) return new Response("Not Found", { status: 404, headers: corsHeaders });
      
      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(method === "HEAD" ? null : object.body, { headers });
    }

    if (url.pathname === "/api/config" && method === "GET") {
      return new Response(JSON.stringify({ whatsapp_phone: WHATSAPP_PHONE }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // --- ENDPOINTS PÚBLICOS ---
    if (url.pathname === "/api/properties" && method === "GET") {
      try {
        const type = url.searchParams.get("type");
        const operation = url.searchParams.get("operation");
        const maxPrice = url.searchParams.get("maxPrice");
        const province = url.searchParams.get("province");

        let query = "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at FROM properties WHERE status = 'published'";
        const params = [];

        if (type) { query += " AND type = ?"; params.push(type); }
        if (operation) { query += " AND operation = ?"; params.push(operation); }
        if (maxPrice) { query += " AND price <= ?"; params.push(parseFloat(maxPrice)); }
        if (province) { query += " AND province = ?"; params.push(province); }

        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();

        const formatted = results.map(row => ({ ...row, images: normalizeImages(row.images) }));
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // P1: Propiedades Similares Inteligentes (Misma ciudad o provincia ±30% Precio)
    const similarMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)\/similar$/);
    if (similarMatch && method === "GET") {
      const id = similarMatch[1];
      try {
        const row = await env.DB.prepare("SELECT price, city, province FROM properties WHERE id = ? AND status = 'published'").bind(id).first();
        if (!row) {
          return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const minPrice = row.price * 0.7;
        const maxPrice = row.price * 1.3;

        let { results } = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND city = ? AND price BETWEEN ? AND ? LIMIT 4"
        ).bind(id, row.city, minPrice, maxPrice).all();

        if (results.length === 0) {
          const provRes = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND province = ? AND price BETWEEN ? AND ? LIMIT 4"
          ).bind(id, row.province, minPrice, maxPrice).all();
          results = provRes.results;
        }

        const formatted = results.map(r => ({ ...r, images: normalizeImages(r.images) }));
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // Detalle Propiedad Púbica (Filtro Privacidad Cuidado)
    const detailMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)$/);
    if (detailMatch && method === "GET") {
      const id = detailMatch[1];
      try {
        const row = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude FROM properties WHERE id = ? AND status = 'published'"
        ).bind(id).first();

        if (!row) return new Response(JSON.stringify({ error: "No encontrada" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
        const formatted = { ...row, images: normalizeImages(row.images) };
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // --- ADMIN ENDPOINTS (Mantenidos sin alteraciones funcionales para no romper) ---
    if (url.pathname === "/api/admin/verify" && method === "POST") {
      if (isAdmin(request)) return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      return new Response(JSON.stringify({ error: "Denegado" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (url.pathname === "/api/admin/properties" && method === "GET") {
      if (!isAdmin(request)) return new Response(JSON.stringify({ error: "Denegado" }), { status: 401, headers: corsHeaders });
      const { results } = await env.DB.prepare("SELECT * FROM properties ORDER BY created_at DESC").all();
      return new Response(JSON.stringify(results.map(row => ({ ...row, images: normalizeImages(row.images) }))), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // --- NEXO IA CHATBOT (RAG Fallback Preservado) ---
    if (url.pathname === "/api/chat" && method === "POST") {
      try {
        const { message } = await request.json();
        if (!message) return new Response(JSON.stringify({ error: "Requerido" }), { status: 400, headers: corsHeaders });

        let matchedProperties = [];
        if (env.AI && env.VECTORIZE) {
          try {
            const queryVec = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [message] });
            const vecResults = await env.VECTORIZE.query(queryVec.data[0], { topK: 4 });
            if (vecResults.matches && vecResults.matches.length > 0) {
              const matchedIds = vecResults.matches.map(m => m.id);
              const { results } = await env.DB.prepare(`SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE id IN (${matchedIds.map(()=>"?").join(",")}) AND status = 'published'`).bind(...matchedIds).all();
              matchedProperties = results.map(row => ({ ...row, images: normalizeImages(row.images) }));
            }
          } catch (e) { /* fallback if vectorize fails */ }
        }

        if (matchedProperties.length === 0) {
          const { results } = await env.DB.prepare("SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' LIMIT 3").all();
          matchedProperties = results.map(row => ({ ...row, images: normalizeImages(row.images) }));
        }

        const contextString = matchedProperties.map(p => `[${p.id}] ${p.title} - ${p.type} en ${p.neighborhood}, ${p.city}. $${p.price} USD. Habs: ${p.bedrooms}, Baños: ${p.bathrooms}.`).join("\n");
        const sysPrompt = `Eres NEXO IA, asesor inmobiliario premium en Cuba. Tono educado, claro y minimalista. Responde usando SÓLO las propiedades en tu contexto. Cita el ID como [N-XXX] para vincular. Contexto: \n${contextString}`;

        const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages: [{ role: "system", content: sysPrompt }, { role: "user", content: message }] });
        return new Response(JSON.stringify({ response: aiResponse.response, properties: matchedProperties }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  }
};

const PROPERTY_HTML_TEMPLATE = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><!-- SEO_TAGS --></head><body></body></html>`;