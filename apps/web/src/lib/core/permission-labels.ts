/**
 * Plain-Spanish names for the permission codes, for the role editor. The catalog the API returns
 * carries a technical, partly English description ("Actualizar los datos editables del tenant
 * actual (nombre)") that a business user cannot be expected to read; this maps each code to a short
 * label (what the checkbox says) plus a one-sentence summary of what holding it allows (the "?"
 * help). Wording follows the app's glossary: "empresa" (never "tenant"), "Sucursal" for a warehouse
 * and "Almacén" for a location. A code missing here (a permission added later) falls back to the
 * API's own description, so a new permission is never hidden — just not yet translated.
 */
export interface PermissionLabel {
  label: string;
  help: string;
}

export const PERMISSION_LABELS: Record<string, PermissionLabel> = {
  // Núcleo
  'core.tenant.update': { label: 'Editar los datos de la empresa', help: 'Cambiar el nombre de la empresa y subir o quitar su logo.' },
  'core.users.read': { label: 'Ver usuarios', help: 'Consultar la lista de usuarios y el detalle de cada uno. No permite cambiarlos.' },
  'core.users.create': { label: 'Crear usuarios', help: 'Dar de alta nuevos usuarios de la empresa con su contraseña inicial y su rol.' },
  'core.users.update': { label: 'Editar usuarios', help: 'Cambiar el perfil de un usuario y activarlo o desactivarlo (un usuario desactivado ya no puede entrar).' },
  'core.users.locations.manage': { label: 'Asignar almacenes a usuarios', help: 'Definir en qué almacenes puede trabajar cada usuario. Sin asignación, el usuario no opera en ninguno.' },
  'core.roles.read': { label: 'Ver roles', help: 'Consultar la lista de roles y los permisos de cada uno.' },
  'core.roles.manage': { label: 'Crear y editar roles', help: 'Crear, renombrar y eliminar roles, y cambiar sus permisos. No puede cambiar los permisos del rol que tiene asignado.' },
  'core.roles.assign': { label: 'Asignar roles a usuarios', help: 'Cambiar el rol de un usuario. No puede dar un rol con más permisos de los que ya tiene.' },
  // Configuración
  'administration.settings.view': { label: 'Ver la configuración de la empresa', help: 'Consultar la zona horaria, el horario comercial y el flujo de transferencias. No permite cambiarlos.' },
  'administration.settings.manage': { label: 'Cambiar la configuración de la empresa', help: 'Modificar la zona horaria, el horario comercial y qué etapas de una transferencia requieren confirmación.' },
  // Catálogo
  'products.view': { label: 'Ver productos', help: 'Consultar productos y variantes con su stock y precios. El costo y el precio mínimo necesitan además sus permisos propios.' },
  'products.manage': { label: 'Crear y editar productos', help: 'Crear y modificar productos y variantes, subir sus fotos y activarlos o desactivarlos.' },
  'categories.view': { label: 'Ver categorías', help: 'Consultar las categorías y los atributos que usa cada una.' },
  'categories.manage': { label: 'Crear y editar categorías', help: 'Crear categorías y modificar su nombre y sus atributos.' },
  'catalog.attributes.manage': { label: 'Gestionar atributos de productos', help: 'Crear, editar y desactivar atributos (color, medidas, etc.) y sus opciones.' },
  'catalog.qr.manage': { label: 'Gestionar códigos QR', help: 'Generar, ver, imprimir y revocar códigos QR de productos y almacenes.' },
  // Precios
  'pricing.cost.view': { label: 'Ver costos y márgenes', help: 'Mostrar el costo de los productos y, con él, la ganancia de las ventas y el valor del inventario.' },
  'pricing.floor.view': { label: 'Ver el precio mínimo', help: 'Mostrar el precio mínimo al que se puede vender cada producto.' },
  'pricing.discount.request': { label: 'Solicitar descuentos especiales', help: 'Pedir aprobación para vender por debajo del precio base.' },
  'pricing.discount.approve': { label: 'Aprobar descuentos especiales', help: 'Aprobar o rechazar las solicitudes de descuento y ver su reporte. No puede aprobar las suyas.' },
  'pricing.policy.manage': { label: 'Configurar políticas de precios', help: 'Definir desde qué descuento se exige aprobación y el máximo descuento permitido.' },
  // Inventario
  'inventory.view': { label: 'Ver inventario', help: 'Consultar existencias, kardex y movimientos de todos los almacenes. No permite modificarlos.' },
  'inventory.adjust': { label: 'Ajustar inventario', help: 'Registrar entradas de stock y ajustes manuales (sumar o restar), solo en los almacenes que tenga asignados.' },
  'inventory.returns.manage': { label: 'Procesar devoluciones en bodega', help: 'Recibir devoluciones de clientes, inspeccionarlas y decidir su destino: volver a vender, cuarentena, dañado o desecho.' },
  'inventory.transfers.request': { label: 'Solicitar transferencias', help: 'Crear una transferencia de stock de un almacén a otro.' },
  'inventory.transfers.approve': { label: 'Aprobar y cancelar transferencias', help: 'Aprobar una transferencia (reserva el stock en el origen) o cancelarla.' },
  'inventory.transfers.dispatch': { label: 'Preparar y despachar transferencias', help: 'Preparar la mercadería y despacharla: el stock sale del almacén de origen y queda en tránsito.' },
  'inventory.transfers.receive': { label: 'Recibir transferencias', help: 'Registrar la recepción total o parcial en el almacén de destino.' },
  'warehouses.view': { label: 'Ver sucursales', help: 'Consultar las sucursales de la empresa.' },
  'warehouses.manage': { label: 'Crear y editar sucursales', help: 'Crear sucursales, modificarlas y activarlas o desactivarlas.' },
  'locations.view': { label: 'Ver almacenes', help: 'Consultar los almacenes de cada sucursal.' },
  'locations.manage': { label: 'Crear y editar almacenes', help: 'Crear almacenes y modificarlos o desactivarlos.' },
  // Importación
  'import.execute': { label: 'Importar datos desde Excel', help: 'Subir un archivo de Excel, revisarlo y confirmar la importación de productos al catálogo.' },
  'import.inventory': { label: 'Importar también el stock', help: 'Permite que una importación actualice las cantidades de inventario, no solo el catálogo. Se usa junto con «Importar datos desde Excel».' },
  // Ventas
  'sales.customers.view': { label: 'Ver clientes', help: 'Consultar la lista de clientes y su detalle.' },
  'sales.customers.manage': { label: 'Crear y editar clientes', help: 'Registrar nuevos clientes y modificar sus datos.' },
  'sales.carts.manage': { label: 'Usar el carrito de venta', help: 'Armar una venta: agregar y quitar productos, cambiar cantidades y negociar el precio.' },
  'sales.orders.create': { label: 'Crear y confirmar ventas', help: 'Crear el pedido y confirmarlo con su forma de pago. Reserva y descuenta el inventario del almacén.' },
  'sales.orders.cancel': { label: 'Cancelar ventas pendientes', help: 'Cancelar un pedido antes de confirmarlo; el stock reservado vuelve a estar disponible.' },
  'sales.orders.view': { label: 'Ver el historial de ventas', help: 'Consultar los pedidos y las formas de pago. Sin «Ver las ventas de todos los vendedores», solo ve los suyos.' },
  'sales.orders.view_all': { label: 'Ver las ventas de todos los vendedores', help: 'Ver los pedidos y reportes de todos los vendedores, no solo los propios.' },
  'sales.returns.view': { label: 'Ver devoluciones', help: 'Consultar las devoluciones de ventas y su reporte.' },
  'sales.returns.create': { label: 'Solicitar devoluciones', help: 'Crear y cancelar solicitudes de devolución sobre una venta confirmada.' },
};

/** Visible group titles of the permission picker (the API's `module` value is free text). */
export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  core: 'Usuarios, roles y empresa',
  administration: 'Configuración de la empresa',
  catalog: 'Catálogo',
  pricing: 'Precios y descuentos',
  inventory: 'Inventario',
  import: 'Importación',
  sales: 'Ventas',
};

/** The label and help to show for a catalog item — the translated pair, or the API description. */
export function describePermission(code: string, fallbackDescription: string): PermissionLabel {
  return PERMISSION_LABELS[code] ?? { label: fallbackDescription, help: fallbackDescription };
}
