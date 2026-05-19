# bruget

Install and manage multiple versions of Bruno API client on macOS, Linux, and Windows.

## Installation

```bash
npm install -g bruget
```

## Usage

```bash
bruget install <version> [<version> ...]        # install one or more stable versions
bruget install --nightly <yyyy-mm-dd|latest>    # install a nightly build
bruget clean                                    # remove leftover download files
```

### Examples

Install a single version:
```bash
bruget install 2.15.0
```

Install multiple versions at once:
```bash
bruget install 2.15.0 2.14.0 2.13.0
```

Install a nightly build by date:
```bash
bruget install --nightly 2026-04-13
```

Install the latest nightly build:
```bash
bruget install --nightly latest
```

Remove leftover ZIP/DMG files from interrupted downloads:
```bash
bruget clean
```

## How it works

All versions are installed to `~/Downloads/bet-temp/bruno-versions/` and opened automatically after install. Re-running the same version skips the download and opens the existing install.

| Platform | Format | Installed as |
|----------|--------|--------------|
| macOS | ZIP (stable) / DMG (nightly) | `Bruno-<version>.app` |
| Linux | AppImage | `Bruno-<version>.AppImage` |
| Windows | ZIP | `Bruno-<version>/` folder |

## Requirements

- Node.js >= 14.0.0
- macOS (arm64, x64), Linux (x64, arm64), or Windows (x64, arm64)

## Development

Clone and link locally:

```bash
git clone https://github.com/Pragadesh-45/bet.git
cd bet
npm install
npm link
```

Test:
```bash
bruget install 2.15.0
```

## Publishing

```bash
npm login
npm publish
```

## License

MIT
