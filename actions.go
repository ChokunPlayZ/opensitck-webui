package main

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// An explicit action registry makes privileged operations auditable. Form values
// are passed as executable arguments, never concatenated into a shell command.
type actionRequest struct {
	Action  string            `json:"action"`
	Params  map[string]string `json:"params"`
	Confirm bool              `json:"confirm"`
}

var (
	uuidPattern      = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)
	unitPattern      = regexp.MustCompile(`^[a-zA-Z0-9_@.\\:\-]{1,160}\.service$`)
	interfacePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,15}$`)
	packagePattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9+.:\-]{0,100}$`)
)

func validUUID(value string) bool { return uuidPattern.MatchString(value) }
func validUnit(value string) bool {
	return unitPattern.MatchString(value) && !strings.HasPrefix(value, "-")
}
func validInterface(value string) bool {
	return interfacePattern.MatchString(value) && !strings.HasPrefix(value, "-") && value != "." && value != ".."
}
func numericID(value string) bool {
	return regexp.MustCompile(`^[0-9]{1,8}$`).MatchString(value)
}

func (a *app) action(w http.ResponseWriter, r *http.Request) {
	var request actionRequest
	if !decode(w, r, &request) {
		return
	}
	for key, value := range request.Params {
		if len(value) > 65536 || strings.ContainsRune(value, 0) {
			fail(w, 400, "Invalid value for "+key)
			return
		}
	}
	// Read-only diagnostics still use POST so they cannot be triggered cross-site.
	readOnly := request.Action == "diagnostic" || request.Action == "wifi.scan"
	if !readOnly && !request.Confirm {
		fail(w, 400, "Explicit confirmation is required for this change")
		return
	}

	var steps []step
	var err error
	switch {
	case strings.HasPrefix(request.Action, "profile.") || strings.HasPrefix(request.Action, "wifi.") || strings.HasPrefix(request.Action, "route.") || request.Action == "forwarding":
		steps, err = networkAction(request)
	case strings.HasPrefix(request.Action, "modem.") || strings.HasPrefix(request.Action, "sim.") || strings.HasPrefix(request.Action, "sms."):
		steps, err = modemAction(request)
	case strings.HasPrefix(request.Action, "wireguard."):
		steps, err = a.wireguardAction(request)
	case strings.HasPrefix(request.Action, "firewall."):
		steps, err = a.firewallAction(request)
	case strings.HasPrefix(request.Action, "user."):
		s, _ := a.getSession(r)
		steps, err = a.userAction(request, s.Username)
	case strings.HasPrefix(request.Action, "hardware."):
		steps, err = hardwareAction(request)
	case request.Action == "speedtest.run":
		steps = []step{{Name: "Device internet speed test", Run: a.runSpeedtest}}
	default:
		steps, err = a.systemAction(request)
	}
	if err != nil {
		a.audit(request.Action, "validation rejected", false)
		fail(w, 400, err.Error())
		return
	}
	if len(steps) == 0 {
		a.audit(request.Action, "configuration saved", true)
		respond(w, map[string]any{"ok": true, "message": "Configuration saved"})
		return
	}
	id, err := a.startJob(request.Action, steps)
	if err != nil {
		fail(w, http.StatusTooManyRequests, err.Error())
		return
	}
	respond(w, map[string]string{"job": id})
}

func require(value, label string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", label)
	}
	return nil
}

func choice(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

var errUnknownAction = errors.New("unknown or unsupported action")
