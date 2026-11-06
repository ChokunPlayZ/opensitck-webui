#!/usr/bin/env python3
"""Install the prebuilt ARM64 binary over SSH without changing device networking.

Requires Paramiko on the build machine only. The core console needs no Python,
Node or Go runtime; optional device/cellular services use the stick's Python 3.
Authentication uses existing Debian accounts; no new password is set.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import ssl
import tarfile
import time

import paramiko

ROOT = Path(__file__).resolve().parents[1]
LCD_ROOT = None
CELLULAR_ROOT = None


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="192.168.5.1")
    parser.add_argument("--user", default="user")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--accept-new-host-key", action="store_true")
    parser.add_argument("--known-hosts", type=Path, help="Also load an existing, verified SSH known_hosts file")
    parser.add_argument("--device-daemon", action="store_true",
                        help="Install the independent MF800H display/button daemon (requires working LCD support)")
    parser.add_argument("--cellular-recovery", action="store_true",
                        help="Install the independent MF800H modem recovery timer (does not change APN/autoconnect)")
    parser.add_argument("--lcd-dir", type=Path, help="Path to the separate LCD release (only with --device-daemon)")
    parser.add_argument("--cellular-dir", type=Path, help="Path to the MF800H release cellular/ folder (only with --cellular-recovery)")
    parser.add_argument("--skip-ca-install", action="store_true",
                        help="Offline deployment: skip provisioning Debian's HTTPS CA trust store (needed by speed tests)")
    return parser.parse_args()


def source_archive(destination: Path) -> None:
    """Include console/LCD/cellular source, not dependencies or private records."""
    with tarfile.open(destination, "w:gz") as archive:
        for source_root in (ROOT, LCD_ROOT, CELLULAR_ROOT):
            if source_root is None:
                continue
            for path in sorted(source_root.rglob("*")):
                relative = path.relative_to(source_root)
                if any(part in {"node_modules", "dist", ".local", ".venv", "__pycache__", "test-results", "playwright-report", ".git", "hardware", "bringup"} for part in relative.parts):
                    continue
                if path.is_file():
                    archive.add(path, arcname=f"{source_root.name}/{relative}", recursive=False)


def main() -> None:
    global LCD_ROOT, CELLULAR_ROOT
    args = arguments()
    for enabled, path, names, flag in (
        (args.device_daemon, args.lcd_dir, ("openstick_device.py", "lcd_display.py", "lcd_telemetry.py", "openstick-device.service", "README.md"), "--lcd-dir"),
        (args.cellular_recovery, args.cellular_dir, ("cellular_recovery.py", "openstick-cellular-recovery.service", "openstick-cellular-recovery.timer", "README.md"), "--cellular-dir"),
    ):
        if enabled and (path is None or not all((path / name).is_file() for name in names)):
            raise SystemExit(f"Supply {flag} with the separately prepared component before deployment")
    LCD_ROOT = args.lcd_dir.resolve() if args.device_daemon else None
    CELLULAR_ROOT = args.cellular_dir.resolve() if args.cellular_recovery else None
    binary = ROOT / "dist/openstick-webui"
    if not binary.is_file():
        raise SystemExit("Missing dist/openstick-webui. Run make build first.")

    local = ROOT / ".local"
    local.mkdir(mode=0o700, exist_ok=True)
    known_hosts = local / "known_hosts"
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    if known_hosts.exists():
        client.load_host_keys(str(known_hosts))
    if args.known_hosts:
        client.load_host_keys(str(args.known_hosts))
    if args.accept_new_host_key:
        # TOFU is opt-in. Changed keys still fail against the pinned key file.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

    password = os.environ.get("OPENSTICK_SSH_PASSWORD")
    if password is None:
        password = getpass.getpass(f"SSH password for {args.user}@{args.host}: ")
    client.connect(args.host, port=args.port, username=args.user, password=password,
                   timeout=10, allow_agent=False, look_for_keys=False)
    client.save_host_keys(str(known_hosts))
    os.chmod(known_hosts, 0o600)

    def remote(command: str, stdin_text: str | None = None, *, timeout: int = 90, required: bool = True) -> str:
        # Support normal password-protected sudo without changing sudoers. The
        # password goes through stdin over SSH, never command arguments or logs.
        if command.startswith("sudo -n "):
            command = "sudo -S -p '' " + command[len("sudo -n "):]
            stdin_text = password + "\n" + (stdin_text or "")
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        if stdin_text is not None:
            stdin.write(stdin_text)
            stdin.flush()
        stdin.channel.shutdown_write()
        result = stdout.read().decode("utf-8", errors="replace")
        errors = stderr.read().decode("utf-8", errors="replace")
        if stdout.channel.recv_exit_status() != 0:
            if required:
                raise RuntimeError(f"Remote command failed: {command}\n{result}{errors}")
            return ""
        return result.strip()

    try:
        remote("sudo -n true")
        machine = remote("uname -m")
        if machine != "aarch64":
            raise RuntimeError(f"This build targets aarch64, but the device reports {machine}")
        device_model = remote("cat /proc/device-tree/model").replace("\x00", "")
        is_mf800h = "MF800H" in device_model
        if args.cellular_recovery:
            model = device_model
            if "MF800H" not in model:
                raise RuntimeError("The cellular recovery timer currently supports the MF800H only")
            remote("python3 --version && command -v mmcli && command -v nmcli")
        if args.device_daemon:
            model = remote("cat /proc/device-tree/model").replace("\x00", "")
            if "MF800H" not in model:
                raise RuntimeError("The optional device daemon currently supports the MF800H LCD wiring only")
            remote("test -e /dev/fb0 && test -e /sys/class/leds/mf800h:lcd/brightness")
            remote("python3 -c 'from PIL import Image, ImageFont; import qrcode'")
            remote("test -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf && test -f /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
            remote("command -v systemd-inhibit")
        listeners = remote("sudo -n ss -H -ltnp '( sport = :80 or sport = :443 )'")
        conflicts = [line for line in listeners.splitlines() if '"openstick-webui"' not in line]
        if conflicts:
            raise RuntimeError("Management ports 80/443 are already used by another service:\n" + "\n".join(conflicts))
        ca_size = remote("stat -c %s /etc/ssl/certs/ca-certificates.crt", required=False)
        if not ca_size.isdigit() or int(ca_size) == 0:
            if args.skip_ca_install:
                print("Warning: no system HTTPS CA bundle. Install ca-certificates before using Speed test.")
            else:
                print("Provisioning Debian's ca-certificates trust store for verified outbound HTTPS…")
                print(remote("sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -y install ca-certificates", timeout=300))
                print(remote("sudo -n update-ca-certificates", timeout=90))
        staging = f"/home/{args.user}/.openstick-webui-upload-{secrets.token_hex(5)}"
        archive = local / "source.tar.gz"
        source_archive(archive)
        sftp = client.open_sftp()
        sftp.mkdir(staging, 0o700)
        print(f"Uploading self-contained binary ({binary.stat().st_size / 1024**2:.1f} MiB)…")
        uploads = {
            binary: "openstick-webui",
            ROOT / "deploy/openstick-webui.service": "openstick-webui.service",
            ROOT / "README.md": "README.md",
            ROOT / "TESTING.md": "TESTING.md",
            archive: "source.tar.gz",
        }
        if is_mf800h:
            uploads[ROOT / "deploy/mf800h-lan-management.conf"] = "mf800h-lan-management.conf"
        if args.device_daemon:
            uploads.update({LCD_ROOT / name: name for name in ("openstick_device.py", "lcd_display.py", "lcd_telemetry.py")})
            uploads.update({LCD_ROOT / "README.md": "device-README.md",
                            ROOT / "deploy/mf800h-lan-management.conf": "mf800h-lan-management.conf",
                            LCD_ROOT / "openstick-device.service": "openstick-device.service"})
        if args.cellular_recovery:
            uploads.update({CELLULAR_ROOT / name: name for name in (
                "cellular_recovery.py", "openstick-cellular-recovery.service", "openstick-cellular-recovery.timer")})
            uploads[CELLULAR_ROOT / "README.md"] = "cellular-README.md"
        for source, name in uploads.items():
            sftp.put(str(source), f"{staging}/{name}")
        quote = shlex.quote
        remote("sudo -n install -d -m 700 /var/lib/openstick-webui")
        remote("sudo -n sh -c 'if test -f /usr/local/bin/openstick-webui; then cp -p /usr/local/bin/openstick-webui /usr/local/bin/openstick-webui.previous; fi'")
        # Atomic replacement avoids ETXTBSY when updating a running executable.
        remote(f"sudo -n install -m 755 {quote(staging + '/openstick-webui')} /usr/local/bin/openstick-webui.new")
        remote("sudo -n mv /usr/local/bin/openstick-webui.new /usr/local/bin/openstick-webui")
        remote(f"sudo -n install -m 644 {quote(staging + '/openstick-webui.service')} /etc/systemd/system/openstick-webui.service")
        remote("sudo -n install -d -m 755 /usr/local/share/openstick-webui")
        for name in ("README.md", "TESTING.md", "source.tar.gz"):
            remote(f"sudo -n install -m 644 {quote(staging + '/' + name)} /usr/local/share/openstick-webui/{name}")
        if is_mf800h:
            # Preserve an existing administrator binding override on upgrades.
            # br0 includes USB and genuine AP-mode Wi-Fi, never Wi-Fi/LTE uplinks.
            remote("sudo -n install -d -m 755 /etc/systemd/system/openstick-webui.service.d")
            remote(f"sudo -n sh -c {quote('if ! test -e /etc/systemd/system/openstick-webui.service.d/10-management.conf; then install -m 644 ' + quote(staging + '/mf800h-lan-management.conf') + ' /etc/systemd/system/openstick-webui.service.d/10-management.conf; fi')}")
        if args.device_daemon:
            remote("sudo -n install -d -m 700 /etc/openstick-device /etc/openstick-device/macros")
            remote("sudo -n install -d -m 755 /usr/local/lib/openstick-device /usr/local/share/openstick-device")
            for name in ("openstick_device.py", "lcd_display.py", "lcd_telemetry.py"):
                remote(f"sudo -n install -m 644 {quote(staging + '/' + name)} /usr/local/lib/openstick-device/{name}.new")
                remote(f"sudo -n mv /usr/local/lib/openstick-device/{name}.new /usr/local/lib/openstick-device/{name}")
            remote(f"sudo -n install -m 644 {quote(staging + '/device-README.md')} /usr/local/share/openstick-device/README.md")
            remote(f"sudo -n install -m 644 {quote(staging + '/openstick-device.service')} /etc/systemd/system/openstick-device.service")
            remote("sudo -n systemctl disable --now mf800h-display.service", required=False)
        if args.cellular_recovery:
            remote("sudo -n install -d -m 755 /usr/local/lib/openstick-cellular /usr/local/share/openstick-cellular")
            remote(f"sudo -n install -m 644 {quote(staging + '/cellular_recovery.py')} /usr/local/lib/openstick-cellular/cellular_recovery.py.new")
            remote("sudo -n mv /usr/local/lib/openstick-cellular/cellular_recovery.py.new /usr/local/lib/openstick-cellular/cellular_recovery.py")
            for name in ("openstick-cellular-recovery.service", "openstick-cellular-recovery.timer"):
                remote(f"sudo -n install -m 644 {quote(staging + '/' + name)} /etc/systemd/system/{name}")
            remote(f"sudo -n install -m 644 {quote(staging + '/cellular-README.md')} /usr/local/share/openstick-cellular/README.md")
        remote("sudo -n systemctl daemon-reload")
        if args.cellular_recovery:
            remote("sudo -n systemctl enable --now openstick-cellular-recovery.timer")
        if args.device_daemon:
            remote("sudo -n systemctl enable openstick-device.service")
            remote("sudo -n systemctl restart openstick-device.service")
        remote("sudo -n systemctl enable openstick-webui.service")
        remote("sudo -n systemctl restart openstick-webui.service")
        time.sleep(2)
        print(remote("sudo -n systemctl is-active openstick-webui.service"))
        if args.device_daemon:
            print(remote("sudo -n systemctl is-active openstick-device.service"))
        if args.cellular_recovery:
            print(remote("sudo -n systemctl is-active openstick-cellular-recovery.timer"))
        certificate = remote("sudo -n cat /var/lib/openstick-webui/tls/cert.pem") + "\n"
        fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate)).hexdigest().upper()
        (local / "cert.pem").write_text(certificate)
        for name in uploads.values():
            sftp.remove(f"{staging}/{name}")
        sftp.rmdir(staging)
        sftp.close()
        result = {"url": f"https://{args.host}", "http_url": f"http://{args.host}", "username": args.user, "auth": "existing Debian password via local SSH/PAM", "service": "openstick-webui.service", "certificate_sha256": fingerprint}
        result_path = local / "access.json"
        descriptor = os.open(result_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as file:
            json.dump(result, file, indent=2)
        os.chmod(result_path, 0o600)
        print(json.dumps(result, indent=2))
        print("Port 80 redirects to HTTPS on 443. Verify the self-signed certificate fingerprint over SSH before trusting it:")
        print("SHA-256: " + ":".join(fingerprint[i:i+2] for i in range(0, len(fingerprint), 2)))
        print("Sign in with your existing Debian account password. No system password or network configuration was changed.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
