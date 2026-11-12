# Pryme Server PC 🖥️⚡ (v2)

පරණ Samsung i3 PC එක **ඔයාගේම storage server** එකක් කරන system එක.
**Laptop / phone එකට කිසිම දෙයක් install කරන්න ඕන නෑ** — WiFi එකට connect වෙලා browser එක open කරාම ඇති.

- 🔐 Username + password එකෙන් login
- ⚡ **Power On** (smart plug එකෙන්), **Shut Down**, **Restart** — ඔබපු ගමන්ම
- 🖥️ Xubuntu desktop එක **Live Screen** එකෙන් බලන්න + mouse/keyboard එකෙන් control කරන්න
- 📁 හැම hard drive එකකම files එක තැනකින් — upload, download (folder එකක් නම් .zip), rename, delete, preview
- 🌗 Dark / Light theme · 📱 phone එකටත් ගැලපෙනවා
- ☁️ **Render** එකේ නිතරම on වෙලා තියෙන link එකක් — server එක OFF වෙලා තිබ්බත් open වෙනවා, ගෙදරින් පිට ඉඳන් වුණත් වැඩ

---

## 0. වැඩ කරන විදිහ

```
                    ┌──────────── Render (free) ────────────┐
   ගෙදරින් පිට / ඕන  │  Pryme Cloud  https://xxx.onrender.com │◄── server එකම මේකට connect වෙනවා
   තැනක ඉඳන් ──────►│  login · Power On/Off · files browse   │    (router settings ඕන නෑ)
                    │  · live preview · mouse/keyboard        │
                    └───────┬─────────────────────────────────┘
                            │ Power On → Smart plug cloud (Tuya / Shelly)
                            ▼
  ┌──────────── ගෙදර WiFi ─────────────────────────────────────────┐
  │  Laptop / Phone browser                         Server PC (i3)    │
  │  http://pryme-server.local  ◄══ FAST MODE ══►  Xubuntu + Pryme    │
  │  (full speed files, smooth live screen)         /srv/pryme/HDD…   │
  │                                         🔌 Smart plug ──► power   │
  └───────────────────────────────────────────────────────────────────┘
```

| ලින්ක් එක | කවදාද | මොනවද කරන්න පුළුවන් |
|---|---|---|
| **Pryme Cloud** `https://<ඔයාගේ-නම>.onrender.com` | ඕනම වෙලාවක, ඕනම තැනක (server OFF වුණත්) | Power On, Shut Down, Restart, files බලන්න/rename/delete, live preview (~1 fps), mouse/keyboard |
| **Fast mode** `http://pryme-server.local` (හෝ `http://192.168.x.x`) | ගෙදර WiFi එකේ, server ON නම් | ඔක්කොම **full speed** — download, upload, smooth live screen |

> **ඇයි files Render හරහා යවන්නේ නැත්තේ?** Render free plan එකේ bandwidth එක මාසෙට **5GB** විතරයි (ඊට පස්සේ සල්ලි යනවා) ඒ වගේම slow. ඒ නිසා ලොකු files යන්නේ ගෙදර WiFi එකෙන් කෙලින්ම — Render එකට එක byte එකක්වත් යන්නේ නෑ.

> **ඇයි Power On එකට smart plug එකක් ඕන?** OFF වෙලා තියෙන PC එකක් on කරන්න ගෙදර network එකේ on වෙලා තියෙන දෙයක් ඕන. Browser එකකට ඒක කරන්න බෑ, Render එකට ගෙදර network එකට එන්නත් බෑ. Smart plug එක cloud එකට connect වෙලා නිතරම on — Render → plug ON → BIOS setting එකෙන් PC එක auto on වෙනවා.

---

## 1. ඕන කරන දේවල්

| දේ | විස්තරය |
|---|---|
| Server PC | Samsung i3 2nd gen + ethernet cable එක router එකට |
| USB pen drive | **8GB+** (Rufus pen එක දැනටමත් තියෙනවා ✅) |
| **Wi-Fi smart plug** ⭐ | **Tuya / "Smart Life" app** එකේ වැඩ කරන 10A/16A plug එකක් (Daraz වල ලේසියෙන් ගන්න පුළුවන්). Shelly plug එකක් වුණත් හරි. |
| GitHub account | ✅ තියෙනවා |
| Render account | ✅ තියෙනවා (GitHub එකෙන් login වෙන්න) |
| UPS (recommend) | Current යනකොට server එක ආරක්ෂා කරන්න — section 11 |

---

## 2. OS: **Xubuntu 26.04 LTS (Minimal)** ✅
Lightweight Xfce desktop · X11 (Live Screen + control වැඩ) · 2029 වෙනකම් updates.
Download: https://xubuntu.org/download → **Xubuntu 26.04 → Minimal** (`xubuntu-26.04-minimal-amd64.iso`)

## 3. Rufus USB (main PC)
1. https://rufus.ie → Rufus Portable → open.
2. **Device** → USB එක · **SELECT** → Xubuntu ISO.
3. **Partition scheme: MBR** (Target: BIOS or UEFI-CSM) — පරණ Samsung PC වලට safe. (BIOS එකේ UEFI තියෙනවා කියලා sure නම් GPT.)
4. **START** → **ISO Image mode** → OK → READY ආවම CLOSE.

---

## 4. USB එකෙන් boot කරන්නේ කොහොමද? (F2 ද?)

**F2 = BIOS settings. Boot menu එකට වෙනම key එකක් තියෙනවා.**

1. USB එක server PC එකට ගහලා PC එක **සම්පූර්ණයෙන් off** කරන්න.
2. Power button එක ඔබපු ගමන් **F2** එක දිගටම (තත්පරයකට 2-3 පාරක්) ඔබන්න → BIOS setup එක එනවා.
3. BIOS එකේ මේවා හදන්න:
   - **Boot** tab → **Fast BIOS Mode → Disabled** (Samsung PC වල මේක on නම් USB එක පේන්නේ නෑ)
   - **Secure Boot → Disabled** (තියෙනවා නම්)
   - **Boot Device Priority** → **USB** එක 1st (`+`/`-` හෝ F5/F6 keys)
   - ඊළඟ section 6 එකේ power settings ත් එකම පාරේ හදන්න
4. **F10** → Yes → PC එක USB එකෙන් boot වෙනවා.

> **Boot menu shortcut:** Power on කරපු ගමන් **F10** (Samsung desktops) — වැඩ නැත්නම් **Esc** හෝ **F12** try කරන්න. List එකෙන් USB එක තෝරන්න.
> Xubuntu screen එක එන්නේ නැතුව Kali එකම boot වෙනවා නම් → Fast BIOS Mode / boot order එක ආයේ check කරන්න.

---

## 5. Kali Linux සම්පූර්ණයෙන්ම අයින් කරන්නේ කොහොමද?

වෙනම දෙයක් කරන්න ඕන නෑ — Xubuntu install කරනකොට **"Erase disk and install Xubuntu"** තෝරාම Kali (files, partitions, boot menu ඔක්කොම) සම්පූර්ණයෙන් මැකිලා යනවා.

⚠️ කලින් check කරන්න:
1. **Kali එකේ ඕන files තියෙනවා නම්** කලින් USB එකකට copy කරගන්න — ආයේ ගන්න බෑ.
2. **Data hard drives ගලවන්න** (SATA cable එක) — Kali තියෙන disk එක විතරක් ඉතුරු කරන්න. එතකොට වැරදි disk එක මැකෙන්නේ නෑ.
3. Installer එකේ disk list එකේ size එක බලලා Kali තිබුණ disk එකම තෝරන්න.

Install වුණාට පස්සේ (optional) පරණ Kali boot entry එකක් BIOS boot list එකේ තිබ්බොත් අයින් කරන්න:
```bash
sudo efibootmgr            # list එක බලන්න — "kali" Boot000X එකක් තියෙනවද
sudo efibootmgr -b 000X -B # X = kali එකේ number එක
```
(MBR/Legacy mode එකේ නම් මේක ඕන නෑ.)

---

## 6. BIOS power settings (Power On එකට අනිවාර්යයි)

| Setting (Samsung BIOS නම් ටිකක් වෙනස් වෙන්න පුළුවන්) | Value | ඇයි |
|---|---|---|
| **Restore on AC Power Loss** / AC Back / After Power Failure | **Power On** ⭐ | Plug එකෙන් power ආපු ගමන් PC එක auto on → smart plug Power On වැඩ |
| **ErP / EuP / Deep Sleep** | Disabled | |
| **Wake on LAN** / Power On by PCI-E | Enabled | (backup) |

---

## 7. Xubuntu install
1. USB එකෙන් boot → **Install Xubuntu** → English → keyboard English (US).
2. Internet: Ethernet auto. **Interactive installation** → Default selection. ☑ third-party software.
3. **Erase disk and install Xubuntu** → Kali තිබුණ disk එක (section 5) → Install.
4. Account: Name `Yasiru` · **Computer name `pryme-server`** · Username `pryme` · password එකක්.
5. Timezone **Colombo** → Install → **Restart Now** → USB එක ගලවන්න.
6. ඉවර වුණාම data drives ආයේ SATA එකට ගහන්න.

---

## 8. Render එකේ Pryme Cloud හදන්න (main PC/laptop browser එකෙන්)

### 8.1 Code එක GitHub එකට
1. https://github.com/new → name `pryme-server-pc` → **Public** (code එකේ passwords නෑ) → Create.
2. **uploading an existing file** → මේ zip එකේ ඇතුලේ තියෙන **ඔක්කොම files/folders** (`web`, `cloud`, `server-agent`, `render.yaml`, `README.md`) drag & drop → **Commit changes**.

### 8.2 Render deploy
1. https://dashboard.render.com → **New +** → **Blueprint** → `pryme-server-pc` repo එක තෝරන්න → **Apply**.
   (`render.yaml` එකෙන් free web service එකක් auto ම හැදෙනවා — region Singapore.)
2. Values අහනකොට:
   - `PRYME_USERNAME` → උදා `admin`
   - `PRYME_PASSWORD` → ශක්තිමත් password එකක් (මේක internet එකේ තියෙන නිසා!)
   - `PRYME_AGENT_KEY` → දැනට `temporary-key-123456` (8.3 දී හරි key එක දානවා)
   - Tuya fields හිස්ව තියන්න (section 10)
3. Deploy වුණාම ලැබෙන URL එක ලියාගන්න: උදා `https://pryme-cloud-ab12.onrender.com`

### 8.3 Server එකට Pryme install කරලා Render එකට link කරන්න
Server එකේ (Xubuntu) **Terminal** (`Ctrl+Alt+T`):
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<ඔයාගේ-github-username>/pryme-server-pc.git
cd pryme-server-pc/server-agent
sudo bash install.sh
```
Installer එක අහනවා:
- **Username / Password** → 8.2 එකේ දාපුවාමයි දාන්න (දෙකම එකම නම් ලේසියි)
- **Render URL** → 8.2.3 එකේ URL එක paste කරන්න
- එතකොට **`PRYME_AGENT_KEY = ....`** පෙන්නනවා → copy කරලා **Render → pryme-cloud → Environment → PRYME_AGENT_KEY** එකට paste කරලා **Save** (Render auto redeploy වෙනවා)
- **Make boot faster?** → `Y`

ඊට පස්සේ:
```bash
sudo bash /opt/pryme/mount-drives.sh   # hard drives එකතු කරන්න (හැම එකටම y)
sudo reboot
```
Reboot වුණාම Render link එක open කරලා login වෙන්න → **Online** 🟢 පේනවා නම් ✅ link වුණා.

---

## 9. Laptop / phone එකෙන් පාවිච්චි කරන විදිහ (install කිසිවක් නෑ)

- **ඕනම තැනක:** `https://<ඔයාගේ>.onrender.com` → login → Home / Files / Live Screen / Settings
- **ගෙදර WiFi එකේ full speed:** උඩ තියෙන **⚡ Fast mode** button එක ඔබන්න (හෝ browser එකේ `http://pryme-server.local` / `http://<server-ip>` type කරන්න) → එකම username/password
- 📌 දෙකම **bookmark** කරන්න. Phone එකේ: Chrome menu → **Add to Home screen** — app එකක් වගේ icon එකක් එනවා.

| Tab | කරන්න පුළුවන් දේ |
|---|---|
| 🏠 Home | Power On / Restart / Shut Down, CPU, RAM, temperature, network, drives |
| 📁 Files | Browse, rename, delete, new folder · Fast mode එකේදී: upload (drag & drop / folder), download (folder = .zip, laptop එකේ Downloads එකට auto ම), photo/video preview |
| 📺 Live Screen | Desktop එක live (Fast mode = smooth, Cloud = ~1 fps) · **Control** → mouse + keyboard |
| ⚙️ Settings | Theme, links, server info, password |

> Render free service එක විනාඩි 15ක් කිසිම traffic එකක් නැත්නම් නිදාගන්නවා. Server එක ON වෙලා තියෙනකොට server එකම Render එකව ඇහැරවලා තියාගන්නවා. Server OFF වෙලා තියෙද්දී link එක open කරාම **පළමු පාරට විනාඩියක් විතර** load වෙන්න යනවා — ඒක normal.


### 9.1 📂 Windows File Explorer එකෙන් files (network drive)
`install.sh` එකේ **Share drives to Windows File Explorer?** → `Y` දුන්නම server එකේ drives ඔක්කොම Windows network drive එකක් විදිහට එනවා (ගෙදර WiFi එකේ, full speed):
1. Laptop: **File Explorer** → **This PC** → උඩ **⋯** → **Map network drive**
2. Drive: `P:` · Folder: `\\pryme-server.local\Pryme` (වැඩ නැත්නම් `\\192.168.x.x\Pryme`)
3. ☑ Reconnect at sign-in → **Finish**
4. Username: `pryme` (Xubuntu username එක) · Password: install.sh එකේ දාපු password එක · ☑ Remember
දැන් **P:** drive එකට drag & drop කරලා files දාන්න / ගන්න පුළුවන් — සාමාන්‍ය drive එකක් වගේම.

### 9.2 ⚡ Wake-on-LAN Power On (smart plug නැතුව)
- Pryme → **Settings** → **download "Pryme Power On"** → `Pryme Power On.bat` file එක laptop **Desktop** එකට දාන්න.
- Server එක OFF නම්, **ගෙදර WiFi එකේ ඉඳන්** ඒ file එක **double-click** → server එක on වෙනවා, Pryme page එකත් auto open වෙනවා.
- Install කරන්න දෙයක් නෑ (Windows වල තියෙන PowerShell එකෙන් වැඩ කරන්නේ). Windows "protected your PC" කිව්වොත් → **More info → Run anyway**.
- Phone එකෙන් කරන්න: Play Store **"Wake On Lan"** app එකට server MAC එක (Settings එකේ තියෙනවා) දාන්න.
- ⚠️ Wake-on-LAN වැඩ කරන්නේ **ගෙදර network එක ඇතුලේ** විතරයි. ගෙදරින් පිට ඉඳන් Power On කරන්න smart plug එකක් ඕන (section 10).
- **Off / Restart** → Pryme එකේ (Render හෝ Fast mode) Home → **Shut Down / Restart** — ඕනම තැනක ඉඳන්.

---

## 10. 🔌 Smart plug setup (Power On)

### 10.1 Tuya / Smart Life plug (ලංකාවේ ලේසියෙන් ගන්න පුළුවන්)
1. Phone එකට **Smart Life** app එක දාලා plug එක add කරන්න (2.4GHz WiFi). App එකෙන් on/off වෙනවද බලන්න.
2. Server PC එකේ power cable එක plug එකට ගහන්න. **BIOS: Restore on AC Power Loss = Power On** (section 6).
3. https://platform.tuya.com → sign up → **Cloud → Development → Create Cloud Project**
   - Industry: Smart Home · Development Method: Smart Home
   - **Data Center**: Smart Life app එකේ account එක තියෙන region එකම (බොහෝ විට *India* හෝ *Central Europe*)
4. Project එකේ **Overview** → **Access ID** සහ **Access Secret** copy කරන්න.
5. **Devices → Link App Account → Add App Account** → QR එක Smart Life app එකෙන් scan කරන්න (Me → ⊞ scan icon) → plug එක list එකේ පේනවා → **Device ID** copy කරන්න.
6. **Render → Environment**:

| Key | Value |
|---|---|
| `PLUG_TYPE` | `tuya` |
| `TUYA_ENDPOINT` | Data center එකට අදාල: India `https://openapi.tuyain.com` · Central Europe `https://openapi.tuyaeu.com` · Western America `https://openapi.tuyaus.com` · China `https://openapi.tuyacn.com` |
| `TUYA_CLIENT_ID` | Access ID |
| `TUYA_SECRET` | Access Secret |
| `TUYA_DEVICE_ID` | Device ID |
| `PLUG_CUT_AFTER_SHUTDOWN` | `1` |

7. Save → Pryme Cloud → Settings → **Connections** එකේ "Tuya / Smart Life cloud" පේනවා. Server එක Shut Down කරලා විනාඩියක් ඉඳලා **Power On** ඔබලා බලන්න ✅

> Tuya developer account එකේ free "IoT Core" trial එක කාලෙකට පස්සේ expire වෙනවා — email එකක් ආවම platform.tuya.com එකේ **Extend** (free) කරන්න. Power On වැඩ නැති වුණොත් මුලින්ම බලන්න ඕන මේකයි.

### 10.2 වෙනත් plugs
- **Shelly (Shelly Cloud):** `PLUG_TYPE=shelly-cloud`, `SHELLY_SERVER` + `SHELLY_AUTH_KEY` (Shelly app → Settings → User settings → Authorization cloud key), `SHELLY_DEVICE_ID`
- **Webhook (Home Assistant වගේ):** `PLUG_TYPE=webhook`, `PLUG_ON_URL`, `PLUG_OFF_URL`
- **Fast mode එකෙන් විතරක් (cloud නැති Shelly/Tasmota):** Fast mode → Settings → Smart plug

### 10.3 වැදගත්
- `PLUG_CUT_AFTER_SHUTDOWN=1` → Pryme එකෙන් Shut Down කළාම තත්පර 40කට විතර පස්සේ plug එක OFF වෙනවා. **මේක නිසා තමයි ඊළඟ Power On එක වැඩ කරන්නේ** (plug OFF→ON = BIOS එකෙන් PC එක start).
- ⚠️ Server එක **Xubuntu menu එකෙන් shutdown කරන්න එපා** — Pryme එකෙන් කරන්න. නැත්නම් plug එක ON වෙලාම තියෙන නිසා ඊළඟ Power On එක වැඩ කරන්නේ නෑ (එහෙම වුණොත් Smart Life app එකෙන් plug එක OFF → ON කරන්න).

---

## 11. Current යනකොට ආරක්ෂාව
- **UPS** (650–850VA, AVR එක්ක) — voltage spikes වලින් ආරක්ෂාව + current ගියාම server එක හරියට shutdown වෙන්න වෙලාව. USB port එකක් තියෙන එකක් ගත්තොත් auto-shutdown එකත් Pryme එකට එකතු කරන්න පුළුවන්.
- UPS නැත්නම් අවම surge protector එකක්.
- BIOS **Restore on AC Power Loss = Power On** → current ආපු ගමන් server එක auto on.
- Data drives **ext4** නම් power cuts වලට ශක්තිමත් (NTFS ට වඩා). වැදගත් files වල backup එකක් තියාගන්න.

---

## 12. ප්‍රශ්න ආවොත්

| ප්‍රශ්නය | විසඳුම |
|---|---|
| USB එකෙන් boot වෙන්නේ නෑ | BIOS: Fast BIOS Mode **Disabled**, Secure Boot Disabled, USB 1st. Rufus එකේ **DD mode** එකෙන් ආයේ හදලා බලන්න |
| Render එකේ "Offline" (server ON වුණත්) | Server: `sudo journalctl -u pryme-agent -n 30` → "Pryme Cloud: connected" තියෙනවද? `PRYME_AGENT_KEY` Render එකේ හරියට දාලද? |
| Render link එක load වෙන්න කල් යනවා | Free plan එක නිදාගෙන — විනාඩියක් ඉන්න |
| Power On වැඩ නෑ | Settings → Connections එකේ plug type එක පේනවද? Tuya trial expire ද? BIOS AC Power Loss = **Power On** ද? Smart Life app එකෙන් plug එක on/off වෙනවද? |
| `pryme-server.local` open වෙන්නේ නෑ | `http://<server-ip>` පාවිච්චි කරන්න (Render → Settings → Connections එකේ තියෙනවා). Router එකේ server එකට fixed IP (DHCP reservation) එකක් දෙන්න |
| Login password වෙනස් කරන්න | Server: `sudo bash ~/pryme-server-pc/server-agent/install.sh` (Fast mode) · Render → Environment → `PRYME_PASSWORD` (Cloud) |
| Live screen / Control වැඩ නෑ | `sudo reboot` (auto-login එක ආවද බලන්න). Session එක Xfce (X11) ද? |
| Update | Server: `cd ~/pryme-server-pc && git pull && sudo bash server-agent/install.sh` · Render: GitHub එකට push කළාම auto update |
| Agent logs | `sudo systemctl status pryme-agent` · `sudo journalctl -u pryme-agent -f` |

---

### Files
```
pryme-server-pc/
├── web/            ← dashboard (HTML/CSS/JS) — server එකයි Render එකයි දෙකම මේක serve කරනවා
├── server-agent/
│   ├── agent.js        ← server එකේ run වෙන එක (files, power, screen, control, Render link)
│   ├── install.sh      ← sudo bash install.sh
│   └── mount-drives.sh ← hard drives එකතු කරන්න
├── cloud/
│   └── server.js       ← Render එකේ run වෙන Pryme Cloud
└── render.yaml         ← Render Blueprint
```
Ports (server): `80` dashboard · `7100` agent · `445` File Explorer (Samba) · `22` SSH. Render එකට server එකෙන් පිටතට යන connection එකක් විතරයි — router එකේ port forward කරන්න ඕන නෑ.
