# GitHub Actions-workflows (nog niet actief)

Deze workflows staan hier geparkeerd. GitHub voert ze pas uit als ze in `.github/workflows/` staan.

| Bestand | Wat |
|---|---|
| `ci.yml` | Typecheck, tests en build bij elke push en pull request |
| `pages.yml` | Publiceert de site op GitHub Pages (alleen handmatig te starten) |
| `update-data.yml` | Haalt nieuwe cijfers en landenrapporten op, test en commit ze (alleen handmatig; publiceert alleen als de repository-variabele `PUBLISH_SITE` op `true` staat) |

## Activeren

1. Geef je GitHub-login het recht om workflows te pushen: `gh auth refresh -h github.com -s workflow`
2. Zet de bestanden terug: `mkdir -p .github/workflows && git mv docs/workflows/*.yml .github/workflows/`
3. Commit en push.
4. Voor publiceren: Settings → Pages → Source: "GitHub Actions", en start "Publiceren op GitHub Pages" onder Actions.
