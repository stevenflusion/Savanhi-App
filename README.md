# Savanhi SA

> **Savanhi** — Marketplace hiperlocal que digitaliza el canal tradicional de Quito, llevando ofertas reales de marcas a las tiendas de barrio y conectando al consumidor con su tienda más cercana.
>
> Sin promociones, Savanhi es conveniente. Con promociones, es irresistible. Con delivery, es imbatible.

---

## Qué es Savanhi

Savanhi es la primera plataforma digital de Ecuador dedicada al **canal tradicional** — las ~120.000 tiendas de barrio que mueven el 60% del consumo masivo del país y que hoy operan 100% offline.

El problema es simple: las marcas no saben qué pasa en la tienda de barrio. No saben si su promo llegó, si se redimió, si el tendero la respetó. El tendero no tiene herramientas digitales. El consumidor va al supermercado por ofertas porque la tienda de barrio "no tiene promociones". Todos pierden.

Savanhi cierra ese hueco con un modelo de **3 lados**:

| Actor | Qué recibe | Qué da |
| --- | --- | --- |
| **Marca** | ROAS medible en canal tradicional, datos hiperlocales de redención, mapa de calor de compra real por barrio | Fee por campaña + presupuesto de promociones |
| **Tendero** | Tráfico incremental, comisión por redención, herramientas digitales sin costo, acceso a delivery | Escanear cupones, preparar pedidos, respetar promos |
| **Consumidor** | Ofertas reales en su tienda más cercana, descubrimiento hiperlocal, delivery en minutos | Comprar, redimir cupones, recomendar |

---

## Los 4 Pilares del Producto

1. **Descubrimiento hiperlocal** — El consumidor encuentra productos y promos en tiendas de su barrio
2. **Motor de promociones** — Cupones digitales de marcas reales, redimibles en tienda física
3. **Pagos digitales** — DeUna como vía principal (+6M usuarios en Ecuador), efectivo como fallback
4. **Delivery hiperlocal** — Pedido tienda → consumidor sin salir del barrio (0-5 km, $1.50-$3.50)

> El delivery es un bounded context independiente con ciclo de vida propio, no una extensión de Order. Tiene estados, actores y economía separada.

---

## Modelo de Monetización

| Ingreso | Descripción | Fase |
| --- | --- | --- |
| **Fee por campaña** | La marca paga por cada campaña activa ($200-$600 según fase) | Piloto+ |
| **CPO (Cost Per Offer)** | Costo por cupón redimido (~$0.15-$0.30) | Piloto+ |
| **Margen delivery** | $1.00-$1.25 por viaje (después de pagar al repartidor) | Fase 1+ |
| **Comisión originación crédito** | 1-3% por microcrédito colocado vía Savanhi al tendero | Fase 2+ |
| **API de datos** | Suscripción enterprise para marcas que quieran datos del canal tradicional | Fase 3 |

**Unit economics (base):** LTV:CAC 5:1 en marca | Margen operativo 85% | Break-even desde mes 1 con 5+ campañas

---

## Ecosistema de Alianzas — Efecto Ancla Institucional

Savanhi no entra solo al mercado. Usa una lógica de encadenamiento donde cada actor reduce el riesgo del siguiente:

```
GAD Calderón → Legitima ante el Banco y ante los tenderos
    ↓
Banco Pichincha ve: Aval institucional ✓ + Base de tenderos real ✓ + Datos transaccionales ✓ → ENTRA
    ↓
Marcas ven: Banco respaldando ✓ + GAD avalando ✓ + Tenderos activos ✓ → ENTRAN
```

- **GAD Calderón** da: padrón de tiendas, difusión oficial, carta de respaldo | Recibe: métricas de impacto social, mapa georreferenciado
- **Banco Pichincha** da: fondo piloto de crédito $50K-$100K, co-branding, procesamiento de pagos | Recibe: score de comportamiento por tendero, originación de microcréditos

> **Límite no negociable:** Savanhi nunca cede co-administración, aprobación de contenidos, propiedad de datos, ni exclusividad bancaria.

---

## Secuencia de Fases

| Fase | Período | Enfoque | Tiendas | Hitos |
| --- | --- | --- | --- | --- |
| **FASE 0** | Pre-operación | Preparación interna, contratos, MVP | 0 | Equipo armado, MVP en staging |
| **FASE 1** | Mes 1-2 | GAD Calderón + field research | 10-15 | Padrón validado, encuestas completadas |
| **FASE 2** | Mes 1-2 | **Piloto 90 días** en tiendas de condominio | 20-30 | ≥15% redención, 500+ cupones, 1 marca ancla |
| **FASE 3** | Mes 3-4 | Escala + Banco Pichincha | 50+ | ROAS ≥4x, NPS tendero ≥8, 3 marcas |
| **FASE 4** | Mes 5-12 | Múltiples ciudades | 100+ | 5+ marcas, margen ≥85%, delivery automatizado |
| **FASE 5** | Año 2 | API de datos + expansión regional | 500+ | 10+ marcas, API con integraciones enterprise |

> ⚡ **Pivote mayo 2026:** El piloto ahora es en **tiendas de condominio/conjuntos residenciales**, no en barrios abiertos. Razón: clientela cautiva ≥20 familias por tienda, el tendero ES el canal de adquisición, y TuTi no tiene presencia dentro de condominios.

---

## Sistema de Tiers — Tendero

| Tier | Requisitos | Beneficios |
| --- | --- | --- |
| **Gold** | ≥15 cupones/semana, ≥80% aceptación | Prioridad campañas, comisión +5%, delivery habilitado |
| **Silver** | 8-14 cupones/semana, 60-79% aceptación | Acceso a todas las campañas, delivery habilitado |
| **Bronze** | <8 cupones/semana, <60% aceptación | Solo retiro en tienda, sin delivery |

> El tier es interno (lo ven marcas en su panel). El consumidor ve estrellas (1-5), no el nivel.

---

## Proyección Financiera — 12 Meses

| Fase | Ingresos | Costos | Margen | Margen % |
| --- | --- | --- | --- | --- |
| Piloto (M1-2) | $8,400 | $2,800 | $5,600 | 67% |
| Fase 1 (M3-4) | $34,000 | $5,700 | $28,300 | 83% |
| Fase 2 (M5-12) | $264,000 | $38,400 | $225,600 | 85% |
| **Total 12 meses** | **$306,400** | **$46,900** | **$259,500** | **85%** |

- **Runway:** 6-8 meses desde $30K inicial
- **Break-even operativo:** Mes 1 (con 5+ campañas/mes)
- **Break-even escala:** 50 tiendas, 5 marcas

---

## Panorama Competitivo

| Competidor | Tiendas | Presencia | Amenaza |
| --- | --- | --- | --- |
| **TuTi** | 762 | 99+ ciudades, 88% hogares | ALTA — pero es hard discount, no plataforma |
| **B-Sí** | 2 (piloto) | Quito norte | BAJA |
| **Tía Go** | 114 | 22 provincias | MEDIA |
| **Coralito** | piloto | Cuenca → Quito | BAJA |

**La barrera real NO es vs. TuTi/B-Sí — es ser EL PRIMERO en plataforma digital de canal tradicional en Ecuador.** TuTi compite por precio; Savanhi compite por datos + promociones + digitalización del tendero.

---

## Cumplimiento Legal

- **LOPDP vigente** con régimen sancionatorio desde mayo 2023 (multas 0.1%-1% facturación)
- Datos sensibles: GPS consumidor, cédula tendero/repartidor, datos bancarios — cifrado obligatorio
- Consentimiento informado antes del modal del sistema (ubicación, notificaciones)
- 6 documentos LOPDP pendientes: Política de Privacidad, Términos de Uso, ARCO, retención, consentimiento tendero, registro de tratamiento
- Todos los contratos son borradores base — requieren revisión de abogado habilitado en Ecuador
