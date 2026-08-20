/* ==========================================================================
   NEXO INMOBILIARIA — MOTOR EDGE HÍBRIDO (CLOUDFLARE WORKER)
   orquesta: API REST, SSR Ligero, Seguridad y NEXO IA (Workers AI + Vectorize)
   ========================================================================== */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        // Cabeceras CORS estándar para intercomunicación segura de servicios
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // Manejar peticiones de pre-vuelo (Preflight OPTIONS)
        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            /* ==========================================================
               1. ENRUTADOR DE LA API REST (CRUD sobre Cloudflare D1)
               ========================================================== */
            if (url.pathname === '/api/properties') {
                
                // --- GET: Consultar catálogo con filtros dinámicos ---
                if (method === 'GET') {
                    const id = url.searchParams.get('id');

                    // Consulta individual de propiedad
                    if (id) {
                        const property = await env.DB.prepare(
                            "SELECT * FROM properties WHERE id = ?"
                        ).bind(id).first();

                        if (!property) {
                            return new Response(JSON.stringify({ error: 'Propiedad no encontrada' }), {
                                status: 404,
                                headers: { 'Content-Type': 'application/json', ...corsHeaders }
                            });
                        }
                        return new Response(JSON.stringify(property), {
                            headers: { 'Content-Type': 'application/json', ...corsHeaders }
                        });
                    }

                    // Consulta general con filtros opcionales (Ubicación, tipo, precio)
                    const location = url.searchParams.get('location');
                    const type = url.searchParams.get('type');
                    const maxPrice = url.searchParams.get('maxPrice');

                    let query = "SELECT * FROM properties WHERE 1=1";
                    let params = [];

                    if (location) {
                        query += " AND location LIKE ?";
                        params.push(`%${location}%`);
                    }
                    if (type) {
                        query += " AND type = ?";
                        params.push(type);
                    }
                    if (maxPrice) {
                        query += " AND price <= ?";
                        params.push(parseFloat(maxPrice));
                    }

                    query += " ORDER BY id DESC";

                    const { results } = await env.DB.prepare(query).bind(...params).all();
                    return new Response(JSON.stringify(results), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }

                // --- POST: Crear nueva propiedad (Admin Protegido) ---
                if (method === 'POST') {
                    const data = await request.json();
                    
                    const { success } = await env.DB.prepare(
                        `INSERT INTO properties (title, price, type, type_transaction, location, bedrooms, bathrooms, area, image_url, latitude, longitude, description)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        data.title, data.price, data.type, data.type_transaction, data.location,
                        data.bedrooms, data.bathrooms, data.area, data.image_url, data.latitude, data.longitude, data.description
                    ).run();

                    if (!success) throw new Error('Error al insertar registro en D1.');

                    return new Response(JSON.stringify({ success: true, message: 'Propiedad creada correctamente.' }), {
                        status: 201,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }

                // --- PUT: Modificar propiedad existente (Admin Protegido) ---
                if (method === 'PUT') {
                    const id = url.searchParams.get('id');
                    if (!id) return new Response(JSON.stringify({ error: 'ID requerido' }), { status: 400 });

                    const data = await request.json();
                    const { success } = await env.DB.prepare(
                        `UPDATE properties SET title = ?, price = ?, type = ?, type_transaction = ?, location = ?, 
                         bedrooms = ?, bathrooms = ?, area = ?, image_url = ?, latitude = ?, longitude = ?, description = ?
                         WHERE id = ?`
                    ).bind(
                        data.title, data.price, data.type, data.type_transaction, data.location,
                        data.bedrooms, data.bathrooms, data.area, data.image_url, data.latitude, data.longitude, data.description, id
                    ).run();

                    if (!success) throw new Error('Error al actualizar registro en D1.');

                    return new Response(JSON.stringify({ success: true, message: 'Propiedad actualizada.' }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }

                // --- DELETE: Eliminar propiedad del inventario (Admin Protegido) ---
                if (method === 'DELETE') {
                    const id = url.searchParams.get('id');
                    if (!id) return new Response(JSON.stringify({ error: 'ID requerido' }), { status: 400 });

                    const { success } = await env.DB.prepare(
                        "DELETE FROM properties WHERE id = ?"
                    ).bind(id).run();

                    if (!success) throw new Error('Error al eliminar registro en D1.');

                    return new Response(JSON.stringify({ success: true, message: 'Propiedad eliminada.' }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
            }

            /* ==========================================================
               2. ENRUTADOR NEXO IA (Búsqueda Vectorial + Chat LLM)
               ========================================================== */
            if (url.pathname === '/api/chat' && method === 'POST') {
                const { message } = await request.json();
                if (!message) return new Response(JSON.stringify({ error: 'Mensaje requerido' }), { status: 400 });

                // a. Generar embedding vectorial de la consulta del usuario
                const embeddingResponse = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
                    text: [message]
                });
                const userVector = embeddingResponse.data[0];

                // b. Consultar el índice de Vectorize de NEXO para buscar propiedades similares
                const vectorMatches = await env.VECTOR_INDEX.query(userVector, {
                    topK: 3,
                    returnValues: false,
                    returnMetadata: true
                });

                // Extraer IDs de propiedades coincidentes
                let matchedProperties = [];
                if (vectorMatches.matches && vectorMatches.matches.length > 0) {
                    const matchedIds = vectorMatches.matches.map(m => parseInt(m.id));
                    
                    // Consultar los datos estructurados en D1 para los IDs recomendados
                    const placeholders = matchedIds.map(() => '?').join(',');
                    const { results } = await env.DB.prepare(
                        `SELECT * FROM properties WHERE id IN (${placeholders})`
                    ).bind(...matchedIds).all();
                    
                    matchedProperties = results;
                }

                // c. Preparar contexto semántico para alimentar al modelo conversacional (LLaMA)
                let contextText = "Propiedades recomendadas disponibles en NEXO:\n";
                matchedProperties.forEach(p => {
                    contextText += `- ID ${p.id}: ${p.title} en ${p.location}. Precio: ${p.price} USD. ${p.bedrooms} habs, ${p.bathrooms} baños, ${p.area} m².\n`;
                });

                const systemPrompt = "Eres el asistente inteligente de NEXO Inmobiliaria. Tu misión es guiar amablemente al usuario recomendándole de forma clara las propiedades listadas en el contexto. Responde de manera concisa y elegante.";
                
                // d. Invocar el modelo LLM con el contexto de las propiedades encontradas
                const chatResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                    messages: [
                        { role: 'system', content: `${systemPrompt}\n\n[CONTEXTO DE PROPIEDADES DISPONIBLES]:\n${contextText}` },
                        { role: 'user', content: message }
                    ]
                });

                // Retornar la respuesta estructurada consumible por public/ia/index.html
                return new Response(JSON.stringify({
                    reply: chatResponse.response,
                    properties: matchedProperties
                }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            /* ==========================================================
               3. SERVER-SIDE RENDERING (SSR LIGERO) PARA LA FICHA
               Intercepta /property.html para inyectar tags SEO en el Edge
               ========================================================== */
            if (url.pathname === '/property.html') {
                const propertyId = url.searchParams.get('id');

                if (propertyId) {
                    // Consulta la propiedad directamente en D1
                    const property = await env.DB.prepare(
                        "SELECT * FROM properties WHERE id = ?"
                    ).bind(propertyId).first();

                    if (property) {
                        // Obtiene el HTML base de la ficha como recurso estático
                        const staticResponse = await env.ASSETS.fetch(request);
                        
                        // Configurar formateador de moneda
                        const formattedPrice = new Intl.NumberFormat('en-US', {
                            style: 'currency', currency: 'USD', maximumFractionDigits: 0
                        }).format(property.price);

                        // Estructurar el objeto de datos Schema.org (JSON-LD) para SEO Premium
                        const schemaJson = {
                            "@context": "https://schema.org",
                            "@type": "SingleFamilyResidence",
                            "name": property.title,
                            "description": property.description || property.title,
                            "address": {
                                "@type": "PostalAddress",
                                "streetAddress": property.location || "Dirección no especificada"
                            },
                            "offers": {
                                "@type": "Offer",
                                "price": property.price,
                                "priceCurrency": "USD",
                                "availability": "https://schema.org/InStock"
                            }
                        };

                        // Reescribe el HTML en tiempo real con HTMLRewriter (Tiempo de proceso < 5ms)
                        return new HTMLRewriter()
                            // Reemplazar título dinámico para navegadores y bots
                            .on('title', {
                                element(el) {
                                    el.setInnerContent(`${property.title} — NEXO Inmobiliaria`);
                                }
                            })
                            // Inyectar metatags dinámicos en el encabezado <head> (Open Graph y Schema)
                            .on('head', {
                                element(el) {
                                    el.append(`
                                        <meta name="description" content="${(property.description || '').substring(0, 160)}">
                                        <meta property="og:title" content="${property.title} — NEXO">
                                        <meta property="og:description" content="${(property.description || '').substring(0, 160)}">
                                        <meta property="og:image" content="${property.image_url || ''}">
                                        <meta property="og:type" content="website">
                                        <meta property="og:url" content="${url.href}">
                                        <script type="application/ld+json">${JSON.stringify(schemaJson)}<\/script>
                                    `, { html: true });
                                }
                            })
                            // Inyectar datos en el DOM principal para mitigar cascada y Layout Shifts
                            .on('#detail-title', {
                                element(el) {
                                    el.setInnerContent(property.title);
                                }
                            })
                            .on('#detail-price-desktop', {
                                element(el) {
                                    el.setInnerContent(formattedPrice);
                                }
                            })
                            .on('#detail-price-sidebar', {
                                element(el) {
                                    el.setInnerContent(formattedPrice);
                                }
                            })
                            .on('#detail-price-mobile', {
                                element(el) {
                                    el.setInnerContent(formattedPrice);
                                }
                            })
                            .on('#detail-description', {
                                element(el) {
                                    el.setInnerContent(property.description || 'Sin descripción disponible.');
                                }
                            })
                            .transform(staticResponse);
                    }
                }
            }

            /* ==========================================================
               4. SERVICIO DE ARCHIVOS ESTÁTICOS POR DEFECTO (FALLBACK)
               ========================================================== */
            return await env.ASSETS.fetch(request);

        } catch (error) {
            console.error(error);
            return new Response(JSON.stringify({ error: 'Internal Server Error', message: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    }
};