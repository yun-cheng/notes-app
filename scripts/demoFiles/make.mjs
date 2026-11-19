/**
 * Writes the demo's attached files, which the dev server serves in place of Google Drive (vite.config.ts): a one-page
 * PDF itinerary and its first draft, a PDF lease, a CSV budget and a plain-text list. Run `node scripts/demoFiles/make.mjs` from the project folder.
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;

/** A one-page PDF of lines of text, a title first, written by hand: no library needed for this little. */
function pdf(title, lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [
    'BT /F2 22 Tf 56 770 Td',
    `(${esc(title)}) Tj`,
    '/F1 13 Tf 0 -36 Td 18 TL',
    ...lines.map((l) => `(${esc(l)}) '`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

writeFileSync(
  `${here}itinerary.pdf`,
  pdf('Kyoto, 4 days in April', [
    'Day 1  Arrive at Kyoto Station, 15:40. Hotel near Shijo.',
    '       Evening: Pontocho alley for dinner.',
    '',
    'Day 2  Fushimi Inari at 7:00, before the crowds.',
    '       Afternoon: Nishiki market, then Gion.',
    '',
    'Day 3  Arashiyama: bamboo grove, Tenryu-ji, the monkey park.',
    '',
    "Day 4  Philosopher's Path, Ginkaku-ji. Train out at 18:10.",
    '',
    'Booking refs: hotel KY-20417, train JR-5531.',
  ]),
);

// A first go at the itinerary, taken out of the Kyoto note for the one above; it waits in the Trash.
writeFileSync(
  `${here}itinerary-draft.pdf`,
  pdf('Kyoto, first draft', ['Day 1  Arrive. Hotel?', 'Day 2  Fushimi Inari, Gion', 'Day 3  Arashiyama', '', 'To book: hotel, train.']),
);

writeFileSync(
  `${here}lease.pdf`,
  pdf('Tenancy agreement', [
    'Flat 3, 12 Alder Road. Twelve months from the 1st.',
    '',
    'Rent: 1,450 a month, paid on the 1st.',
    'Deposit: 1,450, held in a protection scheme.',
    'Notice: two months, from either side, after the first six.',
    '',
    'Meter readings and inventory to be signed on move-in day.',
  ]),
);

writeFileSync(
  `${here}launch-budget.csv`,
  ['Item,Owner,Budget,Spent', 'Load testing,Mia,1200,950', 'Beta survey tool,Lee,300,300', 'Help center articles,Sam,800,200', 'Press kit design,Lee,1500,0', 'Launch party,Mia,600,0', 'Total,,4400,1450', ''].join('\n'),
);

writeFileSync(
  `${here}spice-list.txt`,
  ['Spices for the curry, from the shop on Elm St.', '', '- Cumin seeds', '- Coriander, ground', '- Turmeric', '- Garam masala', '- Chilli flakes', '- Fresh ginger and garlic', ''].join('\n'),
);
