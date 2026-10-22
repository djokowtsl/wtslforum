# Awards vote sync to Google Sheets

The Forum remains the voting interface. When configured, it sends each saved Forum vote to a separate `Forum Votes` tab in the linked response spreadsheet. Existing `Form responses 1` rows are not changed. The sync does not include Discord IDs; it includes a stable Forum vote ID, season, category, nominee or write-in, and vote update time.

The sync is disabled until the Apps Script web app and Vercel environment variables are configured. Votes remain saved in the Forum while it is disabled or unavailable. An administrator can retry a full sync from `/admin/awards`; rows are upserted by Forum vote ID, so retries do not create duplicates.

The Forum does not show poll responses or result totals to administrators or visitors. Its admin API exposes only whether a sync succeeded, not vote counts or response contents. Review results through the linked Google account; Forum votes are written to the separate `Forum Votes` spreadsheet tab, not submitted as native Google Form responses.

## One-time Apps Script setup

1. Open the response spreadsheet and choose **Extensions → Apps Script**.
2. Replace the starter code with `google-apps-script/award-vote-sync.gs`, then save.
3. In Apps Script **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the response spreadsheet URL.
   - `SYNC_SECRET`: a randomly generated secret with at least 32 characters. Do not send it in chat or commit it to the repository.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your account and **Who has access** to **Anyone**. The shared secret protects writes; the script rejects requests without it.
5. Copy the deployed web app URL. It should look like `https://script.google.com/macros/s/<deployment-id>/exec`.

## Vercel setup

In the Forum's Vercel project, add these server-side environment variables for Production:

- `AWARDS_SHEET_WEB_APP_URL`: the Apps Script web app URL.
- `AWARDS_SHEET_SYNC_SECRET`: the same secret stored in Apps Script as `SYNC_SECRET`.

Do not use a `NEXT_PUBLIC_` prefix, put the secret in source control, or send it through chat. Redeploy the Forum after adding the variables. Preview can be configured separately if you want to test there.

After deployment, visit `/admin/awards` and select **Sync Forum votes now** to backfill the current cycle. The first successful sync creates the `Forum Votes` tab. New or updated votes sync immediately after that.

If Google Workspace policy does not allow an Apps Script web app accessible to **Anyone**, do not weaken the spreadsheet permissions; use a separately approved Google OAuth setup instead.
