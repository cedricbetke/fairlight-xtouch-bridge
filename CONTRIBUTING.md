# Contributing

Thanks for looking at this project. It is a control bridge for a live mixing setup, so changes are reviewed with the hardware in mind. Please read the safety notes below before you change anything that writes to Fairlight or moves motors.

## Development setup

Requirements: Node.js 26 LTS (see `.nvmrc`), macOS for hardware work, and the Xcode Command Line Tools if the native MIDI module needs to be built.

```bash
npm ci
npm run check    # TypeScript in strict mode, no output files
npm test         # node:test with tsx
npm run build
```

Run the software without hardware:

```bash
npm run dev -- simulate
npm run settings:demo
npm run dev -- mock-ember --port 19000
```

## Project layout

See the [project layout in the README](README.md#project-layout). In short:

- `src/`: TypeScript source. ES modules, compiled with `tsc` to `dist/`.
- `test/`: unit and integration tests. Integration tests use local TCP connections to the mock Ember+ provider.
- `web/`: settings page. Plain HTML, CSS and JavaScript without a build step.
- `config/`: example configurations. Do not put real show data or personal paths in them.
- `docs/`: guides and references, written in English.

## Code guidelines

- Keep changes in the style of the surrounding code: naming, file structure and error handling.
- Use the existing `ConfigError`, `FairlightError` and logger patterns instead of new mechanisms.
- Prefer small, focused changes. Describe the reason in the commit or pull request, not only the code.
- Add or update tests for behavior changes. Protocol behavior is tested against the mock provider, so a change that touches Ember+ should come with a test there.
- Comments: explain why, not what. Keep them rare.

## Safety rules

These rules protect live shows. Changes that weaken them need a clear justification and must be called out in the pull request.

- Writes stay off unless `--arm-writes` is given and the target is in the matching allowlist.
- Motors stay off unless `--arm-motor` is given.
- Fairlight is the source of truth. LEDs and motor positions follow confirmed values, never the sent value alone.
- Pending values expire, and structure changes, bank changes and disconnects discard them.
- A failed or unconfirmed write locks the affected strip until a fresh value arrives.
- `doctor` and the settings page must not write to Fairlight or move motors. The only MIDI the settings page sends is the SELECT blink from **Find**.

## Protocol and hardware changes

- Protocol assumptions belong in the protocol references under `docs/protocols/` with their source or verification status.
- Do not add features for Ember+ paths or MIDI messages that are not verified. Mark them as best-effort or not implemented, as the existing VCA/DCA and Select/Solo entries do.
- Say in the pull request whether the change was tested on real hardware, only with the simulation, or only with unit tests.
- Do not copy code from projects with unclear licenses. Protocol references are fine when they are credited in `THIRD_PARTY_NOTICES.md`.

## Language

- Documentation and code comments are in English.
- The settings page is German by default and has an English translation. Its source texts are German. When you add or change visible text in `web/index.html` or `web/app.js`, add the English translation to `web/i18n.js`. `test/i18n.test.ts` checks the translations.

## Pull requests

Before you open a pull request:

- [ ] `npm run check`, `npm test` and `npm run build` pass
- [ ] Docs and example configurations match the code change
- [ ] No personal paths, show data or credentials are included
- [ ] The safety rules above still hold
- [ ] Hardware testing status is stated in the description

## Reporting issues

Please include your macOS version, Fairlight Live version, Node.js version, X-Touch model and firmware, the output of `npm run dev -- doctor --json` (remove any personal names if needed), and the steps to reproduce. For suspected protocol problems, attach the `midi monitor` output or the discovery output.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
