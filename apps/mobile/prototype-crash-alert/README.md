# PROTOTYPE: how the crash countdown and a received Crash alert look

Throwaway mockups for OPE-393 (map OPE-377). They are never merged. The flow itself was settled in OPE-387.

Open any `.html` file in a browser, or run `W=1340 HT=1060 ./render.sh D-A.html` to redraw its PNG (`W` and `HT` set the window size; S and N need `W=2690`).

Driver's countdown, three styles (each: counting down, alert sent, not sent yet):

- `D-A`: full red alarm screen, ring countdown, huge white I'm OK
- `D-B`: dark header with a draining bar, sheet showing what the alert will say and who gets it
- `D-C`: light screen, one huge round I'm OK with the countdown as a ring around it

Received side, three styles (each: just tapped, then "Sam says they're OK"):

- `R-A`: red block at the top of the usual person card
- `R-B`: red banner across the top of the map, usual person card underneath
- `R-C`: Crash alert sheet listing what has happened so far, dotted line from crash spot to Sam

Shared:

- `S`: Account › Drive detection (hosted, self-hosted without pushes, paused / Drive detection off), Try it, Account › Notifications
- `N`: received notifications (alert, OK, late, two devices), driver's heads-up fallback and later notices, Group History, "Crash alerts are off"

`common.css`, `parts.js`, `icons.js`, `render.sh` and the fonts come from `prototype/weekly-driving-report`. `crash.js` holds the crash parts.
