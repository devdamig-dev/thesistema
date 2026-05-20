/**
 * Adaptador "demo".
 *
 * Devuelve los mismos datos que viven en `lib/mock-data.ts` para que
 * la app pueda seguir funcionando sin Supabase. Cada repositorio
 * Supabase tiene una contraparte acá; el switch lo hace
 * `lib/data/index.ts`.
 */

import * as mock from "@/lib/mock-data";

// ---------- BUSINESS ----------
export const business = {
  async getCurrent() {
    return mock.businessInfo;
  },
};

// ---------- DASHBOARD ----------
export const dashboard = {
  async getKpis() {
    return mock.dashboardKpis;
  },
  async getTodaySnapshot() {
    return mock.todaySnapshot;
  },
  async getKpiSparklines() {
    return mock.kpiSparklines;
  },
  async getInsights() {
    return mock.insights;
  },
  async getAttentionItems() {
    return mock.attentionItems;
  },
  async getOperationalIntelligence() {
    return mock.operationalIntelligence;
  },
  async getSalesByDay() {
    return mock.salesByDay;
  },
  async getExpensesByCategory() {
    return mock.expensesByCategory;
  },
  async getRecentActivity() {
    return mock.recentActivity;
  },
};

// ---------- INBOX IA ----------
export const inbox = {
  async list() {
    return mock.inboxItems;
  },
  async getConversation(messageId: string) {
    return mock.conversations[messageId] ?? [];
  },
};

// ---------- FACTURAS ----------
export const invoices = {
  async list() {
    return mock.invoices;
  },
};

// ---------- CIERRES ----------
export const closures = {
  async list() {
    return mock.closures;
  },
};

// ---------- PRODUCTOS ----------
export const products = {
  async list() {
    return mock.products;
  },
  async getRecipe(productName: string) {
    return mock.recipes[productName] ?? [];
  },
  async getCostHistory(productName: string) {
    return mock.productCostHistory[productName];
  },
  async getRecommendations(productName: string) {
    return mock.productRecommendations[productName] ?? [];
  },
  async getCostingAlerts() {
    return mock.costingAlerts;
  },
  async getIngredientCostHistory() {
    return mock.ingredientCostHistory;
  },
};

// ---------- VENTAS ----------
export const sales = {
  async byChannel() {
    return mock.salesByChannel;
  },
  async daily() {
    return mock.dailySalesTable;
  },
  async byDay() {
    return mock.salesByDay;
  },
};

// ---------- COMPRAS ----------
export const purchases = {
  async list() {
    return mock.recentPurchases;
  },
  async topSuppliers() {
    return mock.topSuppliers;
  },
};

// ---------- GASTOS ----------
export const expenses = {
  async fixed() {
    return mock.fixedExpenses;
  },
  async breakEven() {
    return mock.breakEven;
  },
};

// ---------- STOCK ----------
export const stock = {
  async list() {
    return mock.stockItems;
  },
};

// ---------- EMPLEADOS ----------
export const employees = {
  async list() {
    return mock.employees;
  },
  async laborStats() {
    return mock.laborStats;
  },
  async weeklyShifts() {
    return mock.weeklyShifts;
  },
  async alerts() {
    return mock.employeeAlerts;
  },
  async laborByDay() {
    return mock.laborByDay;
  },
};

// ---------- CLIENTES ----------
export const customers = {
  async list() {
    return mock.customers;
  },
};

// ---------- MARKETING IA ----------
export const marketing = {
  async summary() {
    return mock.growthSummary;
  },
  async insights() {
    return mock.growthInsights;
  },
  async campaigns() {
    return mock.suggestedCampaigns;
  },
  async audiences() {
    return mock.audienceSegments;
  },
  async bestHours() {
    return mock.bestHours;
  },
  async copies() {
    return mock.copyLibrary;
  },
};

// ---------- REPORTES ----------
export const reports = {
  async insights() {
    return mock.reportInsights;
  },
  async suggestions() {
    return mock.reportSuggestions;
  },
  async weeklyDecisions() {
    return mock.weeklyDecisions;
  },
};
