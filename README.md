<h1 align="center">Beavoguix</h1>

<p align="center">
  BeavoguiX V1 utilise Ollama local.
  Ton agent de code en ligne de commande, base sur le code source Codex et publie sous licence Apache-2.0.
</p>

> Beavoguix est un fork personnalise du projet Codex. Les notices d'origine et la licence Apache-2.0 sont conservees dans ce depot.

---

## Installation locale

```shell
git clone https://github.com/Barre-Beavogui/beavoguix.git
cd beavoguix
cargo build --manifest-path codex-rs/Cargo.toml --bin beavoguix
./bin/beavoguix
```

Sur cette machine, la commande globale est deja reliee:

```shell
beavoguix
```

## Utilisation

```text
Beavoguix CLI

Usage: beavoguix [OPTIONS] [PROMPT]
       beavoguix [OPTIONS] <COMMAND> [ARGS]
```

Commandes utiles:

```shell
beavoguix
beavoguix exec "explique ce projet"
beavoguix login
beavoguix --help
```

## Prototype BeavoguiX V1

Le binaire `beavoguix-v1` fournit un premier agent local volontairement simple:

- scan du projet avec `rg --files`;
- lecture limitee des fichiers texte les plus pertinents;
- demande d'un patch unifie au modele;
- affichage du patch;
- confirmation `Apply? y/N`;
- application avec `git apply`.

Exemple:

```shell
beavoguix-v1 "corrige le bug dans la page de login"
```

Configuration:

- par defaut, `beavoguix-v1` utilise Ollama en local, sans cle API;
- le modele local par defaut est `qwen2.5-coder:7b`;
- `BEAVOGUIX_MODEL` ou `--model` change le modele;
- `OLLAMA_HOST` change l'URL Ollama, par defaut `http://127.0.0.1:11434`;
- `BEAVOGUIX_MODEL_COMMAND` permet d'utiliser un adaptateur local qui lit le
  prompt JSON sur stdin et imprime un diff unifie sur stdout.
- `OPENAI_API_KEY` est requis seulement avec `--provider openai`.

Exemple avec Ollama:

```shell
ollama pull qwen2.5-coder:7b
ollama serve
beavoguix-v1 --provider ollama "ajoute un test pour le parseur"
```

## Build

Le binaire Beavoguix est construit depuis le workspace Rust:

```shell
cd codex-rs
cargo build --bin beavoguix
../bin/beavoguix --version
```

Le wrapper `bin/beavoguix` lance le binaire local `codex-rs/target/debug/beavoguix`. Si ce binaire n'existe pas encore, construis-le avec la commande de build ci-dessus.

## Site

Site web GitHub Pages:

https://barre-beavogui.github.io/beavoguix/

Depot GitHub:

https://github.com/Barre-Beavogui/beavoguix

## Licence

Ce projet conserve la licence Apache-2.0 et les notices du projet source.
