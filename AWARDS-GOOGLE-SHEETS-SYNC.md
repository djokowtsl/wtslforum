# Native Google Form responses for Forum awards

The Forum is the only awards voting interface. When a voter has saved every required answer, the Forum submits the complete ballot as a native Google Form response. Optional questions can be left blank or answered later. The linked Google Form response summary and its response spreadsheet stay in sync because the Apps Script uses `FormResponse.submit()` rather than writing imitation rows.

The Discord ID stays inside the Forum database. The Forum sends an HMAC-based pseudonymous key to Apps Script so it can recognize the same voter without putting their Discord ID or Forum vote IDs in the Form response destination. The script adds hidden sync-metadata columns to the linked Form Responses tab; these contain only the pseudonymous key, native response ID, ballot fingerprint, and update time. When a voter edits a submitted ballot, the script submits the replacement, removes the previous response from the Form's response store, and removes that exact response's linked sheet row. Responses submitted directly to Google Forms are not managed or deleted by the Forum sync.

The admin **Backfill Forum ballots to Google Form** action submits the latest complete ballots currently stored in the Forum database, including votes saved before this change. Incomplete ballots are left in the Forum until required questions are answered. Re-running the action is safe. The old `Forum Votes` tab is no longer written to or used for backfill; its existing rows are left untouched as an archive.

## One-time Apps Script setup

1. Open the spreadsheet currently linked to the Google Form, then choose **Extensions → Apps Script**.
2. Replace the old spreadsheet-upsert script with `google-apps-script/award-vote-sync.gs`, then save and deploy a new web-app version.
3. In Apps Script **Project Settings → Script Properties**, keep or add:
   - `SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the linked response spreadsheet URL.
   - `SYNC_SECRET`: the shared secret already configured for the Forum, at least 32 characters. Do not send it in chat or commit it.
4. Set the web app to execute as your Google account and permit the Forum server to call it. The shared secret protects the endpoint.
5. Confirm the Google Form sends responses to this spreadsheet.

The sync maps imported questions by their Google Form item ID, with the imported title as a fallback. Re-import the current form in `/admin/awards` before backfilling so question IDs are saved. Required questions must be single-choice or dropdown questions that exist in the Forum ballot. Email collection and other required question types are rejected rather than submitting incomplete or misleading responses.

## Forum server setup and backfill

Apply these database migrations to the Forum database before deploying the updated Forum:

- `migrations/2026-10-22-award-question-required.sql`
- `migrations/2026-10-22-award-native-form-responses.sql`

The existing server-side variables are retained for compatibility:

- `AWARDS_SHEET_WEB_APP_URL`: the Apps Script web-app URL.
- `AWARDS_SHEET_SYNC_SECRET`: the same secret stored in Apps Script as `SYNC_SECRET`.

Keep both server-side; do not use a `NEXT_PUBLIC_` prefix. After deploying the updated Forum and Apps Script, open `/admin/awards`, re-import the Form questions, then select **Backfill Forum ballots to Google Form**. The admin page reports only sync status, not vote contents or poll totals.

For each completed ballot, the Forms service creates a real response in the Form response store. Google documents that deleting a Form response does not remove the external spreadsheet copy, so this script explicitly cleans up the prior linked response row when replacing a Forum-managed response.

The Form and linked spreadsheet are not modified until the new Forum version, Apps Script version, and server settings are deployed and the admin starts the backfill. The existing `Forum Votes` tab is not deleted.
