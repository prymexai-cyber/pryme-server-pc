#!/usr/bin/env bash
# Pryme Server PC — server agent installer
# Works on: Xubuntu 26.04 (desktop, recommended) / Ubuntu Server 26.04 / 24.04 / Debian 12+
# Usage:  sudo bash install.sh
set -e
if [ "$EUID" -ne 0 ]; then echo "Please run:  sudo bash install.sh"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/pryme
DESK_USER="${SUDO_USER:-$(logname 2>/dev/null || echo '')}"

echo "==> Installing packages..."
apt-get update -y
apt-get install -y nodejs ffmpeg ethtool ntfs-3g exfatprogs curl xdotool openssh-server zip avahi-daemon

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "==> Node.js too old ($NODE_MAJOR). Installing Node.js 22 LTS from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "$DEST"
cp "$HERE/agent.js" "$DEST/agent.js"
rm -rf "$DEST/public" && cp -r "$HERE/../web" "$DEST/public"
cp "$HERE/mount-drives.sh" "$DEST/mount-drives.sh" 2>/dev/null || true

if [ -f /etc/pryme/config.json ]; then
  read -rp "Pryme is already set up. Change username/password? [y/N]: " CH
else CH=y; fi
if [ "$CH" = "y" ] || [ "$CH" = "Y" ]; then
  echo
  echo "==> Account for the Pryme web system (you will log in with this)"
  read -rp "Server name [Pryme Server PC]: " NAME; NAME=${NAME:-Pryme Server PC}
  read -rp "Username [admin]: " PUSER; PUSER=${PUSER:-admin}
  while true; do
    read -rsp "Password (min 6 chars): " P1; echo
    read -rsp "Password again: " P2; echo
    if [ "$P1" != "$P2" ]; then echo "  Passwords do not match."; continue; fi
    if [ ${#P1} -lt 6 ]; then echo "  Too short."; continue; fi
    break
  done
  PRYME_SET_NAME="$NAME" PRYME_SET_USER="$PUSER" PRYME_SET_PASS="$P1" node "$DEST/agent.js" --setup
fi

# ---------------- Pryme Cloud (Render) link ----------------
echo
echo "==> Pryme Cloud (Render) — lets you open Pryme from anywhere and Power On with a smart plug."
CUR_URL=$(node -e "try{const c=require('/etc/pryme/config.json');process.stdout.write(c.cloudUrl||'')}catch(e){}")
read -rp "Render URL (e.g. https://pryme-cloud.onrender.com) [${CUR_URL:-skip}]: " CLOUD_URL
CLOUD_URL=${CLOUD_URL:-$CUR_URL}
if [ -n "$CLOUD_URL" ]; then
  AGENT_KEY=$(node "$DEST/agent.js" --cloud "$CLOUD_URL" | sed -n 's/^PRYME_AGENT_KEY=//p')
  echo
  echo "  ┌──────────────────────────────────────────────────────────────────────┐"
  echo "  │ Render → pryme-cloud → Environment → set:                            │"
  echo "  │   PRYME_AGENT_KEY = $AGENT_KEY"
  echo "  │   PRYME_USERNAME / PRYME_PASSWORD = same as above                    │"
  echo "  └──────────────────────────────────────────────────────────────────────┘"
  echo "  (Shown again any time with:  sudo node -e \"console.log(require('/etc/pryme/config.json').cloudKey)\")"
  read -rp "  Press Enter after you copied the key..." _
fi

echo "==> Creating service (auto-start on boot)..."
cat > /etc/systemd/system/pryme-agent.service <<EOF
[Unit]
Description=Pryme Server PC Agent
After=network.target local-fs.target

[Service]
ExecStart=$(command -v node) $DEST/agent.js
Restart=always
RestartSec=2
Nice=-5

[Install]
WantedBy=multi-user.target
EOF

# ---------------- Wake-on-LAN (every boot) ----------------
IFACE=$(ip -o -4 route show to default | awk '{print $5}' | head -n1)
if [ -n "$IFACE" ]; then
  echo "==> Enabling Wake-on-LAN on $IFACE"
  cat > /etc/systemd/system/pryme-wol.service <<EOF
[Unit]
Description=Pryme - enable Wake-on-LAN on $IFACE
After=network.target NetworkManager.service

[Service]
Type=oneshot
ExecStart=$(command -v ethtool) -s $IFACE wol g

[Install]
WantedBy=multi-user.target
EOF
  systemctl enable --now pryme-wol.service || true
  # Desktop systems use NetworkManager, which can reset WoL -> tell it to keep WoL on
  if command -v nmcli >/dev/null; then
    CON=$(nmcli -t -f NAME,DEVICE connection show --active | awk -F: -v d="$IFACE" '$2==d{print $1}' | head -n1)
    [ -n "$CON" ] && nmcli connection modify "$CON" 802-3-ethernet.wake-on-lan magic && echo "   NetworkManager WoL: magic"
  fi
  ethtool "$IFACE" | grep -i "wake-on" || true
fi

# A server must never fall asleep by itself
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

# ---------------- Desktop (Xubuntu / LightDM) ----------------
if [ -d /etc/lightdm ] && [ -n "$DESK_USER" ] && [ "$DESK_USER" != "root" ]; then
  echo "==> Desktop found. Setting up auto-login for '$DESK_USER', no screen lock / blanking"
  mkdir -p /etc/lightdm/lightdm.conf.d
  SESSION=xfce; [ -f /usr/share/xsessions/xubuntu.desktop ] && SESSION=xubuntu
  cat > /etc/lightdm/lightdm.conf.d/50-pryme.conf <<EOF
[Seat:*]
autologin-user=$DESK_USER
autologin-user-timeout=0
autologin-session=$SESSION
user-session=$SESSION
EOF
  groupadd -f autologin; usermod -aG autologin "$DESK_USER"
  cat > /etc/xdg/autostart/pryme-noblank.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Pryme - keep screen on
Exec=sh -c "sleep 3; xset s off; xset s noblank; xset -dpms; xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -n -t bool -s false; xfconf-query -c xfce4-screensaver -p /saver/enabled -n -t bool -s false; xfconf-query -c xfce4-screensaver -p /lock/enabled -n -t bool -s false"
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
  apt-get remove -y light-locker >/dev/null 2>&1 || true
fi

# ---------------- Windows File Explorer sharing (Samba) ----------------
read -rp "Share drives to Windows File Explorer (\\\\$(hostname)\\Pryme)? [Y/n]: " SMB
if [ "${SMB:-Y}" != "n" ] && [ "${SMB:-Y}" != "N" ] && [ -n "$DESK_USER" ] && [ "$DESK_USER" != "root" ]; then
  echo "==> Installing Samba (network drive for Windows)..."
  apt-get install -y samba
  apt-get install -y wsdd 2>/dev/null || apt-get install -y wsdd2 2>/dev/null || true   # makes the server show up in Windows "Network"
  if ! grep -q "^\[Pryme\]" /etc/samba/smb.conf; then
    cat >> /etc/samba/smb.conf <<EOF

# ---- Pryme Server PC ----
[Pryme]
   comment = Pryme Server PC drives
   path = /srv/pryme
   browseable = yes
   read only = no
   valid users = $DESK_USER
   force user = root
   create mask = 0664
   directory mask = 0775
   veto files = /*.pryme-part/
EOF
  fi
  SMB_PASS="${P1:-}"
  if [ -z "$SMB_PASS" ]; then
    while true; do
      read -rsp "Password for File Explorer login (user '$DESK_USER'): " SMB_PASS; echo
      [ ${#SMB_PASS} -ge 6 ] && break; echo "  Too short."
    done
  fi
  (echo "$SMB_PASS"; echo "$SMB_PASS") | smbpasswd -s -a "$DESK_USER" >/dev/null
  smbpasswd -e "$DESK_USER" >/dev/null
  systemctl enable --now smbd >/dev/null 2>&1 || true
  systemctl restart smbd
  systemctl enable --now wsdd >/dev/null 2>&1 || systemctl enable --now wsdd2 >/dev/null 2>&1 || true
  command -v ufw >/dev/null && ufw status | grep -q "Status: active" && ufw allow samba
  SMB_DONE=1
fi

# Firewall (only if ufw is active)
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp; ufw allow 7100/tcp; ufw allow 7101/udp; ufw allow 22/tcp
fi

read -rp "Make boot faster? (GRUB 1s, skip wait-online) [Y/n]: " FAST
if [ "${FAST:-Y}" != "n" ] && [ "${FAST:-Y}" != "N" ]; then
  if grep -q '^GRUB_TIMEOUT=' /etc/default/grub; then sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=1/' /etc/default/grub; fi
  sed -i 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=hidden/' /etc/default/grub || true
  update-grub || true
  for s in systemd-networkd-wait-online.service NetworkManager-wait-online.service; do
    systemctl disable "$s" >/dev/null 2>&1 || true
  done
  systemctl mask systemd-networkd-wait-online.service >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable pryme-agent.service
systemctl restart pryme-agent.service
sleep 1
IP=$(hostname -I | awk '{print $1}')
MAC=$(cat /sys/class/net/$IFACE/address 2>/dev/null)
echo
echo "=================================================="
echo "  Pryme Server Agent is running!"
echo "  Open on any laptop / phone (same Wi-Fi):"
echo "     http://$IP"
echo "     http://$(hostname).local"
echo "  MAC : $MAC"
echo "  Storage folder: /srv/pryme   (mount drives here)"
echo "  Next: sudo bash $DEST/mount-drives.sh"
[ -d /etc/lightdm ] && echo "  Desktop: restart once (sudo reboot) so auto-login takes effect"
if [ "${SMB_DONE:-0}" = "1" ]; then
  echo "  File Explorer (Windows):  \\\\$(hostname).local\\Pryme   or   \\\\$IP\\Pryme"
  echo "     login →  user: $DESK_USER   password: the one you set above"
fi
echo "=================================================="
