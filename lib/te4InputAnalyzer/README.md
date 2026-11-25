# TE4 Online Circuit input analyzer (vendored)

`analyze-dmo.cjs` and `measure-aim-at-impact.cjs` are the moderator tool shared
with the WTSL admin group ("TE4-Online-Circuit-Analyzer.zip"). They're kept as
received so results match what admins get when they run the tool by hand.
`ANALYZER-README.txt` is the guide that came with them.

One line differs from the original: the last `module.exports` line of
`analyze-dmo.cjs` also exports `WriteReport`, so the admin panel can serve the
tool's own HTML report. Nothing else is changed.

| File | Original SHA-256 | Vendored SHA-256 |
| --- | --- | --- |
| analyze-dmo.cjs | 1cc71d4ae47f41082f881a45c42fd82a36fc2596214116a98f468b917f24f822 | 95d531936308f99fb746986497b1b60b974cbf962656a7d21e23bc299f0d83d6 |
| measure-aim-at-impact.cjs | c25bd7f19983d6449f5fd072a5d529af4ac1d1c256a88f53b9437879d3eca9a3 | same |

`tests/dmoIntegrity.test.mjs` checks these hashes. If you replace the scripts
with a newer version, update the hashes there and bump
`DMO_INTEGRITY_ANALYZER_VERSION` in `lib/dmoIntegrityScore.mjs` so every match
is rescanned.

The admin panel shows the tool's own grades, using its own names: each
player's strongest flagged passage outside serves (Converging indicators,
Intermediate or Weak / exploratory). For each passage it also says whether the
replay's recorded aim confirms it (the tool's recorded plateau check). That is
for review only and never changes the grade. A grade is a lead for an admin to
check in the replay, not proof.

Supported: online singles between two humans, TE4 Builds 167–169, replay
formats 32–33. Anything else is marked "Couldn't analyse".
