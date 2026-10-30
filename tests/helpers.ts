import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Encodes an 8-bit RGBA PNG; `ink(x, y)` returns true where the pen drew. */
export function makePng(w: number, h: number, ink: (x: number, y: number) => boolean, filter = 0): Uint8Array {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = filter; // filter 0 (none) or 2 (up) for coverage
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const on = ink(x, y);
      const v = [20, 33, 58, on ? 255 : 0];
      for (let i = 0; i < 4; i++) {
        const above = y > 0 && filter === 2 ? (ink(x, y - 1) ? [20, 33, 58, 255] : [20, 33, 58, 0])[i] : 0;
        raw[o + i] = (v[i] - above + 256) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** A wavy "signature" stroke. */
export const signatureInk = (x: number, y: number) => Math.abs(y - (60 + 25 * Math.sin(x / 18))) < 3 && x > 20 && x < 380;

export const validForm = {
  fullName: 'Priya Raman',
  designation: 'Founder',
  email: 'priya@example.com',
  phone: '+91 98765 43210',
  preferredContact: 'WhatsApp',
  companyName: 'Raman Organics',
  industry: 'Retail / E-commerce',
  location: 'Chennai, Tamil Nadu, India',
  hasWebsite: 'No',
  websiteUrl: '',
  websiteRequirements: 'A storefront with product catalogue, online payments and order tracking.',
  businessDescription: 'We sell organic groceries to households across Chennai.',
  services: ['Website design & development', 'AI automation', 'Chatbot development'],
  otherServices: '',
  projectRequirements: 'An e-commerce website with UPI payments, inventory sync and a WhatsApp chatbot for order status.',
  budgetRange: '₹50,000 – ₹1,00,000',
  timeline: 'Within 1–3 months',
  additionalNotes: 'We would like to launch before Pongal.',
  acknowledged: true,
};
