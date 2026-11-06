package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Configuration backups exclude credentials for the console, system passwords,
// firmware, executables and raw partitions. Network/WireGuard secrets ARE included.
var backupRoots = []string{
	"etc/NetworkManager/system-connections", "etc/wireguard", "etc/hostapd",
	"etc/dnsmasq.d", "etc/ssh/sshd_config.d", "etc/cron.d",
	"etc/sysctl.d/90-openstick-webui.conf", "etc/hostname", "etc/hosts",
	"etc/nftables.conf", "var/lib/openstick-webui/firewall.nft",
	"var/lib/openstick-webui/root.crontab",
}

func allowedBackupPath(name string) bool {
	if filepath.IsAbs(name) || filepath.Clean(name) != name {
		return false
	}
	for _, root := range backupRoots {
		if name == root || strings.HasPrefix(name, root+"/") {
			return true
		}
	}
	return false
}

func (a *app) backup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"openstick-config-%s.tar.gz\"", time.Now().Format("20060102-150405")))
	gz := gzip.NewWriter(w)
	defer gz.Close()
	archive := tar.NewWriter(gz)
	defer archive.Close()
	metadata, _ := json.Marshal(map[string]any{"version": version, "created": time.Now(), "hostname": readText("/etc/hostname")})
	archive.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(metadata))})
	archive.Write(metadata)
	for _, root := range backupRoots {
		filepath.Walk("/"+root, func(path string, info os.FileInfo, err error) error {
			if err != nil || !info.Mode().IsRegular() || info.Size() > 2<<20 {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			header := &tar.Header{Name: strings.TrimPrefix(path, "/"), Mode: int64(info.Mode().Perm()), Size: int64(len(data)), ModTime: info.ModTime()}
			if archive.WriteHeader(header) == nil {
				archive.Write(data)
			}
			return nil
		})
	}
	a.audit("backup.download", "configuration archive (contains network secrets)", true)
}

func (a *app) restore(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("confirm") != "yes" {
		fail(w, 400, "Restore confirmation required")
		return
	}
	gz, err := gzip.NewReader(r.Body)
	if err != nil {
		fail(w, 400, "Invalid gzip archive")
		return
	}
	defer gz.Close()
	archive := tar.NewReader(io.LimitReader(gz, 16<<20))
	type entry struct {
		path string
		data []byte
		mode os.FileMode
	}
	entries := []entry{}
	// Validate the entire archive before touching the live filesystem.
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			fail(w, 400, "Invalid or oversized archive")
			return
		}
		if header.Name == "manifest.json" {
			continue
		}
		if !allowedBackupPath(header.Name) || header.Typeflag != tar.TypeReg || header.Size < 0 || header.Size > 2<<20 || len(entries) > 300 {
			fail(w, 400, "Unsafe or unsupported archive entry: "+header.Name)
			return
		}
		path := "/" + header.Name
		// Reject any existing symlink in the destination path.
		for parent := path; parent != "/"; parent = filepath.Dir(parent) {
			if info, err := os.Lstat(parent); err == nil && info.Mode()&os.ModeSymlink != 0 {
				fail(w, 400, "Symlink destination refused")
				return
			}
		}
		data, err := io.ReadAll(archive)
		if err != nil {
			fail(w, 400, "Could not read archive entry")
			return
		}
		entries = append(entries, entry{path, data, os.FileMode(header.Mode) & 0755})
	}
	if len(entries) == 0 {
		fail(w, 400, "Archive contains no supported configuration files")
		return
	}
	for _, item := range entries {
		if err := os.MkdirAll(filepath.Dir(item.path), 0700); err != nil {
			fail(w, 500, err.Error())
			return
		}
		if previous, err := os.ReadFile(item.path); err == nil {
			if err := atomicWrite(item.path+".pre-restore", previous, 0600); err != nil {
				fail(w, 500, err.Error())
				return
			}
		}
		if err := atomicWrite(item.path, item.data, item.mode|0600); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	a.audit("backup.restore", fmt.Sprintf("%d files; not activated", len(entries)), true)
	respond(w, map[string]any{"ok": true, "message": fmt.Sprintf("Restored %d files. Reload connection profiles or reboot to activate. Previous files have .pre-restore backups.", len(entries))})
}

func (a *app) calibration(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("partition")
	if !choice(name, "modemst1", "modemst2", "fsg", "fsc", "persist", "sec") {
		fail(w, 400, "Only calibration partitions may be downloaded")
		return
	}
	path := filepath.Join("/dev/disk/by-partlabel", name)
	file, err := os.Open(path)
	if err != nil {
		fail(w, 400, "Partition unavailable: "+err.Error())
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".bin\"")
	io.Copy(w, io.LimitReader(file, 128<<20))
	a.audit("calibration.download", name, true)
}
