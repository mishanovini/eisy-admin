#!/usr/bin/env node
/**
 * Quick script to list all devices from the eisy, grouped by protocol.
 * Usage: curl -sk -u admin:admin "https://192.168.4.123:8443/rest/nodes" | node scripts/list-devices.mjs
 */
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  const r = parser.parse(data);
  const nodes = r?.nodes?.node;
  if (!nodes) { console.log('No nodes found'); return; }
  const arr = Array.isArray(nodes) ? nodes : [nodes];

  const insteon = arr.filter(n => {
    const addr = String(n['@_address']);
    return addr.includes(' ') && !addr.match(/^z[wylr]/i);
  });
  const zwave = arr.filter(n => String(n['@_address']).match(/^z[wylr]/i));
  const other = arr.filter(n => {
    const addr = String(n['@_address']);
    return !addr.includes(' ') && !addr.match(/^z[wylr]/i);
  });

  console.log(`=== INSTEON DEVICES (${insteon.length}) ===`);
  insteon.forEach(n => console.log(`  ${n['@_address']} | ${n.name} | def=${n['@_nodeDefId'] || '?'}`));

  console.log(`\n=== Z-WAVE DEVICES (${zwave.length}) ===`);
  zwave.forEach(n => console.log(`  ${n['@_address']} | ${n.name} | def=${n['@_nodeDefId'] || '?'}`));

  console.log(`\n=== OTHER (${other.length}) ===`);
  other.forEach(n => console.log(`  ${n['@_address']} | ${n.name} | def=${n['@_nodeDefId'] || '?'}`));
});
