package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func validRequest() Request {
	hex := func(value string) string { return strings.Repeat(value, 64) }
	return Request{
		SchemaVersion: 1, HostID: "host-1", ReleaseID: "release-1", RunID: "run-1",
		PlanDigest: hex("a"), GrantID: "grant-1", GrantDigest: hex("b"), TaskID: "package.tree",
		OperationID: "tree.apply", Phase: "apply", ConsentDigest: hex("c"), DescriptorDigest: hex("d"),
		ClosureDigest: hex("e"), Payload: Payload{SHA256: hex("f"), SizeBytes: 4096,
			RequiredSeals: []string{"seal", "shrink", "grow", "write"}},
		Nonce: "nonce_nonce_nonce_nonce_nonce_nonce_1", RequestedAt: "2026-11-08T12:01:00.000Z",
	}
}

func TestDecodeRequestStrict(t *testing.T) {
	bytes, err := json.Marshal(validRequest())
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeRequest(bytes)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.OperationID != "tree.apply" || decoded.Payload.SizeBytes != 4096 {
		t.Fatalf("unexpected decoded request: %#v", decoded)
	}
}

func TestDecodeRequestRejectsAmbiguityAndBounds(t *testing.T) {
	bytes, err := json.Marshal(validRequest())
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"duplicate top level": []byte(strings.Replace(string(bytes), `"hostId":"host-1"`, `"hostId":"host-1","hostId":"host-2"`, 1)),
		"duplicate nested":    []byte(strings.Replace(string(bytes), `"sizeBytes":4096`, `"sizeBytes":4096,"sizeBytes":8`, 1)),
		"unknown field":       []byte(strings.TrimSuffix(string(bytes), "}") + `,"argv":["/bin/sh"]}`),
		"trailing object":     append(append([]byte{}, bytes...), []byte(`{}`)...),
		"oversized":           []byte(`{"padding":"` + strings.Repeat("x", MaxRequestBytes) + `"}`),
	}
	for name, candidate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeRequest(candidate); err == nil {
				t.Fatal("expected strict request rejection")
			}
		})
	}
}

func FuzzDecodeRequest(f *testing.F) {
	valid, err := json.Marshal(validRequest())
	if err != nil {
		f.Fatal(err)
	}
	f.Add(valid)
	f.Add([]byte(`{"schemaVersion":1}`))
	f.Add([]byte(`{"payload":{"sizeBytes":1,"sizeBytes":2}}`))
	f.Fuzz(func(t *testing.T, candidate []byte) {
		if len(candidate) > MaxRequestBytes+1 {
			candidate = candidate[:MaxRequestBytes+1]
		}
		_, _ = DecodeRequest(candidate)
	})
}
