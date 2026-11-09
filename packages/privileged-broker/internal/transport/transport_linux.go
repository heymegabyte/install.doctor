//go:build linux

package transport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"github.com/heymegabyte/install.doctor/packages/privileged-broker/internal/protocol"
)

const (
	memfdCloexec      = 0x0001
	memfdAllowSealing = 0x0002
	sysMemfdCreate    = 319 // Linux amd64; this helper is released only for the admitted Debian amd64 cell.
	fAddSeals         = 1033
	fGetSeals         = 1034
	fSealSeal         = 0x0001
	fSealShrink       = 0x0002
	fSealGrow         = 0x0004
	fSealWrite        = 0x0008
	requiredSeals     = fSealSeal | fSealShrink | fSealGrow | fSealWrite
	maxResponseBytes  = 64 * 1024
	prCapbsetDrop     = 24
	prSetNoNewPrivs   = 38
	prCapAmbient      = 47
	prCapAmbientClear = 4
	capNetAdmin       = 12
)

type ServerConfig struct {
	SocketPath    string
	ExpectedUID   uint32
	SocketGID     int
	RuntimePath   string
	RuntimeSHA256 string
	WorkerPath    string
	WorkerSHA256  string
	RequestCount  int
	Timeout       time.Duration
}

type workerEnvelope struct {
	SchemaVersion int             `json:"schemaVersion"`
	PeerUID       uint32          `json:"peerUid"`
	Request       json.RawMessage `json:"request"`
}

type requestRejection struct{ cause error }

func (rejection *requestRejection) Error() string { return rejection.cause.Error() }
func reject(cause error) error                    { return &requestRejection{cause: cause} }

func Serve(ctx context.Context, config ServerConfig) error {
	if config.RequestCount < 1 || config.RequestCount > 256 || config.Timeout <= 0 || config.Timeout > 30*time.Minute {
		return errors.New("server request count or timeout is outside the supported boundary")
	}
	runtime, err := openVerifiedRootFile(config.RuntimePath, config.RuntimeSHA256, true)
	if err != nil {
		return err
	}
	defer runtime.Close()
	worker, err := openVerifiedRootFile(config.WorkerPath, config.WorkerSHA256, false)
	if err != nil {
		return err
	}
	defer worker.Close()
	listener, err := listen(config.SocketPath, config.SocketGID)
	if err != nil {
		return err
	}
	defer func() {
		syscall.Close(listener)
		_ = os.Remove(config.SocketPath)
	}()
	served, rejected := 0, 0
	for served < config.RequestCount {
		if err := serveOne(ctx, listener, runtime, worker, config); err != nil {
			var denied *requestRejection
			if errors.As(err, &denied) {
				rejected++
				if rejected > 32 {
					return errors.New("broker exceeded its rejected-request boundary")
				}
				continue
			}
			return err
		}
		served++
	}
	return nil
}

func Client(socketPath string, requestBytes []byte, payloadFD int, output io.Writer) error {
	request, err := protocol.DecodeRequest(requestBytes)
	if err != nil {
		return err
	}
	sealedFD, err := createSealedPayload(payloadFD, request.Payload)
	if err != nil {
		return err
	}
	defer syscall.Close(sealedFD)
	connection, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_SEQPACKET|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("create broker socket: %w", err)
	}
	defer syscall.Close(connection)
	if err := syscall.Connect(connection, &syscall.SockaddrUnix{Name: socketPath}); err != nil {
		return fmt.Errorf("connect broker socket: %w", err)
	}
	credential, err := syscall.GetsockoptUcred(connection, syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil || credential.Uid != 0 {
		return errors.New("broker peer is not root")
	}
	written, err := syscall.SendmsgN(connection, requestBytes, syscall.UnixRights(sealedFD), nil, 0)
	if err != nil || written != len(requestBytes) {
		return errors.New("broker request packet was not sent atomically")
	}
	response := make([]byte, maxResponseBytes+1)
	n, oobn, flags, _, err := syscall.Recvmsg(connection, response, nil, 0)
	if err != nil {
		return fmt.Errorf("receive broker response: %w", err)
	}
	if n == 0 || n > maxResponseBytes || oobn != 0 || flags&(syscall.MSG_TRUNC|syscall.MSG_CTRUNC) != 0 {
		return errors.New("broker response violated packet boundaries")
	}
	_, err = output.Write(response[:n])
	return err
}

func listen(socketPath string, socketGID int) (int, error) {
	if !filepath.IsAbs(socketPath) || filepath.Clean(socketPath) != socketPath || filepath.Dir(socketPath) == socketPath {
		return -1, errors.New("broker socket path must be absolute, normalized, and non-root")
	}
	if _, err := os.Lstat(socketPath); err == nil || !errors.Is(err, os.ErrNotExist) {
		return -1, errors.New("broker socket path must be absent")
	}
	parent, err := os.Lstat(filepath.Dir(socketPath))
	if err != nil || !parent.IsDir() || parent.Mode()&os.ModeSymlink != 0 || parent.Sys().(*syscall.Stat_t).Uid != 0 || parent.Mode().Perm()&0o027 != 0 {
		return -1, errors.New("broker socket parent must be a protected root-owned directory")
	}
	fd, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_SEQPACKET|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return -1, err
	}
	if err := syscall.Bind(fd, &syscall.SockaddrUnix{Name: socketPath}); err != nil {
		syscall.Close(fd)
		return -1, err
	}
	if err := os.Chown(socketPath, 0, socketGID); err != nil {
		syscall.Close(fd)
		_ = os.Remove(socketPath)
		return -1, err
	}
	if err := os.Chmod(socketPath, 0o660); err != nil {
		syscall.Close(fd)
		_ = os.Remove(socketPath)
		return -1, err
	}
	if err := syscall.Listen(fd, 8); err != nil {
		syscall.Close(fd)
		_ = os.Remove(socketPath)
		return -1, err
	}
	return fd, nil
}

func serveOne(parent context.Context, listener int, runtime, worker *os.File, config ServerConfig) error {
	connection, _, err := syscall.Accept4(listener, syscall.SOCK_CLOEXEC)
	if err != nil {
		return err
	}
	defer syscall.Close(connection)
	credential, err := syscall.GetsockoptUcred(connection, syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil || credential.Uid != config.ExpectedUID {
		writeError(connection)
		return reject(errors.New("broker client uid differs from the enrolled uid"))
	}
	requestBytes, payloadFD, err := receiveRequest(connection)
	if err != nil {
		writeError(connection)
		return reject(err)
	}
	defer syscall.Close(payloadFD)
	request, err := protocol.DecodeRequest(requestBytes)
	if err != nil {
		writeError(connection)
		return reject(err)
	}
	if err := verifySealedPayload(payloadFD, request.Payload); err != nil {
		writeError(connection)
		return reject(err)
	}
	envelopeBytes, err := json.Marshal(workerEnvelope{SchemaVersion: 1, PeerUID: credential.Uid, Request: requestBytes})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, config.Timeout)
	defer cancel()
	payload := os.NewFile(uintptr(payloadFD), "sealed-payload")
	response := os.NewFile(uintptr(connection), "broker-response")
	if payload == nil || response == nil {
		return errors.New("failed to construct worker descriptors")
	}
	originalNamespace, err := os.Open("/proc/self/ns/net")
	if err != nil {
		return errors.New("cannot capture the original network namespace")
	}
	defer originalNamespace.Close()
	command := exec.CommandContext(ctx, "/proc/self/exe", "__worker-launch")
	command.Stdin = bytes.NewReader(envelopeBytes)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	command.Env = []string{"LANG=C", "LC_ALL=C", "PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	command.ExtraFiles = []*os.File{payload, response, runtime, worker, originalNamespace}
	command.SysProcAttr = &syscall.SysProcAttr{Cloneflags: syscall.CLONE_NEWNET, Pdeathsig: syscall.SIGKILL}
	if err := command.Run(); err != nil {
		writeError(connection)
		if ctx.Err() != nil {
			return errors.New("privileged worker exceeded its deadline")
		}
		return fmt.Errorf("privileged worker failed: %w", err)
	}
	return nil
}

// LaunchWorker is reachable only through the fixed hidden argv emitted by Serve.
// Descriptors are fixed: payload=3, response=4, verified runtime=5,
// verified worker script=6, original netns=7.
func LaunchWorker() error {
	if os.Geteuid() != 0 {
		return errors.New("internal worker launcher requires root")
	}
	var original, current syscall.Stat_t
	if err := syscall.Fstat(7, &original); err != nil {
		return errors.New("original network namespace descriptor is unavailable")
	}
	currentFD, err := syscall.Open("/proc/self/ns/net", syscall.O_RDONLY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("current network namespace is unavailable")
	}
	defer syscall.Close(currentFD)
	if err := syscall.Fstat(currentFD, &current); err != nil || (original.Dev == current.Dev && original.Ino == current.Ino) {
		return errors.New("worker did not enter a distinct network namespace")
	}
	if err := dropNetworkAdministrationAuthority(); err != nil {
		return err
	}
	for _, fd := range []int{5, 7} {
		if _, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), syscall.F_SETFD, syscall.FD_CLOEXEC); errno != 0 {
			return errors.New("cannot close worker bootstrap authority on exec")
		}
	}
	return syscall.Exec("/proc/self/fd/5", []string{"desktop-tools-privileged-node", "/proc/self/fd/6"}, []string{
		"LANG=C", "LC_ALL=C", "PATH=/usr/sbin:/usr/bin:/sbin:/bin",
	})
}

func dropNetworkAdministrationAuthority() error {
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prCapbsetDrop, capNetAdmin, 0); errno != 0 {
		return errors.New("cannot drop CAP_NET_ADMIN from the capability bounding set")
	}
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, prCapAmbient, prCapAmbientClear, 0, 0, 0, 0); errno != 0 && errno != syscall.EINVAL {
		return errors.New("cannot clear ambient capabilities")
	}
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prSetNoNewPrivs, 1, 0); errno != 0 {
		return errors.New("cannot lock no-new-privileges")
	}
	return nil
}

func receiveRequest(connection int) ([]byte, int, error) {
	packet := make([]byte, protocol.MaxRequestBytes+1)
	oob := make([]byte, syscall.CmsgSpace(4)*2)
	n, oobn, flags, _, err := syscall.Recvmsg(connection, packet, oob, syscall.MSG_CMSG_CLOEXEC)
	if err != nil {
		return nil, -1, err
	}
	messages, parseError := syscall.ParseSocketControlMessage(oob[:oobn])
	if n == 0 || n > protocol.MaxRequestBytes || flags&(syscall.MSG_TRUNC|syscall.MSG_CTRUNC) != 0 {
		closeControlDescriptors(messages)
		return nil, -1, errors.New("broker request violated packet boundaries")
	}
	if parseError != nil || len(messages) != 1 || messages[0].Header.Level != syscall.SOL_SOCKET || messages[0].Header.Type != syscall.SCM_RIGHTS {
		closeControlDescriptors(messages)
		return nil, -1, errors.New("broker request must carry exactly one rights message")
	}
	fds, err := syscall.ParseUnixRights(&messages[0])
	if err != nil || len(fds) != 1 {
		for _, fd := range fds {
			syscall.Close(fd)
		}
		return nil, -1, errors.New("broker request must carry exactly one descriptor")
	}
	return append([]byte(nil), packet[:n]...), fds[0], nil
}

func closeControlDescriptors(messages []syscall.SocketControlMessage) {
	for index := range messages {
		if messages[index].Header.Level != syscall.SOL_SOCKET || messages[index].Header.Type != syscall.SCM_RIGHTS {
			continue
		}
		fds, err := syscall.ParseUnixRights(&messages[index])
		if err == nil {
			for _, fd := range fds {
				syscall.Close(fd)
			}
		}
	}
}

func createSealedPayload(sourceFD int, authority protocol.Payload) (int, error) {
	name, err := syscall.BytePtrFromString("desktop-tools-payload")
	if err != nil {
		return -1, err
	}
	fdValue, _, errno := syscall.Syscall(sysMemfdCreate, uintptr(unsafe.Pointer(name)), memfdCloexec|memfdAllowSealing, 0)
	if errno != 0 {
		return -1, errno
	}
	fd := int(fdValue)
	if err := copyExactPayload(sourceFD, fd, authority); err != nil {
		syscall.Close(fd)
		return -1, err
	}
	if _, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), fAddSeals, requiredSeals); errno != 0 {
		syscall.Close(fd)
		return -1, errno
	}
	return fd, nil
}

func copyExactPayload(sourceFD, destinationFD int, authority protocol.Payload) error {
	hash := sha256.New()
	buffer := make([]byte, 64*1024)
	var offset int64
	for offset < authority.SizeBytes {
		want := int64(len(buffer))
		if authority.SizeBytes-offset < want {
			want = authority.SizeBytes - offset
		}
		n, err := syscall.Pread(sourceFD, buffer[:want], offset)
		if err != nil || n == 0 {
			return errors.New("payload ended before its declared size")
		}
		if _, err := hash.Write(buffer[:n]); err != nil {
			return err
		}
		written, err := syscall.Pwrite(destinationFD, buffer[:n], offset)
		if err != nil || written != n {
			return errors.New("payload memfd write was incomplete")
		}
		offset += int64(n)
	}
	if n, _ := syscall.Pread(sourceFD, buffer[:1], offset); n != 0 {
		return errors.New("payload exceeds its declared size")
	}
	if hex.EncodeToString(hash.Sum(nil)) != authority.SHA256 {
		return errors.New("payload digest differs from request authority")
	}
	return nil
}

func verifySealedPayload(fd int, authority protocol.Payload) error {
	var stat syscall.Stat_t
	if err := syscall.Fstat(fd, &stat); err != nil || stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Nlink != 0 || stat.Size != authority.SizeBytes {
		return errors.New("payload is not the exact anonymous regular file")
	}
	seals, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), fGetSeals, 0)
	if errno != 0 || int(seals)&requiredSeals != requiredSeals {
		return errors.New("payload memfd is not fully sealed")
	}
	hash := sha256.New()
	buffer := make([]byte, 64*1024)
	var offset int64
	for offset < authority.SizeBytes {
		n, err := syscall.Pread(fd, buffer, offset)
		if err != nil || n == 0 {
			return errors.New("sealed payload is truncated")
		}
		if offset+int64(n) > authority.SizeBytes {
			return errors.New("sealed payload exceeds its declared size")
		}
		hash.Write(buffer[:n])
		offset += int64(n)
	}
	if hex.EncodeToString(hash.Sum(nil)) != authority.SHA256 {
		return errors.New("sealed payload digest differs from request authority")
	}
	return nil
}

func openVerifiedRootFile(path, expectedSHA256 string, executable bool) (*os.File, error) {
	if !filepath.IsAbs(path) || len(expectedSHA256) != 64 {
		return nil, errors.New("worker authority is malformed")
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "privileged-broker-authority")
	var stat syscall.Stat_t
	if err := syscall.Fstat(fd, &stat); err != nil || stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Nlink != 1 || stat.Uid != 0 ||
		stat.Mode&0o022 != 0 || executable && stat.Mode&0o111 == 0 {
		file.Close()
		return nil, errors.New("broker runtime authority is not an exact protected root-owned file")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil || hex.EncodeToString(hash.Sum(nil)) != expectedSHA256 {
		file.Close()
		return nil, errors.New("broker runtime authority differs from its signed digest")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func writeError(connection int) {
	_, _ = syscall.Write(connection, []byte(`{"schemaVersion":1,"status":"failed","error":"broker request rejected"}`))
}
