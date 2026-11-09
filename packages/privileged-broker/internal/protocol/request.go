package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const MaxRequestBytes = 64 * 1024

type Payload struct {
	SHA256        string   `json:"sha256"`
	SizeBytes     int64    `json:"sizeBytes"`
	RequiredSeals []string `json:"requiredSeals"`
}

type Request struct {
	SchemaVersion    int     `json:"schemaVersion"`
	HostID           string  `json:"hostId"`
	ReleaseID        string  `json:"releaseId"`
	RunID            string  `json:"runId"`
	PlanDigest       string  `json:"planDigest"`
	GrantID          string  `json:"grantId"`
	GrantDigest      string  `json:"grantDigest"`
	TaskID           string  `json:"taskId"`
	OperationID      string  `json:"operationId"`
	Phase            string  `json:"phase"`
	ConsentDigest    string  `json:"consentDigest"`
	DescriptorDigest string  `json:"descriptorDigest"`
	ClosureDigest    string  `json:"closureDigest"`
	Payload          Payload `json:"payload"`
	Nonce            string  `json:"nonce"`
	RequestedAt      string  `json:"requestedAt"`
}

type jsonFrame struct {
	object    bool
	expectKey bool
	keys      map[string]struct{}
}

func DecodeRequest(data []byte) (Request, error) {
	var request Request
	if len(data) == 0 || len(data) > MaxRequestBytes {
		return request, errors.New("request is empty or exceeds the 64 KiB boundary")
	}
	if err := rejectDuplicateKeys(data); err != nil {
		return request, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("invalid strict request: %w", err)
	}
	if err := requireEOF(decoder); err != nil {
		return request, err
	}
	if request.SchemaVersion != 1 || request.Payload.SizeBytes <= 0 || request.Payload.SizeBytes > 1<<30 {
		return request, errors.New("request schema or payload bound is unsupported")
	}
	if len(request.Payload.SHA256) != 64 || request.Payload.RequiredSeals == nil ||
		!equalStrings(request.Payload.RequiredSeals, []string{"seal", "shrink", "grow", "write"}) {
		return request, errors.New("request payload authority is malformed")
	}
	return request, nil
}

func requireEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request contains trailing JSON")
		}
		return fmt.Errorf("invalid trailing request data: %w", err)
	}
	return nil
}

func rejectDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	stack := []jsonFrame{}
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("invalid JSON token stream: %w", err)
		}
		switch value := token.(type) {
		case json.Delim:
			switch value {
			case '{':
				stack = append(stack, jsonFrame{object: true, expectKey: true, keys: map[string]struct{}{}})
			case '[':
				stack = append(stack, jsonFrame{})
			case '}', ']':
				if len(stack) == 0 {
					return errors.New("unbalanced JSON delimiter")
				}
				stack = stack[:len(stack)-1]
				markValueConsumed(stack)
			}
		case string:
			if len(stack) > 0 && stack[len(stack)-1].object && stack[len(stack)-1].expectKey {
				current := &stack[len(stack)-1]
				if _, exists := current.keys[value]; exists {
					return fmt.Errorf("duplicate JSON key: %s", value)
				}
				current.keys[value] = struct{}{}
				current.expectKey = false
			} else {
				markValueConsumed(stack)
			}
		default:
			markValueConsumed(stack)
		}
	}
}

func markValueConsumed(stack []jsonFrame) {
	if len(stack) > 0 && stack[len(stack)-1].object && !stack[len(stack)-1].expectKey {
		stack[len(stack)-1].expectKey = true
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
