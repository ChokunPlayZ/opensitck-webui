package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSelfSignedTLSIdentity(t *testing.T) {
	state := t.TempDir()
	certPath, keyPath, err := prepareTLS(state, "", "")
	if err != nil {
		t.Fatal(err)
	}
	initial, _ := os.ReadFile(certPath)
	key, _ := os.ReadFile(keyPath)
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"localhost", "openstick.local", "127.0.0.1", "::1", "192.168.5.1", "192.168.4.1", "192.168.68.1"} {
		if err := cert.VerifyHostname(host); err != nil {
			t.Errorf("missing certificate SAN for %s: %v", host, err)
		}
	}
	if cert.NotBefore.After(time.Now()) || time.Until(cert.NotAfter) < 365*24*time.Hour {
		t.Fatal("certificate validity is incorrect")
	}
	if err := cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature); err != nil {
		t.Fatal("certificate is not self-signed:", err)
	}
	for _, path := range []string{certPath, keyPath} {
		info, _ := os.Stat(path)
		if info.Mode().Perm() != 0600 {
			t.Fatalf("TLS identity has unsafe permissions: %s", path)
		}
	}
	if _, _, err := prepareTLS(state, "", ""); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(certPath)
	afterKey, _ := os.ReadFile(keyPath)
	if !bytes.Equal(initial, after) || !bytes.Equal(key, afterKey) {
		t.Fatal("TLS identity changed on restart")
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "secure") }))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(cert)
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal("HTTPS handshake failed:", err)
	}
	defer response.Body.Close()
	if response.TLS == nil || len(response.TLS.VerifiedChains) == 0 {
		t.Fatal("self-signed identity could not be explicitly trusted")
	}
	if _, _, err := prepareTLS(state, certPath, keyPath); err != nil {
		t.Fatal("custom TLS identity rejected:", err)
	}
}

func TestTLSRejectsPartialOrCorruptIdentity(t *testing.T) {
	state := t.TempDir()
	if _, _, err := prepareTLS(state, "cert.pem", ""); err == nil {
		t.Fatal("accepted certificate without private key")
	}
	if _, _, err := prepareTLS(state, "", "key.pem"); err == nil {
		t.Fatal("accepted private key without certificate")
	}
	cert, _, err := prepareTLS(state, "", "")
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(cert, []byte("corrupt"), 0600)
	if _, _, err := prepareTLS(state, "", ""); err == nil {
		t.Fatal("silently overwrote corrupt saved TLS identity")
	}
}

func TestHTTPRedirect(t *testing.T) {
	for _, test := range []struct{ listen, from, to string }{
		{":443", "http://192.168.5.1/api/session?x=1", "https://192.168.5.1/api/session?x=1"},
		{":443", "http://openstick.local:80/", "https://openstick.local/"},
		{":443", "http://[::1]:80/a%2Fb", "https://[::1]/a%2Fb"},
		{":18443", "http://localhost:18080/", "https://localhost:18443/"},
	} {
		handler, err := httpsRedirect(test.listen)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", test.from, nil))
		if recorder.Code != 308 || recorder.Header().Get("Location") != test.to {
			t.Fatalf("incorrect redirect: %d %s", recorder.Code, recorder.Header().Get("Location"))
		}
	}
	handler, _ := httpsRedirect(":443")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("POST", "http://stick/api/login", strings.NewReader(`{"password":"secret"}`)))
	if recorder.Code != 400 || recorder.Header().Get("Location") != "" {
		t.Fatal("HTTP accepted/forwarded a login mutation")
	}
	if _, err := httpsRedirect("invalid"); err == nil {
		t.Fatal("accepted invalid HTTPS address")
	}
}

func TestTLSLoginCookieAndOrigin(t *testing.T) {
	a := testApp(t)
	r := httptest.NewRequest("POST", "https://stick/api/login", strings.NewReader(`{"username":"user","password":"test-debian-password"}`))
	r.Header.Set("Origin", "https://stick")
	w := httptest.NewRecorder()
	a.secure(a.mux).ServeHTTP(w, r)
	if w.Code != 200 || !w.Result().Cookies()[0].Secure {
		t.Fatal("HTTPS login cookie is not secure")
	}
	r.Header.Set("Origin", "http://stick")
	if sameOrigin(r) {
		t.Fatal("accepted an insecure origin for an HTTPS request")
	}
}
