# Repository working agreement

- Follow ru-class/PROJECT_SPEC.md and docs/decisions.md. Only v0.1 and v0.1.1 fixes are approved.
- Keep src/protocol.ts and docs/protocol.md identical to their fixed-version copies in ru-class, and run joint contract tests after changes.
- Keep platform-specific installation outside portable Worker core. Configure engine URL/model/backend; do not hardcode Homebrew/Metal paths or vendor whisper.cpp into this repository.
- Update architecture, module descriptions, development log and acceptance evidence alongside code.
- Never commit tokens, .env, private domains/paths, classroom audio, model binaries or raw local logs. Use sanitized examples.
- Run npm test, npm run typecheck and npm run build. Automated mock tests do not complete real M4/Metal + five-minute Russian/browser acceptance.

- User clarification, 2026-10-16: M1 is the current development/integration machine. M4 formal hardware acceptance is deferred to a later stage; do not block current development on M4 availability or mislabel M1 measurements as M4.

- Latest user correction: default ASR entry point serves an independent OpenAI-compatible HTTP API; main server calls URL/model/key and owns window scheduling. No outbound Worker is required in normal startup. Keep current contract in docs/api-integration-v0.1.md; older Worker docs/tests are migration history. Default ASR listener remains loopback, but any valid bind address can be configured directly via listen.host or ASR_HOST without a separate opt-in flag. Public exposure requires operator-managed HTTPS/firewall; never deploy without explicit authorization. Toolbar belongs to the right half.

- v0.1.1 correction: ASR is a standalone authenticated OpenAI-compatible HTTP service; load private `config.json` (or environment overrides) to set listener and whisper engine. Legacy Worker WebSocket remains migration-only. Never commit config.json or expose raw whisper.cpp. macOS/M1 first; M4 acceptance deferred.
