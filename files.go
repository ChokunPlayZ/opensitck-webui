package main

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// This is an intentional administrator-level file manager. Protect the console's
// own credential file and pseudo-filesystems from accidental writes; use the
// terminal for devices, procfs, sysfs, credentials and other exceptional cases.
func safePath(path string) (string, error) {
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return "", errors.New("an absolute path is required")
	}
	path = filepath.Clean(path)
	if path == "/" || protectedPath(path) {
		return "", errors.New("protected path: use the terminal if you really need to change it")
	}
	return path, nil
}

func protectedPath(path string) bool {
	return protectedPathDepth(path, 0)
}

func protectedPathDepth(path string, depth int) bool {
	if depth > 40 {
		return true // Refuse symlink loops instead of guessing at the target.
	}
	for _, prefix := range []string{"/dev", "/proc", "/sys", "/var/lib/openstick-webui", "/etc/shadow", "/etc/gshadow"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	// Resolve each symlink lexically, even if its final destination does not yet
	// exist. EvalSymlinks alone cannot protect a dangling link to a credential.
	for current := path; current != "/"; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink == 0 {
			continue
		}
		target, err := os.Readlink(current)
		if err != nil {
			return true
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(current), target)
		}
		suffix := strings.TrimPrefix(strings.TrimPrefix(path, current), "/")
		return protectedPathDepth(filepath.Join(target, suffix), depth+1)
	}
	return false
}

func (a *app) files(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Query().Get("path"))
	if !filepath.IsAbs(path) {
		path = "/etc"
	}
	if protectedPath(path) {
		fail(w, 403, "Protected directory")
		return
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	files := []map[string]any{}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, map[string]any{"name": entry.Name(), "directory": entry.IsDir(), "size": info.Size(), "mode": info.Mode().String(), "modified": info.ModTime(), "symlink": info.Mode()&os.ModeSymlink != 0})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i]["directory"] != files[j]["directory"] {
			return files[i]["directory"].(bool)
		}
		return files[i]["name"].(string) < files[j]["name"].(string)
	})
	respond(w, map[string]any{"path": path, "files": files})
}

func (a *app) fileGet(w http.ResponseWriter, r *http.Request) {
	path, err := safePath(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		fail(w, 400, "Editor supports regular text files up to 1 MiB")
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if strings.ContainsRune(string(data), 0) {
		fail(w, 400, "Binary file: download instead")
		return
	}
	respond(w, map[string]any{"path": path, "content": string(data), "mode": info.Mode().Perm()})
}

func (a *app) fileSave(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Path    string
		Content string
		Confirm bool
	}
	if !decode(w, r, &request) {
		return
	}
	if !request.Confirm {
		fail(w, 400, "Confirmation required")
		return
	}
	path, err := safePath(request.Path)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if len(request.Content) > 1<<20 {
		fail(w, 400, "Text file exceeds 1 MiB")
		return
	}
	mode := os.FileMode(0644)
	if info, statErr := os.Lstat(path); statErr == nil {
		if !info.Mode().IsRegular() {
			fail(w, 400, "Only regular files can be replaced (not symlinks)")
			return
		}
		mode = info.Mode().Perm()
		old, readErr := os.ReadFile(path)
		if readErr != nil {
			fail(w, 500, readErr.Error())
			return
		}
		if err = atomicWrite(path+".webui.bak", old, 0600); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	if err = atomicWrite(path, []byte(request.Content), mode); err != nil {
		fail(w, 500, err.Error())
		return
	}
	a.audit("file.save", path, true)
	respond(w, map[string]bool{"ok": true})
}

func (a *app) fileDownload(w http.ResponseWriter, r *http.Request) {
	path, err := safePath(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 400, "Not a regular file")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(filepath.Base(path), "\"", "")+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, path)
}

func (a *app) fileUpload(w http.ResponseWriter, r *http.Request) {
	path, err := safePath(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		fail(w, 400, "Choose a new filename; uploads never overwrite existing files")
		return
	}
	data, err := io.ReadAll(r.Body)
	if err != nil {
		fail(w, 400, "Upload exceeds 16 MiB or could not be read")
		return
	}
	if err := atomicWrite(path, data, 0600); err != nil {
		fail(w, 500, err.Error())
		return
	}
	a.audit("file.upload", path, true)
	respond(w, map[string]bool{"ok": true})
}
