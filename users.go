package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type linuxAccount struct {
	Username     string   `json:"username"`
	UID          int      `json:"uid"`
	GID          int      `json:"gid"`
	Name         string   `json:"name"`
	Home         string   `json:"home"`
	Shell        string   `json:"shell"`
	Groups       []string `json:"groups"`
	PrimaryGroup string   `json:"primaryGroup"`
	Status       string   `json:"status"`
	Sudo         bool     `json:"sudo"`
	Editable     bool     `json:"editable"`
}

func parseAccounts(passwd, group string) []linuxAccount {
	accounts := []linuxAccount{}
	for _, line := range strings.Split(passwd, "\n") {
		f := strings.Split(line, ":")
		if len(f) != 7 {
			continue
		}
		uid, err := strconv.Atoi(f[2])
		gid, gidErr := strconv.Atoi(f[3])
		if err != nil || gidErr != nil || uid < 0 || gid < 0 {
			continue
		}
		account := linuxAccount{Username: f[0], UID: uid, GID: gid, Name: f[4], Home: f[5], Shell: f[6], Status: "unknown", Groups: []string{}, Editable: uid >= 1000 && uid != 65534 && f[0] != "root"}
		for _, line := range strings.Split(group, "\n") {
			g := strings.Split(line, ":")
			if len(g) != 4 {
				continue
			}
			groupID, err := strconv.Atoi(g[2])
			member := err == nil && groupID == gid
			for _, username := range strings.Split(g[3], ",") {
				member = member || username == account.Username
			}
			if member {
				if err == nil && groupID == gid {
					account.PrimaryGroup = g[0]
				}
				account.Groups = append(account.Groups, g[0])
				account.Sudo = account.Sudo || g[0] == "sudo"
			}
		}
		sort.Strings(account.Groups)
		accounts = append(accounts, account)
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].UID < accounts[j].UID })
	return accounts
}

func localAccounts() ([]linuxAccount, error) {
	passwd, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return nil, err
	}
	group, err := os.ReadFile("/etc/group")
	if err != nil {
		return nil, err
	}
	return parseAccounts(string(passwd), string(group)), nil
}

func (a *app) users(w http.ResponseWriter, r *http.Request) {
	accounts, err := localAccounts()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	// passwd exposes only lock/password status, never password hashes.
	statuses, statusErr := run("passwd", "--status", "--all")
	byName := map[string]string{}
	for _, line := range strings.Split(statuses, "\n") {
		f := strings.Fields(line)
		if len(f) > 1 {
			byName[f[0]] = f[1]
		}
	}
	for i := range accounts {
		if statusErr == nil && choice(byName[accounts[i].Username], "P", "L", "NP") {
			accounts[i].Status = byName[accounts[i].Username]
		}
	}
	s, _ := a.getSession(r)
	respond(w, map[string]any{"users": accounts, "currentUser": s.Username, "statusError": errorString(statusErr)})
}

func validLinuxPassword(password string) bool {
	return len(password) >= 8 && len(password) <= 512 && !strings.ContainsAny(password, "\x00\r\n:")
}

func checkUserTarget(accounts []linuxAccount, request actionRequest, actor string) error {
	username := request.Params["user"]
	for _, account := range accounts {
		if account.Username != username {
			continue
		}
		if request.Action == "user.create" {
			return errors.New("this local account already exists")
		}
		if !account.Editable {
			return errors.New("root and system accounts are protected; use the root terminal for exceptional changes")
		}
		if username == actor && (choice(request.Action, "user.delete", "user.lock") || request.Action == "user.sudo" && request.Params["enabled"] == "false") {
			return errors.New("you cannot delete, lock, or remove sudo membership from your own signed-in account")
		}
		if request.Action == "user.sudo" && request.Params["enabled"] == "false" && account.PrimaryGroup == "sudo" {
			return errors.New("sudo is this account's primary group; change it through the root terminal first")
		}
		return nil
	}
	if request.Action == "user.create" {
		return nil
	}
	return errors.New("local account not found")
}

func (a *app) userAction(request actionRequest, actor string) ([]step, error) {
	p := request.Params
	if !choice(request.Action, "user.create", "user.password", "user.lock", "user.unlock", "user.sudo", "user.delete") {
		return nil, errUnknownAction
	}
	if !linuxUsernamePattern.MatchString(p["user"]) {
		return nil, errors.New("invalid Debian username (use 1–32 lowercase letters, digits, underscores or hyphens; start with a letter or underscore)")
	}
	if choice(request.Action, "user.create", "user.password") && !validLinuxPassword(p["password"]) {
		return nil, errors.New("password must be 8–512 characters without colon, NUL or newline")
	}
	if request.Action == "user.create" && !choice(p["sudo"], "true", "false") || request.Action == "user.sudo" && !choice(p["enabled"], "true", "false") {
		return nil, errors.New("invalid sudo membership setting")
	}
	accounts, err := localAccounts()
	if err != nil {
		return nil, err
	}
	if err := checkUserTarget(accounts, request, actor); err != nil {
		return nil, err
	}
	return []step{{Name: request.Action, Run: func(ctx context.Context, out io.Writer) (resultErr error) {
		defer func() { a.audit(request.Action, "actor="+actor+" target="+p["user"], resultErr == nil) }()
		// Recheck under the job queue's mutation lock, not just at submission time.
		accounts, err := localAccounts()
		if err != nil {
			return err
		}
		if err := checkUserTarget(accounts, request, actor); err != nil {
			return err
		}
		fmt.Fprintf(out, "Local Debian account: %s\n", p["user"])
		exec := func(input, name string, args ...string) error {
			text, err := command(ctx, input, name, args...)
			fmt.Fprint(out, text)
			return err
		}
		switch request.Action {
		case "user.create":
			if err := exec("", "useradd", "--create-home", "--shell", "/bin/bash", "--", p["user"]); err != nil {
				return err
			}
			if err := exec(p["user"]+":"+p["password"]+"\n", "chpasswd"); err != nil {
				fmt.Fprintln(out, "The account was created, but password setup failed. Set its password before using it.")
				return err
			}
			if p["sudo"] == "true" {
				return exec("", "usermod", "--append", "--groups", "sudo", "--", p["user"])
			}
		case "user.password":
			return exec(p["user"]+":"+p["password"]+"\n", "chpasswd")
		case "user.lock":
			return exec("", "passwd", "--lock", "--", p["user"])
		case "user.unlock":
			return exec("", "passwd", "--unlock", "--", p["user"])
		case "user.sudo":
			if p["enabled"] == "true" {
				return exec("", "usermod", "--append", "--groups", "sudo", "--", p["user"])
			}
			return exec("", "gpasswd", "--delete", p["user"], "sudo")
		case "user.delete":
			// No --remove or --force: home/data is preserved and logged-in users
			// are rejected by Debian's own userdel checks.
			return exec("", "userdel", "--", p["user"])
		}
		fmt.Fprintln(out, "Account created. The home directory and Debian password are ready.")
		return nil
	}}}, nil
}
