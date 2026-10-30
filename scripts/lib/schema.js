'use strict';
/*
 * schema.js — the one JSON Schema validator used by the acceptance harness (C47).
 *
 * It implements the subset of JSON Schema (2020-12) that the files in schema/ actually use, and nothing
 * else. unsupportedKeywords() walks a schema and reports any keyword the validator does not know, so a
 * schema edit that needs a new keyword fails loudly instead of being silently ignored. No dependencies.
 * Unit tests: scripts/unit.test.js.
 */

// Keywords that only describe or organise a schema; they never reject data.
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', '$defs', 'definitions']);
// Keywords this validator enforces.
const ASSERTIONS = new Set([
  '$ref', 'type', 'enum', 'const', 'format', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'properties', 'required', 'additionalProperties', 'anyOf', 'allOf'
]);
// Keywords whose value is a schema, a list of schemas or a map of schemas (so unsupportedKeywords can descend).
const SUBSCHEMA = { items: 'one', contains: 'one', additionalProperties: 'one', anyOf: 'list', allOf: 'list', properties: 'map', $defs: 'map', definitions: 'map' };

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function typeOk(v, t) {
  switch (t) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: return false;
  }
}
function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function isDateTime(v) { // RFC 3339 with a time-zone offset
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
    isDate(v.slice(0, 10)) && !isNaN(new Date(v).getTime());
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) throw new Error('only local $ref values are supported: ' + ref);
  return ref.slice(1).split('/').filter(Boolean).reduce((node, part) => {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!node || typeof node !== 'object' || !(key in node)) throw new Error('unresolvable $ref ' + ref);
    return node[key];
  }, root);
}

// Checks value v against schema node (a part of root, against which $ref resolves); pushes messages to errors.
function check(root, v, node, path, errors) {
  if (node === true || node === undefined) return;
  if (node === false) { errors.push(path + ': not allowed'); return; }
  const conforms = (x, sub) => { const e = []; check(root, x, sub, path, e); return e.length === 0; };
  if (node.$ref) check(root, v, resolveRef(root, node.$ref), path, errors);
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some(t => typeOk(v, t))) { errors.push(path + ': expected ' + types.join('|') + ', got ' + String(JSON.stringify(v)).slice(0, 40)); return; }
  }
  if (node.enum && !node.enum.some(x => deepEqual(x, v))) errors.push(path + ': not one of ' + JSON.stringify(node.enum));
  if ('const' in node && !deepEqual(node.const, v)) errors.push(path + ': must be ' + JSON.stringify(node.const));
  if (typeof v === 'string') {
    if (node.format === 'date' && !isDate(v)) errors.push(path + ': not a YYYY-MM-DD date: ' + v);
    if (node.format === 'date-time' && !isDateTime(v)) errors.push(path + ': not an RFC 3339 date-time: ' + v);
    if (node.minLength !== undefined && [...v].length < node.minLength) errors.push(path + ': shorter than ' + node.minLength);
    if (node.maxLength !== undefined && [...v].length > node.maxLength) errors.push(path + ': longer than ' + node.maxLength);
    if (node.pattern && !new RegExp(node.pattern, 'u').test(v)) errors.push(path + ': does not match ' + node.pattern);
  }
  if (typeof v === 'number') {
    if (node.minimum !== undefined && v < node.minimum) errors.push(path + ': below minimum ' + node.minimum);
    if (node.maximum !== undefined && v > node.maximum) errors.push(path + ': above maximum ' + node.maximum);
  }
  if (Array.isArray(v)) {
    if (node.minItems !== undefined && v.length < node.minItems) errors.push(path + ': fewer than ' + node.minItems + ' items');
    if (node.maxItems !== undefined && v.length > node.maxItems) errors.push(path + ': more than ' + node.maxItems + ' items');
    if (node.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length) errors.push(path + ': items are not unique');
    if (node.items !== undefined) v.forEach((x, i) => check(root, x, node.items, path + '[' + i + ']', errors));
    if (node.contains !== undefined) {
      const n = v.filter(x => conforms(x, node.contains)).length;
      const min = node.minContains === undefined ? 1 : node.minContains;
      if (n < min || (node.maxContains !== undefined && n > node.maxContains)) {
        errors.push(path + ': ' + n + ' items match "contains" (allowed ' + min + (node.maxContains !== undefined ? ' to ' + node.maxContains : ' or more') + ')');
      }
    }
  }
  if (isObject(v)) {
    (node.required || []).forEach(k => { if (!(k in v)) errors.push(path + ': missing ' + k); });
    const props = node.properties || {};
    Object.keys(v).forEach(k => {
      if (k in props) check(root, v[k], props[k], path + '.' + k, errors);
      else if (node.additionalProperties === false) errors.push(path + ': unexpected key ' + k);
      else if (isObject(node.additionalProperties)) check(root, v[k], node.additionalProperties, path + '.' + k, errors);
    });
  }
  if (node.allOf) node.allOf.forEach(s => check(root, v, s, path, errors));
  if (node.anyOf && !node.anyOf.some(s => conforms(v, s))) errors.push(path + ': matches none of anyOf');
}

// Returns a list of error strings (empty when the data conforms). `node` defaults to the whole schema;
// pass a sub-schema (for example { $ref: '#/$defs/sprintTicket' }) to validate against part of it.
function validate(schema, data, at = 'root', node = schema) {
  const errors = [];
  check(schema, data, node, at, errors);
  return errors;
}

// Lists keywords used anywhere in `schema` that this validator neither enforces nor treats as annotation.
function unsupportedKeywords(schema) {
  const out = new Set();
  function walk(node, path) {
    if (!isObject(node)) return;
    Object.keys(node).forEach(k => {
      if (!ANNOTATIONS.has(k) && !ASSERTIONS.has(k)) out.add(path + '/' + k);
      const kind = SUBSCHEMA[k];
      if (kind === 'one') walk(node[k], path + '/' + k);
      else if (kind === 'list') node[k].forEach((s, i) => walk(s, path + '/' + k + '/' + i));
      else if (kind === 'map') Object.keys(node[k]).forEach(n => walk(node[k][n], path + '/' + k + '/' + n));
    });
  }
  walk(schema, '#');
  return [...out];
}

module.exports = { validate, unsupportedKeywords, isDate, isDateTime };
