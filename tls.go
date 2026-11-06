package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func prepareTLS(state, certPath, keyPath string) (string, string, error) {
	if (certPath == "") != (keyPath == "") {
		return "", "", errors.New("--tls-cert and --tls-key must be provided together")
	}
	if certPath != "" {
		_, err := tls.LoadX509KeyPair(certPath, keyPath)
		return certPath, keyPath, err
	}
	directory := filepath.Join(state, "tls")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", "", err
	}
	certPath, keyPath = filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")
	if _, err := os.Stat(certPath); err == nil {
		pair, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return "", "", fmt.Errorf("cannot load saved TLS identity: %w", err)
		}
		cert, err := x509.ParseCertificate(pair.Certificate[0])
		if err != nil {
			return "", "", err
		}
		if time.Until(cert.NotAfter) > 30*24*time.Hour {
			log.Printf("TLS certificate SHA-256: %X", sha256.Sum256(cert.Raw))
			return certPath, keyPath, nil
		}
	} else if !os.IsNotExist(err) {
		return "", "", err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}
	now := time.Now()
	certificate := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "OpenStick Console", Organization: []string{"OpenStick"}},
		NotBefore:    now.Add(-24 * time.Hour), NotAfter: now.AddDate(5, 0, 0),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost", "openstick", "openstick.local"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1"), net.ParseIP("192.168.5.1"), net.ParseIP("192.168.4.1"), net.ParseIP("192.168.68.1")},
	}
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		certificate.DNSNames = append(certificate.DNSNames, hostname)
		if !strings.Contains(hostname, ".") {
			certificate.DNSNames = append(certificate.DNSNames, hostname+".local")
		}
	}
	addresses, _ := net.InterfaceAddrs()
	for _, address := range addresses {
		if ip, _, err := net.ParseCIDR(address.String()); err == nil {
			certificate.IPAddresses = append(certificate.IPAddresses, ip)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", "", err
	}
	if err := atomicWrite(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), 0600); err != nil {
		return "", "", err
	}
	if err := atomicWrite(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		return "", "", err
	}
	log.Printf("Generated self-signed TLS certificate; SHA-256: %X", sha256.Sum256(der))
	return certPath, keyPath, nil
}

// HTTP never serves the application or accepts credentials. Only navigation is
// redirected; API clients must send mutations directly over HTTPS.
func httpsRedirect(listen string) (http.Handler, error) {
	_, port, err := net.SplitHostPort(listen)
	if err != nil || port == "" {
		return nil, errors.New("HTTPS listen address must include a port")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			fail(w, http.StatusBadRequest, "Use HTTPS directly; HTTP only redirects navigation")
			return
		}
		origin, err := url.Parse("http://" + r.Host)
		if err != nil || origin.Hostname() == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
			fail(w, http.StatusBadRequest, "Invalid host")
			return
		}
		host := net.JoinHostPort(origin.Hostname(), port)
		if port == "443" {
			host = strings.TrimSuffix(host, ":443")
		}
		target := &url.URL{Scheme: "https", Host: host, Path: r.URL.Path, RawPath: r.URL.RawPath, RawQuery: r.URL.RawQuery}
		http.Redirect(w, r, target.String(), http.StatusPermanentRedirect)
	}), nil
}
