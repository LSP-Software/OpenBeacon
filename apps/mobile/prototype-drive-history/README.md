# PROTOTYPE: drives in Group History, the "Tell this Group" switch and Drive alert mutes

Throwaway mockups for OPE-394 (map OPE-377). They are never merged. The notification rules come from OPE-388.

Open any `.html` file in a browser, or run `W=1780 HT=1080 ./render.sh T.html` to redraw its PNG (`H` needs `W=1340`).

- `H`: Group History entries for a finished drive. HA one sentence per drive, HB short title with the numbers underneath, HC one line per person per day.
- `T`: where the driver turns each Group's "Tell this Group when I finish a drive" switch on or off. TA a list of Groups in Account › Drive detection, TB the Group's Settings tab, TC both. TD is what members see when it's off.
- `M`: where a member mutes Drive alerts. MA a Drive alerts card on the Group's existing Alerts screen, MB a "Your alerts" section in the Group's Settings tab opening MB2. MP is the switch on the person card.

`common.css`, `parts.js`, `crash.js`, `icons.js`, `render.sh` and the fonts come from `prototype/crash-alert-screens`. `drive.js` holds the new parts.
