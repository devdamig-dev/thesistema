/**
 * Seeds por rubro: ingredientes + productos base + recetas sugeridas.
 *
 * No son perfectos pero sí útiles para que el piloto arranque con
 * datos realistas y no con tablas vacías.
 */

import type { Industry } from "@/lib/entities";

export type SeedIngredient = {
  name: string;
  unit: string;
  avg_unit_cost: number;
};

export type SeedProduct = {
  name: string;
  category: string;
  price: number;
  cost: number;
  ingredients: string[];
};

export type IndustrySeed = {
  ingredients: SeedIngredient[];
  products: SeedProduct[];
};

export const SEEDS: Record<Industry, IndustrySeed> = {
  hamburgueseria: {
    ingredients: [
      { name: "Carne premium 180g", unit: "kg", avg_unit_cost: 10260 },
      { name: "Pan brioche", unit: "u", avg_unit_cost: 520 },
      { name: "Queso cheddar", unit: "kg", avg_unit_cost: 8400 },
      { name: "Papas 4ta gama", unit: "kg", avg_unit_cost: 2880 },
      { name: "Bacon ahumado", unit: "kg", avg_unit_cost: 42000 },
      { name: "Lechuga", unit: "kg", avg_unit_cost: 1900 },
      { name: "Tomate", unit: "kg", avg_unit_cost: 2833 },
      { name: "Salsa BBQ", unit: "L", avg_unit_cost: 4500 },
      { name: "Packaging hamburguesa", unit: "u", avg_unit_cost: 600 },
      { name: "Gaseosas 500ml", unit: "u", avg_unit_cost: 1000 },
    ],
    products: [
      { name: "Clásica", category: "Hamburguesa", price: 8900, cost: 3450, ingredients: ["Carne premium 180g", "Pan brioche", "Queso cheddar", "Lechuga", "Tomate"] },
      { name: "Doble Cheddar", category: "Hamburguesa", price: 11500, cost: 5120, ingredients: ["Carne premium 180g", "Pan brioche", "Queso cheddar"] },
      { name: "Papas rústicas", category: "Acompañamiento", price: 4900, cost: 1120, ingredients: ["Papas 4ta gama"] },
      { name: "Coca 500ml", category: "Bebida", price: 2400, cost: 900, ingredients: ["Gaseosas 500ml"] },
    ],
  },
  cafeteria: {
    ingredients: [
      { name: "Café en grano", unit: "kg", avg_unit_cost: 12000 },
      { name: "Leche entera", unit: "L", avg_unit_cost: 1200 },
      { name: "Medialunas", unit: "u", avg_unit_cost: 350 },
      { name: "Tostadas de campo", unit: "u", avg_unit_cost: 280 },
      { name: "Dulce de leche", unit: "kg", avg_unit_cost: 5800 },
      { name: "Mermelada", unit: "kg", avg_unit_cost: 4200 },
      { name: "Azúcar", unit: "kg", avg_unit_cost: 1800 },
      { name: "Vasos descartables", unit: "u", avg_unit_cost: 120 },
    ],
    products: [
      { name: "Café con leche", category: "Bebida caliente", price: 3200, cost: 850, ingredients: ["Café en grano", "Leche entera"] },
      { name: "Medialuna", category: "Panadería", price: 1200, cost: 350, ingredients: ["Medialunas"] },
      { name: "Combo desayuno", category: "Combo", price: 5900, cost: 1800, ingredients: ["Café en grano", "Leche entera", "Medialunas", "Tostadas de campo"] },
    ],
  },
  pizzeria: {
    ingredients: [
      { name: "Harina 000", unit: "kg", avg_unit_cost: 1200 },
      { name: "Muzzarella", unit: "kg", avg_unit_cost: 7800 },
      { name: "Salsa de tomate", unit: "L", avg_unit_cost: 2400 },
      { name: "Jamón cocido", unit: "kg", avg_unit_cost: 9500 },
      { name: "Levadura fresca", unit: "kg", avg_unit_cost: 3200 },
      { name: "Aceite de oliva", unit: "L", avg_unit_cost: 8500 },
      { name: "Cajas pizza", unit: "u", avg_unit_cost: 450 },
    ],
    products: [
      { name: "Muzza grande", category: "Pizza", price: 9500, cost: 3200, ingredients: ["Harina 000", "Muzzarella", "Salsa de tomate"] },
      { name: "Napolitana", category: "Pizza", price: 10500, cost: 3800, ingredients: ["Harina 000", "Muzzarella", "Salsa de tomate", "Jamón cocido"] },
      { name: "Fainá", category: "Acompañamiento", price: 3500, cost: 800, ingredients: ["Harina 000", "Aceite de oliva"] },
    ],
  },
  bar: {
    ingredients: [
      { name: "Cerveza IPA barril", unit: "L", avg_unit_cost: 3500 },
      { name: "Fernet", unit: "L", avg_unit_cost: 8500 },
      { name: "Coca-Cola 2.25L", unit: "u", avg_unit_cost: 2800 },
      { name: "Vodka", unit: "L", avg_unit_cost: 12000 },
      { name: "Limón", unit: "kg", avg_unit_cost: 2200 },
      { name: "Hielo", unit: "kg", avg_unit_cost: 800 },
    ],
    products: [
      { name: "Pinta IPA", category: "Cerveza", price: 4500, cost: 1750, ingredients: ["Cerveza IPA barril"] },
      { name: "Fernet con Coca", category: "Trago", price: 5500, cost: 2200, ingredients: ["Fernet", "Coca-Cola 2.25L", "Hielo"] },
      { name: "Vodka Tonic", category: "Trago", price: 6000, cost: 2800, ingredients: ["Vodka", "Limón", "Hielo"] },
    ],
  },
  foodtruck: {
    ingredients: [
      { name: "Carne premium 180g", unit: "kg", avg_unit_cost: 10260 },
      { name: "Pan brioche", unit: "u", avg_unit_cost: 520 },
      { name: "Queso cheddar", unit: "kg", avg_unit_cost: 8400 },
      { name: "Papas congeladas", unit: "kg", avg_unit_cost: 3200 },
      { name: "Packaging", unit: "u", avg_unit_cost: 650 },
      { name: "Gas propano", unit: "kg", avg_unit_cost: 2500 },
    ],
    products: [
      { name: "Smash Burger", category: "Hamburguesa", price: 7500, cost: 2800, ingredients: ["Carne premium 180g", "Pan brioche", "Queso cheddar"] },
      { name: "Papas fritas", category: "Acompañamiento", price: 3500, cost: 1100, ingredients: ["Papas congeladas"] },
    ],
  },
  heladeria: {
    ingredients: [
      { name: "Crema de leche", unit: "L", avg_unit_cost: 3800 },
      { name: "Leche entera", unit: "L", avg_unit_cost: 1200 },
      { name: "Azúcar", unit: "kg", avg_unit_cost: 1800 },
      { name: "Chocolate cobertura", unit: "kg", avg_unit_cost: 9800 },
      { name: "Dulce de leche", unit: "kg", avg_unit_cost: 5800 },
      { name: "Vasitos / cucuruchos", unit: "u", avg_unit_cost: 250 },
    ],
    products: [
      { name: "1/4 kg helado", category: "Helado", price: 5500, cost: 2200, ingredients: ["Crema de leche", "Azúcar"] },
      { name: "1 kg helado", category: "Helado", price: 16000, cost: 6800, ingredients: ["Crema de leche", "Azúcar", "Leche entera"] },
    ],
  },
  panaderia: {
    ingredients: [
      { name: "Harina 000", unit: "kg", avg_unit_cost: 1200 },
      { name: "Manteca", unit: "kg", avg_unit_cost: 7500 },
      { name: "Huevos", unit: "u", avg_unit_cost: 280 },
      { name: "Levadura fresca", unit: "kg", avg_unit_cost: 3200 },
      { name: "Azúcar", unit: "kg", avg_unit_cost: 1800 },
      { name: "Bolsas kraft", unit: "u", avg_unit_cost: 150 },
    ],
    products: [
      { name: "Medialunas x 12", category: "Panadería", price: 5500, cost: 1800, ingredients: ["Harina 000", "Manteca", "Huevos"] },
      { name: "Pan de campo 1kg", category: "Pan", price: 3200, cost: 950, ingredients: ["Harina 000", "Levadura fresca"] },
    ],
  },
  restaurante: {
    ingredients: [
      { name: "Bife de chorizo", unit: "kg", avg_unit_cost: 14500 },
      { name: "Pollo entero", unit: "kg", avg_unit_cost: 5200 },
      { name: "Papas", unit: "kg", avg_unit_cost: 1800 },
      { name: "Verduras de hoja", unit: "kg", avg_unit_cost: 2500 },
      { name: "Arroz", unit: "kg", avg_unit_cost: 2200 },
      { name: "Vino tinto (copa)", unit: "L", avg_unit_cost: 4500 },
    ],
    products: [
      { name: "Bife de chorizo con papas", category: "Principal", price: 18500, cost: 6200, ingredients: ["Bife de chorizo", "Papas"] },
      { name: "Pollo al horno con ensalada", category: "Principal", price: 14500, cost: 4800, ingredients: ["Pollo entero", "Verduras de hoja"] },
      { name: "Copa de vino tinto", category: "Bebida", price: 5500, cost: 2250, ingredients: ["Vino tinto (copa)"] },
    ],
  },
  dark_kitchen: {
    ingredients: [
      { name: "Carne premium 180g", unit: "kg", avg_unit_cost: 10260 },
      { name: "Pan brioche", unit: "u", avg_unit_cost: 520 },
      { name: "Queso cheddar", unit: "kg", avg_unit_cost: 8400 },
      { name: "Packaging delivery", unit: "u", avg_unit_cost: 800 },
      { name: "Bolsa térmica", unit: "u", avg_unit_cost: 350 },
    ],
    products: [
      { name: "Combo delivery", category: "Combo", price: 12500, cost: 4800, ingredients: ["Carne premium 180g", "Pan brioche", "Queso cheddar", "Packaging delivery"] },
    ],
  },
};
