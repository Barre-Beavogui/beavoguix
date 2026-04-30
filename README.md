<h1 align="center">Beavoguix</h1>

<p align="center">
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
