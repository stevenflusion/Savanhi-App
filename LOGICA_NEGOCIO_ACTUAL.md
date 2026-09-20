# Logica de negocio actual de Savanhi Tenderos

Fecha del relevamiento: 17 de septiembre de 2026.

Este documento explica que hace actualmente el producto para un tendero, que reglas aplica y hasta donde llega cada flujo. Describe el comportamiento implementado hoy, no el producto futuro ni lo que dicen propuestas antiguas.

## Resumen ejecutivo

Savanhi Tenderos tiene dos partes activas: una aplicacion Android para el tendero y un backend que guarda usuarios, sesiones, tiendas, productos y pedidos.

La parte mas completa del negocio es el ingreso y alta del tendero:

1. El tendero ingresa su correo.
2. Recibe y valida un codigo de un solo uso.
3. Si es nuevo, completa su nombre, el nombre del negocio y su ubicacion.
4. Puede tomar o elegir fotos del local, aunque hoy esas fotos no llegan al backend.
5. Al finalizar se crea la tienda y se habilita el acceso a la aplicacion.
6. La sesion se conserva y puede renovarse sin volver a pedir un codigo.

Despues del alta, la realidad funcional es distinta:

- El inicio muestra ventas, ganancias, alertas y productos destacados de demostracion. No se calculan con datos reales.
- La gestion de productos e inventario funciona dentro de la pantalla, pero usa datos locales y se pierde al reiniciar la aplicacion.
- Registrar una venta descuenta stock local, pero no crea una venta o pedido persistente.
- El backend si posee operaciones persistentes para tiendas, productos y pedidos, pero la aplicacion Android todavia no las utiliza.
- Marcas, repartos, clientes y administracion existen como base de datos o capacidades internas, pero no tienen una experiencia activa en este producto.

## Estado real por capacidad

| Capacidad                           | Estado actual                      | Que significa                                                                                              |
| ----------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ingreso por correo y codigo         | Funciona con proveedor configurado | En produccion requiere Resend; en desarrollo necesita un codigo fijo configurado porque no se envia correo |
| Creacion del usuario tendero        | Funciona de punta a punta          | Se crea al validar correctamente el primer codigo                                                          |
| Recuperacion y renovacion de sesion | Funciona de punta a punta          | El usuario puede volver sin autenticarse cada vez                                                          |
| Nombre y alta de tienda             | Funciona de punta a punta          | Se guardan en la base de datos al completar el registro                                                    |
| Ubicacion de la tienda              | Funciona de punta a punta          | Puede salir de GPS, mapa o busqueda y se guarda al finalizar                                               |
| Fotos de la tienda                  | Parcial                            | Se eligen y guardan temporalmente en el telefono, pero luego se descartan                                  |
| Metodo de pago                      | Parcial e inaccesible              | Existe una pantalla y el backend lo admite, pero el flujo normal no pasa por ella                          |
| Perfil                              | Basico                             | Solo muestra nombre y correo, y permite cerrar sesion                                                      |
| Dashboard                           | Demostracion                       | Las cifras y alertas son fijas                                                                             |
| Inventario movil                    | Prototipo local                    | Agrega productos y registra ventas solo en memoria                                                         |
| Productos persistentes              | Solo backend                       | El backend permite administrarlos, pero la app no lo consume                                               |
| Pedidos del tendero                 | Solo backend                       | Se pueden listar y cambiar de estado, pero no hay pantalla movil                                           |
| Marcas y repartos                   | Solo backend interno               | Existen datos y operaciones internas, sin flujo visible                                                    |

## Actores actuales

### Tendero

Es el usuario principal de la aplicacion. Puede crear o recuperar su cuenta con correo, completar el alta de su negocio, entrar a las pestañas principales, usar el inventario local y cerrar sesion.

### Aplicacion Android

Guia al tendero por las pantallas, guarda temporalmente su sesion y el avance del alta, solicita permisos del telefono y decide a que pantalla puede entrar segun el estado de su registro.

### Backend de Tenderos

Valida codigos, crea usuarios, mantiene sesiones, crea tiendas y ofrece operaciones persistentes para productos y pedidos. Tambien protege las operaciones segun el rol del usuario.

### Proveedor de correo

En un entorno productivo envia el codigo de acceso mediante Resend. En desarrollo no se envia ningun correo: el flujo necesita un codigo fijo configurado previamente. Si no se configura, se genera un codigo aleatorio que el usuario no puede conocer.

### Servicios del telefono y Mapbox

Android administra los permisos. La ubicacion del telefono y Mapbox ayudan a encontrar o marcar la direccion del negocio.

## Flujo completo de ingreso y registro

### 1. Apertura de la aplicacion

Al iniciar, la aplicacion intenta recuperar la sesion guardada en el telefono.

- Si no hay una sesion util, muestra la bienvenida.
- Si la sesion esta cerca de vencer, intenta renovarla.
- Si el ultimo estado conocido indica que el usuario completo su registro, lo envia al inicio.
- Si el registro quedo incompleto, lo envia al primer paso pendiente.
- La aplicacion intenta confirmar el estado con el backend antes de decidir.

Si esa confirmacion falla por falta de conexion, conserva la sesion y navega con el ultimo estado guardado. Las operaciones protegidas pueden ser rechazadas despues por el backend, pero las pantallas y funciones puramente locales pueden seguir accesibles.

La aplicacion conserva el avance del alta solo en ese dispositivo. Cerrar sesion elimina tambien ese borrador.

### 2. Bienvenida

La opcion funcional es continuar con correo.

- El boton de Google se muestra, pero no tiene comportamiento.
- Los textos de terminos y privacidad no abren documentos ni registran una aceptacion.

### 3. Ingreso del correo

El tendero escribe su correo electronico.

Reglas actuales:

- Debe tener un formato basico de correo valido.
- Debe ingresarse sin espacios al principio o al final.
- El sistema no distingue mayusculas y minusculas en el correo.
- Un usuario desactivado no puede solicitar un codigo.
- Pedir un codigo para un correo desconocido no crea todavia al usuario.

Despues de validarlo, el backend normaliza el correo a minusculas. Si la solicitud es aceptada, se crea un desafio temporal y comienza una espera antes de permitir otro envio.

### 4. Envio del codigo

El codigo tiene seis cifras y una vigencia de 10 minutos.

Reglas de proteccion:

- Deben pasar 30 segundos antes de pedir otro codigo.
- Un codigo nuevo invalida el anterior.
- Se controlan excesos de solicitudes por origen, correo y combinacion de ambos.
- El sistema impide que dos solicitudes simultaneas al mismo correo generen envios duplicados.
- Si falla el envio del nuevo codigo, el codigo anterior sigue siendo valido.

### 5. Validacion del codigo

La pantalla acepta numeros y comienza la validacion al completar seis cifras.

Resultados posibles:

- Codigo correcto: crea o recupera al usuario y abre una sesion.
- Codigo incorrecto: limpia el campo y permite volver a intentar.
- Codigo vencido: obliga a pedir uno nuevo.
- Demasiados intentos: bloquea internamente el desafio.
- Demasiadas solicitudes: indica cuanto tiempo debe esperar el usuario.
- Sin conexion: mantiene al usuario en la pantalla para reintentar.
- Problema del proveedor: informa que el codigo no pudo procesarse o enviarse.

Cada desafio permite hasta cinco intentos incorrectos. El quinto error bloquea internamente el desafio, pero inicialmente se muestra como codigo incorrecto; un intento posterior se muestra como codigo vencido. No existe un mensaje especifico de bloqueo por intentos. Un codigo aceptado se consume y no puede volver a usarse.

### 6. Usuario nuevo o existente

El sistema decide el camino despues de validar el codigo.

#### Usuario nuevo

Se crea con estas condiciones:

- Rol tendero.
- Cuenta activa.
- Correo verificado.
- Nombre vacio.
- Registro pendiente de perfil.

Luego comienza el alta del negocio.

#### Usuario existente con estado `completed`

Entra directamente a las pestañas principales. No vuelve a completar sus datos.

#### Usuario existente con estado `profile_required`

Vuelve obligatoriamente a la pantalla de nombre personal.

#### Usuario existente con estado `store_required`

Continua el alta de la tienda. Si el borrador sigue en el mismo telefono, puede retomar un paso avanzado. Si cerro sesion o perdio el almacenamiento local, vuelve al nombre del negocio.

#### Usuario desactivado

No puede pedir ni validar codigos. Sus sesiones dejan de ser utilizables.

## Alta del tendero y su negocio

El negocio maneja tres estados duraderos de registro:

1. `profile_required`: falta el nombre de la persona.
2. `store_required`: falta completar la tienda.
3. `completed`: el usuario puede entrar a la aplicacion principal.

El estado guardado en el backend tiene prioridad sobre la pantalla que el telefono recuerde.

### 1. Nombre personal

- No puede estar vacio ni contener solamente espacios desde la pantalla movil.
- Al guardarlo, se persiste en el backend.
- El registro avanza de perfil pendiente a tienda pendiente.

La operacion general del backend solo exige que el texto tenga al menos un caracter. La pantalla movil es la que aplica la regla mas estricta contra nombres formados solo por espacios.

### 2. Nombre del negocio

- No puede estar vacio ni contener solamente espacios.
- En este punto se guarda en el borrador seguro del telefono.
- Todavia no se crea la tienda en el backend.

### 3. Permiso de ubicacion

La aplicacion solicita acceso a la ubicacion mientras esta en uso.

- Si el usuario acepta, continua al mapa.
- Si rechaza, recibe una advertencia, pero puede continuar igualmente.
- El rechazo no bloquea el alta.
- La aplicacion no guarda como dato de negocio si el permiso fue aceptado o rechazado.

### 4. Ubicacion del negocio

La direccion puede obtenerse de tres maneras:

- Ubicacion actual del telefono.
- Movimiento manual del marcador en el mapa.
- Busqueda de una direccion.

Reglas actuales:

- Para avanzar debe existir una direccion.
- Se guardan direccion, latitud y longitud en el borrador local.
- Si no puede obtenerse el GPS, se muestra una ubicacion inicial en Quito y el usuario debe ajustarla o buscar una direccion.
- Los datos no llegan al backend hasta la confirmacion final del registro.

### 5. Fotos del local

El tendero puede usar la camara o la galeria.

- La pantalla dispone de hasta tres espacios.
- Con al menos una foto aparece la opcion de continuar.
- Sin fotos se permite omitir el paso.
- Omitir crea una lista vacia, y para la navegacion eso cuenta como paso resuelto.

Limitacion importante: las fotos solo se guardan como referencias a archivos del telefono. No se suben ni existen en la base de datos. Al terminar el registro se elimina el borrador y esas referencias dejan de formar parte de la sesion.

### 6. Metodo de pago

Existe una pantalla que permite elegir efectivo o Banco Pichincha, y el backend puede guardar esa seleccion.

Sin embargo, el flujo actual no navega a esa pantalla. Desde fotos se pasa directamente a la pantalla final. Por eso una tienda creada normalmente queda sin metodo de pago.

### 7. Pantalla de cuenta creada

Entrar a esta pantalla no significa que la tienda ya exista en el backend. La creacion real ocurre cuando el tendero pulsa `Comenzar`.

En ese momento:

1. Se envia el nombre personal.
2. Se envia el nombre del negocio.
3. Se envian direccion y coordenadas si existen.
4. Se envia el metodo de pago si hubiera sido seleccionado.
5. Se crea la tienda si el usuario no tiene una.
6. El registro pasa a completado.
7. Se elimina el borrador local.
8. Se habilita el acceso a las pestañas.

Si el usuario ya tiene una tienda, la finalizacion devuelve esa tienda y no actualiza sus datos con el nuevo borrador.

## Sesion y seguridad de acceso

### Duracion

- La credencial de acceso dura 15 minutos.
- La posibilidad de renovar la sesion dura 30 dias.
- La aplicacion intenta renovar cuando queda menos de un minuto.

### Renovacion

Cada renovacion reemplaza la credencial de renovacion anterior. Si una credencial vieja, vencida o revocada vuelve a usarse, el sistema invalida la familia completa de sesiones relacionada.

Ante un error temporal de red, la aplicacion conserva la sesion local para poder reintentar. Ante un rechazo definitivo de la credencial, elimina la sesion.

### Limites de uso

Los valores actuales son configurables. De forma predeterminada se permiten:

- 120 solicitudes generales por minuto desde un mismo origen.
- 5 solicitudes de codigo por minuto para cada control de origen y correo.
- 10 validaciones de codigo por minuto para cada control equivalente.
- 30 renovaciones de sesion por minuto desde un mismo origen.

Los limites generales y de renovacion se guardan en memoria: se reinician con el proceso y no se comparten automaticamente entre varias instancias del backend.

### Cierre de sesion

Al cerrar sesion:

- Se intenta revocar la sesion en el backend.
- La sesion local se elimina aunque el aviso al backend falle.
- Se borra el usuario en memoria.
- Se borra el borrador del alta.
- La aplicacion vuelve a la bienvenida.

### Control de acceso

- Solo un usuario con registro completado puede permanecer en las pestañas principales.
- Un usuario incompleto es devuelto a su paso pendiente.
- La aplicacion movil no comprueba que un usuario ya existente tenga rol tendero; usa principalmente el estado de registro.
- El backend si exige rol tendero para finalizar el alta y para operar tiendas, productos y pedidos.

## Navegacion principal

La aplicacion tiene tres pestañas visibles:

1. Inicio.
2. Productos.
3. Perfil.

El archivo interno de la pestaña Productos se llama pedidos, pero hoy esa pantalla no contiene pedidos.

## Inicio o dashboard

El inicio presenta una vision de negocio con:

- Ventas del dia.
- Comparacion con el dia anterior.
- Ganancia estimada.
- Margen promedio.
- Productos vendidos.
- Productos con bajo stock.
- Productos agotados.
- Ranking de productos mas vendidos.
- Alertas importantes.

Estado real: todos esos valores son fijos y demostrativos. No se leen del backend, no se calculan desde el inventario y no cambian al registrar una venta.

Las acciones rapidas son:

- Agregar producto.
- Registrar venta.
- Revisar inventario.

Las tres abren la misma pantalla de Productos. Ademas, esa pantalla siempre inicia en Agregar producto, por lo que Registrar venta y Revisar inventario no abren directamente la herramienta prometida.

## Productos e inventario en la aplicacion

La pantalla comienza con cuatro productos de demostracion guardados dentro de la propia aplicacion.

Cada producto local tiene:

- Nombre.
- Categoria.
- Stock.
- Cantidad vendida.
- Fecha de vencimiento opcional.

Estos datos no coinciden por completo con el producto persistente del backend, que usa precio, descripcion, marca, tienda, stock y estado activo.

### Agregar producto

El formulario pide:

- Nombre.
- Categoria.
- Stock inicial.
- Fecha de vencimiento opcional.

Reglas actuales:

- Nombre y categoria no pueden quedar vacios.
- El stock no puede ser negativo.
- El stock local admite decimales; el producto persistente del backend exige un numero entero.
- La fecha solo comprueba que tenga apariencia `AAAA-MM-DD`; no comprueba que sea una fecha real.
- No se impiden nombres duplicados.
- Al guardar, el producto se agrega al principio de la lista local con cero vendidos.

El producto no se envia al backend y se pierde al reiniciar o reconstruir la pantalla.

### Editar y eliminar

El formulario tiene una variante visual de edicion, pero ninguna accion actual permite alcanzarla. No existe eliminacion desde la aplicacion.

### Buscar y filtrar

La busqueda:

- Ignora mayusculas y minusculas.
- Busca coincidencias parciales en nombre o categoria.
- Se combina con el filtro de categoria.

Las categorias se obtienen de los productos existentes. Diferencias de mayusculas o escritura crean categorias separadas.

### Resumen de inventario

El resumen se calcula sobre todos los productos locales, no solo los resultados filtrados.

Reglas de stock:

- Stock mayor a 5: en stock.
- Stock entre 1 y 5: bajo stock.
- Stock igual o menor a 0: agotado.

Reglas de vencimiento:

- Sin fecha: sin expiracion.
- Fecha anterior a hoy: expirado.
- Fecha de hoy: vence hoy.
- Entre 1 y 7 dias: por vencer.
- Mas de 7 dias: vigente.

Las alertas del inventario se calculan localmente para agotados, bajo stock y proximos a vencer. No se generan alertas equivalentes para productos ya expirados o que vencen hoy.

Estas alertas son distintas de las alertas fijas del dashboard; ambos espacios pueden mostrar cifras contradictorias.

## Registro local de ventas

Para registrar una venta, el tendero selecciona un producto, indica una cantidad y confirma.

Reglas:

- Debe haber un producto seleccionado.
- La cantidad debe ser numerica y mayor que cero.
- Si existe stock suficiente, se descuenta la cantidad y aumenta el contador vendido.
- Si no existe stock suficiente, el producto no cambia.

Limitaciones:

- La operacion solo modifica la lista local.
- No crea un pedido, venta, comprobante o movimiento historico.
- No registra fecha, precio, total, cliente ni medio de pago.
- No actualiza el dashboard.
- No impide vender un producto vencido.
- No ofrece anulacion o devolucion.
- Permite cantidades decimales.
- Los cambios se pierden al reiniciar la aplicacion.

## Perfil

El perfil actual muestra:

- Nombre del usuario.
- Correo.
- Boton para cerrar sesion.

No permite editar:

- Nombre personal.
- Nombre de la tienda.
- Ubicacion.
- Fotos.
- Metodo de pago.
- Preferencias.

Esto contradice mensajes del alta que indican que algunos datos podran cambiarse despues desde el perfil.

## Capacidades persistentes disponibles en el backend

Estas capacidades existen y guardan datos, aunque varias todavia no tienen una pantalla conectada.

### Usuarios y roles

Roles reconocidos:

- Administrador.
- Marca.
- Cliente.
- Tendero.
- Repartidor.

El backend de Tenderos crea nuevos usuarios como tenderos. No ofrece una operacion publica para cambiar roles.

El usuario autenticado puede consultar sus datos y actualizar su nombre. No existe una interfaz movil de perfil para usar esa actualizacion despues del alta.

### Tiendas

Un tendero puede:

- Consultar todas sus tiendas.
- Crear una tienda.

Reglas:

- Toda tienda tiene un propietario.
- El nombre es obligatorio.
- Direccion, coordenadas y metodo de pago son opcionales.
- El metodo de pago puede ser efectivo o Banco Pichincha.
- La tienda queda activa por defecto.
- Pueden existir varias tiendas por tendero mediante la operacion general de creacion.
- Crear una tienda por esa operacion no completa automaticamente el registro del usuario.
- No hay operaciones publicas para editar, desactivar o eliminar tiendas.

El modelo contempla datos bancarios adicionales, pero las operaciones actuales no los reciben.

### Productos

Un tendero puede, desde el backend:

- Listar productos de todas sus tiendas.
- Crear un producto.
- Modificar un producto.
- Desactivar un producto.

Reglas de creacion:

- El nombre es obligatorio.
- El precio es obligatorio y no puede ser negativo.
- El stock debe ser un numero entero no negativo.
- Si no se informa stock, comienza en cero.
- El producto queda activo por defecto.
- La tienda debe pertenecer al tendero.
- Si no se indica tienda, se usa una de las tiendas del propietario.
- Sin una tienda propia no puede crearse el producto.
- La marca es opcional.

Eliminar un producto no lo borra: lo marca como inactivo. El listado actual del tendero incluye productos activos e inactivos.

Brecha de regla: al modificar un producto se comprueba que actualmente sea del tendero, pero no se vuelve a comprobar que una nueva tienda asignada tambien sea suya.

### Pedidos

Un tendero puede, desde el backend:

- Listar pedidos de cualquiera de sus tiendas.
- Cambiar el estado de un pedido de sus tiendas.

Estados disponibles:

1. Pendiente.
2. Aceptado.
3. En preparacion.
4. Listo.
5. Asignado.
6. Entregado.
7. Cancelado.

No existen reglas de transicion. Un pedido puede pasar desde cualquier estado hacia cualquier otro, incluso volver desde entregado o cancelado.

El listado no incluye el detalle de los articulos. La aplicacion movil no consume estas operaciones.

La capacidad interna de crear pedidos calcula el total usando los precios actuales y conserva el precio unitario de cada articulo, pero hoy no esta expuesta en este producto. Tampoco comprueba stock ni lo descuenta.

### Marcas

Las marcas pueden existir, estar activas y tener un propietario. El backend posee operaciones internas para listarlas, crearlas y modificarlas, pero el producto Tenderos no expone esas acciones.

Un producto puede referenciar una marca. Las operaciones actuales no comprueban que la marca este activa o relacionada con el tendero.

### Entregas

El modelo reconoce estos estados:

- Asignada.
- Retirada.
- En camino.
- Entregada.
- Fallida.

Existen operaciones internas para consultar y actualizar entregas de un repartidor, pero no hay rutas activas ni aplicacion de repartidor en este producto. Tampoco existen reglas de transicion entre estados.

## Auditoria actual

El sistema registra eventos procesados de autenticacion:

- Solicitud de codigo exitosa y algunos rechazos.
- Fallo del proveedor de correo.
- Validacion de codigo correcta, incorrecta o vencida cuando alcanza el servicio.
- Renovacion de sesion exitosa o fallida cuando alcanza el servicio.
- Cierre de una sesion autenticada.

El correo se guarda de forma resumida, no en texto visible. Tambien pueden guardarse identificadores de usuario y sesion, origen de la solicitud y fecha.

Limitaciones:

- Un fallo al guardar la auditoria no bloquea el acceso.
- Los rechazos previos por validacion, falta de autenticacion o exceso de solicitudes no necesariamente quedan registrados.
- No existe una pantalla o ruta para consultar estos eventos.
- No se auditan cambios de perfil, tiendas, productos, pedidos, entregas o cambios de estado.

## Donde vive cada dato

| Dato                                         | Donde se guarda hoy                | Duracion real                                        |
| -------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Usuario, correo, nombre y estado de registro | Backend                            | Persistente                                          |
| Sesiones y renovaciones                      | Backend                            | Hasta vencimiento o revocacion                       |
| Copia de la sesion activa                    | Almacenamiento seguro del telefono | Hasta logout, rechazo definitivo o borrado de la app |
| Nombre del negocio durante el alta           | Borrador seguro del telefono       | Hasta completar o cerrar sesion                      |
| Direccion y coordenadas durante el alta      | Borrador seguro del telefono       | Hasta completar o cerrar sesion                      |
| Tienda final                                 | Backend                            | Persistente                                          |
| Fotos del local                              | Referencias locales en el borrador | Se descartan al completar                            |
| Productos mostrados en la app                | Memoria de la pantalla             | Se pierden al reiniciar                              |
| Ventas registradas en la app                 | Memoria de la pantalla             | Se pierden al reiniciar                              |
| Productos creados por el backend             | Backend                            | Persistente, pero sin conexion movil actual          |
| Pedidos del backend                          | Backend                            | Persistente, pero sin pantalla movil actual          |
| Cifras del dashboard                         | Codigo fijo de demostracion        | No representan actividad real                        |

## Reglas y contradicciones que deben conocerse

1. Completar fotos no significa que se guarden; solo permite avanzar.
2. Omitir fotos tambien cuenta como completar ese paso.
3. El metodo de pago existe, pero el recorrido normal no permite elegirlo.
4. La tienda se crea recien al pulsar `Comenzar`, no al mostrar la pantalla de exito.
5. Un usuario con tienda pendiente depende del mismo telefono para retomar exactamente su progreso.
6. El dashboard y el inventario usan fuentes distintas y pueden contradecirse.
7. Registrar una venta no modifica las ventas o ganancias mostradas en Inicio.
8. La pantalla llamada internamente Pedidos es realmente Productos.
9. El backend de productos y pedidos funciona de forma separada a la experiencia movil.
10. El perfil no ofrece las ediciones prometidas durante el alta.
11. Google, terminos y privacidad se muestran sin una accion funcional.
12. Notificaciones tiene una pantalla aislada, pero no forma parte del recorrido permitido.
13. El backend permite estados de pedido, pero no obliga a seguir un orden.
14. El backend modela creacion de pedidos, pero no reserva ni descuenta stock.
15. La app no comprueba el rol del usuario existente antes de abrir las pestañas; el backend si lo hace para operaciones sensibles.

## Que puede considerarse operativo hoy

### Operativo de punta a punta

- Ingreso sin contrasena por correo y codigo.
- Creacion automatica del tendero.
- Recuperacion, renovacion y cierre de sesion.
- Persistencia del nombre personal.
- Captura de direccion y coordenadas.
- Creacion final de una tienda.
- Proteccion de las pantallas segun el estado del registro.

### Operativo solo como experiencia local

- Ver productos de demostracion.
- Agregar productos temporales.
- Buscar y filtrar inventario.
- Calcular estados locales de stock y vencimiento.
- Registrar ventas temporales.
- Mostrar alertas locales de inventario.

### Disponible solo en backend

- Crear, listar, modificar y desactivar productos persistentes.
- Listar tiendas del tendero y crear tiendas adicionales.
- Listar pedidos de tiendas propias.
- Cambiar estados de pedidos.

### Repositorios internos sin ruta publica

- Gestion de marcas.
- Creacion y cancelacion de pedidos de clientes.
- Consulta y actualizacion de entregas de repartidores.
- Administracion de usuarios.
- Datos bancarios completos.

### No implementado como capacidad de negocio

- Historial independiente de ventas o movimientos de inventario.
- Auditoria de operaciones comerciales.
- Experiencias activas para clientes, marcas, repartidores o administradores.

## Fuentes principales del relevamiento

La explicacion se contrasto contra estas areas del codigo actual:

- `apps/Tenderos/mobile/app/auth/`: pantallas del ingreso y alta.
- `apps/Tenderos/mobile/src/features/auth/`: reglas de sesion, navegacion y borrador.
- `apps/Tenderos/mobile/app/(tabs)/`: Inicio, Productos y Perfil.
- `apps/Tenderos/mobile/src/components/ProductsWorkspace.tsx`: inventario y venta local.
- `apps/Tenderos/backend/src/routes/index.ts`: capacidades comerciales expuestas.
- `packages/backend-core/src/auth/`: reglas de codigo, usuario y sesion.
- `packages/backend-core/src/database/`: datos y operaciones persistentes.
- `packages/api-contracts/src/`: roles, estados y formas compartidas de los datos.

Las propuestas y documentos historicos se usaron solo para detectar contradicciones. No se tomaron como evidencia de que una funcionalidad exista hoy.
