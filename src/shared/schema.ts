// Single source of truth for the onboarding form: options, limits and
// validation. Imported by the browser (instant feedback) and by the API
// (authoritative check) so the two can never drift apart.

export const CONTACT_METHODS = ['Email', 'Phone', 'WhatsApp'] as const;

export const INDUSTRIES = [
  'Technology / IT',
  'Retail / E-commerce',
  'Healthcare',
  'Education',
  'Manufacturing',
  'Real estate',
  'Professional services',
  'Food & hospitality',
  'Finance / Insurance',
  'Logistics / Transport',
  'Non-profit',
  'Other',
] as const;

export const SERVICES = [
  'Website design & development',
  'Mobile application development',
  'AI automation',
  'Chatbot development',
  'Business process automation',
  'Custom software development',
  'Digital marketing',
  'Other services',
] as const;

export const BUDGETS = [
  'Below ₹10,000',
  '₹10,000 – ₹25,000',
  '₹25,000 – ₹50,000',
  '₹50,000 – ₹1,00,000',
  '₹1,00,000 – ₹5,00,000',
  'Above ₹5,00,000',
  'Need guidance',
] as const;

export const TIMELINES = [
  'As soon as possible',
  'Within 2–4 weeks',
  'Within 1–3 months',
  'Within 3–6 months',
  'Flexible',
] as const;

export const STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'contacted',
  'proposal_sent',
  'approved',
  'in_progress',
  'completed',
  'rejected',
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  contacted: 'Contacted',
  proposal_sent: 'Proposal sent',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
};

export const ACKNOWLEDGEMENT_TEXT =
  'I confirm that the information provided in this application is accurate and that Innovexa Digital may contact me about this enquiry using the details above.';

export const ATTACHMENTS = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  // extension -> accepted MIME types (browsers disagree on zip/doc types)
  types: {
    pdf: ['application/pdf'],
    png: ['image/png'],
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    doc: ['application/msword'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    zip: ['application/zip', 'application/x-zip-compressed'],
  } as Record<string, string[]>,
};

export const SIGNATURE_MAX_BYTES = 512 * 1024;

export interface ApplicationInput {
  fullName: string;
  designation: string;
  email: string;
  phone: string;
  preferredContact: string;
  companyName: string;
  industry: string;
  location: string;
  hasWebsite: string; // 'Yes' | 'No'
  websiteUrl: string;
  websiteRequirements: string;
  businessDescription: string;
  services: string[];
  otherServices: string;
  projectRequirements: string;
  budgetRange: string;
  timeline: string;
  additionalNotes: string;
  acknowledged: boolean;
}

export type FieldName = keyof ApplicationInput;
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Which form step each field belongs to (0-based). */
export const FIELD_STEP: Record<FieldName, number> = {
  fullName: 0, designation: 0, email: 0, phone: 0, preferredContact: 0,
  companyName: 1, industry: 1, location: 1, hasWebsite: 1, websiteUrl: 1,
  websiteRequirements: 1, businessDescription: 1,
  services: 2, otherServices: 2, projectRequirements: 2, budgetRange: 2,
  timeline: 2, additionalNotes: 2,
  acknowledged: 3,
};

const LIMITS: Partial<Record<FieldName, number>> = {
  fullName: 120, designation: 120, email: 254, phone: 20, companyName: 160,
  location: 160, websiteUrl: 300, websiteRequirements: 4000,
  businessDescription: 4000, otherServices: 300, projectRequirements: 8000,
  additionalNotes: 4000,
};

export const MIN_REQUIREMENTS_LENGTH = 20;

/** Trim, normalise line endings and drop control characters (keeps \n and \t). */
export function cleanText(value: unknown, multiline = false): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  else s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  return s.trim();
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  if (!EMAIL_RE.test(email) || email.length > 254) return false;
  const tld = email.split('.').pop() ?? '';
  return /^[A-Za-z]{2,}$/.test(tld) && !email.includes('..');
}

/** Accepts international formats; requires 7–15 digits (E.164 range). */
export function isValidPhone(phone: string): boolean {
  if (!/^\+?[0-9 ().-]{7,20}$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Adds https:// if missing; returns '' when the value is not a plausible public http(s) URL. */
export function normaliseUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (!url.hostname.includes('.') || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

const oneOf = (list: readonly string[], v: string) => list.includes(v);

/**
 * Cleans and validates raw input. Returns cleaned data plus per-field errors.
 * `steps` limits validation to particular steps (used for step-by-step UI).
 */
export function validateApplication(
  raw: Partial<Record<FieldName, unknown>>,
  steps: number[] = [0, 1, 2, 3],
): { data: ApplicationInput; errors: FieldErrors } {
  const multiline: FieldName[] = ['websiteRequirements', 'businessDescription', 'projectRequirements', 'additionalNotes'];
  const text = (k: FieldName) => cleanText(raw[k], multiline.includes(k));

  const services = Array.isArray(raw.services)
    ? [...new Set(raw.services.map((s) => cleanText(s)).filter((s) => oneOf(SERVICES, s)))]
    : [];

  const data: ApplicationInput = {
    fullName: text('fullName'),
    designation: text('designation'),
    email: text('email').toLowerCase(),
    phone: text('phone'),
    preferredContact: text('preferredContact') || 'Email',
    companyName: text('companyName'),
    industry: text('industry'),
    location: text('location'),
    hasWebsite: text('hasWebsite'),
    websiteUrl: text('websiteUrl'),
    websiteRequirements: text('websiteRequirements'),
    businessDescription: text('businessDescription'),
    services,
    otherServices: services.includes('Other services') ? text('otherServices') : '',
    projectRequirements: text('projectRequirements'),
    budgetRange: text('budgetRange'),
    timeline: text('timeline'),
    additionalNotes: text('additionalNotes'),
    acknowledged: raw.acknowledged === true,
  };

  // Only keep the website field that matches the answer.
  if (data.hasWebsite === 'Yes') data.websiteRequirements = '';
  if (data.hasWebsite === 'No') data.websiteUrl = '';

  const errors: FieldErrors = {};
  const on = (k: FieldName) => steps.includes(FIELD_STEP[k]);
  const need = (k: FieldName, message: string) => {
    if (on(k) && !data[k]) errors[k] = message;
  };

  need('fullName', 'Enter your full name.');
  if (on('fullName') && data.fullName && data.fullName.length < 2) errors.fullName = 'Enter your full name.';
  need('email', 'Enter your email address.');
  if (on('email') && data.email && !isValidEmail(data.email)) errors.email = 'Enter a valid email address, like name@company.com.';
  need('phone', 'Enter your phone number.');
  if (on('phone') && data.phone && !isValidPhone(data.phone)) errors.phone = 'Enter a valid phone number with 7–15 digits, e.g. +91 98765 43210.';
  if (on('preferredContact') && !oneOf(CONTACT_METHODS, data.preferredContact)) errors.preferredContact = 'Choose a contact method.';

  need('companyName', 'Enter your company or business name.');
  need('industry', 'Select your industry.');
  if (on('industry') && data.industry && !oneOf(INDUSTRIES, data.industry)) errors.industry = 'Select your industry.';
  if (on('hasWebsite') && data.hasWebsite !== 'Yes' && data.hasWebsite !== 'No') errors.hasWebsite = 'Tell us whether you have a website.';
  if (on('websiteUrl') && data.hasWebsite === 'Yes') {
    const url = normaliseUrl(data.websiteUrl);
    if (!data.websiteUrl) errors.websiteUrl = 'Enter your website address.';
    else if (!url) errors.websiteUrl = 'Enter a valid website address, like https://example.com.';
    else data.websiteUrl = url;
  }
  if (on('websiteRequirements') && data.hasWebsite === 'No' && !data.websiteRequirements) {
    errors.websiteRequirements = 'Describe what you need from a new website.';
  }

  if (on('services') && data.services.length === 0) errors.services = 'Select at least one service.';
  if (on('otherServices') && data.services.includes('Other services') && !data.otherServices) {
    errors.otherServices = 'Tell us which other services you need.';
  }
  need('projectRequirements', 'Describe your project requirements.');
  if (on('projectRequirements') && data.projectRequirements && data.projectRequirements.length < MIN_REQUIREMENTS_LENGTH) {
    errors.projectRequirements = `Add a little more detail (at least ${MIN_REQUIREMENTS_LENGTH} characters).`;
  }
  if (on('budgetRange') && data.budgetRange && !oneOf(BUDGETS, data.budgetRange)) errors.budgetRange = 'Choose a budget range.';
  if (on('timeline') && data.timeline && !oneOf(TIMELINES, data.timeline)) errors.timeline = 'Choose a timeline.';

  if (on('acknowledged') && !data.acknowledged) errors.acknowledged = 'Please confirm the acknowledgement to continue.';

  for (const [k, max] of Object.entries(LIMITS) as [FieldName, number][]) {
    const v = data[k];
    if (on(k) && typeof v === 'string' && v.length > max) errors[k] = `Keep this under ${max.toLocaleString('en-IN')} characters.`;
  }

  return { data, errors };
}

export interface InvitationInput {
  fullName: string;
  email: string;
  companyName: string;
  message: string;
}

export const INVITATION_DAYS = 30;

/** Validates the "send onboarding link" form (admin dashboard and API). */
export function validateInvitation(raw: Partial<Record<keyof InvitationInput, unknown>>): { data: InvitationInput; errors: Partial<Record<keyof InvitationInput, string>> } {
  const data: InvitationInput = {
    fullName: cleanText(raw.fullName),
    email: cleanText(raw.email).toLowerCase(),
    companyName: cleanText(raw.companyName),
    message: cleanText(raw.message, true),
  };
  const errors: Partial<Record<keyof InvitationInput, string>> = {};
  if (data.fullName.length < 2) errors.fullName = "Enter the client's name.";
  else if (data.fullName.length > 120) errors.fullName = 'Keep the name under 120 characters.';
  if (!data.email) errors.email = "Enter the client's email address.";
  else if (!isValidEmail(data.email)) errors.email = 'Enter a valid email address.';
  if (data.companyName.length > 160) errors.companyName = 'Keep the company name under 160 characters.';
  if (data.message.length > 2000) errors.message = 'Keep the message under 2,000 characters.';
  return { data, errors };
}

export function attachmentProblem(name: string, size: number, type: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const allowed = ATTACHMENTS.types[ext];
  if (!allowed) return `${name}: file type not allowed. Use PDF, PNG, JPG, DOC, DOCX, XLSX or ZIP.`;
  // Some browsers report an empty type for Office/zip files; the extension decides then.
  if (type && !allowed.includes(type)) return `${name}: file type does not match its extension.`;
  if (size <= 0) return `${name}: file is empty.`;
  if (size > ATTACHMENTS.maxBytes) return `${name}: larger than 10 MB.`;
  return null;
}

export function mimeForExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ATTACHMENTS.types[ext]?.[0] ?? 'application/octet-stream';
}

export const BRAND = {
  name: 'Innovexa Digital',
  tagline: 'Build. Automate. Scale.',
  website: 'https://www.innovexadigital.in',
  email: 'contact@innovexadigital.in',
  phone: '+91 95660 61075',
  address: 'Tirukazhukundram, Tamil Nadu 603109',
  navy: '#101b2b',
  accent: '#7b5cf7',
  accentInk: '#5b3fd9',
};
