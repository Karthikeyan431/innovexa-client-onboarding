# Innovexa Digital Client Onboarding – Netlify deploy package

## Deploy (free-tier option)
1. Sign in to your Netlify account.
2. Choose **Add new site → Deploy manually**.
3. Upload this folder (or its ZIP) using Netlify Drop / the manual deploy interface.
4. Netlify will provide a temporary `*.netlify.app` URL.
5. Test the form and PDF print flow at that URL before connecting your custom domain.

## Included
- `index.html`: current four-step client onboarding prototype.
- `netlify.toml`: static publish configuration and basic response headers.

## Important current limitations
This is a static frontend prototype. Form submissions are not sent to a server or database. Selected files are not uploaded. No automatic email is sent. The captured drawing is not identity-verified. PDF output is produced by the browser print dialog (choose **Save as PDF**).

Do not collect sensitive identity documents or rely on this for legally binding signatures until backend security, access controls, privacy notice, retention rules, and compliant e-signature are implemented.