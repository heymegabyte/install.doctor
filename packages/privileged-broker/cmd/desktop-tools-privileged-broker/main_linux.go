//go:build linux

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"

	"github.com/heymegabyte/install.doctor/packages/privileged-broker/internal/protocol"
	"github.com/heymegabyte/install.doctor/packages/privileged-broker/internal/transport"
)

var version = "development"

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "desktop-tools-privileged-broker: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("expected client, serve, or version")
	}
	switch args[0] {
	case "__worker-launch":
		if len(args) != 1 {
			return errors.New("internal worker launcher accepts no arguments")
		}
		return transport.LaunchWorker()
	case "help", "--help", "-h":
		_, err := fmt.Fprintln(stdout, "usage: desktop-tools-privileged-broker <client|serve|version> [flags]\n\nclient reads request fd 3 and payload fd 4; serve is a bounded root-only transport")
		return err
	case "version", "--version":
		_, err := fmt.Fprintln(stdout, version)
		return err
	case "client":
		flags := flag.NewFlagSet("client", flag.ContinueOnError)
		flags.SetOutput(stderr)
		socket := flags.String("socket", "", "absolute root-broker socket path")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 || *socket == "" {
			return errors.New("client requires exactly --socket")
		}
		requestFile := os.NewFile(3, "broker-request")
		if requestFile == nil {
			return errors.New("client requires request JSON on inherited fd 3")
		}
		requestBytes, err := io.ReadAll(io.LimitReader(requestFile, protocol.MaxRequestBytes+1))
		if err != nil {
			return err
		}
		return transport.Client(*socket, requestBytes, 4, stdout)
	case "serve":
		if os.Geteuid() != 0 {
			return errors.New("serve requires root authority")
		}
		flags := flag.NewFlagSet("serve", flag.ContinueOnError)
		flags.SetOutput(stderr)
		socket := flags.String("socket", "", "absolute per-run socket path")
		uidText := flags.String("uid", "", "enrolled user uid")
		gid := flags.Int("gid", -1, "enrolled user primary gid")
		runtime := flags.String("runtime", "", "absolute signed Node runtime path")
		runtimeSHA256 := flags.String("runtime-sha256", "", "signed Node runtime SHA-256")
		worker := flags.String("worker", "", "absolute signed worker path")
		workerSHA256 := flags.String("worker-sha256", "", "signed worker SHA-256")
		requests := flags.Int("requests", 0, "exact operation request count")
		timeout := flags.Duration("timeout", 2*time.Minute, "per-operation deadline")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		uid, err := strconv.ParseUint(*uidText, 10, 32)
		if err != nil || *gid < 0 || flags.NArg() != 0 {
			return errors.New("serve requires exact uid, gid, and no positional arguments")
		}
		return transport.Serve(context.Background(), transport.ServerConfig{
			SocketPath: *socket, ExpectedUID: uint32(uid), SocketGID: *gid,
			RuntimePath: *runtime, RuntimeSHA256: *runtimeSHA256,
			WorkerPath: *worker, WorkerSHA256: *workerSHA256,
			RequestCount: *requests, Timeout: *timeout,
		})
	default:
		return fmt.Errorf("unknown command: %s", args[0])
	}
}
