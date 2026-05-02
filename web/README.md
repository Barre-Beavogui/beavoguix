# Beavoguix Web

Interface locale pour poser des questions a Beavoguix depuis le navigateur.

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

## GitHub

La page statique peut etre poussee sur GitHub, mais GitHub Pages ne peut pas lancer Beavoguix ni acceder a tes fichiers locaux. Pour discuter avec l'agent, il faut demarrer `npm run web` sur ta machine ou deployer un backend securise qui execute Beavoguix.
