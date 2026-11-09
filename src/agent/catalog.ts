export interface JsonSchemaObject {
  [keyword: string]: unknown;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  propertyNames?: JsonSchema;
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  prefixItems?: JsonSchema[];
  contains?: JsonSchema;
  additionalItems?: boolean | JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  pattern?: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  minContains?: number;
  maxContains?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
}

export type JsonSchema = JsonSchemaObject | boolean;

export interface CapabilityPrice {
  usd: string;
  atomic: string;
  tokens?: string[];
  pricingModel?: string;
  prorated?: boolean;
  maxResults?: number;
}

export interface Capability {
  id: string;
  title: string;
  method: string;
  url: string;
  platform: string;
  available: boolean;
  provider?: string;
  inputSchema: JsonSchema;
  price?: CapabilityPrice;
  tiers: CapabilityPrice[];
}

const CATALOG_URL = "https://gateway.usebuy.ai/v1/catalog";
const GATEWAY_ORIGIN = "https://gateway.usebuy.ai";
let cache: { at: number; caps: Map<string, Capability> } | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isGatewayUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === GATEWAY_ORIGIN && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function parsePrice(value: unknown): CapabilityPrice | undefined {
  if (!isRecord(value) || typeof value.usd !== "string" || typeof value.atomic !== "string" || !/^\d+$/.test(value.atomic)) return undefined;
  const tokens = Array.isArray(value.tokens) ? value.tokens.filter((token): token is string => typeof token === "string") : undefined;
  return {
    usd: value.usd,
    atomic: value.atomic,
    ...(tokens ? { tokens } : {}),
    ...(typeof value.pricingModel === "string" ? { pricingModel: value.pricingModel } : {}),
    ...(typeof value.prorated === "boolean" ? { prorated: value.prorated } : {}),
    ...(typeof value.maxResults === "number" && Number.isInteger(value.maxResults) ? { maxResults: value.maxResults } : {}),
  };
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "boolean" || isRecord(value);
}

/** Fetches the real Buy catalogue, cached briefly to avoid repeated discovery calls. */
export async function getCatalog(refresh = false): Promise<Map<string, Capability>> {
  if (!refresh && cache && Date.now() - cache.at < 600_000) return cache.caps;
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (!isRecord(json) || !Array.isArray(json.capabilities)) throw new Error("Buy catalogue response has no capabilities array");

  const caps = new Map<string, Capability>();
  for (const raw of json.capabilities) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string" ||
      typeof raw.method !== "string" || !isGatewayUrl(raw.url) || typeof raw.platform !== "string") {
      continue;
    }
    const priceOptions = Array.isArray(raw.priceOptions) ? raw.priceOptions.map(parsePrice).filter((price): price is CapabilityPrice => !!price) : [];
    const price = parsePrice(raw.price) ?? priceOptions[0];
    const agent = isRecord(raw.agent) ? raw.agent : undefined;
    caps.set(raw.id, {
      id: raw.id,
      title: raw.title,
      method: raw.method,
      url: raw.url,
      platform: raw.platform,
      available: raw.available === true,
      ...(typeof agent?.provider === "string"
        ? { provider: agent.provider }
        : raw.id.startsWith("monid.")
          ? { provider: raw.id.split(".")[2] }
          : {}),
      inputSchema: isJsonSchema(raw.inputSchema) ? raw.inputSchema : {},
      ...(price ? { price } : {}),
      tiers: priceOptions,
    });
  }
  cache = { at: Date.now(), caps };
  return caps;
}

const supportedKeywords = new Set([
  "$schema", "$id", "$anchor", "$comment", "$defs", "definitions",
  "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly",
  "type", "enum", "const", "required", "properties", "patternProperties", "propertyNames",
  "dependentRequired", "dependentSchemas", "additionalProperties", "minProperties", "maxProperties",
  "items", "prefixItems", "additionalItems", "contains", "minContains", "maxContains",
  "minItems", "maxItems", "uniqueItems", "allOf", "anyOf", "oneOf", "not",
  "minLength", "maxLength", "pattern", "format", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "contentEncoding", "contentMediaType", "contentSchema",
  "$ref", "$dynamicRef", "$recursiveRef",
]);

const annotationKeywords = new Set([
  "$schema", "$id", "$anchor", "$comment", "$defs", "definitions",
  "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly",
  "contentEncoding", "contentMediaType", "contentSchema",
]);

const validTypes = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function validateSchemaShape(schema: JsonSchemaObject, path: string, errors: string[]): void {
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) errors.push(`${path} schema uses unsupported keyword "${keyword}"`);
  }
  for (const referenceKeyword of ["$ref", "$dynamicRef", "$recursiveRef"]) {
    if (referenceKeyword in schema) errors.push(`${path} schema uses unsupported keyword "${referenceKeyword}"`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.length || types.some((type) => typeof type !== "string" || !validTypes.has(type))) {
      errors.push(`${path} schema has an unsupported type declaration`);
    }
  }
  if (schema.format !== undefined && schema.format !== "uri") {
    errors.push(`${path} schema uses unsupported format "${String(schema.format)}"`);
  }
  if (schema.pattern !== undefined && typeof schema.pattern !== "string") {
    errors.push(`${path} schema has an invalid pattern declaration`);
  }
}

function validateValue(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (typeof schema === "boolean") {
    if (!schema) errors.push(`${path} is not allowed by the catalogue schema`);
    return;
  }
  validateSchemaShape(schema, path, errors);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeof type === "string" && typeMatches(type, value))) {
      errors.push(`${path} must be ${types.join(" or ")}`);
    }
  }

  if (schema.enum && !schema.enum.some((allowed) => deepEqual(allowed, value))) errors.push(`${path} is not an allowed value`);
  if ("const" in schema && !deepEqual(schema.const, value)) errors.push(`${path} must equal the catalogue constant`);

  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const alternatives = schema[keyword];
    if (alternatives === undefined) continue;
    if (!Array.isArray(alternatives)) {
      errors.push(`${path} schema has an invalid ${keyword} declaration`);
      continue;
    }
    const branchErrors = alternatives.map((branch) => {
      const current: string[] = [];
      validateValue(branch, value, path, current);
      return current;
    });
    if (keyword === "allOf") {
      branchErrors.forEach((current) => errors.push(...current));
    } else {
      const matching = branchErrors.filter((current) => current.length === 0).length;
      const valid = keyword === "anyOf" ? matching > 0 : matching === 1;
      if (!valid) errors.push(`${path} must match ${keyword === "anyOf" ? "at least one" : "exactly one"} allowed schema`);
    }
  }
  if (schema.not !== undefined) {
    const notErrors: string[] = [];
    validateValue(schema.not, value, path, notErrors);
    if (notErrors.length === 0) errors.push(`${path} matches a disallowed schema`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match the catalogue pattern`);
      } catch {
        errors.push(`${path} schema has an invalid pattern`);
      }
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        errors.push(`${path} must be a valid URI`);
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below the catalogue minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above the catalogue maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path} must be greater than the catalogue exclusive minimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path} must be less than the catalogue exclusive maximum`);
    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient))) {
        errors.push(`${path} is not a multiple of the catalogue constraint`);
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.uniqueItems && value.some((item, index) => value.slice(index + 1).some((other) => deepEqual(item, other)))) {
      errors.push(`${path} must contain unique items`);
    }
    const prefixItems = schema.prefixItems;
    if (Array.isArray(prefixItems)) {
      prefixItems.forEach((itemSchema, index) => {
        if (index < value.length) validateValue(itemSchema, value[index], `${path}[${index}]`, errors);
      });
    }
    if (Array.isArray(schema.items)) {
      const tupleItems = schema.items as JsonSchema[];
      tupleItems.forEach((itemSchema, index) => {
        if (index < value.length) validateValue(itemSchema, value[index], `${path}[${index}]`, errors);
      });
      if (schema.additionalItems === false && value.length > tupleItems.length) {
        errors.push(`${path}[${tupleItems.length}] is not allowed`);
      } else if (isRecord(schema.additionalItems)) {
        value.slice(tupleItems.length).forEach((item, index) => {
          validateValue(schema.additionalItems as JsonSchema, item, `${path}[${tupleItems.length + index}]`, errors);
        });
      }
    } else if (schema.items !== undefined) {
      const start = Array.isArray(prefixItems) ? prefixItems.length : 0;
      value.forEach((item, index) => {
        if (index >= start) validateValue(schema.items as JsonSchema, item, `${path}[${index}]`, errors);
      });
    }
    if (schema.contains !== undefined) {
      const matches = value.reduce((count, item, index) => {
        const itemErrors: string[] = [];
        validateValue(schema.contains!, item, `${path}[${index}]`, itemErrors);
        return count + (itemErrors.length === 0 ? 1 : 0);
      }, 0);
      if (matches < (schema.minContains ?? 1)) errors.push(`${path} has too few items matching the catalogue contains schema`);
      if (schema.maxContains !== undefined && matches > schema.maxContains) errors.push(`${path} has too many items matching the catalogue contains schema`);
    }
    return;
  }

  if (!isRecord(value)) return;
  const propertySchemas = isRecord(schema.properties) ? schema.properties as Record<string, JsonSchema> : {};
  const patternSchemas = isRecord(schema.patternProperties) ? schema.patternProperties as Record<string, JsonSchema> : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    if (typeof name === "string" && !Object.hasOwn(value, name)) errors.push(`${path}.${name} is required`);
  }
  if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path} has too few properties`);
  if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) errors.push(`${path} has too many properties`);

  for (const [name, propertyValue] of Object.entries(value)) {
    const matchingPatterns: JsonSchema[] = [];
    for (const [pattern, childSchema] of Object.entries(patternSchemas)) {
      try {
        if (new RegExp(pattern).test(name)) matchingPatterns.push(childSchema);
      } catch {
        errors.push(`${path} schema has an invalid property pattern`);
      }
    }
    if (schema.propertyNames !== undefined) validateValue(schema.propertyNames, name, `${path} property name`, errors);
    const hasPropertySchema = Object.hasOwn(propertySchemas, name);
    const propertySchema = propertySchemas[name];
    if (hasPropertySchema && propertySchema !== undefined) validateValue(propertySchema, propertyValue, `${path}.${name}`, errors);
    matchingPatterns.forEach((childSchema) => validateValue(childSchema, propertyValue, `${path}.${name}`, errors));
    if (!hasPropertySchema && matchingPatterns.length === 0) {
      if (schema.additionalProperties === false) errors.push(`${path}.${name} is not allowed`);
      else if (isRecord(schema.additionalProperties)) validateValue(schema.additionalProperties as JsonSchema, propertyValue, `${path}.${name}`, errors);
    }
  }

  if (isRecord(schema.dependentRequired)) {
    for (const [property, dependencies] of Object.entries(schema.dependentRequired)) {
      if (Object.hasOwn(value, property) && Array.isArray(dependencies)) {
        for (const dependency of dependencies) {
          if (typeof dependency === "string" && !Object.hasOwn(value, dependency)) {
            errors.push(`${path}.${dependency} is required when ${property} is present`);
          }
        }
      }
    }
  }
  if (isRecord(schema.dependentSchemas)) {
    for (const [property, dependentSchema] of Object.entries(schema.dependentSchemas)) {
      if (Object.hasOwn(value, property)) validateValue(dependentSchema as JsonSchema, value, path, errors);
    }
  }
}

/** Checks a planned Buy request against the live catalogue's supported JSON Schema keywords. */
export function validateCapabilityInput(capability: Capability, input: unknown): string[] {
  const errors: string[] = [];
  validateValue(capability.inputSchema, input, "input", errors);
  return errors;
}
