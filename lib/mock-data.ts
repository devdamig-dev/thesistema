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
