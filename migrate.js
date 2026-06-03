#!/usr/bin/env node
/**
 * Migrador estático — Buenos Aires by Night VR Gallery
 *
 * Lee las copias locales de los .md en data/personajes/, parsea el frontmatter
 * y genera client/assets/personajes.json. NO toca el vault: trabaja solo con las
 * copias ya duplicadas en el proyecto.
 *
 * Uso:  node migrate.js
 */
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const ROOT = __dirname;
const MD_DIR = path.join(ROOT, "data", "personajes");
const IMG_DIR = path.join(ROOT, "docs", "assets", "img");
const OUT = path.join(ROOT, "docs", "assets", "personajes.json");

/** Limpia wikilinks de Obsidian: "[[Archivo|Alias]]" -> "Alias", "[[Toledo]]" -> "Toledo". */
function stripLinks(value) {
  if (value == null) return "";
  const s = String(value);
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[target|alias]] -> alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1")             // [[target]] -> target
    .trim();
}

/** Normaliza un campo que puede venir como string, array o null. Devuelve string limpio. */
function firstClean(value) {
  if (Array.isArray(value)) value = value.find((v) => v != null && String(v).trim() !== "");
  return stripLinks(value);
}

/** Convierte un campo lista en array de strings limpios (sin vacíos). */
function listClean(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(stripLinks).filter((v) => v !== "");
}

/** Extrae el nombre de archivo del campo Retrato (notación [[...]] o path plano). */
function resolveImage(retrato) {
  const raw = Array.isArray(retrato) ? retrato[0] : retrato;
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/\[\[([^\]]+)\]\]/);
  let file = m ? m[1] : s;
  file = file.split("/").pop().trim(); // por si viene con path relativo
  return file || null;
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function main() {
  if (!fs.existsSync(MD_DIR)) {
    console.error("✗ No existe " + MD_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(MD_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("Arbol"));
  const personajes = [];
  const skipped = [];

  for (const file of files) {
    const nombre = path.basename(file, ".md");
    const raw = fs.readFileSync(path.join(MD_DIR, file), "utf8");
    let fm;
    try {
      fm = matter(raw).data || {};
    } catch (e) {
      skipped.push(`${nombre} (frontmatter inválido: ${e.message})`);
      continue;
    }

    const imgFile = resolveImage(fm.Retrato);
    if (!imgFile) {
      skipped.push(`${nombre} (sin Retrato)`);
      continue;
    }
    if (!fs.existsSync(path.join(IMG_DIR, imgFile))) {
      skipped.push(`${nombre} (imagen no encontrada: ${imgFile})`);
      continue;
    }

    // "clan" = Subcategoria para Cainitas; fallback a Criatura para otras criaturas.
    const clan = firstClean(fm.Subcategoria) || firstClean(fm.Criatura) || "Desconocido";
    const generacion = fm.Generacion != null && String(fm.Generacion).trim() !== ""
      ? Number(fm.Generacion) || stripLinks(fm.Generacion)
      : null;

    personajes.push({
      id: slugify(nombre),
      nombre,
      clan,
      generacion,
      status: firstClean(fm.Status) || "Desconocido",
      descripcion: firstClean(fm.Descripcion) || "",
      organizacion: listClean(fm.Organizacion),
      aliases: listClean(fm.aliases),
      imagen: "assets/img/" + imgFile,
    });
  }

  personajes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  fs.writeFileSync(OUT, JSON.stringify(personajes, null, 2), "utf8");

  console.log(`✓ ${personajes.length} personajes → ${path.relative(ROOT, OUT)}`);
  if (skipped.length) {
    console.log(`  Omitidos (${skipped.length}):`);
    skipped.forEach((s) => console.log("    - " + s));
  }
}

main();
