package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func (a *app) systemAction(request actionRequest) ([]step, error) {
	p := request.Params
	switch request.Action {
	case "service":
		if !validUnit(p["unit"]) || !choice(p["verb"], "start", "stop", "restart", "enable", "disable", "unmask", "mask", "reset-failed") {
			return nil, errors.New("invalid service or operation")
		}
		if p["unit"] == "openstick-webui.service" && choice(p["verb"], "stop", "mask", "disable") {
			return nil, errors.New("use the terminal to disable this console; this would end your session")
		}
		return []step{{Name: "systemctl", Args: []string{p["verb"], p["unit"]}}}, nil
	case "package.update":
		return []step{{Name: "apt-get", Args: []string{"update"}}}, nil
	case "package.upgrade":
		return []step{{Name: "apt-get", Args: []string{"-y", "-o", "Dpkg::Options::=--force-confold", "upgrade"}}}, nil
	case "package.install", "package.remove":
		packages := strings.Fields(p["packages"])
		if len(packages) == 0 || len(packages) > 30 {
			return nil, errors.New("provide 1–30 package names")
		}
		for _, name := range packages {
			if !packagePattern.MatchString(name) {
				return nil, errors.New("invalid package name: " + name)
			}
			if request.Action == "package.remove" && choice(name, "systemd", "openssh-server", "network-manager", "sudo", "libc6", "nftables") {
				return nil, errors.New("remove critical system packages only through the terminal")
			}
		}
		args := []string{"-y", "-o", "Dpkg::Options::=--force-confold", strings.TrimPrefix(request.Action, "package.")}
		return []step{{Name: "apt-get", Args: append(args, packages...)}}, nil
	case "system.hostname":
		if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$`).MatchString(p["hostname"]) {
			return nil, errors.New("invalid hostname")
		}
		return []step{{Name: "hostnamectl", Args: []string{"set-hostname", p["hostname"]}}}, nil
	case "system.timezone":
		zone := p["timezone"]
		if strings.Contains(zone, "..") || strings.HasPrefix(zone, "/") {
			return nil, errors.New("invalid timezone")
		}
		if _, err := os.Stat(filepath.Join("/usr/share/zoneinfo", zone)); err != nil {
			return nil, errors.New("unknown timezone")
		}
		return []step{{Name: "timedatectl", Args: []string{"set-timezone", zone}}}, nil
	case "system.ntp":
		if !choice(p["enabled"], "true", "false") {
			return nil, errors.New("invalid NTP state")
		}
		return []step{{Name: "timedatectl", Args: []string{"set-ntp", p["enabled"]}}}, nil
	case "system.reboot", "system.poweroff":
		// Delay so HTTP and job creation can complete before the connection drops.
		verb := strings.TrimPrefix(request.Action, "system.")
		return []step{{Name: "sleep", Args: []string{"3"}}, {Name: "systemctl", Args: []string{verb}}}, nil
	case "system.linux-password":
		if !linuxUsernamePattern.MatchString(p["user"]) || !validLinuxPassword(p["password"]) {
			return nil, errors.New("valid user and password of 8–512 characters required (no colon/NUL/newline)")
		}
		return []step{{Name: "chpasswd", Input: p["user"] + ":" + p["password"] + "\n"}}, nil
	case "system.cron":
		file := filepath.Join(a.state, "root.crontab")
		if err := atomicWrite(file, []byte(p["config"]+"\n"), 0600); err != nil {
			return nil, err
		}
		return []step{{Name: "crontab", Args: []string{file}}}, nil
	case "process.signal":
		pid, err := strconv.Atoi(p["pid"])
		if err != nil || pid < 2 || pid == os.Getpid() {
			return nil, errors.New("invalid or protected process")
		}
		if !choice(p["signal"], "TERM", "KILL", "HUP") {
			return nil, errors.New("unsupported signal")
		}
		return []step{{Name: "kill", Args: []string{"-" + p["signal"], p["pid"]}}}, nil
	case "file.mkdir":
		path, err := safePath(p["path"])
		if err != nil {
			return nil, err
		}
		return nil, os.Mkdir(path, 0755)
	case "file.rename":
		from, err := safePath(p["path"])
		if err != nil {
			return nil, err
		}
		to, err := safePath(p["destination"])
		if err != nil {
			return nil, err
		}
		if _, err := os.Lstat(to); err == nil {
			return nil, errors.New("destination already exists")
		}
		return nil, os.Rename(from, to)
	case "file.delete":
		path, err := safePath(p["path"])
		if err != nil {
			return nil, err
		}
		// Non-recursive by design. Never recursively remove a system directory.
		return nil, os.Remove(path)
	case "diagnostic":
		host := p["host"]
		if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.:%_-]{0,252}$`).MatchString(host) {
			return nil, errors.New("invalid host")
		}
		switch p["type"] {
		case "ping":
			return []step{{Name: "ping", Args: []string{"-c", "4", "-W", "3", host}}}, nil
		case "dns":
			return []step{{Name: "getent", Args: []string{"ahosts", host}}}, nil
		case "trace":
			return []step{{Name: "traceroute", Args: []string{"-m", "15", "-w", "2", host}}}, nil
		}
		return nil, errors.New("unknown diagnostic")
	}
	return nil, errUnknownAction
}

// Make the fixed firewall table persistent without requiring another daemon.
func (a *app) restoreFirewall() {
	path := filepath.Join(a.state, "firewall.nft")
	if _, err := os.Stat(path); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := command(ctx, "", "nft", "-f", path)
	a.audit("firewall.boot", out, err == nil)
}
