#!/bin/bash
# A stand-in for wsl.exe on Linux (tests only, needs root): distros are folders, "running in a distro" is chroot.
# Prints UTF-16LE like the real one does when not attached to a console. State lives in $FAKE_WSL.
set -e
S="${FAKE_WSL:?}"; mkdir -p "$S/reg"
u16() { iconv -f UTF-8 -t UTF-16LE; }
root_of() { cat "$S/reg/$1" 2>/dev/null; }
case "$1" in
  --status)
    if [ -n "$FAKE_WSL_OFF" ]; then printf 'The Windows Subsystem for Linux is not enabled.\n' | u16; exit 1; fi
    printf 'Default Distribution: none\nDefault Version: 2\n' | u16 ;;
  --list) ls "$S/reg" 2>/dev/null | u16 ;;
  --import)
    name="$2"; dir="$3"; tar="$4"
    mkdir -p "$dir/rootfs"; tar -xf "$tar" -C "$dir/rootfs" --same-owner --numeric-owner
    echo "$dir/rootfs" > "$S/reg/$name" ;;
  --export) r=$(root_of "$2"); tar -cf "$3" -C "$r" --numeric-owner --exclude=./proc --exclude=./dev --exclude=./sys . ;;
  --terminate)
    for p in $(cat "$S/pids-$2" 2>/dev/null); do pkill -9 -s "$p" 2>/dev/null || true; kill -9 "$p" 2>/dev/null || true; done
    rm -f "$S/pids-$2" ;;
  --unregister)
    r=$(root_of "$2") || true
    "$0" --terminate "$2"
    if [ -n "$r" ]; then for m in proc dev/shm dev sys; do umount -l "$r/$m" 2>/dev/null || true; done; rm -rf "$(dirname "$r")"; fi
    rm -f "$S/reg/$2" ;;
  -d)
    name="$2"; shift 2; r=$(root_of "$name") || { echo "no distro $name" | u16; exit 1; }
    while [ "$1" != "--exec" ]; do shift; done; shift
    mkdir -p "$r/proc" "$r/dev" "$r/sys" "$r/tmp"
    mountpoint -q "$r/proc" || mount -t proc proc "$r/proc"
    mountpoint -q "$r/dev" || mount --rbind /dev "$r/dev"
    mountpoint -q "$r/sys" || mount --rbind /sys "$r/sys"
    echo $$ >> "$S/pids-$name"
    exec chroot "$r" "$@" ;;
  *) echo "fake wsl: unknown $*" >&2; exit 2 ;;
esac
