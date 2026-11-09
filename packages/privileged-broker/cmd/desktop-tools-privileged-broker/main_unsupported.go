//go:build !linux

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "desktop-tools-privileged-broker: unsupported platform; Linux is required")
	os.Exit(20)
}
