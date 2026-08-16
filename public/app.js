"use strict";

/*
 * ============================================================
 * NEXO — APP.JS
 * Propiedades + búsqueda + filtros + NEXO IA
 * ============================================================
 */

const state = {
  properties: [],
  filtered: [],
  filter: "all",
  search: "",
  aiHistory: []
};

const $ = (selector) => document.querySelector(selector);

const grid = $("#propertyGrid");
const count = $("#propertyCount");
const searchForm = $("#searchForm");
const searchInput = $("#searchInput");
const openAIButton = $("#openAI");

/* ============================================================
   UTILIDADES
   ============================================================ */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatPrice(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Precio a consultar";
  }

  const number = Number(
    String(value).replace(/[^0-9.-]/g, "")
  );

  if (!Number.isFinite(number)) {
    return String(value);
  }

  return "$" + number.toLocaleString("en-US");
}

function getType(property) {
  return (
    property.property_type ||
    property.type ||
    "Propiedad"
  );
}

function getTitle(property) {
  return (
    property.title ||
    property.name ||
    getType(property)
  );
}

function getLocation(property) {
  return [
    property.neighborhood,
    property.city,
    property.province
  ]
    .filter(Boolean)
    .join(", ") || "Cuba";
}

function getPhoto(property) {
  const photos = property.photos;

  if (!photos) return "";

  if (Array.isArray(photos)) {
    return photos[0] || "";
  }

  if (typeof photos === "string") {

    try {
      const parsed = JSON.parse(photos);

      if (Array.isArray(parsed)) {
        return parsed[0] || "";
      }
    } catch (_) {}

    return photos
      .