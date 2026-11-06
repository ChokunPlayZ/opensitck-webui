package main

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"
)

const testPasswd = "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:Device User:/home/user:/bin/bash\nother:x:1001:1001::/home/other:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\nbad:x:no:1::/:/bin/sh\n"
const testGroup = "root:x:0:\nuser:x:1000:\nother:x:1001:\nsudo:x:27:user\ndialout:x:20:user,other\n"

func TestParseLocalAccounts(t *testing.T) {
	accounts := parseAccounts(testPasswd, testGroup)
	if len(accounts) != 5 {
		t.Fatalf("got %d accounts", len(accounts))
	}
	for _, account := range accounts {
		if account.Username == "user" {
			if !account.Sudo || !account.Editable || account.PrimaryGroup != "user" || account.Home != "/home/user" || !reflect.DeepEqual(account.Groups, []string{"dialout", "sudo", "user"}) {
				t.Fatalf("incorrect account: %+v", account)
			}
		} else if choice(account.Username, "root", "daemon", "nobody") && account.Editable {
			t.Fatalf("system account editable: %s", account.Username)
		}
	}
}

func TestUserTargetGuards(t *testing.T) {
	accounts := parseAccounts(testPasswd, testGroup)
	for _, test := range []struct {
		action, user, enabled string
		allowed               bool
	}{
		{"user.create", "newuser", "false", true},
		{"user.create", "user", "false", false},
		{"user.password", "other", "", true},
		{"user.password", "user", "", true},
		{"user.delete", "user", "", false},
		{"user.lock", "user", "", false},
		{"user.sudo", "user", "false", false},
		{"user.sudo", "user", "true", true},
		{"user.delete", "other", "", true},
		{"user.password", "missing", "", false},
		{"user.lock", "root", "", false},
		{"user.delete", "daemon", "", false},
		{"user.sudo", "nobody", "true", false},
	} {
		r := actionRequest{Action: test.action, Params: map[string]string{"user": test.user, "enabled": test.enabled}}
		if err := checkUserTarget(accounts, r, "user"); (err == nil) != test.allowed {
			t.Errorf("%s %s allowed=%v: %v", test.action, test.user, test.allowed, err)
		}
	}
	primarySudo := parseAccounts("other:x:1001:42::/home/other:/bin/bash", "sudo:x:42:")
	if err := checkUserTarget(primarySudo, actionRequest{Action: "user.sudo", Params: map[string]string{"user": "other", "enabled": "false"}}, "user"); err == nil {
		t.Fatal("allowed removal of primary sudo group")
	}
}

func TestUserCredentialValidation(t *testing.T) {
	a := testApp(t)
	for _, username := range []string{"", "--root", "user;reboot", "../root", "user\nroot", strings.Repeat("u", 33), "UPPER"} {
		if _, err := a.userAction(actionRequest{Action: "user.create", Params: map[string]string{"user": username, "password": "good-password", "sudo": "false"}}, "user"); err == nil {
			t.Errorf("accepted invalid username %q", username)
		}
	}
	for _, password := range []string{"short", "1234567\n", "pass:word", "pass\x00word", strings.Repeat("p", 513)} {
		if validLinuxPassword(password) {
			t.Errorf("accepted invalid password %q", password)
		}
	}
	if !validLinuxPassword("a strong password!") {
		t.Fatal("valid literal password rejected")
	}
	if _, err := a.userAction(actionRequest{Action: "user.create", Params: map[string]string{"user": "newuser", "password": "good-password", "sudo": "yes;reboot"}}, "user"); err == nil {
		t.Fatal("accepted invalid sudo setting")
	}
}

func waitJob(t *testing.T, a *app, id string) string {
	t.Helper()
	a.mu.Lock()
	j := a.jobs[id]
	a.mu.Unlock()
	select {
	case <-j.done:
	case <-time.After(5 * time.Second):
		t.Fatal("job did not complete")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return j.Status
}

func TestAccountChangesRevokeSessions(t *testing.T) {
	for _, label := range []string{"user.password", "user.lock", "user.unlock", "user.sudo", "user.delete", "system.linux-password", "user.create"} {
		t.Run(label, func(t *testing.T) {
			a := testApp(t)
			a.sessions["existing"] = session{Username: "user", Expires: time.Now().Add(time.Hour)}
			id, err := a.startJob(label, []step{{Name: "test", Run: func(context.Context, io.Writer) error { return nil }}})
			if err != nil || waitJob(t, a, id) != "success" {
				t.Fatal("job failed:", err)
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if (len(a.sessions) != 0) != (label == "user.create") {
				t.Fatal("incorrect account session revocation")
			}
		})
	}
}

func TestFunctionJobFailure(t *testing.T) {
	a := testApp(t)
	id, err := a.startJob("speedtest.run", []step{{Name: "test", Run: func(context.Context, io.Writer) error { return errors.New("provider unavailable") }}})
	if err != nil || waitJob(t, a, id) != "failed" {
		t.Fatal("function job error was not propagated")
	}
	if !strings.Contains(a.jobs[id].buf.String(), "provider unavailable") {
		t.Fatal("function job error not visible in Activity")
	}
}
