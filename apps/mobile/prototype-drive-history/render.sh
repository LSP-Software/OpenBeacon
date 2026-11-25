#!/bin/bash
cd "$(dirname "$0")"
for f in "$@"; do n=${f%.html}; W=${W:-1440}  # HT sets the window height
/home/smadger/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell --headless --no-sandbox --no-zygote --disable-gpu --hide-scrollbars --screenshot="$PWD/$n.png" --window-size=$W,${HT:-1040} --force-device-scale-factor=1.5 "file://$PWD/$f" 2>/dev/null
done
