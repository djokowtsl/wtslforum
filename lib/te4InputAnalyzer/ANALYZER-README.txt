TE4 Replay Input Analyzer · Online Circuit moderator guide

Requirements
  Keep analyze-dmo.cjs and measure-aim-at-impact.cjs in the same folder.
  Node.js 24 was used for testing. No npm install or game launch is needed.
  Supports online singles in TE4 Builds 167–169, replay formats 32–33.

Run from PowerShell in the scripts folder
  node .\analyze-dmo.cjs "C:\path\to\match.dmo" --out ".\match-report.html" --self-test
  Open match-report.html in a browser. Use a different output name per match.
  The console also lists the score, checks and the first flagged passages.
  Under Windows, replays are typically in AppData\LocalLow\Mana Games\Tennis Elbow 4\Profiles\Demos.
  --fps overrides the input screening step. Leave it unset for recorded timing.

Review a match
  Compare both players under Repeated neutral gaps in preparations over 0.5 s.
  It works without aim debug data and links the main points to the inspector.
  Use Lateral aim at impact to compare both players' recorded aim.
  Full per-frame debug data and strike antilag are needed for those charts.
  Show only timestamped impacts to cross-check the trajectory estimates.
  Use Passages to review and Point inspector to find a point in the replay
  and check it with the in-game aiming indicator. Serves are hidden by default
  in the flagged-passages table. Export flagged passages or frame-by-frame
  inputs as CSV, or export the measurements as JSON.
  Treat a flag as a lead. Check repeated patterns and plausible controller
  behavior before drawing conclusions. Keep match reports within moderation.

Node.js downloads: https://nodejs.org/en/download
