// Datos mockeados realistas en ARS para GastroPilot AI
// Negocio: hamburguesería "La Birra Burger"

export const businessInfo = {
  name: "La Birra Burger",
  plan: "Pro",
  owner: "Mateo Iglesias",
  location: "Palermo, CABA",
};

// ---------- DASHBOARD KPIs ----------
export const dashboardKpis = {
  ventasHoy: 742_500,
  ventasHoyDelta: 12.4,
  ventasMes: 18_420_000,
  ventasMesDelta: 8.7,
  margenEstimado: 31.2,
  margenDelta: -1.8,
  costosMes: 12_680_000,
  costosDelta: 14.1,
};

// ---------- GRÁFICO VENTAS POR DÍA ----------
export const salesByDay = [
  { day: "Lun 6", ventas: 612_000, costo: 410_000 },
  { day: "Mar 7", ventas: 488_000, costo: 360_000 },
  { day: "Mié 8", ventas: 705_000, costo: 470_000 },
  { day: "Jue 9", ventas: 820_000, costo: 540_000 },
  { day: "Vie 10", ventas: 1_140_000, costo: 720_000 },
  { day: "Sáb 11", ventas: 1_320_000, costo: 830_000 },
  { day: "Dom 12", ventas: 980_000, costo: 640_000 },
  { day: "Lun 13", ventas: 590_000, costo: 405_000 },
  { day: "Mar 14", ventas: 460_000, costo: 355_000 },
  { day: "Mié 15", ventas: 712_000, costo: 480_000 },
  { day: "Jue 16", ventas: 742_500, costo: 510_000 },
];

// ---------- GASTOS POR CATEGORÍA ----------
export const expensesByCategory = [
  { name: "Insumos", value: 5_820_000, color: "#F97316" },
  { name: "Sueldos", value: 4_960_000, color: "#A78BFA" },
  { name: "Alquiler", value: 1_350_000, color: "#F59E0B" },
  { name: "Servicios", value: 410_000, color: "#84CC16" },
  { name: "Apps delivery", value: 1_180_000, color: "#EF4444" },
  { name: "Otros", value: 360_000, color: "#64748B" },
];

// ---------- RECOMENDACIONES IA ----------
export const insights = [
  {
    id: "i1",
    tone: "warn" as const,
    icon: "TrendingUp",
    title: "El costo de carne subió 14% respecto a la compra anterior",
    detail:
      "Don José pasó de $9.000/kg a $10.260/kg. Sugerimos cotizar con Frigorífico Sur antes del jueves.",
  },
  {
    id: "i2",
    tone: "info" as const,
    icon: "CalendarDays",
    title: "Los martes tienen baja venta y alto costo de personal",
    detail:
      "Últimos 4 martes: venta promedio $478k, costo laboral $186k (39%). Revisar grilla horaria.",
  },
  {
    id: "i3",
    tone: "danger" as const,
    icon: "PieChart",
    title: "PedidosYa genera volumen pero reduce margen 11 pts",
    detail:
      "31% de las ventas vienen por PedidosYa con margen neto de 19,8% vs 31,2% promedio.",
  },
  {
    id: "i4",
    tone: "success" as const,
    icon: "Target",
    title: "Necesitás vender $620.000 por día para cubrir costos fijos",
    detail:
      "Punto de equilibrio diario actualizado al 16/05. Llevás 11 de 16 días por encima del objetivo.",
  },
];

// ---------- ACTIVIDAD RECIENTE IA ----------
export const recentActivity = [
  {
    id: "a1",
    type: "compra",
    text: "Compra registrada · 20kg carne a Don José",
    amount: -180_000,
    at: new Date(Date.now() - 1000 * 60 * 14),
    source: "WhatsApp · audio",
    status: "aprobado",
  },
  {
    id: "a2",
    type: "venta",
    text: "Cierre de caja salón",
    amount: 412_300,
    at: new Date(Date.now() - 1000 * 60 * 48),
    source: "WhatsApp · texto",
    status: "aprobado",
  },
  {
    id: "a3",
    type: "adelanto",
    text: "Adelanto a Juan Pérez",
    amount: -30_000,
    at: new Date(Date.now() - 1000 * 60 * 122),
    source: "WhatsApp · texto",
    status: "aprobado",
  },
  {
    id: "a4",
    type: "stock",
    text: "Stock actualizado · 8kg cheddar restantes",
    amount: 0,
    at: new Date(Date.now() - 1000 * 60 * 210),
    source: "WhatsApp · foto",
    status: "revision",
  },
  {
    id: "a5",
    type: "gasto",
    text: "Alquiler de mayo",
    amount: -450_000,
    at: new Date(Date.now() - 1000 * 60 * 60 * 7),
    source: "WhatsApp · texto",
    status: "aprobado",
  },
  {
    id: "a6",
    type: "venta",
    text: "Ventas delivery + WhatsApp",
    amount: 350_000,
    at: new Date(Date.now() - 1000 * 60 * 60 * 9),
    source: "WhatsApp · texto",
    status: "aprobado",
  },
];

// ---------- INBOX IA ----------
export type InboxStatus = "pendiente" | "aprobado" | "revision";
export type InboxItem = {
  id: string;
  sender: string;
  role: string;
  channel: "texto" | "audio" | "foto";
  receivedAt: Date;
  status: InboxStatus;
  preview: string;
  raw: string;
  extracted: {
    tipo: string;
    monto?: number;
    proveedor?: string;
    empleado?: string;
    insumo?: string;
    cantidad?: string;
    medioPago?: string;
    canal?: string;
    categoria?: string;
    fecha: string;
    confidence: number;
    missing?: string[];
  };
};

export const inboxItems: InboxItem[] = [
  {
    id: "m1",
    sender: "Mateo Iglesias",
    role: "Socio",
    channel: "audio",
    receivedAt: new Date(Date.now() - 1000 * 60 * 8),
    status: "pendiente",
    preview:
      "Compramos 20kg de carne a Don José por 180mil. Pagamos transferencia.",
    raw: "Compramos 20kg de carne a Don José por 180 mil. Pagamos por transferencia, viene mañana a las 9.",
    extracted: {
      tipo: "Compra de insumo",
      monto: 180_000,
      proveedor: "Don José",
      insumo: "Carne premium",
      cantidad: "20 kg",
      medioPago: "Transferencia",
      categoria: "Insumos",
      fecha: "Hoy",
      confidence: 0.96,
    },
  },
  {
    id: "m2",
    sender: "Lucía Romero",
    role: "Encargada",
    channel: "texto",
    receivedAt: new Date(Date.now() - 1000 * 60 * 32),
    status: "pendiente",
    preview:
      "Hoy vendimos $850.000: local $500.000, delivery $250.000 y WhatsApp $100.000",
    raw: "Hoy vendimos $850.000: local $500.000, delivery $250.000 y WhatsApp $100.000. Buena noche de jueves!",
    extracted: {
      tipo: "Cierre de ventas diario",
      monto: 850_000,
      canal: "Salón / Delivery / WhatsApp",
      categoria: "Ventas",
      fecha: "Hoy",
      confidence: 0.98,
    },
  },
  {
    id: "m3",
    sender: "Mateo Iglesias",
    role: "Socio",
    channel: "texto",
    receivedAt: new Date(Date.now() - 1000 * 60 * 95),
    status: "pendiente",
    preview: "A Juan le dimos un adelanto de $30.000",
    raw: "A Juan le dimos un adelanto de $30.000, ya se lo paso por la app.",
    extracted: {
      tipo: "Adelanto a empleado",
      monto: 30_000,
      empleado: "Juan Pérez",
      medioPago: "Transferencia",
      categoria: "Sueldos",
      fecha: "Hoy",
      confidence: 0.92,
    },
  },
  {
    id: "m4",
    sender: "Lucía Romero",
    role: "Encargada",
    channel: "foto",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
    status: "revision",
    preview: "Foto · ticket de panadería La Espiga",
    raw: "[Imagen recibida] Ticket de la panadería con varios renglones. Falta confirmar el medio de pago.",
    extracted: {
      tipo: "Compra de insumo",
      monto: 62_400,
      proveedor: "Panadería La Espiga",
      insumo: "Pan brioche x 120u",
      cantidad: "120 unidades",
      categoria: "Insumos",
      fecha: "Hoy",
      confidence: 0.74,
      missing: ["Medio de pago"],
    },
  },
  {
    id: "m5",
    sender: "Mateo Iglesias",
    role: "Socio",
    channel: "texto",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
    status: "aprobado",
    preview: "El alquiler de mayo fue $450.000",
    raw: "El alquiler de mayo fue $450.000, ya lo transfirí a Roberto.",
    extracted: {
      tipo: "Gasto fijo",
      monto: 450_000,
      categoria: "Alquiler",
      medioPago: "Transferencia",
      fecha: "05/05",
      confidence: 0.99,
    },
  },
  {
    id: "m6",
    sender: "Lucía Romero",
    role: "Encargada",
    channel: "audio",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 9),
    status: "aprobado",
    preview: "Quedan 8kg de cheddar",
    raw: "Quedan 8 kilos de cheddar, pedile a Mateo que pase a comprar mañana.",
    extracted: {
      tipo: "Actualización de stock",
      insumo: "Queso cheddar",
      cantidad: "8 kg",
      categoria: "Stock",
      fecha: "Hoy",
      confidence: 0.88,
    },
  },
  {
    id: "m7",
    sender: "Mateo Iglesias",
    role: "Socio",
    channel: "texto",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 22),
    status: "aprobado",
    preview: "El proveedor de pan aumentó 12%",
    raw: "La panadería me avisó que aumenta el pan brioche un 12% desde el lunes.",
    extracted: {
      tipo: "Alerta de precio",
      proveedor: "Panadería La Espiga",
      insumo: "Pan brioche",
      categoria: "Insumos",
      fecha: "20/05",
      confidence: 0.91,
    },
  },
];

// ---------- VENTAS ----------
export const salesByChannel = [
  { canal: "Salón", total: 8_910_000, share: 48.4, ticket: 12_400, delta: 6.2 },
  { canal: "Delivery propio", total: 3_280_000, share: 17.8, ticket: 9_800, delta: 12.1 },
  { canal: "PedidosYa", total: 4_120_000, share: 22.4, ticket: 11_200, delta: -3.4 },
  { canal: "WhatsApp", total: 2_110_000, share: 11.4, ticket: 13_900, delta: 22.0 },
];

export const dailySalesTable = [
  { fecha: "16/05 Jue", salon: 412_000, delivery: 180_000, pya: 110_000, wa: 40_500, total: 742_500 },
  { fecha: "15/05 Mié", salon: 390_000, delivery: 150_000, pya: 130_000, wa: 42_000, total: 712_000 },
  { fecha: "14/05 Mar", salon: 245_000, delivery: 90_000, pya: 100_000, wa: 25_000, total: 460_000 },
  { fecha: "13/05 Lun", salon: 320_000, delivery: 120_000, pya: 120_000, wa: 30_000, total: 590_000 },
  { fecha: "12/05 Dom", salon: 540_000, delivery: 180_000, pya: 200_000, wa: 60_000, total: 980_000 },
  { fecha: "11/05 Sáb", salon: 720_000, delivery: 240_000, pya: 280_000, wa: 80_000, total: 1_320_000 },
  { fecha: "10/05 Vie", salon: 610_000, delivery: 220_000, pya: 230_000, wa: 80_000, total: 1_140_000 },
];

// ---------- COMPRAS ----------
export const recentPurchases = [
  { fecha: "16/05", proveedor: "Don José", insumo: "Carne premium", cantidad: "20 kg", monto: 180_000, variacion: 14 },
  { fecha: "15/05", proveedor: "Panadería La Espiga", insumo: "Pan brioche", cantidad: "120 u", monto: 62_400, variacion: 0 },
  { fecha: "14/05", proveedor: "La Serenísima", insumo: "Cheddar", cantidad: "10 kg", monto: 84_000, variacion: 4 },
  { fecha: "13/05", proveedor: "Verdulería Centro", insumo: "Lechuga / Tomate", cantidad: "12 kg", monto: 28_400, variacion: -2 },
  { fecha: "12/05", proveedor: "Coca-Cola", insumo: "Gaseosas 500ml", cantidad: "96 u", monto: 96_000, variacion: 5 },
  { fecha: "10/05", proveedor: "Don José", insumo: "Carne premium", cantidad: "25 kg", monto: 197_500, variacion: 0 },
];

export const topSuppliers = [
  { nombre: "Don José", rubro: "Carnes", totalMes: 580_000, ordenes: 4, tendencia: 14 },
  { nombre: "La Serenísima", rubro: "Lácteos", totalMes: 312_000, ordenes: 3, tendencia: 4 },
  { nombre: "Panadería La Espiga", rubro: "Panificados", totalMes: 248_000, ordenes: 5, tendencia: 12 },
  { nombre: "Coca-Cola", rubro: "Bebidas", totalMes: 384_000, ordenes: 2, tendencia: 5 },
  { nombre: "Verdulería Centro", rubro: "Frescos", totalMes: 142_000, ordenes: 6, tendencia: -2 },
];

// ---------- GASTOS FIJOS ----------
export const fixedExpenses = [
  { nombre: "Alquiler", monto: 450_000, vencimiento: "05/06", estado: "pagado" },
  { nombre: "Sueldos", monto: 2_480_000, vencimiento: "05/06", estado: "programado" },
  { nombre: "Servicios (luz, gas, agua)", monto: 142_000, vencimiento: "10/06", estado: "pendiente" },
  { nombre: "Contador", monto: 95_000, vencimiento: "10/06", estado: "pendiente" },
  { nombre: "Publicidad (Meta + Google)", monto: 180_000, vencimiento: "01/06", estado: "programado" },
  { nombre: "Internet + telefonía", monto: 38_000, vencimiento: "12/06", estado: "pendiente" },
  { nombre: "Mantenimiento", monto: 60_000, vencimiento: "—", estado: "variable" },
  { nombre: "Comisiones apps", monto: 412_000, vencimiento: "—", estado: "automático" },
];

export const breakEven = { diario: 620_000, mensual: 18_600_000 };

// ---------- STOCK ----------
export const stockItems = [
  { insumo: "Carne premium 180g", unidad: "kg", stock: 32, minimo: 25, dias: 4, estado: "ok" },
  { insumo: "Queso cheddar", unidad: "kg", stock: 8, minimo: 12, dias: 2, estado: "critico" },
  { insumo: "Pan brioche", unidad: "u", stock: 120, minimo: 150, dias: 1, estado: "critico" },
  { insumo: "Papas 4ta gama", unidad: "kg", stock: 45, minimo: 30, dias: 6, estado: "ok" },
  { insumo: "Bacon ahumado", unidad: "kg", stock: 6, minimo: 5, dias: 3, estado: "alerta" },
  { insumo: "Gaseosas 500ml", unidad: "u", stock: 84, minimo: 60, dias: 5, estado: "ok" },
  { insumo: "Cerveza IPA", unidad: "u", stock: 36, minimo: 48, dias: 2, estado: "alerta" },
  { insumo: "Aceite girasol", unidad: "L", stock: 18, minimo: 10, dias: 9, estado: "ok" },
];

// ---------- PRODUCTOS ----------
export const products = [
  {
    nombre: "Clásica La Birra",
    categoria: "Hamburguesa",
    precio: 8_900,
    costo: 3_450,
    ingredientes: ["Pan brioche", "Medallón 180g", "Cheddar", "Lechuga", "Tomate", "Salsa de la casa"],
    estado: "ok",
  },
  {
    nombre: "Doble Cheddar",
    categoria: "Hamburguesa",
    precio: 11_500,
    costo: 5_120,
    ingredientes: ["Pan brioche", "2x medallón 180g", "Doble cheddar", "Cebolla caramelizada"],
    estado: "ok",
  },
  {
    nombre: "Bacon Lover",
    categoria: "Hamburguesa",
    precio: 12_400,
    costo: 6_350,
    ingredientes: ["Pan brioche", "Medallón 180g", "Bacon", "Cheddar", "BBQ"],
    estado: "margen-bajo",
  },
  {
    nombre: "Veggie",
    categoria: "Hamburguesa",
    precio: 9_900,
    costo: 3_100,
    ingredientes: ["Pan integral", "Medallón vegetal", "Provolone", "Rúcula"],
    estado: "ok",
  },
  {
    nombre: "Papas rústicas",
    categoria: "Acompañamiento",
    precio: 4_900,
    costo: 1_120,
    ingredientes: ["Papa 4ta gama", "Sal ahumada", "Romero"],
    estado: "ok",
  },
  {
    nombre: "Combo Clásico",
    categoria: "Combo",
    precio: 14_500,
    costo: 6_100,
    ingredientes: ["Clásica", "Papas", "Bebida 500ml"],
    estado: "ok",
  },
  {
    nombre: "Coca 500ml",
    categoria: "Bebida",
    precio: 2_400,
    costo: 900,
    ingredientes: ["Coca-Cola 500ml"],
    estado: "ok",
  },
  {
    nombre: "IPA Artesanal",
    categoria: "Bebida",
    precio: 3_800,
    costo: 1_900,
    ingredientes: ["Cerveza IPA 473ml"],
    estado: "margen-bajo",
  },
];

// ---------- EMPLEADOS ----------
export const employees = [
  { nombre: "Juan Pérez", rol: "Cocina", turno: "Tarde-Noche", horasMes: 168, costoMes: 520_000, adelantos: 30_000, faltas: 0, tardes: 2 },
  { nombre: "Mariana López", rol: "Caja", turno: "Mediodía", horasMes: 144, costoMes: 410_000, adelantos: 0, faltas: 1, tardes: 0 },
  { nombre: "Lucía Romero", rol: "Encargada", turno: "Full time", horasMes: 192, costoMes: 780_000, adelantos: 0, faltas: 0, tardes: 0 },
  { nombre: "Diego Sosa", rol: "Cocina", turno: "Noche", horasMes: 160, costoMes: 495_000, adelantos: 50_000, faltas: 0, tardes: 3 },
  { nombre: "Florencia Gil", rol: "Atención", turno: "Tarde", horasMes: 132, costoMes: 380_000, adelantos: 0, faltas: 0, tardes: 1 },
  { nombre: "Bruno Méndez", rol: "Delivery", turno: "Noche", horasMes: 120, costoMes: 295_000, adelantos: 0, faltas: 2, tardes: 4 },
];

export const laborStats = {
  costoTotal: 2_880_000,
  ratio: 27,
  empleadosActivos: 6,
  adelantosPendientes: 80_000,
};

// ---------- CLIENTES ----------
export const customers = [
  { nombre: "Sofía Martínez", canal: "WhatsApp", visitas: 18, ultima: "Ayer", ticket: 14_200, estado: "frecuente" },
  { nombre: "Edificio Av. Córdoba 4500", canal: "Delivery", visitas: 24, ultima: "Hace 2 días", ticket: 9_800, estado: "frecuente" },
  { nombre: "Tomás Acuña", canal: "Salón", visitas: 11, ultima: "Hace 5 días", ticket: 11_400, estado: "frecuente" },
  { nombre: "Camila Ruiz", canal: "WhatsApp", visitas: 6, ultima: "Hace 22 días", ticket: 13_100, estado: "inactivo" },
  { nombre: "Oficina Crehana", canal: "Delivery", visitas: 9, ultima: "Hace 31 días", ticket: 22_500, estado: "inactivo" },
  { nombre: "Familia Iglesias", canal: "Salón", visitas: 14, ultima: "Hace 3 días", ticket: 18_600, estado: "frecuente" },
];

// ---------- REPORTES IA — sugerencias de chat ----------
export const reportSuggestions = [
  "¿Cuánto vendimos este mes?",
  "¿Qué proveedor aumentó más?",
  "¿Qué producto deja mejor margen?",
  "¿Cuánto necesitamos vender por día?",
  "¿Qué gastos están creciendo?",
  "¿Qué recomendación tomarías esta semana?",
];

export const reportInsights = [
  {
    titulo: "Margen por producto",
    detalle: "La Clásica deja 61% de margen y representa el 38% de las ventas.",
    metrica: "61%",
    tendencia: "up",
  },
  {
    titulo: "Proveedor con mayor aumento",
    detalle: "Don José subió 14% el kilo de carne en la última compra.",
    metrica: "+14%",
    tendencia: "down",
  },
  {
    titulo: "Punto de equilibrio diario",
    detalle: "Necesitás $620.000 por día. Vas 11 de 16 días por encima.",
    metrica: "$620k",
    tendencia: "neutral",
  },
  {
    titulo: "Canal más rentable",
    detalle: "WhatsApp tiene ticket promedio $13.900 y margen 36%.",
    metrica: "36%",
    tendencia: "up",
  },
];

// ---------- ATENCIÓN HOY (Dashboard) ----------
export type Priority = "alta" | "media" | "baja";
export const attentionItems: {
  id: string;
  priority: Priority;
  title: string;
  detail: string;
  cta: string;
  href: string;
  tag: string;
}[] = [
  {
    id: "att1",
    priority: "alta",
    title: "Margen bajo en Bacon Lover",
    detail: "Pasó de 52% a 48,8% por aumento del bacon y la carne. Recomendamos subir $600 o revisar receta.",
    cta: "Ver impacto",
    href: "/productos",
    tag: "Producto",
  },
  {
    id: "att2",
    priority: "alta",
    title: "Don José aumentó 14% la carne",
    detail: "Frigorífico Sur cotiza $9.450/kg (vs $10.260). Ahorro estimado: $16.200 por compra de 20kg.",
    cta: "Comparar proveedores",
    href: "/compras",
    tag: "Compras",
  },
  {
    id: "att3",
    priority: "media",
    title: "Martes con baja venta y alto costo laboral",
    detail: "Promedio últimos 4 martes: venta $478k, costo laboral 39%. Sugerimos reducir un turno o lanzar combo del martes.",
    cta: "Ver planificación",
    href: "/empleados",
    tag: "Operación",
  },
  {
    id: "att4",
    priority: "media",
    title: "3 movimientos pendientes de aprobar",
    detail: "Compras y un cierre de ventas esperando tu OK desde WhatsApp.",
    cta: "Abrir Inbox",
    href: "/inbox",
    tag: "Inbox IA",
  },
];

// ---------- SPARKLINES KPIs Dashboard ----------
export const kpiSparklines = {
  ventasHoy: [4, 3, 5, 6, 4, 7, 8, 6, 9, 7, 11, 10],
  ventasMes: [8, 9, 7, 10, 12, 11, 13, 12, 14, 13, 15, 14],
  margen: [33, 33, 32, 32, 31, 31, 32, 31, 31, 30, 31, 31],
  costos: [9, 10, 11, 10, 11, 12, 12, 13, 12, 13, 12, 13],
};

// ---------- INBOX — conversación bidireccional ----------
export type ChatTurn = {
  from: "user" | "ai";
  text: string;
  time: string;
};

export const conversations: Record<string, ChatTurn[]> = {
  m1: [
    { from: "user", time: "14:02", text: "Compramos 20kg de carne a Don José por 180mil. Pagamos por transferencia." },
    { from: "ai", time: "14:02", text: "Perfecto Mateo. Detecté una compra de insumo. ¿Querés asociarla a stock de cocina o stock general?" },
    { from: "user", time: "14:03", text: "Stock cocina." },
    { from: "ai", time: "14:03", text: "Listo. Lo dejo pendiente de aprobación en el Inbox. Sumé el costo al margen de los productos que usan carne." },
  ],
  m2: [
    { from: "user", time: "23:45", text: "Hoy vendimos $850.000: local $500.000, delivery $250.000 y WhatsApp $100.000" },
    { from: "ai", time: "23:45", text: "Anotado. ¿Sumo también las propinas o las separamos?" },
    { from: "user", time: "23:46", text: "Separadas, fueron $42.000." },
    { from: "ai", time: "23:46", text: "Perfecto, registro el cierre de ventas y dejo las propinas como movimiento aparte." },
  ],
  m3: [
    { from: "user", time: "11:32", text: "A Juan le dimos un adelanto de $30.000" },
    { from: "ai", time: "11:32", text: "Confirmo: adelanto a Juan Pérez por $30.000. ¿Lo descuento del próximo sueldo o lo dejo como anticipo?" },
    { from: "user", time: "11:33", text: "Descuento del próximo sueldo." },
    { from: "ai", time: "11:33", text: "Hecho. Lo agrego al recibo de junio." },
  ],
  m4: [
    { from: "user", time: "09:18", text: "[Foto del ticket de panadería La Espiga]" },
    { from: "ai", time: "09:18", text: "Leí el ticket: 120 unidades de pan brioche, total $62.400. ¿Cómo lo pagaste? Necesito ese dato para registrar." },
  ],
  m5: [
    { from: "user", time: "08:10", text: "El alquiler de mayo fue $450.000" },
    { from: "ai", time: "08:10", text: "Registrado como gasto fijo de alquiler. ¿Confirmo que fue por transferencia a Roberto?" },
    { from: "user", time: "08:11", text: "Sí." },
    { from: "ai", time: "08:11", text: "Listo, lo marqué como pagado." },
  ],
  m6: [
    { from: "user", time: "20:55", text: "Quedan 8kg de cheddar" },
    { from: "ai", time: "20:55", text: "Stock actualizado. A este ritmo te cubre 2 días. ¿Te armo el pedido a La Serenísima?" },
    { from: "user", time: "20:56", text: "Dale, 10kg." },
    { from: "ai", time: "20:56", text: "Pedido borrador listo, lo dejo para aprobar en compras." },
  ],
  m7: [
    { from: "user", time: "10:04", text: "El proveedor de pan aumentó 12%" },
    { from: "ai", time: "10:04", text: "Tomado. Recalculo el margen de los productos que usan pan brioche y actualizo la lista de precios sugeridos." },
  ],
};

// ---------- PRODUCTOS — recetas detalladas ----------
export type Ingrediente = {
  nombre: string;
  cantidad: string;
  costoUnit: number;
  share: number;
};

export const recipes: Record<string, Ingrediente[]> = {
  "Clásica La Birra": [
    { nombre: "Medallón 180g", cantidad: "180 g", costoUnit: 1_848, share: 53.6 },
    { nombre: "Pan brioche", cantidad: "1 u", costoUnit: 520, share: 15.1 },
    { nombre: "Cheddar", cantidad: "30 g", costoUnit: 252, share: 7.3 },
    { nombre: "Lechuga + tomate", cantidad: "20 g", costoUnit: 140, share: 4.1 },
    { nombre: "Salsa de la casa", cantidad: "15 g", costoUnit: 90, share: 2.6 },
    { nombre: "Packaging + descartables", cantidad: "—", costoUnit: 600, share: 17.4 },
  ],
  "Doble Cheddar": [
    { nombre: "2x Medallón 180g", cantidad: "360 g", costoUnit: 3_696, share: 72.2 },
    { nombre: "Pan brioche", cantidad: "1 u", costoUnit: 520, share: 10.2 },
    { nombre: "Doble cheddar", cantidad: "60 g", costoUnit: 504, share: 9.8 },
    { nombre: "Cebolla caramelizada", cantidad: "25 g", costoUnit: 110, share: 2.1 },
    { nombre: "Packaging + descartables", cantidad: "—", costoUnit: 290, share: 5.7 },
  ],
  "Bacon Lover": [
    { nombre: "Medallón 180g", cantidad: "180 g", costoUnit: 1_848, share: 29.1 },
    { nombre: "Bacon ahumado", cantidad: "50 g", costoUnit: 2_100, share: 33.1 },
    { nombre: "Pan brioche", cantidad: "1 u", costoUnit: 520, share: 8.2 },
    { nombre: "Cheddar", cantidad: "30 g", costoUnit: 252, share: 4.0 },
    { nombre: "Salsa BBQ", cantidad: "20 g", costoUnit: 180, share: 2.8 },
    { nombre: "Packaging + descartables", cantidad: "—", costoUnit: 1_450, share: 22.8 },
  ],
  "Veggie": [
    { nombre: "Medallón vegetal", cantidad: "150 g", costoUnit: 1_650, share: 53.2 },
    { nombre: "Pan integral", cantidad: "1 u", costoUnit: 480, share: 15.5 },
    { nombre: "Provolone", cantidad: "30 g", costoUnit: 320, share: 10.3 },
    { nombre: "Rúcula + tomate", cantidad: "25 g", costoUnit: 180, share: 5.8 },
    { nombre: "Packaging + descartables", cantidad: "—", costoUnit: 470, share: 15.2 },
  ],
  "Papas rústicas": [
    { nombre: "Papa 4ta gama", cantidad: "250 g", costoUnit: 720, share: 64.3 },
    { nombre: "Aceite girasol", cantidad: "40 ml", costoUnit: 110, share: 9.8 },
    { nombre: "Sal ahumada + romero", cantidad: "—", costoUnit: 50, share: 4.5 },
    { nombre: "Packaging", cantidad: "—", costoUnit: 240, share: 21.4 },
  ],
  "Combo Clásico": [
    { nombre: "Clásica La Birra", cantidad: "1 u", costoUnit: 3_450, share: 56.6 },
    { nombre: "Papas rústicas", cantidad: "1 u", costoUnit: 1_120, share: 18.4 },
    { nombre: "Bebida 500ml", cantidad: "1 u", costoUnit: 900, share: 14.7 },
    { nombre: "Packaging combo", cantidad: "—", costoUnit: 630, share: 10.3 },
  ],
  "Coca 500ml": [
    { nombre: "Coca-Cola 500ml", cantidad: "1 u", costoUnit: 720, share: 80.0 },
    { nombre: "Vaso + sorbete", cantidad: "—", costoUnit: 180, share: 20.0 },
  ],
  "IPA Artesanal": [
    { nombre: "Cerveza IPA 473ml", cantidad: "1 u", costoUnit: 1_650, share: 86.8 },
    { nombre: "Posavasos + descartable", cantidad: "—", costoUnit: 250, share: 13.2 },
  ],
};

export const productRecommendations: Record<
  string,
  { action: string; detail: string; impact: string; tone: "warn" | "info" | "success" | "danger" }[]
> = {
  "Bacon Lover": [
    { action: "Subir precio $600", detail: "De $12.400 a $13.000 mantiene margen sobre 52%.", impact: "+$84k/mes", tone: "warn" },
    { action: "Cotizar bacon alternativo", detail: "Frigorífico Sur lo cotiza 9% más barato.", impact: "+1,8 pts margen", tone: "info" },
    { action: "Reducir porción de bacon a 40g", detail: "Bajaría 18% el costo del topping sin afectar percepción.", impact: "+2,4 pts margen", tone: "success" },
  ],
  "IPA Artesanal": [
    { action: "Promocionar 2x1 los martes", detail: "Producto premium con baja rotación entre semana.", impact: "+12% volumen", tone: "info" },
    { action: "Cambiar a IPA local", detail: "Tres cervecerías cotizan 20% menos.", impact: "+4 pts margen", tone: "success" },
  ],
  "Clásica La Birra": [
    { action: "Mantener precio", detail: "Producto estrella, alta elasticidad. No tocar este trimestre.", impact: "—", tone: "success" },
  ],
};

// ---------- EMPLEADOS — turnos semanales ----------
export type Shift = { dia: string; from: string; to: string; horas: number };
export const weeklyShifts: Record<string, Shift[]> = {
  "Juan Pérez": [
    { dia: "Mar", from: "18:00", to: "00:00", horas: 6 },
    { dia: "Mié", from: "18:00", to: "00:00", horas: 6 },
    { dia: "Jue", from: "18:00", to: "00:00", horas: 6 },
    { dia: "Vie", from: "18:00", to: "01:00", horas: 7 },
    { dia: "Sáb", from: "18:00", to: "01:00", horas: 7 },
  ],
  "Mariana López": [
    { dia: "Mar", from: "12:00", to: "16:00", horas: 4 },
    { dia: "Mié", from: "12:00", to: "16:00", horas: 4 },
    { dia: "Jue", from: "12:00", to: "16:00", horas: 4 },
    { dia: "Vie", from: "12:00", to: "16:00", horas: 4 },
    { dia: "Sáb", from: "12:00", to: "16:00", horas: 4 },
    { dia: "Dom", from: "12:00", to: "16:00", horas: 4 },
  ],
  "Lucía Romero": [
    { dia: "Mar", from: "12:00", to: "00:00", horas: 8 },
    { dia: "Mié", from: "12:00", to: "00:00", horas: 8 },
    { dia: "Jue", from: "12:00", to: "00:00", horas: 8 },
    { dia: "Vie", from: "12:00", to: "01:00", horas: 9 },
    { dia: "Sáb", from: "12:00", to: "01:00", horas: 9 },
    { dia: "Dom", from: "12:00", to: "23:00", horas: 7 },
  ],
  "Diego Sosa": [
    { dia: "Jue", from: "19:00", to: "01:00", horas: 6 },
    { dia: "Vie", from: "19:00", to: "02:00", horas: 7 },
    { dia: "Sáb", from: "19:00", to: "02:00", horas: 7 },
    { dia: "Dom", from: "19:00", to: "00:00", horas: 5 },
  ],
  "Florencia Gil": [
    { dia: "Mié", from: "17:00", to: "23:00", horas: 6 },
    { dia: "Jue", from: "17:00", to: "23:00", horas: 6 },
    { dia: "Vie", from: "17:00", to: "00:00", horas: 7 },
    { dia: "Sáb", from: "17:00", to: "00:00", horas: 7 },
  ],
  "Bruno Méndez": [
    { dia: "Jue", from: "20:00", to: "00:00", horas: 4 },
    { dia: "Vie", from: "20:00", to: "01:00", horas: 5 },
    { dia: "Sáb", from: "20:00", to: "01:00", horas: 5 },
  ],
};

export const employeeAlerts: { empleado: string; tipo: string; tone: "warn" | "danger" | "info" }[] = [
  { empleado: "Bruno Méndez", tipo: "4 llegadas tarde este mes", tone: "danger" },
  { empleado: "Juan Pérez", tipo: "2 adelantos pendientes ($30k)", tone: "warn" },
  { empleado: "Diego Sosa", tipo: "Adelanto pendiente $50k", tone: "warn" },
  { empleado: "Mariana López", tipo: "1 falta justificada", tone: "info" },
];

export const laborByDay = [
  { dia: "Lun", ventas: 590_000, laboral: 96_000 },
  { dia: "Mar", ventas: 460_000, laboral: 180_000 },
  { dia: "Mié", ventas: 712_000, laboral: 168_000 },
  { dia: "Jue", ventas: 820_000, laboral: 196_000 },
  { dia: "Vie", ventas: 1_140_000, laboral: 248_000 },
  { dia: "Sáb", ventas: 1_320_000, laboral: 268_000 },
  { dia: "Dom", ventas: 980_000, laboral: 184_000 },
];

// ---------- REPORTES IA — decisiones recomendadas ----------
export type Decision = {
  id: string;
  prioridad: Priority;
  titulo: string;
  motivo: string;
  impacto: string;
  confianza: number;
  area: string;
};

export const weeklyDecisions: Decision[] = [
  {
    id: "d1",
    prioridad: "alta",
    titulo: "Cambiar proveedor de carne a Frigorífico Sur",
    motivo: "Don José aumentó 14% y dejó la carne 8% por encima del promedio del mercado.",
    impacto: "+$162.000 / mes",
    confianza: 0.93,
    area: "Compras",
  },
  {
    id: "d2",
    prioridad: "alta",
    titulo: "Subir 4% el precio de Doble Cheddar y Bacon Lover",
    motivo: "Productos premium con margen erosionado y demanda inelástica.",
    impacto: "+$210.000 / mes",
    confianza: 0.88,
    area: "Productos",
  },
  {
    id: "d3",
    prioridad: "media",
    titulo: "Lanzar combo del martes por WhatsApp",
    motivo: "Día con menor venta y mayor costo laboral relativo. WhatsApp tiene mejor ticket.",
    impacto: "+$120.000 / semana",
    confianza: 0.76,
    area: "Marketing",
  },
  {
    id: "d4",
    prioridad: "baja",
    titulo: "Reducir un cocinero el martes 19-23",
    motivo: "Costo laboral del martes a la noche es 2x el promedio sobre ventas.",
    impacto: "+$48.000 / mes",
    confianza: 0.69,
    area: "Equipo",
  },
];

// ---------- DASHBOARD — métricas Hoy ----------
export const todaySnapshot = {
  ventasHoy: 742_500,
  tickets: 58,
  ticketProm: 12_800,
  movimientosPendientes: 3,
  margenHoy: 33.4,
  costoHoyPct: 66.6,
};

// ---------- INTELIGENCIA OPERATIVA (ERP conversacional) ----------
export const operationalIntelligence: {
  id: string;
  icon: "stock" | "caja" | "costo" | "canal" | "trend";
  tone: "warn" | "danger" | "info" | "success";
  title: string;
  detail: string;
  action?: { label: string; href: string };
}[] = [
  {
    id: "op1",
    icon: "stock",
    tone: "warn",
    title: "Vendiste 36 burgers pero el stock consumido no coincide",
    detail: "Debería haberse descontado 6,5 kg de carne. Sólo se registraron 5,4 kg. Diferencia ≈ 1,1 kg / $11.300.",
    action: { label: "Auditar consumo", href: "/stock" },
  },
  {
    id: "op2",
    icon: "caja",
    tone: "info",
    title: "El retiro de socios representa 33% de la caja del día",
    detail: "$230.000 sobre $693.000. Por encima del límite sugerido (20%). Revisar política de retiros.",
    action: { label: "Ver cierre", href: "/cierres" },
  },
  {
    id: "op3",
    icon: "costo",
    tone: "danger",
    title: "El costo operativo del foodtruck está 9% por encima del promedio",
    detail: "Insumos + combustible + Día Licha. Sugerimos revisar contrato de gas y consumo de descartables.",
    action: { label: "Ver costos", href: "/gastos" },
  },
  {
    id: "op4",
    icon: "canal",
    tone: "success",
    title: "La venta por QR aumentó 18% esta semana",
    detail: "Pasó de $151k a $178k diarios promedio. Buen momento para empujar el descuento de Mercado Pago.",
    action: { label: "Ver ventas", href: "/ventas" },
  },
];

// ---------- FACTURAS / OCR ----------
export type InvoiceStatus =
  | "procesando"
  | "revision"
  | "aprobado"
  | "contador";

export type InvoiceItem = {
  desc: string;
  qty: string;
  unit: number;
  total: number;
  matched?: string;
};

export type Invoice = {
  id: string;
  proveedor: string;
  cuit: string;
  numero: string;
  tipo: "A" | "B" | "C";
  fecha: string;
  recibida: Date;
  source: "foto" | "pdf";
  status: InvoiceStatus;
  confidence: number;
  metodoPago: string;
  subtotal: number;
  iva: number;
  total: number;
  items: InvoiceItem[];
  sender: string;
  vencimiento?: string;
};

export const invoices: Invoice[] = [
  {
    id: "f1",
    proveedor: "Frigorífico Don José",
    cuit: "30-71238412-5",
    numero: "A-0004-00012845",
    tipo: "A",
    fecha: "16/05/2026",
    vencimiento: "30/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 12),
    source: "foto",
    status: "revision",
    confidence: 0.94,
    metodoPago: "Transferencia",
    subtotal: 148_760,
    iva: 31_240,
    total: 180_000,
    sender: "Mateo Iglesias",
    items: [
      { desc: "Carne premium 180g - corte", qty: "20 kg", unit: 7_438, total: 148_760, matched: "Carne premium 180g" },
    ],
  },
  {
    id: "f2",
    proveedor: "Panadería La Espiga",
    cuit: "30-66781234-2",
    numero: "B-0002-00009881",
    tipo: "B",
    fecha: "15/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 3),
    source: "foto",
    status: "procesando",
    confidence: 0.0,
    metodoPago: "Pendiente",
    subtotal: 51_570,
    iva: 10_830,
    total: 62_400,
    sender: "Lucía Romero",
    items: [
      { desc: "Pan brioche x 120 unidades", qty: "120 u", unit: 430, total: 51_570, matched: "Pan brioche" },
    ],
  },
  {
    id: "f3",
    proveedor: "La Serenísima",
    cuit: "30-50000003-2",
    numero: "A-0011-00345122",
    tipo: "A",
    fecha: "14/05/2026",
    vencimiento: "28/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 26),
    source: "pdf",
    status: "aprobado",
    confidence: 0.98,
    metodoPago: "Cuenta corriente · 14 días",
    subtotal: 69_421,
    iva: 14_579,
    total: 84_000,
    sender: "Mateo Iglesias",
    items: [
      { desc: "Cheddar block 1kg", qty: "10 kg", unit: 6_942, total: 69_421, matched: "Queso cheddar" },
    ],
  },
  {
    id: "f4",
    proveedor: "Coca-Cola FEMSA",
    cuit: "30-50000694-1",
    numero: "A-0009-00012445",
    tipo: "A",
    fecha: "12/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 80),
    source: "pdf",
    status: "contador",
    confidence: 0.99,
    metodoPago: "Cuenta corriente · 30 días",
    subtotal: 79_339,
    iva: 16_661,
    total: 96_000,
    sender: "Mateo Iglesias",
    items: [
      { desc: "Coca-Cola 500ml x 24u", qty: "4 cajas", unit: 19_835, total: 79_339, matched: "Gaseosas 500ml" },
    ],
  },
  {
    id: "f5",
    proveedor: "Verdulería Centro",
    cuit: "27-32145698-7",
    numero: "C-0001-00002238",
    tipo: "C",
    fecha: "13/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 50),
    source: "foto",
    status: "aprobado",
    confidence: 0.86,
    metodoPago: "Efectivo",
    subtotal: 28_400,
    iva: 0,
    total: 28_400,
    sender: "Lucía Romero",
    items: [
      { desc: "Lechuga manteca", qty: "6 kg", unit: 1_900, total: 11_400, matched: "Lechuga" },
      { desc: "Tomate redondo", qty: "6 kg", unit: 2_833, total: 17_000, matched: "Tomate" },
    ],
  },
  {
    id: "f6",
    proveedor: "Frigorífico Sur",
    cuit: "30-71540032-9",
    numero: "A-0007-00001102",
    tipo: "A",
    fecha: "10/05/2026",
    vencimiento: "24/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 168),
    source: "pdf",
    status: "contador",
    confidence: 0.97,
    metodoPago: "Transferencia",
    subtotal: 163_223,
    iva: 34_277,
    total: 197_500,
    sender: "Mateo Iglesias",
    items: [
      { desc: "Carne premium 180g", qty: "25 kg", unit: 6_529, total: 163_223, matched: "Carne premium 180g" },
    ],
  },
];

// ---------- CIERRES DIARIOS (foodtruck-style) ----------
export type Closure = {
  id: string;
  punto: string;
  fecha: string;
  recibida: Date;
  sender: string;
  raw: string;
  parsed: {
    ingresos: { medio: string; monto: number }[];
    gastos: { concepto: string; monto: number }[];
    retiros: { concepto: string; monto: number }[];
    cambio: number;
    productos: { nombre: string; cantidad: number }[];
    total: number;
    neto: number;
  };
  inconsistencias: { tone: "warn" | "danger" | "info"; msg: string }[];
  status: "pendiente" | "aprobado";
};

export const closures: Closure[] = [
  {
    id: "c1",
    punto: "CARRO foodtruck",
    fecha: "16/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 25),
    sender: "Día Licha",
    status: "pendiente",
    raw: `CARRO foodtruck 16/05

EFECTIVO: $290.000
TARJETA: $225.000
QR: $178.000

TOTAL: $693.000

GASTOS:
$60.000 (DIA LICHA)

RETIRO: $230.000

CAMBIO: $8.000

Burgers: 36`,
    parsed: {
      ingresos: [
        { medio: "Efectivo", monto: 290_000 },
        { medio: "Tarjeta", monto: 225_000 },
        { medio: "QR", monto: 178_000 },
      ],
      gastos: [{ concepto: "Día Licha", monto: 60_000 }],
      retiros: [{ concepto: "Retiro socios", monto: 230_000 }],
      cambio: 8_000,
      productos: [{ nombre: "Burgers", cantidad: 36 }],
      total: 693_000,
      neto: 403_000,
    },
    inconsistencias: [
      {
        tone: "warn",
        msg: "36 burgers vendidos pero el consumo de carne registrado equivale a 30 burgers (5,4 kg).",
      },
      {
        tone: "info",
        msg: "El retiro de socios representa el 33% del bruto del día (sugerido máx. 20%).",
      },
    ],
  },
  {
    id: "c2",
    punto: "CARRO foodtruck",
    fecha: "15/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 22),
    sender: "Día Licha",
    status: "aprobado",
    raw: `CARRO foodtruck 15/05

EFECTIVO: $245.000
TARJETA: $198.000
QR: $151.000

TOTAL: $594.000

GASTOS:
$45.000 (descartables)

RETIRO: $120.000

Burgers: 31`,
    parsed: {
      ingresos: [
        { medio: "Efectivo", monto: 245_000 },
        { medio: "Tarjeta", monto: 198_000 },
        { medio: "QR", monto: 151_000 },
      ],
      gastos: [{ concepto: "Descartables", monto: 45_000 }],
      retiros: [{ concepto: "Retiro socios", monto: 120_000 }],
      cambio: 0,
      productos: [{ nombre: "Burgers", cantidad: 31 }],
      total: 594_000,
      neto: 429_000,
    },
    inconsistencias: [],
  },
  {
    id: "c3",
    punto: "Local Palermo",
    fecha: "16/05/2026",
    recibida: new Date(Date.now() - 1000 * 60 * 60 * 1),
    sender: "Lucía Romero",
    status: "pendiente",
    raw: `LOCAL 16/05 cierre noche

Efectivo $185.000
MercadoPago $260.000
Tarjeta $295.000
PedidosYa $102.500

Propinas: $42.000
Anticipo Diego $50.000

Total bruto: $842.500
Total neto: $750.500`,
    parsed: {
      ingresos: [
        { medio: "Efectivo", monto: 185_000 },
        { medio: "MercadoPago", monto: 260_000 },
        { medio: "Tarjeta", monto: 295_000 },
        { medio: "PedidosYa", monto: 102_500 },
      ],
      gastos: [],
      retiros: [
        { concepto: "Anticipo Diego", monto: 50_000 },
        { concepto: "Propinas separadas", monto: 42_000 },
      ],
      cambio: 0,
      productos: [],
      total: 842_500,
      neto: 750_500,
    },
    inconsistencias: [
      {
        tone: "info",
        msg: "Las propinas quedaron registradas como movimiento aparte, no afectan margen.",
      },
    ],
  },
];

// ---------- HISTORIAL DE COSTOS POR INSUMO ----------
export type CostPoint = { fecha: string; precio: number };

export const ingredientCostHistory: Record<string, CostPoint[]> = {
  "Carne premium 180g": [
    { fecha: "Ene", precio: 7_400 },
    { fecha: "Feb", precio: 7_800 },
    { fecha: "Mar", precio: 8_200 },
    { fecha: "Abr", precio: 9_000 },
    { fecha: "May", precio: 10_260 },
  ],
  "Cheddar": [
    { fecha: "Ene", precio: 7_200 },
    { fecha: "Feb", precio: 7_500 },
    { fecha: "Mar", precio: 7_900 },
    { fecha: "Abr", precio: 8_200 },
    { fecha: "May", precio: 8_400 },
  ],
  "Pan brioche": [
    { fecha: "Ene", precio: 380 },
    { fecha: "Feb", precio: 400 },
    { fecha: "Mar", precio: 430 },
    { fecha: "Abr", precio: 460 },
    { fecha: "May", precio: 520 },
  ],
  "Bacon ahumado": [
    { fecha: "Ene", precio: 31_000 },
    { fecha: "Feb", precio: 33_400 },
    { fecha: "Mar", precio: 36_200 },
    { fecha: "Abr", precio: 39_800 },
    { fecha: "May", precio: 42_000 },
  ],
};

// Costo total del producto mes a mes (último 5)
export const productCostHistory: Record<string, CostPoint[]> = {
  "Clásica La Birra": [
    { fecha: "Ene", precio: 2_780 },
    { fecha: "Feb", precio: 2_960 },
    { fecha: "Mar", precio: 3_120 },
    { fecha: "Abr", precio: 3_280 },
    { fecha: "May", precio: 3_450 },
  ],
  "Doble Cheddar": [
    { fecha: "Ene", precio: 4_150 },
    { fecha: "Feb", precio: 4_420 },
    { fecha: "Mar", precio: 4_680 },
    { fecha: "Abr", precio: 4_880 },
    { fecha: "May", precio: 5_120 },
  ],
  "Bacon Lover": [
    { fecha: "Ene", precio: 5_100 },
    { fecha: "Feb", precio: 5_420 },
    { fecha: "Mar", precio: 5_780 },
    { fecha: "Abr", precio: 6_080 },
    { fecha: "May", precio: 6_350 },
  ],
  "Veggie": [
    { fecha: "Ene", precio: 2_800 },
    { fecha: "Feb", precio: 2_900 },
    { fecha: "Mar", precio: 2_980 },
    { fecha: "Abr", precio: 3_040 },
    { fecha: "May", precio: 3_100 },
  ],
};

export const costingAlerts: { tone: "warn" | "danger" | "info"; title: string; detail: string }[] = [
  {
    tone: "danger",
    title: "Bacon Lover perdió 8% de margen este mes",
    detail: "El aumento de bacon (+5,5%) y carne (+14%) erosionó la rentabilidad.",
  },
  {
    tone: "warn",
    title: "El aumento de cheddar impactó en 5 productos",
    detail: "Clásica, Doble, Bacon Lover, Combo y Veggie tuvieron +$120 a +$280 de costo extra.",
  },
  {
    tone: "info",
    title: "Sugerencia: subir Doble Cheddar $400 para mantener rentabilidad",
    detail: "Cubriría el aumento acumulado de los últimos 60 días sin afectar demanda.",
  },
];

// ---------- MARKETING IA / CENTRO DE CRECIMIENTO ----------
export type GrowthArea =
  | "Producto"
  | "Cliente"
  | "Horario"
  | "Canal"
  | "Combo"
  | "Margen";

export const growthSummary = {
  oportunidadMes: 1_280_000,
  clientesReactivar: 42,
  campanasSugeridas: 6,
  productosSubperformantes: 3,
};

export const growthInsights: {
  id: string;
  prioridad: Priority;
  area: GrowthArea;
  titulo: string;
  detalle: string;
  impacto: string;
  confianza: number;
  cta: string;
}[] = [
  {
    id: "g1",
    prioridad: "alta",
    area: "Horario",
    titulo: "Los martes tienen 38% menos venta que el promedio",
    detalle: "Mejor momento para empujar una promo de combos por WhatsApp e Instagram. Tu base ya pidió 2 veces los últimos 30 días.",
    impacto: "+$140.000 / semana",
    confianza: 0.86,
    cta: "Generar promo del martes",
  },
  {
    id: "g2",
    prioridad: "alta",
    area: "Cliente",
    titulo: "42 clientes frecuentes están inactivos hace más de 21 días",
    detalle: "Pidieron 3+ veces y no volvieron. Ticket promedio histórico: $13.400. Listos para campaña de reactivación con beneficio.",
    impacto: "+$560.000 / mes",
    confianza: 0.91,
    cta: "Crear campaña de reactivación",
  },
  {
    id: "g3",
    prioridad: "media",
    area: "Producto",
    titulo: "Bacon Lover tiene alto margen y baja salida",
    detalle: "Margen 49% pero sólo 6% de las ventas. La IA propone empujarla como combo o pack con cerveza para subir su rotación.",
    impacto: "+$210.000 / mes",
    confianza: 0.79,
    cta: "Sugerir combo destacado",
  },
  {
    id: "g4",
    prioridad: "media",
    area: "Combo",
    titulo: "El Combo Clásico es tu producto más rentable",
    detalle: "Margen 58% y representa el 32% de las ventas. Podemos protagonizarlo en historias de Instagram tres veces por semana.",
    impacto: "+$95.000 / semana",
    confianza: 0.84,
    cta: "Armar plan de contenido",
  },
  {
    id: "g5",
    prioridad: "baja",
    area: "Canal",
    titulo: "WhatsApp tiene 3x mejor conversión que Instagram",
    detalle: "Ticket promedio $13.900 vs $8.600. Sugerimos migrar parte del presupuesto de Meta Ads hacia listas de difusión segmentadas.",
    impacto: "+18% ROAS",
    confianza: 0.73,
    cta: "Ver plan de reasignación",
  },
  {
    id: "g6",
    prioridad: "baja",
    area: "Margen",
    titulo: "Subir bebidas $200 no afectaría conversión",
    detalle: "Comparativa con 4 hamburgueserías premium: tus bebidas están 12% por debajo del rango. Suba blanda y de bajo riesgo.",
    impacto: "+$78.000 / mes",
    confianza: 0.76,
    cta: "Aplicar nuevo precio",
  },
];

export type GrowthCampaign = {
  id: string;
  nombre: string;
  canal: "WhatsApp" | "Instagram";
  tipo: "Promoción" | "Reactivación" | "Lanzamiento" | "Contenido";
  audiencia: string;
  alcance: number;
  enviarA: string;
  copy: string;
  caption?: string;
  cta: string;
  horario: string;
  impacto: string;
  confianza: number;
  estado: "sugerida" | "lista" | "programada";
};

export const suggestedCampaigns: GrowthCampaign[] = [
  {
    id: "cp1",
    nombre: "Promo Martes Combos",
    canal: "WhatsApp",
    tipo: "Promoción",
    audiencia: "Clientes frecuentes salón + delivery",
    alcance: 184,
    enviarA: "Lista difusión · Birra VIP",
    copy: `Hola {{nombre}} 👋
Hoy martes te armamos algo especial:
Combo Clásico (Burger + Papas + Bebida) por $11.900 — ahorrás $2.600.

¿Te lo pasamos a buscar o vas al local? Respondé a este mensaje y te lo dejamos listo en 15 min. 🍔`,
    cta: "Pedir por WhatsApp",
    horario: "Martes 18:30",
    impacto: "+$140.000 estimado / martes",
    confianza: 0.86,
    estado: "sugerida",
  },
  {
    id: "cp2",
    nombre: "Reactivación 21 días sin pedir",
    canal: "WhatsApp",
    tipo: "Reactivación",
    audiencia: "42 clientes inactivos hace >21 días",
    alcance: 42,
    enviarA: "Segmento · Inactivos VIP",
    copy: `{{nombre}}, te extrañamos 🍔
Hace un tiempo no pasás por La Birra. Te dejamos 15% off en tu próximo pedido — usá el código VOLVE15 cuando nos escribas.

Válido hasta el domingo. ¿Te tentamos con una Doble Cheddar? 🧀`,
    cta: "Pedir con código VOLVE15",
    horario: "Jueves 13:00",
    impacto: "+$560.000 estimado / mes",
    confianza: 0.91,
    estado: "sugerida",
  },
  {
    id: "cp3",
    nombre: "Empujar Bacon Lover",
    canal: "Instagram",
    tipo: "Contenido",
    audiencia: "Seguidores + audiencias similares (Meta)",
    alcance: 12_400,
    enviarA: "Feed + reel + 3 historias",
    caption: `🥓 No es una hamburguesa más. Es la Bacon Lover.
Medallón 180g + cheddar + bacon ahumado real + salsa BBQ de la casa.

Esta semana: combo Bacon Lover + papas + IPA por $15.900.
Pedila por WhatsApp, delivery o en el local. 📍 Palermo`,
    copy: "🥓 No es una hamburguesa más. Es la Bacon Lover.",
    cta: "Pedir online",
    horario: "Mar/Vie 19:00",
    impacto: "+$210.000 estimado / mes",
    confianza: 0.79,
    estado: "lista",
  },
  {
    id: "cp4",
    nombre: "Combo Clásico estrella",
    canal: "Instagram",
    tipo: "Contenido",
    audiencia: "Seguidores zona Palermo",
    alcance: 8_900,
    enviarA: "3 historias / semana",
    caption: `El más pedido por algo: Combo Clásico.
Burger 180g + papas rústicas + bebida = $14.500.

✨ Tip: pedilo por WhatsApp y te lo dejamos listo en 20 minutos.`,
    copy: "El más pedido por algo: Combo Clásico.",
    cta: "Reservar mesa",
    horario: "Lun · Mié · Vie 12:00",
    impacto: "+$95.000 estimado / semana",
    confianza: 0.84,
    estado: "sugerida",
  },
];

export const audienceSegments: {
  id: string;
  nombre: string;
  size: number;
  ticketProm: number;
  recencia: string;
  recomendacion: string;
  tone: "brand" | "success" | "warn" | "ai";
}[] = [
  {
    id: "a1",
    nombre: "Birra VIP",
    size: 78,
    ticketProm: 18_200,
    recencia: "<7 días",
    recomendacion: "Adelantar lanzamientos y combos exclusivos.",
    tone: "brand",
  },
  {
    id: "a2",
    nombre: "Frecuentes inactivos",
    size: 42,
    ticketProm: 13_400,
    recencia: "21–45 días",
    recomendacion: "Campaña de reactivación con código por WhatsApp.",
    tone: "warn",
  },
  {
    id: "a3",
    nombre: "Delivery zona Palermo",
    size: 156,
    ticketProm: 11_800,
    recencia: "<14 días",
    recomendacion: "Promo del martes y combo de la semana.",
    tone: "success",
  },
  {
    id: "a4",
    nombre: "Curiosos Instagram",
    size: 1_240,
    ticketProm: 0,
    recencia: "Nunca compró",
    recomendacion: "Reel + historia con CTA directa a WhatsApp.",
    tone: "ai",
  },
];

export const bestHours: { dia: string; tramo: string; medio: "WhatsApp" | "Instagram"; conversion: number }[] = [
  { dia: "Mar", tramo: "18:30 – 20:00", medio: "WhatsApp", conversion: 14.2 },
  { dia: "Jue", tramo: "13:00 – 14:30", medio: "WhatsApp", conversion: 12.8 },
  { dia: "Vie", tramo: "19:00 – 21:00", medio: "Instagram", conversion: 9.6 },
  { dia: "Dom", tramo: "12:00 – 13:30", medio: "Instagram", conversion: 8.9 },
];

export type CopyTone = "Cercano" | "Premium" | "Divertido" | "Urgente";
export type CopyObjective = "Promo" | "Reactivación" | "Lanzamiento" | "Recordatorio";

export const copyLibrary: Record<
  string,
  { whatsapp: string; instagram: string }
> = {
  "Cercano|Promo": {
    whatsapp: `Hola {{nombre}} 👋
Hoy te armamos algo especial:
Combo Clásico por $11.900 — ahorrás $2.600.

¿Te lo dejamos listo en 15 min? 🍔`,
    instagram: `🍔 Hoy es de combo.
Burger 180g + papas + bebida = $11.900.
Pedilo por WhatsApp y lo pasás a buscar caliente. 🔥`,
  },
  "Cercano|Reactivación": {
    whatsapp: `{{nombre}}, te extrañamos 🍔
Hace un tiempo no pasás por La Birra. Te dejamos 15% off con el código VOLVE15.
Válido hasta el domingo.`,
    instagram: `Llevamos varias semanas sin verte.
Usá VOLVE15 esta semana y ahorrá 15% en tu pedido. 💛`,
  },
  "Premium|Promo": {
    whatsapp: `{{nombre}}, edición limitada para vos.
Combo Doble Cheddar + IPA artesanal por $15.900 — sólo esta semana.

Reservá tu pedido respondiendo a este mensaje.`,
    instagram: `Edición limitada.
Combo Doble Cheddar + IPA artesanal — $15.900.
Sólo esta semana en La Birra Burger.`,
  },
  "Premium|Reactivación": {
    whatsapp: `{{nombre}}, queremos que vuelvas.
Te invitamos con un cheddar extra en tu próxima Doble Cheddar.
Mostralo en el local o pedilo por WhatsApp.`,
    instagram: `Cheddar extra de regalo en tu próxima Doble Cheddar.
Por ser parte de La Birra desde el primer día.`,
  },
  "Divertido|Promo": {
    whatsapp: `Martes triste? Combo feliz 🍔
$11.900 te separa de la noche perfecta.
Decí "combo del martes" y lo dejamos listo.`,
    instagram: `Martes ≠ aburrido.
Combo Clásico $11.900. Pedilo y agradecenos después. 🤝`,
  },
  "Divertido|Reactivación": {
    whatsapp: `Eh, {{nombre}}, ¿estás bien? 👀
Hace rato no pedís. Te tiramos un 15% off con VOLVE15.
La cocina te espera.`,
    instagram: `Hace mucho que no nos vemos.
Tiramos VOLVE15 — 15% off esta semana. 💛`,
  },
  "Urgente|Promo": {
    whatsapp: `🚨 SOLO HOY
Combo Clásico $11.900 (precio normal $14.500).
Respondé este mensaje antes de las 22 hs.`,
    instagram: `🚨 Sólo hoy.
Combo Clásico $11.900 hasta las 22 hs.
WhatsApp en bio.`,
  },
  "Urgente|Reactivación": {
    whatsapp: `Última oportunidad: tu código VOLVE15 vence el domingo.
15% off en tu próximo pedido. No lo pierdas, {{nombre}}.`,
    instagram: `Último día con VOLVE15.
15% off antes de medianoche.`,
  },
  "Cercano|Lanzamiento": {
    whatsapp: `Tenemos novedad 🍔
Estrenamos la Smash Onion — doble medallón aplastado y cebolla caramelizada.
Probala esta semana, pedila por WhatsApp.`,
    instagram: `Nueva en la carta: Smash Onion.
Doble medallón, cebolla caramelizada, salsa de la casa.
Sólo esta semana con un precio de lanzamiento.`,
  },
  "Cercano|Recordatorio": {
    whatsapp: `{{nombre}}, te recordamos que tenés tu pedido reservado para hoy.
Te avisamos cuando esté listo. 🍔`,
    instagram: `Reservaste para hoy?
Te recordamos llevarte la entrada — siempre hay birra fría esperándote.`,
  },
  "Premium|Lanzamiento": {
    whatsapp: `Edición limitada · 100 unidades.
Smash Onion: doble medallón, cebolla caramelizada, mostaza ahumada.
Reservá tu unidad respondiendo a este mensaje.`,
    instagram: `Lanzamiento exclusivo.
Smash Onion. 100 unidades. Esta semana.`,
  },
  "Premium|Recordatorio": {
    whatsapp: `Su mesa está reservada para hoy a las 21:00.
Nos vemos en La Birra Burger Palermo.`,
    instagram: `Recordá que tu reserva sigue en pie.
Te esperamos en Palermo.`,
  },
  "Divertido|Lanzamiento": {
    whatsapp: `🚨 nueva burger en la familia
Conocé a Smash Onion. Es como la Clásica pero con onda. 😎
Esta semana en La Birra.`,
    instagram: `Smash Onion entró en escena 🧅🔥
Doble medallón, cebolla caramelizada, hambre.
Esta semana en La Birra.`,
  },
  "Divertido|Recordatorio": {
    whatsapp: `Ey, tu burger te está esperando 🍔
No la dejes plantada. Hoy 21 hs te esperamos.`,
    instagram: `Tu pedido está reservado.
No nos hagas comerla nosotros 😅`,
  },
  "Urgente|Lanzamiento": {
    whatsapp: `🚨 Smash Onion · sólo 100 unidades.
Hoy salieron 47. Reservá la tuya antes de que se agote.`,
    instagram: `Quedan 53 Smash Onion.
Antes de medianoche o se acaba.`,
  },
  "Urgente|Recordatorio": {
    whatsapp: `⚠️ Última hora para retirar tu pedido.
Cerramos cocina a las 23 hs.`,
    instagram: `Si reservaste hoy, pasá antes de las 23 hs.
La cocina cierra puntual.`,
  },
};
