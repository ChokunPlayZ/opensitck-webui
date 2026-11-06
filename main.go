package main

import (
	"context"
	"crypto/tls"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed all:internal/static
var assets embed.FS

const version = "1.0.0"

func main() {
	listen := flag.String("listen", ":443", "HTTPS listen address")
	httpListen := flag.String("http-listen", ":80", "HTTP redirect listen address (empty to disable)")
	bindInterface := flag.String("bind-interface", "", "Linux interface for management listeners only (for example br0)")
	state := flag.String("state", "/var/lib/openstick-webui", "Private state directory")
	tlsCert := flag.String("tls-cert", "", "PEM certificate (default: persistent self-signed certificate)")
	tlsKey := flag.String("tls-key", "", "PEM private key (required with --tls-cert)")
	flag.Parse()
	if err := os.MkdirAll(*state, 0700); err != nil {
		log.Fatal(err)
	}
	cert, key, err := prepareTLS(*state, *tlsCert, *tlsKey)
	if err != nil {
		log.Fatal(err)
	}
	redirect, err := httpsRedirect(*listen)
	if err != nil {
		log.Fatal(err)
	}
	app, err := newApp(*state)
	if err != nil {
		log.Fatal(err)
	}
	static, _ := fs.Sub(assets, "internal/static")
	app.routes(static)
	listener, err := managementListener(*listen, *bindInterface)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	var httpListener net.Listener
	if *httpListen != "" {
		httpListener, err = managementListener(*httpListen, *bindInterface)
		if err != nil {
			log.Fatal(err)
		}
		defer httpListener.Close()
	}
	app.restoreFirewall()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go app.monitor(ctx)
	srv := &http.Server{Addr: *listen, Handler: app.secure(app.mux), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	errors := make(chan error, 2)
	go func() { errors <- srv.ServeTLS(listener, cert, key) }()
	servers := []*http.Server{srv}
	if httpListener != nil {
		httpServer := &http.Server{Handler: redirect, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10}
		servers = append(servers, httpServer)
		go func() { errors <- httpServer.Serve(httpListener) }()
		log.Printf("HTTP %s redirects to HTTPS", *httpListen)
	}
	log.Printf("OpenStick Console %s listening on HTTPS %s", version, *listen)
	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-errors:
	}
	cancel()
	app.stopJobs()
	shutdown, done := context.WithTimeout(context.Background(), 8*time.Second)
	defer done()
	for _, server := range servers {
		server.Shutdown(shutdown)
	}
	if serveErr != nil && serveErr != http.ErrServerClosed {
		log.Fatal(serveErr)
	}
}
