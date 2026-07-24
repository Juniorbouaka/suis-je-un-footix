#!/bin/sh
set -e

# Le volume persistant est monté APRÈS la construction de l'image, et il
# appartient à root. Sans ce passage, l'utilisateur « node » ne peut pas y
# écrire : SQLite échoue à créer la base et le serveur meurt au démarrage.
DATA_DIR="$(dirname "${DATABASE_FILE:-/data/footix.db}")"

mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR" 2>/dev/null || true

echo "  → dossier de données : $DATA_DIR ($(du -sh "$DATA_DIR" 2>/dev/null | cut -f1))"

# On abandonne les privilèges root avant de lancer le serveur.
exec su-exec node "$@"
