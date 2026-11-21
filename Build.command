#!/bin/zsh
set -eu
cd "${0:a:h}"

sdk="${TIZEN_SDK:-$HOME/tizen-studio}"
cli="$sdk/tools/ide/bin/tizen"
profile="${TIZEN_PROFILE:-TV-Dashboard}"
[[ -x "$cli" ]] || { print -u2 'Tizen CLI missing. Set TIZEN_SDK to the Tizen Studio directory.'; exit 1; }

stage=$(mktemp -d "./.dashboard-build.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
stage=${stage:a}
mkdir "$stage/app" "$stage/out"

# Stage only runtime file types. Studio metadata and existing signatures stay out.
rsync -r --exclude='.*' --include='*/' --include='/config.xml' \
    --include='*.html' --include='*.css' --include='*.js' --include='*.json' \
    --include='*.svg' --include='*.png' --include='*.jpg' --include='*.jpeg' \
    --include='*.webp' --include='*.woff' --include='*.woff2' --exclude='*' \
    app/ "$stage/app/"
if [[ -f weather.local.js ]]; then
    cp weather.local.js "$stage/app/weather-location.js"
fi
if [[ -f phone-origin.txt ]]; then
    python3 tools/configure-phone.py phone-origin.txt "$stage/app"
fi
print 'Signing Dashboard with the selected Samsung TV profile…'
if ! "$cli" package -t wgt -s "$profile" -o "$stage/out" -- "$stage/app" > "$stage/sdk.log" 2>&1; then
    print -u2 'Packaging failed. Check the profile name, certificate validity and keychain access in Tizen Studio.'
    exit 1
fi

wgt="$stage/out/Dashboard.wgt"
[[ -s "$wgt" ]] && unzip -tqq "$wgt" && \
    unzip -p "$wgt" author-signature.xml > /dev/null && \
    unzip -p "$wgt" signature1.xml > /dev/null || { print -u2 'A complete signed Dashboard.wgt was not produced.'; exit 1; }
mv -f -- "$wgt" ./Dashboard.wgt
print 'Built Dashboard.wgt.'
