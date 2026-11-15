#!/usr/bin/env bash
# Pryme Server PC — NAS extras
#  1) Faster Windows file sharing (Samba tuning)
#  2) Hard-disk health monitoring (SMART)
#  3) Automatic daily backup between drives
#  4) Jellyfin media server (movies / music / photos on TV & phone) — optional
# Usage:  sudo bash nas-setup.sh      (safe to run again)
set -e
if [ "$EUID" -ne 0 ]; then echo "Please run:  sudo bash nas-setup.sh"; exit 1; fi
ROOT=/srv/pryme
yes_no() { read -rp "$1 [Y/n]: " a; [ "${a:-Y}" != "n" ] && [ "${a:-Y}" != "N" ]; }

echo "Drives in Pryme:"; ls -1 "$ROOT" 2>/dev/null | sed 's/^/   • /'; echo

# ---------------- 1) Samba speed ----------------
if [ -f /etc/samba/smb.conf ] && yes_no "1) Tune Windows file sharing for speed?"; then
  if ! grep -q "# pryme-tune" /etc/samba/smb.conf; then
    sed -i '/^\[global\]/a \   # pryme-tune\n   server min protocol = SMB2_10\n   use sendfile = yes\n   strict sync = no\n   deadtime = 15' /etc/samba/smb.conf
  fi
  testparm -s >/dev/null 2>&1 && systemctl restart smbd && echo "   ✓ Samba tuned"
fi

# ---------------- 2) Disk health ----------------
if yes_no "2) Watch hard-disk health (SMART) and warn before a disk dies?"; then
  apt-get install -y smartmontools >/dev/null
  systemctl enable --now smartmontools >/dev/null 2>&1 || systemctl enable --now smartd >/dev/null 2>&1 || true
  echo "   ✓ Health monitoring on. Check any time:"
  for d in $(lsblk -dno NAME,TYPE | awk '$2=="disk"{print $1}'); do
    H=$(smartctl -H "/dev/$d" 2>/dev/null | grep -iE "result|status" | head -1 | sed 's/.*: *//')
    echo "     /dev/$d  $(lsblk -dno SIZE,MODEL /dev/$d | xargs)  →  ${H:-unknown (USB drives may not report)}"
  done
fi

# ---------------- 3) Automatic backup ----------------
if yes_no "3) Automatic daily backup of a folder to another drive?"; then
  echo "   Example source: $ROOT/Main-500GB/Important"
  echo "   Example backup: $ROOT/Portable-250GB/Backup"
  read -rp "   Folder to back up: " SRC
  read -rp "   Backup to folder (on a DIFFERENT drive): " DST
  SRC=${SRC%/}; DST=${DST%/}
  if [ -z "$SRC" ] || [ -z "$DST" ]; then echo "   skipped"; else
    mkdir -p "$SRC" "$DST"
    if [ "$(stat -c %d "$SRC")" = "$(stat -c %d "$DST")" ]; then
      echo "   ⚠️  Both folders are on the SAME drive — if that drive dies you lose both. Choose another drive."
    else
      OLD="$(dirname "$DST")/.pryme-backup-old"
      cat > /etc/systemd/system/pryme-backup.service <<EOF
[Unit]
Description=Pryme daily backup
RequiresMountsFor=$SRC $DST

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=/bin/sh -c 'rsync -a --delete --exclude "*.pryme-part" --backup --backup-dir="$OLD/\$(date +%%F)" "$SRC/" "$DST/"'
EOF
      cat > /etc/systemd/system/pryme-backup.timer <<'EOF'
[Unit]
Description=Pryme daily backup (02:00, or soon after the server starts if it was off)

[Timer]
OnCalendar=*-*-* 02:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
EOF
      apt-get install -y rsync >/dev/null
      systemctl daemon-reload && systemctl enable --now pryme-backup.timer
      echo "   ✓ Daily backup: $SRC  →  $DST"
      echo "     Changed / deleted files are kept in: $OLD/<date>"
      echo "     Run a backup now:  sudo systemctl start pryme-backup"
    fi
  fi
fi

# ---------------- 4) Jellyfin ----------------
if yes_no "4) Install Jellyfin media server (watch movies / music on TV, phone, laptop)?"; then
  apt-get install -y curl >/dev/null
  if curl -fsSL https://repo.jellyfin.org/install-debuntu.sh | bash; then
    for g in video render; do getent group $g >/dev/null && usermod -aG $g jellyfin || true; done
    IP=$(hostname -I | awk '{print $1}')
    echo "   ✓ Jellyfin: open  http://$IP:8096  → create account → Add Media Library → folder under $ROOT"
  else
    echo "   ⚠️  Jellyfin installer failed (maybe no support for this Ubuntu version yet). Pryme still works fine."
  fi
fi

echo; echo "Done ✅  NAS extras are set up."
