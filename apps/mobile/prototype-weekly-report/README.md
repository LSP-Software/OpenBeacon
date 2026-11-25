# PROTOTYPE: where the Weekly driving report opens, and how it looks

Throwaway mockups for OPE-392 (map OPE-377). They are never merged.

Open any `.html` file in a browser, or run `HT=1800 ./render.sh S.html` to redraw its PNG (`W` and `HT` set the window size).

- `A`: a third Timeline view, Day / Drives / Week, with ‹ › to step through weeks
- `B`: each week in the Drives list starts with a summary header; the report is a sheet over the Timeline map showing the week's drives
- `C`: a "Driving this week" row on the person card opens the report on its own screen; the driver also finds it in Account › Drive detection
- `S`: shared states: your own week, "Covers Sat–Sun", this week so far, no drives, only Passenger drives, Drive detection off

`common.css`, `parts.js`, `icons.js` and the fonts come from `prototype/drive-timeline-list`. `week.js` holds the report parts.

Sam picked **A** on 25 Nov 2026. The Week view opens on this week so far (not the last full week as drawn in A1). An unfinished week compares with the same days of last week (S3). The "Starts at 100" score breakdown, the shared states S1–S6 and the "sees the same report" footer stay as drawn. The full decision is in the resolution comment on OPE-392.
