# Release validation

From this standalone folder:

```sh
make build
make test
cd frontend
npx playwright install chromium
npm run test:ui
```

The default test target runs Go race tests, `go vet` and TypeScript checking,
not LCD/cellular tests or live-device actions. Linux-only PTY/interface tests
skip on macOS; run them natively on the intended ARM64 Linux target before
claiming target acceptance. Fixture browser tests intercept APIs and need no
Debian credentials or network changes.

The shared source was historically deployed to UZ801 v3 (Debian 13/kernel 6.6)
and the reference MF800H (Debian 13/kernel 6.12.1). Those development records are
not proof of a fresh hardware validation of this separately packaged release.
No new live flash, deploy, reboot, charging or carrier test is implied.

Live tests require explicit `WEBUI_URL`, `WEBUI_PASSWORD` and optionally
`WEBUI_USERNAME`, or local deployment metadata in `.local/access.json`. They
can exercise the display and a temporary file roundtrip. Keep them separate
from fixture tests and only run against an authorized test device.
