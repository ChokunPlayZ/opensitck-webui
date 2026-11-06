package main

import (
	"io/fs"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func (a *app) routes(static fs.FS) {
	m := a.mux
	m.HandleFunc("POST /api/login", a.login)
	m.HandleFunc("GET /api/session", a.sessionInfo)
	m.HandleFunc("POST /api/logout", a.logout)
	m.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		system := a.latest
		history := append([]sample{}, a.samples...)
		a.mu.Unlock()
		respond(w, map[string]any{"system": system, "history": history})
	})
	m.HandleFunc("GET /api/capabilities", func(w http.ResponseWriter, r *http.Request) { respond(w, capabilities()) })
	m.HandleFunc("GET /api/hardware", a.hardware)
	m.HandleFunc("GET /api/speedtest", a.speedtestStatus)
	m.HandleFunc("GET /api/users", a.users)
	m.HandleFunc("GET /api/network", func(w http.ResponseWriter, r *http.Request) { respond(w, networkData()) })
	m.HandleFunc("GET /api/profile", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("uuid")
		if !validUUID(id) {
			fail(w, 400, "Invalid connection UUID")
			return
		}
		out, err := run("nmcli", "-t", "-f", "all", "connection", "show", "uuid", id)
		if err != nil {
			fail(w, 400, out)
			return
		}
		values := map[string]string{}
		for _, line := range strings.Split(out, "\n") {
			f := splitNM(line)
			if len(f) >= 2 {
				values[f[0]] = strings.Join(f[1:], ":")
			}
		}
		respond(w, values)
	})
	m.HandleFunc("GET /api/modem", func(w http.ResponseWriter, r *http.Request) { respond(w, modemData()) })
	m.HandleFunc("GET /api/sms", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if !numericID(id) {
			fail(w, 400, "Invalid SMS ID")
			return
		}
		respond(w, jsonOutput("mmcli", "-s", id, "-J"))
	})
	m.HandleFunc("GET /api/services", func(w http.ResponseWriter, r *http.Request) {
		units := []map[string]string{}
		out, err := run("systemctl", "list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend")
		if err != nil {
			fail(w, 500, out)
			return
		}
		for _, line := range cleanLines(out) {
			f := strings.Fields(line)
			if len(f) >= 5 {
				units = append(units, map[string]string{"name": f[0], "load": f[1], "active": f[2], "sub": f[3], "description": strings.Join(f[4:], " ")})
			}
		}
		respond(w, map[string]any{"units": units, "unitFiles": output("systemctl", "list-unit-files", "--type=service", "--no-pager", "--no-legend")})
	})
	m.HandleFunc("GET /api/logs", a.logs)
	m.HandleFunc("GET /api/wireguard", func(w http.ResponseWriter, r *http.Request) {
		configs := []map[string]any{}
		paths, _ := filepath.Glob("/etc/wireguard/*.conf")
		for _, p := range paths {
			configs = append(configs, map[string]any{"name": strings.TrimSuffix(filepath.Base(p), ".conf"), "config": readText(p)})
		}
		out, err := run("wg", "show", "all")
		respond(w, map[string]any{"configs": configs, "status": out, "error": errorString(err)})
	})
	m.HandleFunc("POST /api/wireguard/keys", wireguardKeys)
	m.HandleFunc("GET /api/firewall", func(w http.ResponseWriter, r *http.Request) {
		out, err := run("nft", "-a", "list", "ruleset")
		respond(w, map[string]any{"ruleset": out, "error": errorString(err), "managed": readText(filepath.Join(a.state, "firewall.nft")), "forwarding": readText("/proc/sys/net/ipv4/ip_forward")})
	})
	m.HandleFunc("GET /api/files", a.files)
	m.HandleFunc("GET /api/file", a.fileGet)
	m.HandleFunc("POST /api/file", a.fileSave)
	m.HandleFunc("GET /api/download", a.fileDownload)
	m.HandleFunc("POST /api/upload", a.fileUpload)
	m.HandleFunc("GET /api/storage", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]any{"disks": jsonOutput("lsblk", "-J", "-b", "-o", "NAME,SIZE,TYPE,MOUNTPOINTS,FSTYPE,LABEL,RO"), "df": output("df", "-h"), "mounts": readText("/proc/mounts"), "partitions": partitionData()})
	})
	m.HandleFunc("GET /api/packages", func(w http.ResponseWriter, r *http.Request) {
		out, err := run("dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${db:Status-Abbrev}\n")
		packages := [][]string{}
		for _, line := range cleanLines(out) {
			f := strings.Split(line, "\t")
			if len(f) >= 3 && strings.HasPrefix(f[2], "ii") {
				packages = append(packages, f)
			}
		}
		respond(w, map[string]any{"packages": packages, "error": errorString(err)})
	})
	m.HandleFunc("GET /api/processes", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]any{"output": output("ps", "-eo", "pid,ppid,user,%cpu,%mem,rss,etime,args", "--sort=-%cpu"), "connections": output("ss", "-tulpn")})
	})
	m.HandleFunc("GET /api/system", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]any{"hostname": readText("/etc/hostname"), "time": output("timedatectl", "show"), "users": readText("/etc/passwd"), "cron": output("crontab", "-l"), "ssh": output("sshd", "-T"), "sysctl": output("sysctl", "net.ipv4.ip_forward", "net.ipv6.conf.all.forwarding"), "capabilities": capabilities(), "version": version})
	})
	m.HandleFunc("GET /api/jobs", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		jobs := []job{}
		buffers := map[string]*cappedBuffer{}
		for _, j := range a.jobs {
			jobs = append(jobs, job{ID: j.ID, Label: j.Label, Started: j.Started, Finished: j.Finished, Status: j.Status})
			buffers[j.ID] = j.buf
		}
		a.mu.Unlock()
		sort.Slice(jobs, func(i, j int) bool { return jobs[i].Started.After(jobs[j].Started) })
		selected := r.URL.Query().Get("selected")
		if selected == "" && len(jobs) > 0 {
			selected = jobs[0].ID
		}
		// Send only the selected job's output, not 40 half-megabyte log buffers.
		for i := range jobs {
			if jobs[i].ID == selected {
				jobs[i].Output = buffers[selected].String()
			}
		}
		respond(w, jobs)
	})
	m.HandleFunc("GET /api/audit", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]string{"output": readText(filepath.Join(a.state, "audit.jsonl"))})
	})
	m.HandleFunc("POST /api/action", a.action)
	m.HandleFunc("GET /api/backup", a.backup)
	m.HandleFunc("POST /api/restore", a.restore)
	m.HandleFunc("GET /api/calibration", a.calibration)
	m.HandleFunc("GET /api/terminal", a.terminal)
	fileServer := http.FileServer(http.FS(static))
	m.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fail(w, 404, "Unknown endpoint")
			return
		}
		if r.URL.Path != "/" {
			if _, err := fs.Stat(static, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
				r.URL.Path = "/"
			}
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func errorString(err error) string {
	if err != nil {
		return err.Error()
	}
	return ""
}
func (a *app) logs(w http.ResponseWriter, r *http.Request) {
	unit := r.URL.Query().Get("unit")
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	if lines < 1 || lines > 2000 {
		lines = 200
	}
	args := []string{"--no-pager", "-n", strconv.Itoa(lines), "-o", "short-iso"}
	if unit != "" {
		if !validUnit(unit) {
			fail(w, 400, "Invalid unit name")
			return
		}
		args = append(args, "-u", unit)
	}
	if r.URL.Query().Get("kernel") == "1" {
		args = append(args, "-k")
	}
	priority := r.URL.Query().Get("priority")
	if priority != "" {
		if _, err := strconv.Atoi(priority); err != nil {
			fail(w, 400, "Invalid priority")
			return
		}
		args = append(args, "-p", priority)
	}
	out, err := run("journalctl", args...)
	respond(w, map[string]string{"output": out, "error": errorString(err)})
}

func partitionData() []map[string]string {
	result := []map[string]string{}
	paths, _ := filepath.Glob("/dev/disk/by-partlabel/*")
	for _, p := range paths {
		real, _ := filepath.EvalSymlinks(p)
		result = append(result, map[string]string{"name": filepath.Base(p), "device": real})
	}
	return result
}
