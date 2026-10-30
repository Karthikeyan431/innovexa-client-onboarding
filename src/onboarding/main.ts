import {
  ACKNOWLEDGEMENT_TEXT,
  ATTACHMENTS,
  BUDGETS,
  FIELD_STEP,
  INDUSTRIES,
  SERVICES,
  TIMELINES,
  attachmentProblem,
  validateApplication,
  type FieldErrors,
  type FieldName,
} from '../shared/schema';
import { ApiError, downloadPdf, submitApplication, uploadAttachments, type SubmitResponse } from './api';
import { SignaturePad } from './signature-pad';
import {
  clearDraft, forgetSubmission, loadDraft, loadSubmissions, newKey, rememberSubmission, saveDraft,
  type SavedSubmission,
} from './storage';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLFormElement>('#f');
const pages = [...document.querySelectorAll<HTMLFieldSetElement>('.page')];
const stepEls = [...document.querySelectorAll<HTMLLIElement>('.step')];
const backBtn = $<HTMLButtonElement>('#back');
const nextBtn = $<HTMLButtonElement>('#next');
const submitBtn = $<HTMLButtonElement>('#submit');
const toReviewBtn = $<HTMLButtonElement>('#toReview');
const formError = $('#formError');
const LAST = pages.length - 1;

let step = 0;
let reviewReturn = false; // editing a section from the review step
let submitting = false;
let idempotencyKey = newKey();
let files: File[] = [];
let lastSubmission: SavedSubmission | null = null;

// ---------------------------------------------------------------- build options
function fillSelect(id: string, options: readonly string[]) {
  const el = $<HTMLSelectElement>(id);
  for (const o of options) el.add(new Option(o, o));
}
fillSelect('#industry', INDUSTRIES);
fillSelect('#budgetRange', BUDGETS);
fillSelect('#timeline', TIMELINES);
$('#services').innerHTML = SERVICES.map(
  (s) => `<label class="check"><input type="checkbox" name="services" value="${s.replace(/&/g, '&amp;')}">${s.replace(/&/g, '&amp;')}</label>`,
).join('');
$('#ackText').innerHTML = `${ACKNOWLEDGEMENT_TEXT} <em>*</em>`;

// ---------------------------------------------------------------- values
function values(): Record<FieldName, unknown> {
  const fd = new FormData(form);
  const v = (k: string) => (fd.get(k) as string | null) ?? '';
  return {
    fullName: v('fullName'), designation: v('designation'), email: v('email'), phone: v('phone'),
    preferredContact: v('preferredContact'), companyName: v('companyName'), industry: v('industry'),
    location: v('location'), hasWebsite: v('hasWebsite'), websiteUrl: v('websiteUrl'),
    websiteRequirements: v('websiteRequirements'), businessDescription: v('businessDescription'),
    services: fd.getAll('services') as string[], otherServices: v('otherServices'),
    projectRequirements: v('projectRequirements'), budgetRange: v('budgetRange'), timeline: v('timeline'),
    additionalNotes: v('additionalNotes'), acknowledged: $<HTMLInputElement>('#acknowledged').checked,
  };
}

function setValues(vals: Record<string, unknown>) {
  for (const [k, val] of Object.entries(vals)) {
    if (k === 'acknowledged') continue; // must be ticked consciously each time
    const els = form.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(k)}"]`);
    els.forEach((el) => {
      if (el.type === 'checkbox') el.checked = Array.isArray(val) && val.includes(el.value);
      else if (el.type === 'radio') el.checked = el.value === val;
      else if (typeof val === 'string') el.value = val;
    });
  }
  syncConditional();
}

// ---------------------------------------------------------------- conditional fields
function syncConditional() {
  const has = (form.elements.namedItem('hasWebsite') as RadioNodeList).value;
  $('#websiteUrlField').hidden = has !== 'Yes';
  $('#websiteRequirementsField').hidden = has !== 'No';
  const other = form.querySelector<HTMLInputElement>('input[name=services][value="Other services"]')!.checked;
  $('#otherServicesField').hidden = !other;
}

// ---------------------------------------------------------------- errors
function fieldContainer(name: string): HTMLElement | null {
  if (name === 'services') return $('#services').closest('.field');
  if (name === 'signature') return $('#signatureBox').closest('.field');
  const el = form.querySelector<HTMLElement>(`[name="${name}"]`);
  return el?.closest('.field') ?? null;
}

function controlFor(name: string): HTMLElement | null {
  if (name === 'services') return $('#services');
  if (name === 'hasWebsite') return $('#hasWebsite');
  if (name === 'signature') return $('#sig');
  if (name === 'preferredContact') return form.querySelector('.segmented');
  return form.querySelector(`[name="${name}"]`);
}

function clearError(name: string) {
  const box = fieldContainer(name);
  box?.querySelector('.field-error')?.remove();
  const ctl = controlFor(name);
  ctl?.removeAttribute('aria-invalid');
  if (name === 'signature') $('#signatureBox').classList.remove('invalid');
}

function showError(name: string, message: string) {
  clearError(name);
  const box = fieldContainer(name);
  const ctl = controlFor(name);
  if (!box) return;
  const id = `err-${name}`;
  const p = document.createElement('span');
  p.className = 'field-error';
  p.id = id;
  p.textContent = message;
  box.append(p);
  if (ctl) {
    ctl.setAttribute('aria-invalid', 'true');
    ctl.setAttribute('aria-describedby', id);
  }
  if (name === 'signature') $('#signatureBox').classList.add('invalid');
}

function showErrors(errors: Record<string, string>) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  $('#signatureBox').classList.remove('invalid');
  for (const [k, msg] of Object.entries(errors)) showError(k, msg);
}

function focusFirstError() {
  const first = pages[step].querySelector('.field-error');
  const ctl = first?.closest('.field')?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, canvas');
  (ctl ?? first as HTMLElement | null)?.focus?.();
  first?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function validateStep(n: number): FieldErrors {
  const { errors } = validateApplication(values(), [n]);
  return errors;
}

// ---------------------------------------------------------------- navigation
function show(n: number, focus = true) {
  step = n;
  pages.forEach((p, i) => (p.hidden = i !== n));
  stepEls.forEach((s, i) => {
    s.classList.toggle('active', i === n);
    s.classList.toggle('done', i < n);
    if (i === n) s.setAttribute('aria-current', 'step');
    else s.removeAttribute('aria-current');
  });
  $('#bar').style.width = `${(100 / pages.length) * (n + 1)}%`;
  $('.progress').setAttribute('aria-valuenow', String(n + 1));
  backBtn.hidden = n === 0;
  nextBtn.hidden = n === LAST;
  submitBtn.hidden = n !== LAST;
  toReviewBtn.hidden = !(reviewReturn && n !== LAST);
  nextBtn.textContent = reviewReturn && n !== LAST ? 'Save & continue' : 'Continue';
  formError.hidden = true;
  if (n === LAST) {
    renderReview();
    requestAnimationFrame(() => pad.resize());
  }
  if (focus) {
    $('#formArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    pages[n].querySelector<HTMLElement>('.page-title')?.setAttribute('tabindex', '-1');
    pages[n].querySelector<HTMLElement>('.page-title')?.focus({ preventScroll: true });
  }
  persist();
}

function tryAdvance(): boolean {
  const errors = validateStep(step);
  if (step === 2) Object.assign(errors, fileErrors());
  showErrors(errors as Record<string, string>);
  if (Object.keys(errors).length) {
    focusFirstError();
    return false;
  }
  return true;
}

nextBtn.addEventListener('click', () => {
  if (!tryAdvance()) return;
  show(reviewReturn ? LAST : Math.min(LAST, step + 1));
});
toReviewBtn.addEventListener('click', () => {
  if (tryAdvance()) show(LAST);
});
backBtn.addEventListener('click', () => show(Math.max(0, step - 1)));

form.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name) clearError(t.name);
  if (t.name === 'hasWebsite' || t.name === 'services') syncConditional();
  if (t.name === 'acknowledged') clearError('acknowledged');
  updateCounter();
  persistSoon();
});
form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name === 'hasWebsite' || t.name === 'services') {
    syncConditional();
    clearError(t.name);
  }
  persistSoon();
});
// Validate a field when the user leaves it (only if it has a value, to avoid nagging).
form.addEventListener('focusout', (e) => {
  const t = e.target as HTMLInputElement;
  const name = t.name as FieldName;
  if (!name || !(name in FIELD_STEP) || !t.value || t.type === 'checkbox' || t.type === 'radio') return;
  const err = validateStep(FIELD_STEP[name])[name];
  if (err) showError(name, err);
  else clearError(name);
});
// Enter in a text input advances instead of submitting the whole form.
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && step < LAST) {
    e.preventDefault();
    nextBtn.click();
  }
});

function updateCounter() {
  const ta = $<HTMLTextAreaElement>('#projectRequirements');
  const c = document.querySelector<HTMLElement>('.counter[data-for="projectRequirements"]')!;
  const n = ta.value.trim().length;
  c.textContent = n < 20 ? `${n} / 20 characters minimum` : `${n.toLocaleString('en-IN')} / 8,000`;
}

// ---------------------------------------------------------------- attachments
const fileInput = $<HTMLInputElement>('#files');
const dropzone = $('#dropzone');

function fmtSize(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileErrors(): Record<string, string> {
  const problems = files.map((f) => attachmentProblem(f.name, f.size, f.type)).filter(Boolean);
  if (files.length > ATTACHMENTS.maxFiles) problems.unshift(`You can attach up to ${ATTACHMENTS.maxFiles} files.`);
  return problems.length ? { files: problems[0]! } : {};
}

function renderFiles() {
  const list = $('#fileList');
  list.innerHTML = '';
  files.forEach((f, i) => {
    const problem = attachmentProblem(f.name, f.size, f.type);
    const li = document.createElement('li');
    if (problem) li.className = 'bad';
    li.innerHTML = `<span class="fname"></span><span class="fsize"></span><button type="button" class="btn ghost small">Remove</button>`;
    li.querySelector('.fname')!.textContent = problem ?? f.name;
    li.querySelector('.fsize')!.textContent = fmtSize(f.size);
    const btn = li.querySelector('button')!;
    btn.setAttribute('aria-label', `Remove ${f.name}`);
    btn.addEventListener('click', () => {
      files.splice(i, 1);
      renderFiles();
    });
    list.append(li);
  });
  const errs = fileErrors();
  if (errs.files) showError('files', errs.files);
  else clearError('files');
}

function addFiles(list: FileList | null) {
  if (!list) return;
  for (const f of list) {
    if (!files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) files.push(f);
  }
  fileInput.value = '';
  renderFiles();
}
fileInput.addEventListener('change', () => addFiles(fileInput.files));
['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('drag')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles((e as DragEvent).dataTransfer?.files ?? null);
});

// ---------------------------------------------------------------- review
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderReview() {
  const { data } = validateApplication(values());
  const v = (s: string) => (s ? esc(s) : '<span class="empty">Not provided</span>');
  const sections: [string, number, [string, string][]][] = [
    ['Contact details', 0, [
      ['Full name', v(data.fullName)], ['Designation', v(data.designation)], ['Email', v(data.email)],
      ['Phone', v(data.phone)], ['Preferred contact', v(data.preferredContact)],
    ]],
    ['Business details', 1, [
      ['Company', v(data.companyName)], ['Industry', v(data.industry)], ['Location', v(data.location)],
      ['Has a website', v(data.hasWebsite)],
      data.hasWebsite === 'Yes' ? ['Website', v(data.websiteUrl)] : ['Website requirements', v(data.websiteRequirements)],
      ['Business description', v(data.businessDescription)],
    ]],
    ['Project requirements', 2, [
      ['Services', v(data.services.map((s) => (s === 'Other services' && data.otherServices ? `Other: ${data.otherServices}` : s)).join('\n'))],
      ['Requirements', v(data.projectRequirements)], ['Budget', v(data.budgetRange)], ['Timeline', v(data.timeline)],
      ['Attachments', v(files.map((f) => `${f.name} (${fmtSize(f.size)})`).join('\n'))],
      ['Additional notes', v(data.additionalNotes)],
    ]],
  ];
  $('#review').innerHTML = sections.map(([title, target, rows]) => `
    <section class="review-card">
      <header><h3>${title}</h3><button type="button" class="btn ghost small" data-edit="${target}" aria-label="Edit ${title.toLowerCase()}">Edit</button></header>
      <dl>${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
    </section>`).join('');
}

$('#review').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-edit]');
  if (!btn) return;
  reviewReturn = true;
  show(Number(btn.dataset.edit));
});

// ---------------------------------------------------------------- signature
const pad = new SignaturePad($<HTMLCanvasElement>('#sig'), () => {
  $('#signatureBox').classList.toggle('signed', pad.hasStrokes());
  if (!pad.isEmpty()) clearError('signature');
  persistSoon();
});
$('#sigClear').addEventListener('click', () => pad.clear());
$('#sigUndo').addEventListener('click', () => pad.undo());

// ---------------------------------------------------------------- draft persistence
let persistTimer = 0;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persist, 400);
}
function persist() {
  if (submitting || lastSubmission) return;
  const ok = saveDraft({ values: values(), step, idempotencyKey, signature: pad.toJSON(), savedAt: Date.now() });
  $('#saveState').textContent = ok ? `Progress saved on this device · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '';
}

function restore() {
  const d = loadDraft();
  if (!d) return;
  setValues(d.values ?? {});
  if (typeof d.idempotencyKey === 'string') idempotencyKey = d.idempotencyKey;
  pad.load(d.signature);
  updateCounter();
  const target = Math.min(Math.max(0, Number(d.step) || 0), LAST);
  // Only resume on a step whose earlier steps are valid.
  let resume = 0;
  while (resume < target && Object.keys(validateStep(resume)).length === 0) resume++;
  show(resume, false);
  const note = document.createElement('div');
  note.className = 'alert info';
  note.innerHTML = 'We restored your saved progress. Attached files need to be selected again. <button type="button" class="btn ghost small" id="discardDraft" style="margin-left:6px">Start over</button>';
  formError.before(note);
  note.querySelector('#discardDraft')!.addEventListener('click', () => {
    clearDraft();
    location.reload();
  });
}

// ---------------------------------------------------------------- submission
function setBusy(btn: HTMLButtonElement, busy: boolean, label?: string) {
  btn.disabled = busy;
  btn.classList.toggle('loading', busy);
  btn.setAttribute('aria-busy', String(busy));
  if (label) btn.querySelector('.btn-label')!.textContent = label;
}

function showFormError(message: string) {
  formError.textContent = message;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

let uploaded: { key: string; session: string; files: { path: string; name: string }[] } | null = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return; // duplicate-click guard
  formError.hidden = true;

  const { errors } = validateApplication(values());
  const all: Record<string, string> = { ...errors, ...fileErrors() };
  const signature = pad.toPNG();
  if (!signature) all.signature = pad.hasStrokes() ? 'Your signature is too short. Please sign your full signature.' : 'Please draw your signature in the box.';

  const earlier = Object.keys(all).map((k) => FIELD_STEP[k as FieldName] ?? (k === 'files' ? 2 : LAST)).filter((s) => s < LAST);
  if (earlier.length) {
    reviewReturn = true;
    show(Math.min(...earlier));
    showErrors(all);
    focusFirstError();
    return;
  }
  if (Object.keys(all).length) {
    showErrors(all);
    focusFirstError();
    return;
  }

  submitting = true;
  setBusy(submitBtn, true, 'Submitting…');
  backBtn.disabled = true;
  try {
    let attachments: { path: string; name: string }[] = [];
    let uploadSession: string | undefined;
    if (files.length) {
      const key = files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');
      if (uploaded?.key !== key) {
        setBusy(submitBtn, true, `Uploading files (0/${files.length})…`);
        const res = await uploadAttachments(files, (n) => setBusy(submitBtn, true, `Uploading files (${n}/${files.length})…`));
        uploaded = { key, session: res.session, files: res.files };
      }
      attachments = uploaded.files;
      uploadSession = uploaded.session;
      setBusy(submitBtn, true, 'Submitting…');
    }

    const res = await submitApplication({
      idempotencyKey,
      form: values(),
      signature,
      uploadSession,
      attachments,
      website: (form.elements.namedItem('website') as HTMLInputElement).value,
    });
    onSuccess(res);
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : new ApiError('Something went wrong. Please try again.', 0);
    if (Object.keys(apiErr.fieldErrors).length) {
      const fe = apiErr.fieldErrors;
      const first = Math.min(...Object.keys(fe).map((k) => FIELD_STEP[k as FieldName] ?? LAST));
      if (first < LAST) { reviewReturn = true; show(first); }
      showErrors(fe);
      focusFirstError();
    }
    if (apiErr.status === 422 && /upload|attach/i.test(apiErr.message)) uploaded = null;
    showFormError(apiErr.message);
  } finally {
    submitting = false;
    setBusy(submitBtn, false, 'Submit application');
    backBtn.disabled = false;
  }
});

function onSuccess(res: SubmitResponse) {
  lastSubmission = {
    reference: res.reference, token: res.accessToken, fullName: res.fullName,
    companyName: res.companyName, submittedAt: res.submittedAt,
  };
  rememberSubmission(lastSubmission);
  clearDraft();
  $('#formArea').hidden = true;
  $('.steps-card').hidden = true;
  $('.layout').style.gridTemplateColumns = '1fr';
  const success = $('#success');
  success.hidden = false;
  $('#successTitle').textContent = `Thank you, ${res.fullName.split(' ')[0]}.`;
  $('#successIntro').textContent = `Your application for ${res.companyName} has been submitted to Innovexa Digital. Our team will review your requirements and contact you soon.`;
  $('#successRef').textContent = res.reference;
  $('#successDate').textContent = new Date(res.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  success.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------- PDF download / print
async function fetchPdf(sub: SavedSubmission, btn?: HTMLButtonElement): Promise<Blob | null> {
  const errEl = $('#pdfError');
  errEl.hidden = true;
  if (btn) setBusy(btn, true);
  try {
    return await downloadPdf(sub.reference, sub.token);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not download the PDF.';
    if (lastSubmission) {
      errEl.textContent = `${msg} Your application is saved — you can try again in a moment.`;
      errEl.hidden = false;
    } else {
      alertBanner(msg);
    }
    if (err instanceof ApiError && err.status === 404) forgetSubmission(sub.reference);
    return null;
  } finally {
    if (btn) setBusy(btn, false);
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function printBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile) {
    // Mobile browsers cannot print a PDF inside an iframe; open it in the viewer instead.
    window.open(url, '_blank', 'noopener');
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };
  document.body.append(frame);
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 5 * 60_000);
}

$('#downloadPdf').addEventListener('click', async () => {
  if (!lastSubmission) return;
  const blob = await fetchPdf(lastSubmission, $('#downloadPdf'));
  if (blob) saveBlob(blob, `Innovexa-Application-${lastSubmission.reference}.pdf`);
});
$('#printPdf').addEventListener('click', async () => {
  if (!lastSubmission) return;
  const blob = await fetchPdf(lastSubmission, $('#printPdf'));
  if (blob) printBlob(blob);
});
$('#newApplication').addEventListener('click', () => location.reload());

function alertBanner(msg: string) {
  showFormError(msg);
}

// ---------------------------------------------------------------- previous submissions
function renderPrevious() {
  const list = loadSubmissions();
  const box = $('#previous');
  box.hidden = list.length === 0;
  if (!list.length) return;
  box.innerHTML = `<h2>Applications submitted from this device</h2><ul>${list.map((s) => `
    <li><span><span class="ref">${esc(s.reference)}</span> · ${esc(s.companyName)} · ${esc(new Date(s.submittedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }))}</span>
    <button type="button" class="btn ghost small" data-ref="${esc(s.reference)}"><span class="spinner" aria-hidden="true"></span><span class="btn-label">Download PDF</span></button></li>`).join('')}</ul>`;
}
$('#previous').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ref]');
  if (!btn) return;
  const sub = loadSubmissions().find((s) => s.reference === btn.dataset.ref);
  if (!sub) return;
  const blob = await fetchPdf(sub, btn);
  if (blob) saveBlob(blob, `Innovexa-Application-${sub.reference}.pdf`);
  else renderPrevious();
});

// ---------------------------------------------------------------- init
restore();
syncConditional();
updateCounter();
renderPrevious();
if (step === 0) show(0, false);
