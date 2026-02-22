#!/bin/bash
set -e

PROJECT_DIR="/Users/all/Documents/Mano Verde SA/05_PROJETS_BUSINESS/FOUR_PYROLYSE_BIOMASSE"
OUTPUT_DIR="$PROJECT_DIR/FINAL"
TMP_MD="$OUTPUT_DIR/__CONSOLIDATED__.md"
OUT_DOCX="$OUTPUT_DIR/FOUR_PYROLYSE_BIOMASSE_DOSSIER_COMPLET.docx"

mkdir -p "$OUTPUT_DIR"
: > "$TMP_MD"

# Exclure dossiers techniques internes
EXCLUDE_PATTERN="./00_TEMPLATES_WORD|./FINAL|./SOURCE_MD|./.git"

find . -type f -name "*.md" \
  ! -path "./00_TEMPLATES_WORD/*" \
  ! -path "./FINAL/*" \
  ! -path "./SOURCE_MD/*" \
  ! -path "./.git/*" \
  -print0 \
| xargs -0 -n1 dirname \
| sort -u \
| while IFS= read -r d; do

  # Ne garder que les dossiers métier (numérotés)
  case "$d" in
    ./0[1-9]* ) ;;  # ok
    * ) continue ;;
  esac

  md=$(ls -1 "$d"/*.md 2>/dev/null | sort | head -n1)
  [ -z "$md" ] && continue

  echo "" >> "$TMP_MD"
  echo "# $(echo "$d" | sed 's|^\./||')" >> "$TMP_MD"
  echo "" >> "$TMP_MD"

  cat "$md" >> "$TMP_MD"
  echo "" >> "$TMP_MD"

done

pandoc "$TMP_MD" --toc --number-sections -o "$OUT_DOCX"

echo "Document propre généré -> $OUT_DOCX"
