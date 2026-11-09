//go:build linux

package transport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/heymegabyte/install.doctor/packages/privileged-broker/internal/protocol"
)

// Serve deliberately re-executes /proc/self/exe with a fixed hidden command so
// no caller can select a worker executable. Under `go test`, /proc/self/exe is
// the generated test binary rather than cmd/desktop-tools-privileged-broker;
// mirror the production main dispatch before the test runner parses argv.
func TestMain(m *testing.M) {
	if len(os.Args) == 2 && os.Args[1] == "__worker-launch" {
		if err := LaunchWorker(); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func payloadAuthority(value []byte) protocol.Payload {
	digest := sha256.Sum256(value)
	return protocol.Payload{
		SHA256: hex.EncodeToString(digest[:]), SizeBytes: int64(len(value)),
		RequiredSeals: []string{"seal", "shrink", "grow", "write"},
	}
}

func requestBytes(value []byte) []byte {
	hexDigest := func(value string) string { return strings.Repeat(value, 64) }
	request := protocol.Request{
		SchemaVersion: 1, HostID: "host-1", ReleaseID: "release-1", RunID: "run-1",
		PlanDigest: hexDigest("a"), GrantID: "grant-1", GrantDigest: hexDigest("b"), TaskID: "package.tree",
		OperationID: "tree.apply", Phase: "apply", ConsentDigest: hexDigest("c"), DescriptorDigest: hexDigest("d"),
		ClosureDigest: hexDigest("e"), Payload: payloadAuthority(value),
		Nonce: "nonce_nonce_nonce_nonce_nonce_nonce_1", RequestedAt: "2026-11-08T12:01:00.000Z",
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		panic(err)
	}
	return encoded
}

func TestSealedPayloadCannotBeChangedAndRoundTripsOneRightsMessage(t *testing.T) {
	value := []byte("exact signed payload")
	source, err := os.CreateTemp(t.TempDir(), "payload")
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if _, err := source.Write(value); err != nil {
		t.Fatal(err)
	}
	sealed, err := createSealedPayload(int(source.Fd()), payloadAuthority(value))
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(sealed)
	if err := verifySealedPayload(sealed, payloadAuthority(value)); err != nil {
		t.Fatal(err)
	}
	if _, err := syscall.Pwrite(sealed, []byte("x"), 0); err == nil {
		t.Fatal("sealed payload accepted mutation")
	}
	pair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_SEQPACKET|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(pair[0])
	defer syscall.Close(pair[1])
	request := requestBytes(value)
	if n, err := syscall.SendmsgN(pair[0], request, syscall.UnixRights(sealed), nil, 0); err != nil || n != len(request) {
		t.Fatalf("sendmsg: n=%d err=%v", n, err)
	}
	received, receivedFD, err := receiveRequest(pair[1])
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(receivedFD)
	if !bytes.Equal(received, request) {
		t.Fatal("packet bytes changed")
	}
	if err := verifySealedPayload(receivedFD, payloadAuthority(value)); err != nil {
		t.Fatal(err)
	}
}

func TestReceiveRejectsMultipleDescriptors(t *testing.T) {
	pair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_SEQPACKET|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(pair[0])
	defer syscall.Close(pair[1])
	first, _ := os.CreateTemp(t.TempDir(), "first")
	second, _ := os.CreateTemp(t.TempDir(), "second")
	defer first.Close()
	defer second.Close()
	request := requestBytes([]byte("x"))
	if _, err := syscall.SendmsgN(pair[0], request, syscall.UnixRights(int(first.Fd()), int(second.Fd())), nil, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := receiveRequest(pair[1]); err == nil {
		t.Fatal("multiple descriptors were accepted")
	}
}

func TestRootServerRunsOnlyVerifiedWorkerAndCancelsBelowRequestLimit(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root-only broker integration")
	}
	directory := t.TempDir()
	if err := os.Chmod(directory, 0o750); err != nil {
		t.Fatal(err)
	}
	workerPath := filepath.Join(directory, "worker")
	workerBytes := []byte("printf '{\"schemaVersion\":1,\"status\":\"applied\"}' >&4\n")
	if err := os.WriteFile(workerPath, workerBytes, 0o700); err != nil {
		t.Fatal(err)
	}
	workerDigest := sha256.Sum256(workerBytes)
	runtimeSource, err := filepath.EvalSymlinks("/bin/sh")
	if err != nil {
		t.Fatal(err)
	}
	runtimeBytes, err := os.ReadFile(runtimeSource)
	if err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(directory, "runtime")
	if err := os.WriteFile(runtimePath, runtimeBytes, 0o700); err != nil {
		t.Fatal(err)
	}
	runtimeDigest := sha256.Sum256(runtimeBytes)
	socketPath := filepath.Join(directory, "broker.sock")
	serverResult := make(chan error, 1)
	serverContext, cancelServer := context.WithCancel(context.Background())
	defer cancelServer()
	go func() {
		serverResult <- Serve(serverContext, ServerConfig{
			SocketPath: socketPath, ExpectedUID: uint32(os.Getuid()), SocketGID: os.Getgid(),
			RuntimePath: runtimePath, RuntimeSHA256: hex.EncodeToString(runtimeDigest[:]),
			WorkerPath: workerPath, WorkerSHA256: hex.EncodeToString(workerDigest[:]),
			RequestLimit: 3, Timeout: 5 * time.Second,
		})
	}()
	for attempt := 0; attempt < 100; attempt++ {
		if _, err := os.Lstat(socketPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// An enrolled-UID client without the exact request descriptor is denied but
	// cannot consume the sole authorized operation or terminate the broker.
	malformed, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_SEQPACKET|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Connect(malformed, &syscall.SockaddrUnix{Name: socketPath}); err != nil {
		t.Fatal(err)
	}
	if _, err := syscall.Write(malformed, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	denial := make([]byte, 256)
	if count, err := syscall.Read(malformed, denial); err != nil || !bytes.Contains(denial[:count], []byte(`"status":"failed"`)) {
		t.Fatalf("malformed request was not explicitly denied: count=%d err=%v", count, err)
	}
	syscall.Close(malformed)
	value := []byte("exact signed payload")
	source, err := os.CreateTemp(directory, "payload")
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if _, err := source.Write(value); err != nil {
		t.Fatal(err)
	}
	var response bytes.Buffer
	if err := Client(socketPath, requestBytes(value), int(source.Fd()), &response); err != nil {
		t.Fatal(err)
	}
	if response.String() != `{"schemaVersion":1,"status":"applied"}` {
		t.Fatalf("unexpected response: %s", response.String())
	}
	cancelServer()
	if err := <-serverResult; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(socketPath); !os.IsNotExist(err) {
		t.Fatal("terminal broker socket was not removed")
	}
	if _, err := os.Lstat(socketPath + ".starting"); !os.IsNotExist(err) {
		t.Fatal("terminal broker staging socket was not removed")
	}
}
