# INSTRUCTIONS DE CONVERSION WORD/PDF
## PROJET FOUR DOMESTIQUE À PYROLYSE / BIOMASSE – MANO VERDE INC SA

---

## 1. FICHIERS DISPONIBLES

Vous disposez de **20 documents techniques** au format Markdown (.md) optimisés pour conversion professionnelle.

### Structure des dossiers :
```
00_TEMPLATES_WORD/          (ce dossier)
01_DESCRIPTION_PRODUIT/
02_DOCUMENTATION_TECHNIQUE/
03_TUTORIELS_PEDAGOGIQUES/
04_DOSSIERS_PARTENAIRES/
05_DOSSIERS_FINANCIERS/
06_PROPRIETE_INTELLECTUELLE/
07_CATALOGUE_RISQUES_AVANTAGES/
```

---

## 2. MÉTHODE DE CONVERSION

### Option A : Conversion automatique avec Pandoc (RECOMMANDÉ)

**Installation Pandoc :**
- Windows : Télécharger sur https://pandoc.org/installing.html
- Mac : `brew install pandoc`
- Linux : `sudo apt-get install pandoc`

**Commande de conversion basique :**
```bash
pandoc document.md -o document.docx
```

**Commande avec template personnalisé :**
```bash
pandoc document.md -o document.docx \
  --reference-doc=template_manoverde.docx \
  --toc --toc-depth=3 \
  --number-sections
```

**Conversion en PDF :**
```bash
pandoc document.md -o document.pdf \
  --pdf-engine=xelatex \
  --toc --toc-depth=3 \
  --number-sections
```

### Option B : Import dans Microsoft Word

1. Ouvrir Microsoft Word
2. Fichier → Ouvrir → Sélectionner le fichier .md
3. Appliquer les styles (voir section 3)
4. Insérer logo en en-tête
5. Enregistrer au format .docx

### Option C : LibreOffice Writer

1. Ouvrir LibreOffice Writer
2. Fichier → Ouvrir → Sélectionner le fichier .md
3. Appliquer les styles du template
4. Exporter en .docx ou .pdf

---

## 3. CHARTE GRAPHIQUE MANO VERDE INC SA

### Couleurs officielles
- **Vert principal** : #2D7A3E (RGB: 45, 122, 62)
- **Vert secondaire** : #5CB85C (RGB: 92, 184, 92)
- **Gris foncé** : #333333 (titres)
- **Gris moyen** : #666666 (texte)
- **Blanc** : #FFFFFF (fond)

### Polices recommandées
- **Titres** : Arial Bold ou Calibri Bold, 16-18 pt
- **Sous-titres** : Arial Bold ou Calibri Bold, 14 pt
- **Texte** : Arial ou Calibri, 11-12 pt
- **Tableaux** : Arial ou Calibri, 10 pt

### Marges
- Haut : 2,5 cm
- Bas : 2,5 cm
- Gauche : 3 cm
- Droite : 2,5 cm

---

## 4. EN-TÊTE ET PIED DE PAGE

### En-tête (toutes les pages sauf page de garde)
```
[LOGO MANO VERDE]                    FOUR DOMESTIQUE À PYROLYSE / BIOMASSE
────────────────────────────────────────────────────────────────────────
```

### Pied de page
```
────────────────────────────────────────────────────────────────────────
MANO VERDE INC SA | Yaoundé, Cameroun | www.manoverde.cm | Page X/XX
```

---

## 5. PAGE DE GARDE TYPE

### Structure recommandée :

```
[ESPACE 3 cm]

                        [LOGO MANO VERDE INC SA]
                              (centré)

[ESPACE 2 cm]

                    ═══════════════════════════════════
                    FOUR DOMESTIQUE À PYROLYSE / BIOMASSE
                      PROJET ÉCONOMIE CIRCULAIRE CAMEROUN
                    ═══════════════════════════════════

[ESPACE 2 cm]

                           [TITRE DU DOCUMENT]
                        (Police 24 pt, Gras, Centré)

[ESPACE 3 cm]

                          Document préparé par :
                          MANO VERDE INC SA
                    Société Anonyme de droit OHADA
                     Yaoundé, République du Cameroun

[ESPACE 2 cm]

                               [DATE]
                          Février 2026

[ESPACE 2 cm]

                    ─────────────────────────────────────
                        CONFIDENTIEL - NE PAS DIFFUSER
                    ─────────────────────────────────────
```

---

## 6. STYLES À APPLIQUER DANS WORD

### Titre 1 (# en Markdown)
- Police : Arial Bold, 18 pt
- Couleur : Vert principal (#2D7A3E)
- Espacement avant : 18 pt
- Espacement après : 12 pt
- Numérotation automatique : 1., 2., 3.

### Titre 2 (## en Markdown)
- Police : Arial Bold, 16 pt
- Couleur : Vert principal (#2D7A3E)
- Espacement avant : 12 pt
- Espacement après : 6 pt
- Numérotation automatique : 1.1, 1.2, etc.

### Titre 3 (### en Markdown)
- Police : Arial Bold, 14 pt
- Couleur : Gris foncé (#333333)
- Espacement avant : 6 pt
- Espacement après : 6 pt
- Numérotation automatique : 1.1.1, 1.1.2, etc.

### Texte normal
- Police : Arial, 11 pt
- Couleur : Gris moyen (#666666)
- Interligne : 1,15
- Alignement : Justifié

### Tableaux
- Bordures : Lignes fines grises
- En-tête : Fond vert clair, texte blanc, gras
- Lignes alternées : Blanc / Gris très clair

### Listes à puces
- Puce : • (point médian)
- Retrait : 1 cm
- Espacement entre items : 3 pt

---

## 7. CHECKLIST AVANT SOUMISSION

- [ ] Logo MANO VERDE inséré en en-tête
- [ ] Page de garde complète avec titre, date, mentions confidentialité
- [ ] Table des matières générée
- [ ] Styles appliqués uniformément
- [ ] Numérotation des pages correcte
- [ ] Tableaux formatés avec charte graphique
- [ ] Orthographe et grammaire vérifiées
- [ ] Numéros de téléphone et emails à jour
- [ ] Signatures et cachets apposés si nécessaire
- [ ] Version PDF générée pour envoi électronique
- [ ] Version DOCX conservée pour édition

---

**Document préparé le : 14 février 2026**  
**MANO VERDE INC SA – Projet Four Domestique à Pyrolyse / Biomasse**
