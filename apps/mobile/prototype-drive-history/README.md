# PROTOTYPE: drives in Group History, the "Tell this Group" switch and Drive alert mutes

Throwaway mockups for OPE-394 (map OPE-377). They are never merged. The notification rules come from OPE-388.

Open any `.html` file in a browser, or run `W=1780 HT=1080 ./render.sh T.html` to redraw its PNG (`H` needs `W=1340`).

- `H`: Group History entries for a finished drive. HA one sentence per drive, HB short title with the numbers underneath, HC one line per person per day.
- `T`: where the driver turns each Group's "Tell this Group when I finish a drive" switch on or off. TA a list of Groups in Account › Drive detection, TB the Group's Settings tab, TC both. TD is what members see when it's off.
- `M`: where a member mutes Drive alerts. MA a Drive alerts card on the Group's existing Alerts screen, MB a "Your alerts" section in the Group's Settings tab opening MB2. MP is the switch on the person card.

`common.css`, `parts.js`, `crash.js`, `icons.js`, `render.sh` and the fonts come from `prototype/crash-alert-screens`. `drive.js` holds the new parts.

Sam picked on 25 Nov 2026: History **HB** (short title, distance, time and top speed as three chips; tapping opens the drive in Timeline), Passenger drives get an entry with no numbers, the "Tell this Group" switch in **both** places (**TC**: the Group list in Account › Drive detection and each Group's Settings tab, one setting), and Drive alert mutes as the first card on the Group's Alerts screen (**MA**), plus the person-card switch (MP). The full decision is in the resolution comment on OPE-394.
