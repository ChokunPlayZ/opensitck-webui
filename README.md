# OpenStick Console

See [TESTING.md](TESTING.md) for what was verified on the connected device and
which disruptive/carrier-dependent operations were deliberately not exercised.

A self-contained, device-native web console for the UZ801 v3 and MF800H OpenStick running
Debian. The frontend and a small Go server compile into one ARM64 binary. It runs
as a systemd service on the stick: **no Mac, Node, Python, CDN, cloud account or
internet connection is needed at runtime**. Network operations use the existing
NetworkManager/ModemManager installation rather than a competing network stack.

## Use

Open **http://192.168.5.1** over USB; port **80** redirects to
**https://192.168.5.1** on port **443**. When the factory hotspot is active, use
**https://192.168.4.1**. Legacy UZ801 configurations also listen on other assigned
addresses; restrict those explicitly to trusted management interfaces.
**MF800H:** use **https://192.168.100.1 over USB or the stick's own hotspot**.
Both HTTPS and its HTTP redirect are bound to LAN bridge `br0`, which contains
USB plus Wi-Fi **only in AP mode**, not the Wi-Fi client or cellular uplink.
The MF800H installer creates a persistent `10-management.conf` systemd drop-in
and preserves an existing administrator binding override on redeployment.
The WebUI's hotspot-creation action joins that same bridge and existing LAN
DHCP/DNS service. Switching back to Wi-Fi client mode detaches Wi-Fi from it.
The stick has one Wi-Fi radio: creating/activating the hotspot replaces its
current Wi-Fi-client connection; it does not add a simultaneous second radio.

Wi-Fi choices persist across reboots: starting a hotspot or connecting a saved
wireless profile enables autoconnect at priority `999`. NetworkManager prefers
the most recently activated profile when priorities tie, so switching back to
client mode becomes the new boot preference. Disconnecting/stopping a wireless
profile disables its autoconnect without deleting its credentials. USB, bridge
and cellular profiles keep their existing boot policy. Advanced autoconnect
settings remain editable under **Network → Edit → Connection**.

For profiles activated with an older console, activate the desired hotspot once
after upgrading to save the new preference; no reboot is required to save it.

The device generates and keeps its own self-signed certificate. Your browser
will warn on first access: verify its SHA-256 fingerprint through SSH or the
deploy tool before accepting it. See [HTTPS / management access](#https--management-access).
Sign in with your **existing Debian username and password**: on this factory
image, `user` / `1`. There is no separate console account or password database.
Only UID 0 accounts or accounts authorized by sudo to run `/bin/sh` as root can
sign in. Change the real Debian password in **System → Console security** (or
with `passwd` over SSH). Do not expose this root interface to the internet.

### Features

| Area | Controls |
| --- | --- |
| Overview | Live CPU, memory, temperature, disk, network throughput and history |
| Battery & display | Read-only MF800H battery voltage/health, independent screen sleep, wake/page controls, configurable single/double-click side-button macros |
| Cellular | Modem enable/reset/power, APN profiles, credentials, roaming policy, IP family, modes, LTE bands, operator scan/registration, signal metrics, raw AT and USSD |
| SIM & SMS | SIM identity, retry/lock status, PIN unlock/enable/disable/change, PUK unblock, SMS drafts/read/send/delete |
| Wi-Fi | Client connection, hidden SSIDs, inline scan progress and automatically refreshed results, secure AP, saved profiles, channel/band/password/subnet, radio toggle |
| Network | Interfaces, DHCP leases, neighbors, IPv4/IPv6, DNS, shared NAT, route metrics, autoconnect, live/persistent routes, Ethernet/bridge/VLAN/GSM profiles |
| Speed test | On-demand device-side HTTPS download, upload and latency against Cloudflare, data-use confirmation, inline test stages/measurements/errors and last successful result |
| WireGuard | Full multi-peer wg-quick configuration, local key generation, tunnel start/stop and boot autostart |
| Firewall | Complete nftables inspection, persistent console-owned table, port-rule builder, raw nft rules, validation, manual backup/reset |
| Services | systemd start/stop/restart, boot enable/disable, mask/unmask, state and unit logs |
| Administration | Journal/kernel/audit logs, files/editor/upload/download/rename, APT install/remove/upgrade, time/NTP/hostname, Linux passwords, root crontab, process signals, network diagnostics |
| User manager | Local Debian accounts, create with home directory, passwords, password lock/unlock, sudo group membership, deletion while preserving files |
| Recovery | Configuration archive export/restore, read-only calibration partition downloads, reboot/shutdown |
| Terminal | Interactive login PTY as the signed-in Debian user, explicit sudo, resizing, Ctrl-C, full-screen applications |

The terminal and configuration editor cover advanced settings outside the forms.
The terminal opens your account's configured login shell in its home directory,
with its UID, primary group and supplementary groups, not an automatic root shell.
Use `sudo` explicitly for privileged commands. It uses Debian's existing
`/usr/sbin/runuser` (util-linux) and PAM; an unavailable account/shell fails closed.
This is not a promise that every hardware/firmware feature exists: missing-SIM,
unsupported modem commands and missing tools are shown as actual device errors.
Flashing, factory reset, IMEI changes and raw partition writes are intentionally
not provided as one-click controls. Use the separate installer for firmware work.

### Feedback without leaving the page

Operations stay in context: Wi-Fi scans update the nearby-network list without
a manual refresh, speed tests show latency/download/upload stages and completed
phase measurements, and other management pages show progress and expandable
device output below their heading. Failures expose their output automatically;
cached networks and previous successful speed results remain available.
Completed operations refresh mounted device views even when **Activity** is closed.
Activity is an optional history/debug window, never opened automatically. Its
badge shows the number of running or queued operations. Jobs continue on the
stick when you navigate away; confirmations for device changes and speed-test
data use are unchanged.

## Standalone build and install

Build requirements: Go 1.26+, Node 20+, npm. The Go server embeds the frontend;
the device needs neither Node nor Go. Deployment uses host Python 3 + Paramiko.
The service uses the device's existing Debian accounts, SSH/PAM, NetworkManager,
ModemManager, systemd and management tools. It intentionally runs privileged
management APIs as root; the terminal runs as the signed-in user.

From this folder:

```sh
make build                 # clean npm install, frontend + static Linux ARM64 binary
make test                  # Go race tests/vet and TypeScript; no sibling projects
python3 -m venv .venv
.venv/bin/python -m pip install paramiko
.venv/bin/python scripts/deploy.py --host 192.168.100.1 \
  --known-hosts /path/to/verified/known_hosts
```

`dist/openstick-webui` in the release is the prebuilt Linux ARM64 executable;
rebuilding is optional for deployment. UZ801 uses `--host 192.168.5.1`. For first
SSH pinning verify the device identity, then explicitly use `--accept-new-host-key`
once. Unknown/changed keys are rejected otherwise. Deployment prompts for the
existing Debian SSH password; `OPENSTICK_SSH_PASSWORD` is also supported. No
account/password is created or reset. Keep SSH available for recovery.

The deploy tool preserves private state/TLS identity and administrator management
drop-ins; a fresh MF800H deployment always installs LAN-only `192.168.100.1` /
`br0` binding, even without the LCD daemon. Existing UZ801 wildcard listener
policy is unchanged: restrict it to your trusted management interface before
using untrusted uplinks. Never forward management ports from the internet.
The previous executable is saved as `/usr/local/bin/openstick-webui.previous`.
Deployment installs `ca-certificates` if absent, unless `--skip-ca-install` is
given for offline use. Speed tests need a valid outbound HTTPS trust store.

Optional MF800H services are distributed separately. Explicit paths are required
only when installing them through this deploy tool:

```sh
.venv/bin/python scripts/deploy.py --host 192.168.100.1 \
  --known-hosts /path/to/verified/known_hosts \
  --device-daemon --lcd-dir /path/to/lcd \
  --cellular-recovery --cellular-dir /path/to/mf800h/cellular
```

Omit either pair if not wanted; WebUI-only deployment does not restart these
services. The LCD needs its already installed compatible DTB/panel firmware,
Python/Pillow/QR/fonts. Cellular recovery does not choose an APN or enable LTE
autoconnect; complete the MF800H cellular guide separately. No charging settings
are changed. Each service also has standalone installation instructions.

Fixture browser tests require no hardware or credentials:

```sh
cd frontend
npx playwright install chromium
npm run test:ui
```

Live-device tests are opt-in, may control the screen or create a temporary file,
and require `WEBUI_URL` plus `WEBUI_PASSWORD` (and optionally `WEBUI_USERNAME`).
Do not run them as release-only smoke tests against an unapproved live device.
See [TESTING.md](TESTING.md) and [RELEASE.md](RELEASE.md).

### Service operations

```sh
sudo systemctl status openstick-webui
sudo systemctl restart openstick-webui
sudo journalctl -u openstick-webui -n 100 --no-pager
sudo systemctl disable --now openstick-webui  # uninstall service activation
```

Binary: `/usr/local/bin/openstick-webui`.
Unit: `/etc/systemd/system/openstick-webui.service`.
Private state: `/var/lib/openstick-webui` (0700). Audit logs are 0600; sessions
are memory-only. Network profiles remain in `/etc/NetworkManager/system-connections`;
tunnels remain in `/etc/wireguard`. Do not delete state when upgrading.
The TLS identity is stored in `/var/lib/openstick-webui/tls/` (private key 0600).
Normal deployments preserve it and save the public certificate to `.local/cert.pem`.

Reset the Debian password from an existing root-capable SSH session:

```sh
sudo passwd user
sudo systemctl restart openstick-webui  # revoke existing console sessions
```

### HTTPS / management access

HTTPS is enabled by default, with TLS 1.2 or newer and Secure session cookies.
Port 80 serves **only redirects for GET/HEAD**, never the console or login API;
send API mutations directly to HTTPS. Port 8080 is no longer used.

On first start the Go server creates a device-local ECDSA certificate (no OpenSSL
dependency). It covers the standard USB/AP IPs, localhost, `openstick.local`, the
hostname and addresses present at generation time. The certificate and private
key survive service restarts and upgrades; the certificate lasts five years and
is renewed on startup when fewer than 30 days remain. A new address/hostname may
need a replacement certificate. The certificate is **not publicly trusted**:
verify the browser's SHA-256 fingerprint against a trusted SSH session:

```sh
sudo openssl x509 -in /var/lib/openstick-webui/tls/cert.pem -noout -fingerprint -sha256
# Also logged by the server:
sudo journalctl -u openstick-webui --no-pager | grep 'SHA-256'
```

The deploy tool prints the fingerprint over pinned SSH and records it in
`.local/access.json`. Trust only this device's certificate; do not disable
certificate verification globally. To use your own certificate instead:

```sh
# Example systemd override on the stick:
sudo systemctl edit openstick-webui
# [Service]
# ExecStart=
# ExecStart=/usr/local/bin/openstick-webui --listen 192.168.100.1:443 --http-listen 192.168.100.1:80 --bind-interface br0 --state /var/lib/openstick-webui --tls-cert /etc/openstick-webui/cert.pem --tls-key /etc/openstick-webui/key.pem
sudo systemctl daemon-reload
sudo systemctl restart openstick-webui
```

Use explicit management addresses and `--bind-interface` for Linux interface
isolation: for the MF800H, `--listen 192.168.100.1:443
--http-listen 192.168.100.1:80 --bind-interface br0`. Other devices need their
actual USB/LAN address and interface. This uses `SO_BINDTODEVICE` for **both**
listeners and fails closed if interface binding fails; even traffic routed to
the management IP through another interface cannot reach the listener. Outbound
speed tests, diagnostics and loopback SSH/PAM authentication are not device-bound.
Do not use a Wi-Fi-client or cellular default-route interface for management.
The supplied unit restarts on failure if USB networking is not ready at startup.
Use `--http-listen ''` to disable HTTP redirects. Custom HTTPS ports are supported;
redirects include the configured HTTPS port. Certificate and key flags must be
supplied together. Keep SSH as a recovery path, and do not forward either console
port from a WAN. The installer refuses to replace another service on 80/443.

### Speed tests and accounts

**Speed test** uses the stick's default route, not the browser's network. No
separate speed-test program, Python runtime, Ookla account or license acceptance is needed.
Outbound HTTPS does require Debian's normal `ca-certificates` trust store; minimal
images may omit it. This is separate from the console's self-signed certificate.
If a speed test reports an unknown certificate authority, install/update
`ca-certificates` and restart `openstick-webui`; never disable TLS verification.
Only confirming **Start speed test** initiates internet requests to Cloudflare.
A test transfers up to **25 MiB download + 10 MiB upload**, plus TLS/protocol
overhead, and may consume mobile data. It measures three HTTPS latency requests
and a single-connection fixed-size transfer in each direction. It is an estimate,
not a full multi-stream Ookla test. Unavailable/slow connections time out and
report the actual error on the speed-test page; incomplete results are not published. Only
one test may be queued/running. The last successful result is memory-only.

**User manager** changes real local Debian accounts, not a separate web database.
New standard accounts can use Linux/SSH but cannot administer the console without
sudo authorization. The administrator option adds the account to Debian's `sudo`
group; under the standard Debian sudoers policy this grants full root access.
Removing the group does not revoke custom sudoers permissions. Password lock
blocks password login only: it does not disable SSH keys, expire the account or
kill running processes. Root/system accounts are protected, as are deletion,
locking and sudo removal of the currently signed-in account. Deletion preserves
the home directory and files; no recursive removal or force flag is used. Account
access/password changes revoke all console sessions after success. Creating an
account does not revoke sessions. Use SSH/terminal for exceptional system-account
administration and keep a recovery login available.

## Safety and limitations

- All API operations except login/session require an authenticated cookie.
  Mutations require a CSRF token; terminal upgrades also require one.
  Cross-origin requests are rejected. Login is limited to 8 attempts per 15
  minutes per client IP. Password verification uses the device's OpenSSH/PAM
  stack over a loopback-only SSH handshake with host keys pinned to local
  `/etc/ssh/ssh_host_*_key.pub` files. No login command/session is opened, no
  system password hash is copied, and no password is stored by the console.
  Keep **ssh.service**, password authentication, and `UsePAM yes` enabled on
  local port 22; disabling them prevents new console logins. PAM account
  expiration/lock policy and sshd login restrictions apply. Changing a password
  or account access through the UI revokes all console sessions; external changes require
  a console service restart to revoke already-issued sessions immediately.
- Privileged commands use an explicit action registry and argument arrays, not
  interpolated shell commands. Crontabs, config files and wg-quick hooks remain
  **root-capable**; the terminal starts as the signed-in user, who can explicitly
  elevate with sudo according to Debian policy. Console login remains admin-only
  because the management APIs still run privileged commands.
- The service intentionally runs as root; restrictive systemd sandboxes would
  break terminal account switching, device access and network management functions.
- Changes require confirmation. Network/radio/firewall changes are **not
  automatically rolled back**. Keep USB and SSH available. Firewall .bak copies
  are for manual recovery, not a lockout prevention guarantee.
- Wi-Fi client and AP share one radio. Switching modes can remove internet
  access; do not assume simultaneous client/AP support. Wi-Fi scan is explicit.
- APT operations are serialized in a background job queue with capped live
  output. Do not restart/unplug the device while dpkg is working. Jobs and
  telemetry history are bounded, memory-only and reset on service restart.
- Configuration restore accepts only a documented allowlist, rejects symlinks
  and traversal, limits decompressed input, and validates entries before writing.
  It is not an atomic filesystem snapshot. Files get `.pre-restore` copies;
  changes are not auto-activated. Backups contain network/VPN secrets.
- File editor: 1 MiB; uploads: 16 MiB. Use SSH/scp for larger transfers. Deletes
  are nonrecursive. Raw devices/procfs/sysfs and credentials are protected from
  the file manager; use explicit sudo in the terminal for exceptional operations.
- PIN/PUK/SMS/operator/network support depends on the modem and installed SIM.
  Operator scan can take two minutes. Raw AT may require ModemManager debug
  mode, which the console does not enable automatically. SMS creation and send
  are separate, explicit operations. The mmcli SMS key/value parser cannot
  encode both quote types in a single text; the form reports this limitation.
- The generic filesystem editor and terminal do not audit file contents or shell
  keystrokes. Action names/results and session lifecycle are logged; passwords
  and form secrets are not deliberately copied to the audit trail.

## Development / architecture

```text
main.go                 CLI, embedded assets, lifecycle
tls.go                  Persistent self-signed certificate and HTTP → HTTPS redirect
auth.go                 Sessions, CSRF/origin checks, rate limits, audit
linux_auth.go           Existing Debian authentication via local OpenSSH/PAM
api.go                  HTTP route registration and read endpoints
actions.go              Validated privileged-action dispatch
network_actions.go      NetworkManager, routes, forwarding
modem_actions.go        ModemManager, SIM, SMS, USSD
vpn_firewall.go         WireGuard and scoped nftables configuration
system_actions.go       systemd, APT, system settings and diagnostics
users.go                Debian account listing, validation and account management
speedtest.go            Bounded device-side HTTPS speed measurements
monitor.go              procfs/sysfs sampling, network/modem reads, parsers
exec.go                 Time-limited command runner and bounded job queue
terminal.go             Authenticated WebSocket ↔ Linux PTY bridge
files.go                File browsing/editing/transfers
backup.go               Allowlisted archive restore / calibration exports
frontend/src/api.ts     API client, polling hook, shared data types
frontend/src/components.tsx  Reusable controls, confirmation and notifications
frontend/src/jobs.tsx    Shared job monitoring and contextual operation feedback
frontend/src/pages/     One component per management area
deploy/                 Readable systemd unit
scripts/deploy.py       SSH installer / safe executable replacement
```

Frontend: React + TypeScript + Vite; bundled xterm and Lucide icons. System fonts,
no external font/image/network requests. Go uses only the standard library plus
`pty`, `gorilla/websocket` and `golang.org/x/crypto/ssh`; no runtime database,
CGO compiler or additional authentication daemon is required.

```sh
make format
make test                  # Go race tests + vet + TypeScript
make build                 # Embedded, stripped, static Linux ARM64 binary
GOOS=darwin make build      # Optional local binary (device calls need Linux)
```

The browser tests in `frontend/tests/` are read-only except for login/logout, a
temporary file roundtrip, and a harmless terminal command. Run against an
already installed stick using the URL in `.local/access.json` and your Debian
password supplied in an environment variable:

```sh
cd frontend
npx playwright install chromium
WEBUI_PASSWORD='your Debian password' npx playwright test
```

To add a control, add its backend action to the appropriate domain file, validate
all parameters, return a sequence of `step` values, then invoke `act()` from the
page. `act()` supplies confirmation and opens the Activity viewer. Keep expensive
work off the HTTP handler. New arbitrary shell interpolation is not necessary.
