package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const deviceSocket = "/run/openstick-device/control.sock"

type batteryInfo struct {
	Available              bool     `json:"available"`
	Name                   string   `json:"name"`
	Voltage                *float64 `json:"voltage_v"`
	Health                 string   `json:"health"`
	ReportedStatus         string   `json:"reported_status"`
	UncalibratedCapacity   *int     `json:"uncalibrated_capacity_percent"`
	DesignCapacity         *float64 `json:"design_capacity_mah"`
	DesignEnergy           *float64 `json:"design_energy_wh"`
	DesignMaxVoltage       *float64 `json:"design_max_voltage_v"`
	ChargingVerified       bool     `json:"charging_verified"`
	ChargeControlAvailable bool     `json:"charge_control_available"`
}

// Deliberately read-only. BMS status without a charger supplier is not proof of
// current direction; the inherited OCV capacity curve is not calibrated either.
func batteryStatus(directory string) batteryInfo {
	result := batteryInfo{Name: "pm8916-bms-vm"}
	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		return result
	}
	result.Available = true
	read := func(name string) string {
		data, _ := os.ReadFile(filepath.Join(directory, name))
		return strings.TrimSpace(string(data))
	}
	number := func(name string, scale float64) *float64 {
		value, err := strconv.ParseInt(read(name), 10, 64)
		if err != nil || value <= 0 {
			return nil
		}
		converted := float64(value) / scale
		return &converted
	}
	result.Voltage = number("voltage_now", 1e6)
	result.DesignCapacity = number("charge_full_design", 1e3)
	result.DesignEnergy = number("energy_full_design", 1e6)
	result.DesignMaxVoltage = number("voltage_max_design", 1e6)
	result.Health = read("health")
	result.ReportedStatus = read("status")
	if value, err := strconv.Atoi(read("capacity")); err == nil && value >= 0 && value <= 100 {
		result.UncalibratedCapacity = &value
	}
	return result
}

type deviceReply struct {
	OK    bool           `json:"ok"`
	State map[string]any `json:"state"`
	Error string         `json:"error"`
}

func deviceRequestAt(ctx context.Context, path string, request map[string]any) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	connection, err := (&net.Dialer{}).DialContext(ctx, "unix", path)
	if err != nil {
		return nil, fmt.Errorf("independent device daemon unavailable: %w", err)
	}
	defer connection.Close()
	deadline, _ := ctx.Deadline()
	connection.SetDeadline(deadline)
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return nil, err
	}
	var reply deviceReply
	if err := json.NewDecoder(io.LimitReader(connection, 64<<10)).Decode(&reply); err != nil {
		return nil, fmt.Errorf("device daemon response: %w", err)
	}
	if !reply.OK {
		return nil, fmt.Errorf("device daemon: %s", reply.Error)
	}
	if reply.State == nil {
		return nil, errors.New("device daemon returned no status")
	}
	return reply.State, nil
}

func (a *app) hardware(w http.ResponseWriter, r *http.Request) {
	state, err := deviceRequestAt(r.Context(), deviceSocket, map[string]any{"op": "status"})
	respond(w, map[string]any{
		"battery": batteryStatus("/sys/class/power_supply/pm8916-bms-vm"),
		"device":  map[string]any{"available": err == nil, "state": state, "error": errorString(err)},
	})
}

func hardwareRequest(request actionRequest) (map[string]any, error) {
	p := request.Params
	switch request.Action {
	case "hardware.screen":
		if len(p) != 1 || !choice(p["operation"], "wake", "sleep", "toggle", "next_page", "previous_page") {
			return nil, errors.New("select a supported display operation")
		}
		return map[string]any{"op": "display." + p["operation"]}, nil
	case "hardware.configure":
		if len(p) != 4 {
			return nil, errors.New("all four device settings are required")
		}
		config := map[string]any{}
		for key, bounds := range map[string][2]int{"screen_sleep_seconds": {0, 86400}, "double_click_ms": {200, 800}} {
			value, err := strconv.Atoi(p[key])
			if err != nil || value < bounds[0] || value > bounds[1] {
				return nil, fmt.Errorf("%s must be an integer between %d and %d", key, bounds[0], bounds[1])
			}
			config[key] = value
		}
		for _, key := range []string{"single_click", "double_click"} {
			if !choice(p[key], "display.toggle", "display.wake", "display.sleep", "display.next_page", "display.previous_page", "none", "hook") {
				return nil, fmt.Errorf("unsupported %s macro", key)
			}
			config[key] = p[key]
		}
		return map[string]any{"op": "configure", "config": config}, nil
	default:
		return nil, errUnknownAction
	}
}

func hardwareAction(request actionRequest) ([]step, error) {
	message, err := hardwareRequest(request)
	if err != nil {
		return nil, err
	}
	return []step{{Name: "Independent screen/button daemon", Run: func(ctx context.Context, out io.Writer) error {
		state, err := deviceRequestAt(ctx, deviceSocket, message)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(state)
	}}}, nil
}
