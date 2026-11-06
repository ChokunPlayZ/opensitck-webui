package main

import (
	"context"
	"crypto/x509"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestSpeedtestMeasurements(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Scheme != "https" || r.URL.Host != "speed.cloudflare.com" {
			t.Fatal("unexpected speedtest destination")
		}
		var body io.Reader = strings.NewReader("")
		if r.URL.Path == "/__down" && r.URL.Query().Get("bytes") != "0" {
			body = io.LimitReader(zeroReader{}, downloadSize)
		} else if r.URL.Path == "/__up" {
			if r.Method != "POST" || r.ContentLength != uploadSize {
				t.Fatal("upload is not fixed size")
			}
			n, err := io.Copy(io.Discard, r.Body)
			r.Body.Close()
			if err != nil || n != uploadSize {
				t.Fatalf("upload bytes=%d err=%v", n, err)
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(body), Header: http.Header{}}, nil
	})}
	result, err := measureSpeedtest(context.Background(), client, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 5 || result.Download != downloadSize || result.Upload != uploadSize || result.DownloadMbps <= 0 || result.UploadMbps <= 0 || result.LatencyMS <= 0 || result.Time.IsZero() {
		t.Fatalf("incorrect measurements: %+v, calls=%d", result, calls)
	}
}

func TestSpeedtestFailure(t *testing.T) {
	for _, failure := range []string{"network", "status", "truncated", "early upload"} {
		t.Run(failure, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if failure == "network" {
					return nil, errors.New("offline")
				}
				status := 200
				if failure == "status" {
					status = 503
				}
				var body io.Reader = strings.NewReader("")
				if failure == "early upload" && r.URL.Query().Get("bytes") != "0" && r.Method == "GET" {
					body = io.LimitReader(zeroReader{}, downloadSize)
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(body)}, nil
			})}
			if result, err := measureSpeedtest(context.Background(), client, io.Discard); err == nil || result != nil {
				t.Fatal("published successful result after provider failure")
			}
		})
	}
}

func TestSpeedtestRequiresConfirmationAndAuthentication(t *testing.T) {
	a := testApp(t)
	handler := a.secure(a.mux)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/speedtest", nil))
	if w.Code != 401 {
		t.Fatal("speed test status exposed without authentication")
	}
	w = httptest.NewRecorder()
	a.action(w, httptest.NewRequest("POST", "/api/action", strings.NewReader(`{"action":"speedtest.run","params":{}}`)))
	if w.Code != 400 {
		t.Fatal("speed test started without explicit data-usage confirmation")
	}
}

func TestSpeedtestSingleJob(t *testing.T) {
	a := testApp(t)
	started, finish := make(chan struct{}), make(chan struct{})
	id, err := a.startJob("speedtest.run", []step{{Name: "test", Run: func(context.Context, io.Writer) error {
		close(started)
		<-finish
		return nil
	}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { close(finish); waitJob(t, a, id) }()
	<-started
	if _, err := a.startJob("speedtest.run", nil); err == nil {
		t.Fatal("allowed concurrent speed tests")
	}
}

func TestSpeedtestTrustErrorsHaveRecoveryAdvice(t *testing.T) {
	for _, err := range []error{x509.UnknownAuthorityError{}, x509.SystemRootsError{Err: errors.New("no roots")}} {
		explained := explainSpeedtestTLS(err)
		if !errors.Is(explained, err) || !strings.Contains(explained.Error(), "ca-certificates") || !strings.Contains(explained.Error(), "restart") {
			t.Fatal("TLS trust error lacks actionable recovery advice:", explained)
		}
	}
	offline := errors.New("offline")
	if explainSpeedtestTLS(offline) != offline {
		t.Fatal("non-TLS error changed")
	}
}
