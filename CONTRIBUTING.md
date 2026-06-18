# Contribuer a bc-source-mcp

## Conventional Commits

Le versioning et la publication npm sont automatiques via
[release-please](https://github.com/googleapis/release-please). Les commits sur
`main` doivent suivre [Conventional Commits](https://www.conventionalcommits.org/).

| Prefixe | Bump | Exemple |
|---|---|---|
| `feat:` | minor | `feat: ajoute bc_get_table_fields` |
| `fix:` | patch | `fix: corrige fuite memoire dans le walker AL` |
| `perf:` | patch | `perf: cache LRU sur les sources lues` |
| `refactor:` / `docs:` / `chore:` / `test:` | aucun | `docs: documente le tokenizer FTS5` |
| `feat!:` ou `BREAKING CHANGE:` dans le body | major | `feat!: renomme outputSchema des tools` |

## Dev local

```powershell
npm install
npm run build
npm test
npm run inspector
```

Roadmap des chantiers ouverts : [IMPROVEMENTS.md](IMPROVEMENTS.md).
