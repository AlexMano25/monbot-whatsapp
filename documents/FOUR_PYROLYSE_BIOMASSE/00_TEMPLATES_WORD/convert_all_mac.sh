#!/bin/bash
# ===========================================================
# SCRIPT DE CONVERSION AUTOMATIQUE MARKDOWN VERS DOCX
# MANO VERDE INC SA - Projet Four à Pyrolyse
# ===========================================================

echo ""
echo "===================================================="
echo "   CONVERSION DOCUMENTS MARKDOWN VERS WORD"
echo "   MANO VERDE INC SA"
echo "===================================================="
echo ""

# Vérifier que Pandoc est installé
if ! command -v pandoc &> /dev/null
then
    echo "ERREUR: Pandoc n'est pas installé !"
    echo "Installez-le avec : brew install pandoc"
    exit 1
fi

echo "Pandoc détecté. Démarrage de la conversion..."
echo ""

# Créer le dossier de sortie
mkdir -p DOCUMENTS_WORD

# Conversion des documents techniques
echo "[1/7] Conversion documentation technique..."
pandoc "../02_DOCUMENTATION_TECHNIQUE/2a_Manuel_conception_cahier_charges.txt" -o "DOCUMENTS_WORD/2a_Manuel_conception_cahier_charges.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../02_DOCUMENTATION_TECHNIQUE/2b_Manuel_fabrication_ateliers_industriels.txt" -o "DOCUMENTS_WORD/2b_Manuel_fabrication_ateliers_industriels.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../02_DOCUMENTATION_TECHNIQUE/2c_Manuel_controle_qualite_QA_QC.txt" -o "DOCUMENTS_WORD/2c_Manuel_controle_qualite_QA_QC.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Conversion des tutoriels pédagogiques
echo "[2/7] Conversion tutoriels pédagogiques..."
pandoc "../03_TUTORIELS_PEDAGOGIQUES/3a_Tutoriel_fabrication_version_metallique_semi_industrielle.txt" -o "DOCUMENTS_WORD/3a_Tutoriel_fabrication_version_metallique_semi_industrielle.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../03_TUTORIELS_PEDAGOGIQUES/3b_Tutoriel_fabrication_version_hybride_metal_argile.txt" -o "DOCUMENTS_WORD/3b_Tutoriel_fabrication_version_hybride_metal_argile.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../03_TUTORIELS_PEDAGOGIQUES/3c_Tutoriel_mise_en_place_centre_local_production_maintenance.txt" -o "DOCUMENTS_WORD/3c_Tutoriel_mise_en_place_centre_local_production_maintenance.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../03_TUTORIELS_PEDAGOGIQUES/3d_Scripts_videos_pedagogiques.txt" -o "DOCUMENTS_WORD/3d_Scripts_videos_pedagogiques.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Conversion des dossiers partenaires
echo "[3/7] Conversion dossiers partenaires..."
pandoc "../04_DOSSIERS_PARTENAIRES/4a_Dossier_Presidence_Republique.txt" -o "DOCUMENTS_WORD/4a_Dossier_Presidence_Republique.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../04_DOSSIERS_PARTENAIRES/4b_Dossier_PNUD.txt" -o "DOCUMENTS_WORD/4b_Dossier_PNUD.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../04_DOSSIERS_PARTENAIRES/4c_Dossier_PAM.txt" -o "DOCUMENTS_WORD/4c_Dossier_PAM.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../04_DOSSIERS_PARTENAIRES/4d_Dossier_UNICEF.txt" -o "DOCUMENTS_WORD/4d_Dossier_UNICEF.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Conversion des dossiers financiers
echo "[4/7] Conversion dossiers financiers..."
pandoc "../05_DOSSIERS_FINANCIERS/5a_Dossier_levee_fonds_Deloitte.txt" -o "DOCUMENTS_WORD/5a_Dossier_levee_fonds_Deloitte.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../05_DOSSIERS_FINANCIERS/5b_Dossier_BAD.txt" -o "DOCUMENTS_WORD/5b_Dossier_BAD.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Conversion propriété intellectuelle
echo "[5/7] Conversion propriété intellectuelle..."
pandoc "../06_PROPRIETE_INTELLECTUELLE/6a_Ebauche_brevet_OAPI.txt" -o "DOCUMENTS_WORD/6a_Ebauche_brevet_OAPI.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Conversion risques et avantages
echo "[6/7] Conversion risques et avantages..."
pandoc "../07_CATALOGUE_RISQUES_AVANTAGES/7a_Catalogue_risques_mesures_attenuation.txt" -o "DOCUMENTS_WORD/7a_Catalogue_risques_mesures_attenuation.docx" --toc --toc-depth=3 --number-sections 2>/dev/null
pandoc "../07_CATALOGUE_RISQUES_AVANTAGES/7b_Catalogue_avantages_indicateurs_impact.txt" -o "DOCUMENTS_WORD/7b_Catalogue_avantages_indicateurs_impact.docx" --toc --toc-depth=3 --number-sections 2>/dev/null

# Instructions
echo "[7/7] Conversion instructions..."
pandoc "TEMPLATE_INSTRUCTIONS.md" -o "DOCUMENTS_WORD/00_TEMPLATE_INSTRUCTIONS.docx" --toc --toc-depth=3 2>/dev/null

echo ""
echo "===================================================="
echo "   CONVERSION TERMINEE !"
echo "   Les fichiers DOCX sont dans : DOCUMENTS_WORD/"
echo "===================================================="
echo ""
echo "Prochaine étape : Ouvrir les fichiers Word et :"
echo "  1. Insérer le logo MANO VERDE"
echo "  2. Appliquer la charte graphique"
echo "  3. Vérifier la table des matières"
echo ""
