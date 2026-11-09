# Desktop Tools privileged broker transport

This package is the Linux/amd64 native transport boundary for approved Desktop Tools package operations. It does not plan work, approve plans, interpret model output, or provide a shell. The enrolled-user installer engine remains the owner of the single plan and canonical journal.

The helper exists because Node does not expose the Linux primitives required by the broker contract. It uses only the Go standard library and provides two noninteractive commands:

- `client --socket PATH` reads the strict request from inherited fd 3 and the already-open payload from fd 4, copies exact verified bytes into a sealed anonymous memfd, verifies the server is UID 0, sends one `SOCK_SEQPACKET` message with exactly one `SCM_RIGHTS` descriptor, and prints one bounded response.
- `serve` is root-only. It accepts a bounded number of operations from one enrolled UID, checks peer credentials and the sealed payload independently, and runs only the already-open root-owned Node runtime and worker script whose digests are release-pinned. The worker receives the sealed payload as fd 3 and the response socket as fd 4. No request can supply a command, path, argument, environment value, package name, or network destination.

The server socket lives in a protected root-owned per-run directory, is group-accessible only to the enrolled user's primary group, and is removed after its exact request count or any failure. The TypeScript worker remains responsible for exact grant, approval, nonce, descriptor, transaction-fence, and receipt validation.

Build the admitted helper reproducibly:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags='-buildid= -X main.version=VERSION' \
  -o desktop-tools-privileged-broker ./cmd/desktop-tools-privileged-broker
```

Run `go test ./...`, `go test -race ./...`, and `go vet ./...` on Linux. Other platforms build only the explicit unsupported executable and never emulate privileged behavior.
