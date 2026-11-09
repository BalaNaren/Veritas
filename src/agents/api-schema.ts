/**
 * Veritas validates every agent answer itself, so the schemas it keeps are fuller than what the API's constrained
 * output accepts. This reduces a schema to the part the API supports: every object closed with
 * `additionalProperties: false`, and the keywords the API does not support removed (the same limits are then checked
 * by Veritas's own validators on the answer).
 */
const UNSUPPORTED = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'default', 'examples',
]);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function clean(node: Json): Json {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue;
    // Property names are data, not keywords: clean their schemas, never drop a property called "minimum".
    out[key] = key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v as Json)]))
      : clean(value);
  }
  if (out.type === 'object') {
    out.additionalProperties = false;
    if (!('properties' in out)) out.properties = {};
  }
  return out;
}

export function toApiSchema(schema: object): object {
  return clean(JSON.parse(JSON.stringify(schema)) as Json) as object;
}
