#!/usr/bin/env node
/**
 * Import knowledge base seed data into the app.
 *
 * Usage: This script outputs the seed data for manual import via the
 * Knowledge Base UI (Export/Import buttons at bottom).
 *
 * Alternatively, the seed data is auto-loaded when the Knowledge Base
 * is first opened and is empty.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, 'knowledge-base-seed.json');
const seed = JSON.parse(readFileSync(seedPath, 'utf-8'));

console.log(`Knowledge Base Seed Data Summary:`);
console.log(`  Integration Profiles: ${seed.integrations.length}`);
console.log(`  Control Mappings:     ${seed.mappings.length}`);
console.log(`  AI Context Documents: ${seed.documents.length}`);
console.log(`  External References:  ${seed.references.length}`);
console.log(`  Troubleshooting:      ${seed.troubleshooting.length}`);
console.log('');

const jsonSize = JSON.stringify(seed).length;
console.log(`  Total JSON size: ${(jsonSize / 1024).toFixed(1)} KB`);
console.log('');

console.log('Integration Profiles:');
for (const p of seed.integrations) {
  const docs = seed.documents.filter(d => d.integrationId === p.id).length;
  const maps = seed.mappings.filter(m => m.integrationId === p.id).length;
  const refs = seed.references.filter(r => r.integrationId === p.id).length;
  const ts = seed.troubleshooting.filter(t => t.integrationId === p.id).length;
  console.log(`  ${p.name}`);
  console.log(`    Protocol: ${p.protocol}`);
  console.log(`    ${docs} docs, ${maps} mappings, ${refs} refs, ${ts} troubleshooting`);
}
