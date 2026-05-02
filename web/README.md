# Beavoguix Web

Interface locale pour poser des questions a Beavoguix depuis le navigateur, avec acces au dossier de travail clone depuis GitHub.

## Lancer

Depuis la racine du depot:

```sh
cargo build -p beavoguix-cli --bin beavoguix
npm run web
```

Puis ouvre:

```text
http://127.0.0.1:8787
```

Par defaut, le workspace est la racine du depot. Pour utiliser un autre clone:

```sh
BEAVOGUIX_WORKSPACE=/chemin/vers/ton/depot npm run web
```

## GitHub

La page statique peut etre poussee sur GitHub, mais GitHub Pages ne peut pas lancer Beavoguix ni acceder a tes fichiers locaux. Pour discuter avec l'agent et lui donner acces aux fichiers, il faut demarrer `npm run web` sur ta machine ou deployer ce serveur Node sur une machine ou le depot GitHub est clone.
