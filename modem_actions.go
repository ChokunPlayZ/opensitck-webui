package main

import (
	"errors"
	"regexp"
	"strings"
)

func modemAction(request actionRequest) ([]step, error) {
	p := request.Params
	id := p["modem"]
	if id == "" {
		id = "0"
	}
	if !numericID(id) {
		return nil, errors.New("invalid modem ID")
	}
	args := []string{"-m", id}
	switch request.Action {
	case "modem.enable":
		args = append(args, "--enable")
	case "modem.disable":
		args = append(args, "--disable")
	case "modem.reset":
		args = append(args, "--reset")
	case "modem.connect":
		if !regexp.MustCompile(`^[a-zA-Z0-9._-]{1,100}$`).MatchString(p["apn"]) {
			return nil, errors.New("invalid APN")
		}
		settings := "apn=" + p["apn"]
		if p["ip-type"] != "" {
			if !choice(p["ip-type"], "ipv4", "ipv6", "ipv4v6") {
				return nil, errors.New("invalid IP type")
			}
			settings += ",ip-type=" + p["ip-type"]
		}
		args = append(args, "--simple-connect="+settings)
	case "modem.disconnect":
		args = append(args, "--simple-disconnect")
	case "modem.scan":
		args = append(args, "--3gpp-scan", "--timeout=120")
	case "modem.register":
		if p["operator"] == "" {
			args = append(args, "--3gpp-register-home")
		} else {
			if !regexp.MustCompile(`^[0-9]{5,6}$`).MatchString(p["operator"]) {
				return nil, errors.New("operator code must be 5–6 digits")
			}
			args = append(args, "--3gpp-register-in-operator="+p["operator"])
		}
	case "modem.modes":
		if !regexp.MustCompile(`^(2g|3g|4g|5g|any)(\|(2g|3g|4g|5g))*$`).MatchString(p["allowed"]) {
			return nil, errors.New("invalid allowed modes")
		}
		args = append(args, "--set-allowed-modes="+p["allowed"])
		if p["preferred"] != "" {
			if !choice(p["preferred"], "none", "2g", "3g", "4g", "5g") {
				return nil, errors.New("invalid preferred mode")
			}
			args = append(args, "--set-preferred-mode="+p["preferred"])
		}
	case "modem.bands":
		if !regexp.MustCompile(`^[a-z0-9|\-]{1,500}$`).MatchString(p["bands"]) {
			return nil, errors.New("invalid band list")
		}
		args = append(args, "--set-current-bands="+p["bands"])
	case "modem.signal":
		args = append(args, "--signal-setup=10")
	case "modem.power":
		if !choice(p["state"], "on", "low", "off") {
			return nil, errors.New("invalid power state")
		}
		args = append(args, "--set-power-state-"+p["state"])
	case "modem.at":
		if !strings.HasPrefix(strings.ToUpper(p["command"]), "AT") || len(p["command"]) > 500 || strings.ContainsAny(p["command"], "\r\n") {
			return nil, errors.New("enter a single AT command")
		}
		args = append(args, "--command="+p["command"])
	case "modem.ussd":
		if len(p["command"]) == 0 || len(p["command"]) > 160 || strings.ContainsAny(p["command"], "\r\n") {
			return nil, errors.New("invalid USSD code")
		}
		args = append(args, "--3gpp-ussd-initiate="+p["command"])
	case "sim.pin", "sim.enable-pin", "sim.disable-pin", "sim.change-pin", "sim.puk":
		if !numericID(p["sim"]) {
			return nil, errors.New("SIM ID is required (SIM must be detected)")
		}
		pinPattern := regexp.MustCompile(`^[0-9]{4,8}$`)
		if !pinPattern.MatchString(p["pin"]) {
			return nil, errors.New("PIN must be 4–8 digits")
		}
		args = []string{"-i", p["sim"], "--pin=" + p["pin"]}
		switch request.Action {
		case "sim.enable-pin":
			args = append(args, "--enable-pin")
		case "sim.disable-pin":
			args = append(args, "--disable-pin")
		case "sim.change-pin":
			if !pinPattern.MatchString(p["new-pin"]) {
				return nil, errors.New("new PIN must be 4–8 digits")
			}
			args = append(args, "--change-pin="+p["new-pin"])
		case "sim.puk":
			if !regexp.MustCompile(`^[0-9]{8}$`).MatchString(p["puk"]) {
				return nil, errors.New("PUK must be 8 digits")
			}
			args = append(args, "--puk="+p["puk"])
		}
	case "sms.create":
		if !regexp.MustCompile(`^\+?[0-9]{3,20}$`).MatchString(p["number"]) {
			return nil, errors.New("invalid destination number")
		}
		if len(p["text"]) == 0 || len(p["text"]) > 1600 {
			return nil, errors.New("message must be 1–1600 bytes")
		}
		// ModemManager's key-value parser supports single or double-quoted values,
		// but not backslash escapes inside them. Pick a quote not in the message.
		quote := "'"
		if strings.Contains(p["text"], quote) {
			quote = "\""
		}
		if strings.Contains(p["text"], quote) {
			return nil, errors.New("ModemManager cannot encode both quote types in one message; replace one quote type")
		}
		args = append(args, "--messaging-create-sms=number='"+p["number"]+"',text="+quote+p["text"]+quote)
	case "sms.send":
		if !numericID(p["sms"]) {
			return nil, errors.New("invalid SMS ID")
		}
		args = []string{"-s", p["sms"], "--send"}
	case "sms.delete":
		if !numericID(p["sms"]) {
			return nil, errors.New("invalid SMS ID")
		}
		args = append(args, "--messaging-delete-sms="+p["sms"])
	default:
		return nil, errUnknownAction
	}
	return []step{{Name: "mmcli", Args: args}}, nil
}
