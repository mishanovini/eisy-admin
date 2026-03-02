import { XMLParser } from 'fast-xml-parser';
const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const r = p.parse(d);
  const groups = r?.nodes?.group;
  if (!groups) { console.log('No scenes'); return; }
  const a = Array.isArray(groups) ? groups : [groups];
  a.forEach(g => {
    const links = g.members?.link;
    const count = links ? (Array.isArray(links) ? links.length : 1) : 0;
    console.log(`${g['@_address']} | ${g.name} | ${count} members`);
  });
});
