# bruget

Install and manage multiple versions of Bruno API client on macOS.

## Installation

```bash
npm install -g bruget
```

## Usage

```bash
bruget install <version> [<version> ...]
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

## How it works

- Downloads the specified Bruno versions from GitHub releases
- Extracts them to `~/Downloads/bet-temp/bruno-versions/`
- Renames each to `Bruno-<version>.app`
- Opens the installed apps automatically

## Requirements

- macOS (arm64 or x64)
- Node.js >= 14.0.0

## Development

Clone the repo and link locally:

```bash
git clone <your-repo>
cd bet
npm install
npm link
```

Test the command:
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
