# Repository working agreement

- Follow ru-class/PROJECT_SPEC.md and docs/decisions.md. Only v0.1 is approved.
- Keep src/protocol.ts and docs/protocol.md identical to their fixed-version copies in ru-class, and run joint contract tests after changes.
- Keep platform-specific installation outside portable Worker core. Configure engine URL/model/backend; do not hardcode Homebrew/Metal paths or vendor whisper.cpp into this repository.
- Update architecture, module descriptions, development log and acceptance evidence alongside code.
- Never commit tokens, .env, private domains/paths, classroom audio, model binaries or raw local logs. Use sanitized examples.
- Run npm test, npm run typecheck and npm run build. Automated mock tests do not complete real M4/Metal + five-minute Russian/browser acceptance.
