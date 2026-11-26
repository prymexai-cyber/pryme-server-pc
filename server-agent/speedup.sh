#!/usr/bin/env bash
# Pryme Server PC — make the server boot faster and run faster.
# Safe to run again any time:  sudo bash ~/pryme-server-pc/server-agent/speedup.sh
set -u
[ "${EUID:-$(id -u)}" -eq 0 ] || { echo "Run:  sudo bash $0"; exit 1; }
say() { echo; echo "==> $*"; }
BEFORE=$(systemd-analyze time 2>/dev/null | head -1)

say "1/7 Boot menu: wait 1 second instead of 10"
if [ -f /etc/default/grub ]; then
  cp /etc/default/grub "/etc/default/grub.pryme-backup.$(date +%s)"
  set_grub() { if grep -q "^$1=" /etc/default/grub; then sed -i "s|^$1=.*|$1=$2|" /etc/default/grub; else echo "$1=$2" >> /etc/default/grub; fi; }
  set_grub GRUB_TIMEOUT 1
  set_grub GRUB_TIMEOUT_STYLE hidden
  set_grub GRUB_RECORDFAIL_TIMEOUT 2
  update-grub >/dev/null 2>&1 && echo "   done" || echo "   (update-grub failed — skipped)"
fi

say "2/7 Do not wait for the network while booting"
for s in NetworkManager-wait-online.service systemd-networkd-wait-online.service; do
  systemctl disable "$s" >/dev/null 2>&1 && echo "   off: $s"
done

say "3/7 Turn off desktop extras a server does not need"
for s in cups cups-browsed bluetooth ModemManager whoopsie apport kerneloops speech-dispatcher packagekit; do
  if systemctl list-unit-files "$s.service" 2>/dev/null | grep -q "$s"; then
    systemctl disable --now "$s.service" >/dev/null 2>&1 && echo "   off: $s"
  fi
done
# software-update checks: still run, but never right after boot (they thrash the slow disk)
for t in apt-daily apt-daily-upgrade; do
  mkdir -p "/etc/systemd/system/$t.timer.d"
  printf '[Timer]\nPersistent=false\nRandomizedDelaySec=2h\n' > "/etc/systemd/system/$t.timer.d/pryme.conf"
done
systemctl daemon-reload

say "4/7 Faster memory: compressed RAM swap (zram) + less swapping to the hard disk"
DEBIAN_FRONTEND=noninteractive apt-get install -y zram-tools >/dev/null 2>&1 || true
if [ -f /etc/default/zramswap ] || dpkg -s zram-tools >/dev/null 2>&1; then
  printf 'ALGO=zstd\nPERCENT=50\nPRIORITY=100\n' > /etc/default/zramswap
  systemctl enable --now zramswap >/dev/null 2>&1; systemctl restart zramswap >/dev/null 2>&1 && echo "   zram on"
fi
printf 'vm.swappiness=20\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/91-pryme-speed.conf
sysctl -q -p /etc/sysctl.d/91-pryme-speed.conf

say "5/7 System disk: stop writing 'last opened' times on every file read"
cp /etc/fstab "/etc/fstab.pryme-backup.$(date +%s)"
awk 'BEGIN{OFS="\t"} !/^[[:space:]]*#/ && $2=="/" && $3 ~ /^ext[234]$/ && $4 !~ /noatime/ { $4=$4",noatime" } {print}' /etc/fstab > /tmp/fstab.pryme && \
  findmnt --verify --tab-file /tmp/fstab.pryme >/dev/null 2>&1 && cp /tmp/fstab.pryme /etc/fstab && echo "   noatime on" || echo "   (fstab unchanged)"
rm -f /tmp/fstab.pryme

say "6/7 Clean up old files"
apt-get autoremove -y >/dev/null 2>&1
apt-get clean
journalctl --vacuum-size=100M >/dev/null 2>&1
echo "   done"

say "7/7 Checking disks"
BAD=$(dmesg 2>/dev/null | grep -E "ata[0-9]+(\.[0-9]+)?: (failed|COMRESET failed|link is slow|hard resetting)|I/O error, dev sd" | tail -5)
if [ -n "$BAD" ]; then
  echo "   !! A disk is not answering properly. This makes boot VERY slow:"
  echo "$BAD" | sed 's/^/      /'
  echo "   -> Check its cables, or unplug that disk."
else
  echo "   all disks answer normally"
fi
lsblk -d -o NAME,SIZE,MODEL,TRAN 2>/dev/null | sed 's/^/   /'

echo
echo "Before: ${BEFORE:-unknown}"
echo "Finished. Restart now to feel the difference:  sudo reboot"
