package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"
)

const (
	speedtestURL = "https://speed.cloudflare.com"
	downloadSize = 25 << 20
	uploadSize   = 10 << 20
)

type speedtestResult struct {
	Time         time.Time `json:"time"`
	Provider     string    `json:"provider"`
	LatencyMS    float64   `json:"latencyMS"`
	DownloadMbps float64   `json:"downloadMbps"`
	UploadMbps   float64   `json:"uploadMbps"`
	Download     int64     `json:"downloadBytes"`
	Upload       int64     `json:"uploadBytes"`
}

type countedReader struct {
	reader io.Reader
	bytes  atomic.Int64
}

func (r *countedReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.bytes.Add(int64(n))
	return n, err
}

func (a *app) speedtestStatus(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	var current *job
	for _, j := range a.jobs {
		if j.Label == "speedtest.run" && (current == nil || j.Started.After(current.Started)) {
			current = j
		}
	}
	status, id, message := "idle", "", ""
	if current != nil {
		status, id = current.Status, current.ID
		if status == "failed" || status == "cancelled" {
			message = "The latest speed test did not complete. Device output is shown below; the last successful result is preserved."
		}
	}
	result := a.speedtest
	a.mu.Unlock()
	respond(w, map[string]any{"result": result, "status": status, "job": id, "error": message})
}

func (a *app) runSpeedtest(ctx context.Context, out io.Writer) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil || runtime.GOOS == "linux" && len(roots.Subjects()) == 0 {
		return errors.New("trusted HTTPS CA certificates are missing: install Debian's ca-certificates package in Packages (or run sudo apt-get install ca-certificates), then restart openstick-webui; do not disable TLS verification")
	}
	// A dedicated transport avoids proxy environment variables, redirects to
	// arbitrary destinations, compression, or sharing connections with other jobs.
	transport := &http.Transport{ForceAttemptHTTP2: true, TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second, DisableCompression: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("speed test endpoint redirected unexpectedly")
	}}
	result, err := measureSpeedtest(ctx, client, out)
	if err != nil {
		return explainSpeedtestTLS(err)
	}
	a.mu.Lock()
	a.speedtest = result
	a.mu.Unlock()
	return nil
}

func explainSpeedtestTLS(err error) error {
	var authority x509.UnknownAuthorityError
	var roots x509.SystemRootsError
	if errors.As(err, &authority) || errors.As(err, &roots) {
		return fmt.Errorf("cannot verify the speed test provider: install/update Debian's ca-certificates package and restart openstick-webui (do not trust the console's self-signed certificate for internet servers): %w", err)
	}
	return err
}

func speedtestRequest(ctx context.Context, client *http.Client, method, path string, body io.Reader, size int64) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, speedtestURL+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Cache-Control", "no-store")
	request.Header.Set("User-Agent", "OpenStick-Console/"+version)
	if body != nil {
		request.ContentLength = size
		request.Header.Set("Content-Type", "application/octet-stream")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("speed test provider returned HTTP %d", response.StatusCode)
	}
	return response, nil
}

func measureSpeedtest(ctx context.Context, client *http.Client, out io.Writer) (*speedtestResult, error) {
	result := &speedtestResult{Provider: "Cloudflare"}
	fmt.Fprintln(out, "Testing the stick's current default internet route against speed.cloudflare.com.")
	fmt.Fprintln(out, "Single-connection estimate; transfers up to 25 MiB down + 10 MiB up, plus protocol overhead.")
	fmt.Fprintln(out, "Measuring HTTPS latency (3 requests)…")
	for range 3 {
		start := time.Now()
		response, err := speedtestRequest(ctx, client, http.MethodGet, "/__down?bytes=0", nil, 0)
		if err != nil {
			return nil, fmt.Errorf("latency: %w", err)
		}
		n, err := io.Copy(io.Discard, io.LimitReader(response.Body, 1025))
		response.Body.Close()
		if err != nil || n > 1024 {
			return nil, errors.New("latency: unexpected or incomplete provider response")
		}
		result.LatencyMS += float64(time.Since(start)) / float64(time.Millisecond) / 3
	}
	fmt.Fprintf(out, "Latency: %.1f ms (includes connection setup on the first request)\nDownloading…\n", result.LatencyMS)
	start := time.Now()
	response, err := speedtestRequest(ctx, client, http.MethodGet, "/__down?bytes="+strconv.Itoa(downloadSize), nil, 0)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}
	result.Download, err = io.Copy(io.Discard, io.LimitReader(response.Body, downloadSize+1))
	response.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}
	if result.Download != downloadSize {
		return nil, errors.New("download: provider returned an unexpected number of bytes")
	}
	result.DownloadMbps = float64(result.Download) * 8 / time.Since(start).Seconds() / 1e6
	fmt.Fprintf(out, "Download: %.2f Mbps\nUploading…\n", result.DownloadMbps)
	start = time.Now()
	// Stream incompressible data instead of allocating a large upload buffer.
	upload := &countedReader{reader: io.LimitReader(rand.Reader, uploadSize)}
	response, err = speedtestRequest(ctx, client, http.MethodPost, "/__up", upload, uploadSize)
	if err != nil {
		return nil, fmt.Errorf("upload: %w", err)
	}
	n, err := io.Copy(io.Discard, io.LimitReader(response.Body, 65537))
	response.Body.Close()
	if err != nil || n > 65536 {
		return nil, errors.New("upload: unexpected or incomplete provider response")
	}
	result.Upload = upload.bytes.Load()
	if result.Upload != uploadSize {
		return nil, errors.New("upload: provider responded before the upload completed")
	}
	result.UploadMbps = float64(result.Upload) * 8 / time.Since(start).Seconds() / 1e6
	result.Time = time.Now()
	fmt.Fprintf(out, "Upload: %.2f Mbps\nComplete. Results are estimates, not a guarantee of carrier line speed.\n", result.UploadMbps)
	return result, nil
}
