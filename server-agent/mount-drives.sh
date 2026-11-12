#!/usr/bin/env bash
# Pryme Server PC — mount extra hard drives under /srv/pryme (permanently, via /etc/fstab)
# Usage:  sudo bash mount-drives.sh
set -e
if [ "$EUID" -ne 0 ]; then echo "Please run:  sudo bash mount-drives.sh"; exit 1; fi
ROOT=/srv/pryme
mkdir -p "$ROOT"
cp /etc/fstab "/etc/fstab.pryme-backup.$(date +%s)"

echo "Drives found:"
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINTS
echo

found=0
while IFS= read -r line; do
  eval "$line"   # sets NAME FSTYPE SIZE LABEL UUID TYPE MOUNTPOINT
  [ "$TYPE" = "part" ] || continue
  [ -n "$FSTYPE" ] || continue
  if [ -n "$MOUNTPOINT" ]; then
    # Desktop auto-mounts drives under /media — take them over for Pryme
    case "$MOUNTPOINT" in /media/*) umount "$NAME" 2>/dev/null || continue ;; *) continue ;; esac
  fi
  case "$FSTYPE" in swap|LVM2_member|crypto_LUKS|linux_raid_member) continue;; esac
  [ -n "$UUID" ] || continue
  grep -q "$UUID" /etc/fstab && continue
  found=1
  DEF=${LABEL:-Drive-$(basename "$NAME")}
  DEF=$(echo "$DEF" | tr ' /' '__')
  read -rp "Add $NAME ($SIZE, $FSTYPE, label '${LABEL}') to Pryme? [y/N]: " A < /dev/tty
  [ "$A" = "y" ] || [ "$A" = "Y" ] || continue
  read -rp "  Name to show in Pryme [$DEF]: " N < /dev/tty; N=${N:-$DEF}; N=$(echo "$N" | tr ' /' '__')
  MP="$ROOT/$N"; mkdir -p "$MP"
  case "$FSTYPE" in
    ntfs)  T=ntfs3; O="defaults,nofail,noatime,x-systemd.device-timeout=10s";;
    exfat) T=exfat; O="defaults,nofail,noatime,x-systemd.device-timeout=10s";;
    vfat)  T=vfat;  O="defaults,nofail,noatime,utf8,x-systemd.device-timeout=10s";;
    *)     T=$FSTYPE; O="defaults,nofail,noatime,x-systemd.device-timeout=10s";;
  esac
  echo "UUID=$UUID  $MP  $T  $O  0  0" >> /etc/fstab
  echo "  -> added: $MP"
done < <(lsblk -Ppno NAME,FSTYPE,SIZE,LABEL,UUID,TYPE,MOUNTPOINT)

[ $found -eq 0 ] && echo "No new unmounted drives found."
systemctl daemon-reload
mount -a && echo "All drives mounted." || echo "Some drive failed to mount (NTFS from Windows? turn off Windows 'Fast startup' and try again)."
df -h | grep "$ROOT" || true
