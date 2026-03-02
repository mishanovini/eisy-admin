import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/** Shared XML parser configured for eisy XML responses */
export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => {
    // These elements should always be parsed as arrays even when there's only one
    const arrayElements = new Set([
      'node', 'folder', 'group', 'property', 'link',
      'trigger', 'd2d', 'email', 'var',
    ]);
    return arrayElements.has(name);
  },
});

/** Shared XML builder for constructing SOAP envelopes and program XML */
export const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: false,
  suppressEmptyNode: false,
});

/** Parse an XML string into a typed object */
export function parseXml<T>(xml: string): T {
  return xmlParser.parse(xml) as T;
}

/**
 * Safely check if a parsed XML boolean attribute is "true".
 * fast-xml-parser with parseAttributeValue converts "true"→boolean true,
 * but `true == 'true'` is false in JS (both coerce to numbers: 1 vs NaN).
 * This helper handles both boolean and string representations.
 */
export function boolAttr(value: unknown): boolean {
  return value === true || value === 'true';
}
