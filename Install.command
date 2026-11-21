#!/bin/zsh
set -eu
cd "${0:a:h}"

sdk="${TIZEN_SDK:-$HOME/tizen-studio}"
sdb="$sdk/tools/sdb"
cli="$sdk/tools/ide/bin/tizen"
[[ -x "$cli" && -x "$sdb" ]] || { print -u2 'Set TIZEN_SDK to the Tizen Studio directory.'; exit 1; }

print -n 'Samsung TV IPv4 address (Return to cancel): '
IFS= read -r tv_ip
[[ -n "$tv_ip" ]] || exit 0
[[ "$tv_ip" == <0-255>.<0-255>.<0-255>.<0-255> ]] || { print -u2 'Enter the four parts of the TV IPv4 address.'; exit 1; }
serial="${tv_ip}:26101"
[[ -s Dashboard.wgt ]] || ./Build.command
"$sdb" connect "$serial"
"$sdb" devices | awk -v tv="$serial" '$1 == tv && $2 == "device" { found=1 } END { exit !found }' || {
    print -u2 'TV unavailable. Check Developer Mode, the developer computer address and the network.'
    exit 1
}
"$cli" install -s "$serial" -n Dashboard.wgt -- "$PWD"
"$cli" run -s "$serial" -p AlpineDash.Dashboard
