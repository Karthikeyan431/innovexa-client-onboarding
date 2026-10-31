import { jsPDF } from 'jspdf';
import { ACKNOWLEDGEMENT_TEXT, BRAND, type ApplicationInput } from '../src/shared/schema.js';
import { LOGO_MARK_PNG } from './brand.generated.js';
import { INTER_BOLD, INTER_REGULAR } from './fonts/fonts.generated.js';

export interface PdfInput {
  reference: string;
  submittedAt: Date;
  data: ApplicationInput;
  attachments: { name: string; size: number }[];
  signaturePng: Uint8Array;
}

// Geometry (mm, A4 portrait)
const PAGE_W = 210;
const PAGE_H = 297;
const M = 18; // side margin
const CONTENT_W = PAGE_W - M * 2;
const TOP = 30; // content top on continuation pages
const BOTTOM = PAGE_H - 22; // content must stay above the footer

// Palette
const NAVY: [number, number, number] = [16, 27, 43];
const NAVY_2: [number, number, number] = [32, 54, 77];
// Accents taken from the Innovexa logo's violet → blue gradient.
const VIOLET: [number, number, number] = [109, 74, 246];
const VIOLET_LIGHT: [number, number, number] = [160, 146, 255];
const BLUE: [number, number, number] = [84, 128, 246];
const DIGITAL_GREY: [number, number, number] = [158, 166, 178];
const INK: [number, number, number] = [28, 41, 58];
const MUTED: [number, number, number] = [113, 128, 147];
const LINE: [number, number, number] = [226, 232, 238];
const SOFT: [number, number, number] = [247, 249, 251];
const WHITE: [number, number, number] = [255, 255, 255];

export function formatIST(date: Date, withTime = true): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(date) + (withTime ? ' IST' : '');
}

export const contactWord = (m: string) => (m === 'WhatsApp' ? m : m.toLowerCase());

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const MARK_ASPECT = 1098 / 1259; // width / height of the logo mark

/** The Innovexa logo mark (transparent PNG); returns the drawn width. */
function drawMark(doc: jsPDF, x: number, y: number, height: number): number {
  const width = height * MARK_ASPECT;
  doc.addImage(LOGO_MARK_PNG, 'PNG', x, y, width, height, 'innovexa-mark', 'FAST');
  return width;
}

/** "INNOVEXA" bold with a letter-spaced, lighter "DIGITAL" — as in the logo. */
function wordmark(doc: jsPDF, x: number, y: number, size: number, onDark: boolean) {
  doc.setFont('Inter', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...(onDark ? WHITE : NAVY));
  doc.text('INNOVEXA', x, y);
  const w = doc.getTextWidth('INNOVEXA') + size * 0.12;
  doc.setFont('Inter', 'normal');
  doc.setTextColor(...DIGITAL_GREY);
  doc.setCharSpace(size * 0.045);
  doc.text('DIGITAL', x + w, y);
  doc.setCharSpace(0);
}

export function buildApplicationPdf(input: PdfInput): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Inter-Regular.ttf', INTER_REGULAR);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', INTER_BOLD);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.setProperties({
    title: `Client onboarding application ${input.reference}`,
    subject: 'Innovexa Digital client onboarding application',
    author: BRAND.name,
    creator: BRAND.name,
  });

  const { data } = input;
  let y = 0;

  const setText = (size: number, weight: 'normal' | 'bold', color = INK) => {
    doc.setFont('Inter', weight);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const lineH = (size: number, factor = 1.45) => (size * factor * 25.4) / 72;

  const continuationHeader = () => {
    const mw = drawMark(doc, M, 10.4, 7.6);
    wordmark(doc, M + mw + 2.6, 16.2, 10, false);
    setText(8, 'normal', MUTED);
    doc.text(`Client onboarding application · ${input.reference}`, PAGE_W - M, 16.2, { align: 'right' });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, 21, PAGE_W - M, 21);
  };

  const ensure = (height: number) => {
    if (y + height > BOTTOM) {
      doc.addPage();
      continuationHeader();
      y = TOP;
    }
  };

  // ---------------------------------------------------------------- cover band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 52, 'F');
  doc.setFillColor(...NAVY_2);
  doc.triangle(PAGE_W - 70, 0, PAGE_W, 0, PAGE_W, 52, 'F');
  // Logo gradient stripe along the bottom of the band.
  const slices = 60;
  for (let i = 0; i < slices; i++) {
    const t = i / (slices - 1);
    doc.setFillColor(...(VIOLET.map((c, k) => Math.round(c + (BLUE[k] - c) * t)) as [number, number, number]));
    doc.rect((PAGE_W / slices) * i, 52, PAGE_W / slices + 0.2, 1.4, 'F');
  }
  const mw = drawMark(doc, M, 12.5, 14);
  const wx = M + mw + 4;
  wordmark(doc, wx, 20.6, 15, true);
  setText(7.5, 'normal', [198, 212, 223]);
  doc.setCharSpace(0.6);
  doc.text(BRAND.tagline.toUpperCase(), wx, 25.6);
  doc.setCharSpace(0);

  setText(19, 'bold', [255, 255, 255]);
  doc.text('Client Onboarding Application', M, 41);
  setText(8.5, 'normal', [198, 212, 223]);
  doc.text('Reference', PAGE_W - M, 17, { align: 'right' });
  setText(11, 'bold', VIOLET_LIGHT);
  doc.text(input.reference, PAGE_W - M, 22.5, { align: 'right' });
  setText(8.5, 'normal', [198, 212, 223]);
  doc.text(`Submitted ${formatIST(input.submittedAt)}`, PAGE_W - M, 41, { align: 'right' });

  y = 64;
  setText(9.5, 'normal', MUTED);
  const intro = doc.splitTextToSize(
    `This document records the requirements submitted by ${data.fullName} on behalf of ${data.companyName}. ` +
      'Innovexa Digital uses it to understand your business, plan the engagement and prepare a proposal.',
    CONTENT_W,
  );
  doc.text(intro, M, y);
  y += intro.length * lineH(9.5) + 4;

  // ---------------------------------------------------------------- summary strip
  const strip: [string, string][] = [
    ['Client', data.fullName],
    ['Company', data.companyName],
    ['Budget', data.budgetRange || 'Not specified'],
    ['Timeline', data.timeline || 'Not specified'],
  ];
  const cellW = CONTENT_W / strip.length;
  doc.setFillColor(...SOFT);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CONTENT_W, 17, 2, 2, 'FD');
  strip.forEach(([label, value], i) => {
    const x = M + i * cellW + 4;
    setText(6.8, 'bold', MUTED);
    doc.setCharSpace(0.3);
    doc.text(label.toUpperCase(), x, y + 6);
    doc.setCharSpace(0);
    setText(9, 'bold', INK);
    const v = doc.splitTextToSize(value, cellW - 7)[0] as string;
    doc.text(v, x, y + 12);
  });
  y += 25;

  // ---------------------------------------------------------------- sections
  const section = (title: string) => {
    ensure(22);
    y += 3;
    doc.setFillColor(...VIOLET);
    doc.rect(M, y - 4, 1.2, 5.4, 'F');
    setText(12, 'bold', NAVY);
    doc.text(title, M + 4, y);
    y += 3.5;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, y, PAGE_W - M, y);
    y += 6;
  };

  const labelStyle = () => {
    setText(6.8, 'bold', MUTED);
    doc.setCharSpace(0.3);
  };

  /** Full-width field; long values continue across pages line by line. */
  const field = (label: string, value: string) => {
    const v = value.trim() || 'Not provided';
    setText(9.5, 'normal', v === value.trim() ? INK : MUTED);
    const lines = doc.splitTextToSize(v, CONTENT_W) as string[];
    const lh = lineH(9.5);
    ensure(5 + Math.min(lines.length, 3) * lh + 3); // keep label with first lines
    labelStyle();
    doc.text(label.toUpperCase(), M, y);
    doc.setCharSpace(0);
    y += 4.6;
    setText(9.5, 'normal', v === value.trim() ? INK : MUTED);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, M, y);
      y += lh;
    }
    y += 3.2;
  };

  /** Two short fields side by side. */
  const pair = (a: [string, string], b?: [string, string]) => {
    const colW = (CONTENT_W - 8) / 2;
    setText(9.5, 'normal');
    const la = doc.splitTextToSize(a[1] || 'Not provided', colW) as string[];
    const lb = b ? (doc.splitTextToSize(b[1] || 'Not provided', colW) as string[]) : [];
    const lh = lineH(9.5);
    const h = 4.6 + Math.max(la.length, lb.length) * lh + 3.2;
    ensure(h);
    const cols = [[a, la, M], ...(b ? [[b, lb, M + colW + 8]] : [])] as [[string, string], string[], number][];
    cols.forEach(([[label, value], lines, x]) => {
      labelStyle();
      doc.text(label.toUpperCase(), x, y);
      doc.setCharSpace(0);
      setText(9.5, 'normal', value ? INK : MUTED);
      doc.text(lines, x, y + 4.6);
    });
    y += h;
  };

  section('Client contact details');
  pair(['Full name', data.fullName], ['Designation', data.designation]);
  pair(['Email address', data.email], ['Phone number', data.phone]);
  pair(['Preferred contact method', data.preferredContact]);

  section('Business information');
  pair(['Company name', data.companyName], ['Industry', data.industry]);
  pair(['Business location', data.location], ['Existing website', data.hasWebsite === 'Yes' ? 'Yes' : 'No']);
  if (data.hasWebsite === 'Yes') field('Website address', data.websiteUrl);
  else field('Website requirements', data.websiteRequirements);
  field('Business description', data.businessDescription);

  section('Project requirements');
  field('Services required', data.services.map((s) => (s === 'Other services' && data.otherServices ? `Other: ${data.otherServices}` : s)).join('\n'));
  field('Project requirements', data.projectRequirements);
  pair(['Budget range', data.budgetRange || 'Not specified'], ['Expected timeline', data.timeline || 'Not specified']);
  field('Additional notes', data.additionalNotes);

  section('Attachments');
  if (input.attachments.length === 0) {
    field('Files', 'No files were attached.');
  } else {
    field(
      `Files (${input.attachments.length})`,
      input.attachments.map((f, i) => `${i + 1}. ${f.name} (${formatBytes(f.size)})`).join('\n') +
        '\nFiles are stored securely with this application and are available to the Innovexa team.',
    );
  }

  // ---------------------------------------------------------------- acknowledgement + signature
  const sigProps = doc.getImageProperties(input.signaturePng);
  const boxH = 38;
  setText(9.5, 'normal');
  const ackLines = doc.splitTextToSize(ACKNOWLEDGEMENT_TEXT, CONTENT_W - 12) as string[];
  const blockH = 22 + ackLines.length * lineH(9.5) + 8 + boxH + 24;
  ensure(blockH); // never split the acknowledgement from its signature
  section('Client acknowledgement & signature');

  doc.setFillColor(...SOFT);
  doc.setDrawColor(...LINE);
  const ackH = ackLines.length * lineH(9.5) + 5;
  doc.roundedRect(M, y - 2, CONTENT_W, ackH, 2, 2, 'FD');
  // tick
  doc.setDrawColor(...VIOLET);
  doc.setLineWidth(0.7);
  doc.lines([[1.4, 1.5], [3, -3.4]], M + 4, y + 2.4, [1, 1], 'S');
  setText(9.5, 'normal', INK);
  doc.text(ackLines, M + 10, y + 3.4);
  y += ackH + 4;

  const boxW = 92;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, boxW, boxH, 2, 2, 'S');
  // fit signature inside the box, preserving aspect ratio
  const pad = 4;
  const maxW = boxW - pad * 2;
  const maxH = boxH - pad * 2 - 4;
  const scale = Math.min(maxW / sigProps.width, maxH / sigProps.height);
  const sw = sigProps.width * scale;
  const sh = sigProps.height * scale;
  doc.addImage(input.signaturePng, 'PNG', M + (boxW - sw) / 2, y + pad + (maxH - sh) / 2, sw, sh, undefined, 'FAST');
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.2);
  doc.line(M + pad, y + boxH - 6, M + boxW - pad, y + boxH - 6);
  setText(6.8, 'normal', MUTED);
  doc.text('Client signature', M + pad, y + boxH - 2.4);

  const ix = M + boxW + 8;
  const meta: [string, string][] = [
    ['Signed by', data.fullName],
    ['On behalf of', data.companyName],
    ['Date & time', formatIST(input.submittedAt)],
    ['Application reference', input.reference],
  ];
  meta.forEach(([label, value], i) => {
    const my = y + 3 + i * 9;
    labelStyle();
    doc.text(label.toUpperCase(), ix, my);
    doc.setCharSpace(0);
    setText(9, 'bold', INK);
    doc.text(doc.splitTextToSize(value, PAGE_W - M - ix)[0] as string, ix, my + 4);
  });
  y += boxH + 6;
  setText(7.5, 'normal', MUTED);
  const disclaimer = doc.splitTextToSize(
    'The signature above was drawn by the client in the Innovexa Digital onboarding form and confirms the acknowledgement. ' +
      'It is an acknowledgement of the submitted requirements, not an identity-verified electronic signature.',
    CONTENT_W,
  );
  doc.text(disclaimer, M, y);
  y += disclaimer.length * lineH(7.5) + 4;

  // ---------------------------------------------------------------- next steps
  const steps: [string, string][] = [
    ['Review', 'Innovexa reviews your requirements and this application.'],
    ['Discussion', `Our team contacts you by ${contactWord(data.preferredContact)} to clarify the details.`],
    ['Proposal', 'We share the scope, timeline and approach for your project.'],
    ['Project kickoff', 'Work begins once the proposal is approved.'],
  ];
  ensure(16 + steps.length * 11);
  section('What happens next');
  steps.forEach(([title, body], i) => {
    ensure(11);
    doc.setFillColor(...NAVY);
    doc.circle(M + 3, y - 1.2, 3, 'F');
    setText(8, 'bold', [255, 255, 255]);
    doc.text(String(i + 1), M + 3, y - 0.1, { align: 'center' });
    setText(9.5, 'bold', INK);
    doc.text(title, M + 9, y);
    setText(9, 'normal', MUTED);
    doc.text(body, M + 9, y + 4.4);
    y += 11;
  });

  // ---------------------------------------------------------------- footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, PAGE_H - 15, PAGE_W - M, PAGE_H - 15);
    setText(7.2, 'bold', NAVY);
    doc.text('INNOVEXA DIGITAL', M, PAGE_H - 10.5);
    setText(7.2, 'normal', MUTED);
    doc.text(
      `${BRAND.website.replace('https://', '')}  ·  ${BRAND.email}  ·  ${BRAND.phone}`,
      M + doc.getTextWidth('INNOVEXA DIGITAL') + 6.5,
      PAGE_H - 10.5,
    );
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 10.5, { align: 'right' });
    setText(6.5, 'normal', MUTED);
    doc.text(`Confidential · ${input.reference}`, M, PAGE_H - 6.8);
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
