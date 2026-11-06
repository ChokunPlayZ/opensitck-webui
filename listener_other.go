//go:build !linux

package main

import (
	"errors"
	"syscall"
)

func bindManagementDevice(_ syscall.RawConn, _ string) error {
	return errors.New("management interface binding requires Linux")
}
