package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (a *app) wireguardAction(request actionRequest) ([]step, error) {
	p := request.Params
	name := p["name"]
	if !validInterface(name) || strings.HasPrefix(name, "-") {
		return nil, errors.New("tunnel name must be 1–15 letters, digits, dots, underscores or hyphens")
	}
	path := filepath.Join("/etc/wireguard", name+".conf")
	switch request.Action {
	case "wireguard.save":
		if !strings.Contains(p["config"], "[Interface]") {
			return nil, errors.New("configuration needs an [Interface] section")
		}
		if err := os.MkdirAll("/etc/wireguard", 0700); err != nil {
			return nil, err
		}
		if old, err := os.ReadFile(path); err == nil {
			if err := atomicWrite(path+".bak", old, 0600); err != nil {
				return nil, err
			}
		}
		return nil, atomicWrite(path, []byte(p["config"]+"\n"), 0600)
	case "wireguard.up", "wireguard.down":
		if _, err := os.Stat(path); err != nil {
			return nil, err
		}
		return []step{{Name: "wg-quick", Args: []string{strings.TrimPrefix(request.Action, "wireguard."), name}}}, nil
	case "wireguard.enable", "wireguard.disable":
		return []step{{Name: "systemctl", Args: []string{strings.TrimPrefix(request.Action, "wireguard."), "wg-quick@" + name + ".service"}}}, nil
	case "wireguard.delete":
		if _, err := os.Stat("/sys/class/net/" + name); err == nil {
			return nil, errors.New("stop the tunnel before deleting it")
		}
		if output("systemctl", "is-enabled", "wg-quick@"+name+".service") == "enabled" {
			return nil, errors.New("disable tunnel autostart before deleting it")
		}
		return nil, os.Remove(path)
	}
	return nil, errUnknownAction
}

func wireguardKeys(w http.ResponseWriter, r *http.Request) {
	private, err := run("wg", "genkey")
	if err != nil {
		fail(w, 500, private)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	public, err := command(ctx, private, "wg", "pubkey")
	if err != nil {
		fail(w, 500, public)
		return
	}
	respond(w, map[string]string{"private": strings.TrimSpace(private), "public": strings.TrimSpace(public)})
}

const defaultFirewall = `# Only this table is managed by the console. NetworkManager's NAT is untouched.
# Do not remove management access unless you have a recovery connection.
destroy table inet openstick_webui
table inet openstick_webui {
    chain input {
        type filter hook input priority -10; policy accept;
        iifname "lo" accept
        ct state established,related accept
        # Example: tcp dport 80 drop
    }
    chain forward {
        type filter hook forward priority -10; policy accept;
    }
}
`

func (a *app) firewallAction(request actionRequest) ([]step, error) {
	path := filepath.Join(a.state, "firewall.nft")
	switch request.Action {
	case "firewall.save":
		config := request.Params["config"]
		if len(config) == 0 || len(config) > 65536 {
			return nil, errors.New("ruleset must be 1–65536 bytes")
		}
		// Restrict persistent rules to a dedicated table. Advanced global changes
		// remain available in the root terminal and /etc/nftables.conf editor.
		if err := validateFirewallScope(config); err != nil {
			return nil, err
		}
		candidate := filepath.Join(a.state, "firewall.candidate.nft")
		if err := atomicWrite(candidate, []byte(config), 0600); err != nil {
			return nil, err
		}
		defer os.Remove(candidate)
		out, err := run("nft", "-c", "-f", candidate)
		if err != nil {
			return nil, fmt.Errorf("nftables validation failed: %s", out)
		}
		previous, readErr := os.ReadFile(path)
		if readErr == nil {
			if err := atomicWrite(path+".bak", previous, 0600); err != nil {
				return nil, err
			}
		} else {
			if err := atomicWrite(path+".bak", []byte(defaultFirewall), 0600); err != nil {
				return nil, err
			}
		}
		if err := atomicWrite(path, []byte(config), 0600); err != nil {
			return nil, err
		}
		return []step{{Name: "nft", Args: []string{"-f", path}}}, nil
	case "firewall.reset":
		if err := atomicWrite(path, []byte(defaultFirewall), 0600); err != nil {
			return nil, err
		}
		return []step{{Name: "nft", Args: []string{"-f", path}}}, nil
	case "firewall.rollback":
		data, err := os.ReadFile(path + ".bak")
		if err != nil {
			return nil, err
		}
		if err := atomicWrite(path, data, 0600); err != nil {
			return nil, err
		}
		return []step{{Name: "nft", Args: []string{"-f", path}}}, nil
	}
	return nil, errUnknownAction
}

// Parse top-level declarations rather than trusting a substring check. Rules may
// contain arbitrary statements inside the single permitted table, not includes,
// shell commands, other tables, or a global flush. nft itself validates syntax.
func validateFirewallScope(config string) error {
	depth := 0
	var top strings.Builder
	for _, line := range strings.Split(config, "\n") {
		line = strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
		if line == "" {
			continue
		}
		if depth == 0 {
			if line == "destroy table inet openstick_webui" || line == "delete table inet openstick_webui" {
				continue
			}
			if !strings.HasPrefix(line, "table inet openstick_webui {") {
				return errors.New("only the 'inet openstick_webui' table may be managed here; use the terminal for global rules")
			}
			top.WriteString("table")
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if depth < 0 {
			return errors.New("unbalanced firewall braces")
		}
		// Reject extra commands trailing a top-level closing brace.
		if depth == 0 && !strings.HasSuffix(line, "}") {
			return errors.New("unexpected top-level firewall command")
		}
	}
	if depth != 0 || top.String() != "table" {
		return errors.New("provide exactly one complete inet openstick_webui table")
	}
	return nil
}
