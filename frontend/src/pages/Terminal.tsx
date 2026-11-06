import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalURL } from "../api";
import { Badge, Card, PageIntro } from "../components";

export default function Terminal({ username }: { username: string }) {
  const container = useRef<HTMLDivElement>(null),
    [revision, setRevision] = useState(0),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    setConnected(false);
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      scrollback: 5000,
      theme: {
        background: "#0d1117",
        foreground: "#d2dbdf",
        cursor: "#a7f3ce",
        green: "#a7f3ce",
        blue: "#91baff",
        magenta: "#b9a5ff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    fit.fit();
    const socket = new WebSocket(terminalURL());
    socket.binaryType = "arraybuffer";
    const resize = () => {
      fit.fit();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
    };
    socket.onopen = () => {
      setConnected(true);
      resize();
      terminal.focus();
    };
    socket.onmessage = (event) =>
      terminal.write(
        typeof event.data === "string"
          ? event.data
          : new Uint8Array(event.data),
      );
    socket.onclose = () => {
      setConnected(false);
      terminal.writeln(
        "\r\n\x1b[33mSession closed. Click Reconnect to open a new shell.\x1b[0m",
      );
    };
    socket.onerror = () =>
      terminal.writeln(
        "\r\nUnable to connect. Check your login session and the console service.",
      );
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "input", data }));
    });
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "heartbeat" }));
    }, 30000);
    return () => {
      clearInterval(heartbeat);
      observer.disconnect();
      input.dispose();
      socket.onclose = null;
      socket.close();
      terminal.dispose();
    };
  }, [revision]);
  return (
    <>
      <PageIntro
        eyebrow="DEBIAN LOGIN SHELL"
        title="Web terminal"
        description="An interactive shell as your signed-in Debian account. Entirely on the stick."
      >
        <Badge tone={connected ? "green" : "red"}>
          {connected ? `Connected · ${username}` : "Disconnected"}
        </Badge>
        <button onClick={() => setRevision((value) => value + 1)}>
          Reconnect
        </button>
      </PageIntro>
      <Card className="terminal-card">
        <div className="terminal-title">
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{username}@openstick · login shell</span>
          <span>PTY / xterm-256color</span>
        </div>
        <div className="terminal-container" ref={container} />
      </Card>
    </>
  );
}
