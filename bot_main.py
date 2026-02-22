import os
import base64
import json
import threading
from datetime import datetime
from flask import Flask, request, jsonify
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from email.mime.text import MIMEText
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from googlesearch import search
import PyPDF2
import docx

# ========================================
# GESTIONNAIRE CHATGPT (IA) -> Sonar
# ========================================

class ChatGPTManager:
    def __init__(self):
        self.api_key = os.getenv('OPENAI_API_KEY')
        self.base_url = os.getenv('OPENAI_API_URL', 'https://api.perplexity.ai/chat/completions')
        self.model = os.getenv('OPENAI_MODEL', 'sonar-pro')

    def chat(self, user_message):
        if not self.api_key:
            return {"error": "ChatGPT non configuré (OPENAI_API_KEY manquante)."}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        system_prompt = (
            "Tu es un routeur de commandes pour un bot local sur macOS. "
            "Tu ne renvoies JAMAIS de texte libre, seulement du JSON valide. "
            "Schéma JSON:\n"
            "{\n"
            '  \"action\": \"list_dir\" | \"tree_dir\" | \"read_file\" | \"search_files\" | \"create_dir\" | \"create_file\" | \"delete\" | \"copy\" | \"move\" | \"rename\" | \"create_architecture\" | \"other\",\n'
            '  \"params\": { ... }\n'
            "}\n"
            "Important: Réponds UNIQUEMENT avec un JSON parsable, sans commentaire ni texte autour."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]

        payload = {"model": self.model, "messages": messages}

        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, timeout=30)
            if resp.status_code != 200:
                return {"error": f"Erreur Sonar: {resp.status_code} {resp.text}"}

            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            message = choice.get("message", {})
            content = message.get("content") or ""

            content_stripped = content.strip()
            if content_stripped.startswith("```"):
                content_stripped = content_stripped.strip("`")
                lines = content_stripped.splitlines()
                if lines and lines.strip().lower() == "json":
                    content_stripped = "\n".join(lines[1:]).strip()

            try:
                command = json.loads(content_stripped)
                return {"mode": "action", "command": command}
            except Exception:
                return {"mode": "advice", "text": content}
        except Exception as e:
            return {"error": f"Erreur de connexion à Sonar: {e}"}

# === CONFIG GLOBALE ===

load_dotenv()

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
]

app = Flask(__name__)

# ========================================
# GESTIONNAIRE GMAIL
# ========================================

class GmailManager:
    def __init__(self):
        self.creds = None
        self.service = None
        self.authenticate()

    def authenticate(self):
        token_file = os.getenv('GMAIL_TOKEN_FILE', 'token.json')
        creds_file = os.getenv('GMAIL_CREDENTIALS_FILE', 'credentials.json')

        if os.path.exists(token_file):
            self.creds = Credentials.from_authorized_user_file(token_file, SCOPES)

        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                if os.path.exists(creds_file):
                    flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
                    self.creds = flow.run_local_server(port=0)
                else:
                    print("⚠️  Fichier credentials.json non trouvé.")
                    return

            with open(token_file, 'w') as token:
                token.write(self.creds.to_json())

        self.service = build('gmail', 'v1', credentials=self.creds)
        print("✅ Gmail connecté!")

    def list_emails(self, max_results=10):
        try:
            results = self.service.users().messages().list(
                userId='me', maxResults=max_results
            ).execute()
            messages = results.get('messages', [])

            email_list = []
            for msg in messages:
                msg_data = self.service.users().messages().get(
                    userId='me', id=msg['id']
                ).execute()

                headers = msg_data['payload']['headers']
                subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'Sans sujet')
                sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Inconnu')

                email_list.append({
                    'id': msg['id'],
                    'subject': subject,
                    'from': sender,
                    'snippet': msg_data['snippet']
                })

            return email_list
        except Exception as e:
            print(f"❌ Erreur Gmail: {e}")
            return []

    def send_email(self, to, subject, body):
        try:
            message = MIMEText(body)
            message['to'] = to
            message['subject'] = subject

            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()

            self.service.users().messages().send(
                userId='me',
                body={'raw': raw_message}
            ).execute()

            return True
        except Exception as e:
            print(f"❌ Erreur: {e}")
            return False

# ========================================
# GESTIONNAIRE WHATSAPP
# ========================================

class WhatsAppManager:
    def __init__(self):
        self.api_url = os.getenv('WHATSAPP_API_URL')
        self.access_token = os.getenv('WHATSAPP_ACCESS_TOKEN')
        self.verify_token = os.getenv('WHATSAPP_VERIFY_TOKEN')

    def send_message(self, phone_number, message):
        try:
            headers = {
                'Authorization': f'Bearer {self.access_token}',
                'Content-Type': 'application/json'
            }

            payload = {
                'messaging_product': 'whatsapp',
                'to': phone_number,
                'type': 'text',
                'text': {'body': message}
            }

            response = requests.post(self.api_url, headers=headers, json=payload, timeout=10)
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Erreur WhatsApp: {e}")
            return False

# ========================================
# GESTIONNAIRE DE FICHIERS
# ========================================

class FileManager:
    @staticmethod
    def create_directory(directory_name):
        try:
            os.makedirs(directory_name, exist_ok=True)
            return f"✅ Répertoire '{directory_name}' créé"
        except Exception as e:
            return f"❌ Erreur: {e}"

    @staticmethod
    def create_file(file_name, content):
        try:
            with open(file_name, 'w', encoding='utf-8') as file:
                file.write(content)
            return f"✅ Fichier '{file_name}' créé"
        except Exception as e:
            return f"❌ Erreur: {e}"

    @staticmethod
    def read_file(file_name):
        try:
            with open(file_name, 'r', encoding='utf-8') as file:
                return file.read()
        except Exception as e:
            return f"❌ Erreur: {e}"

    @staticmethod
    def list_files(directory='.'):
        try:
            files = os.listdir(directory)
            return "\n".join([f"📄 {f}" for f in files])
        except Exception as e:
            return f"❌ Erreur: {e}"

    @staticmethod
    def delete_file(file_name):
        try:
            os.remove(file_name)
            return f"✅ Fichier '{file_name}' supprimé"
        except Exception as e:
            return f"❌ Erreur: {e}"

# ========================================
# GESTIONNAIRE DE RECHERCHE WEB
# ========================================

class WebSearchManager:
    @staticmethod
    def search_google(query, num_results=5):
        try:
            print(f"🔍 Recherche en cours: {query}")
            results = []
            for url in search(query, num_results=num_results, lang='fr'):
                results.append(url)

            if results:
                output = f"🌐 Résultats de recherche pour '{query}':\n"
                for i, url in enumerate(results, 1):
                    output += f"{i}. {url}\n"
                return output
            else:
                return "❌ Aucun résultat trouvé"
        except Exception as e:
            return f"❌ Erreur de recherche: {e}"

    @staticmethod
    def scrape_webpage(url):
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, 'html.parser')

            title = soup.find('title')
            title_text = title.get_text() if title else "Sans titre"

            paragraphs = soup.find_all('p')
            content = ''.join([p.get_text() for p in paragraphs[:10]])

            output = f"📄 Contenu de: {url}\n"
            output += f"📌 Titre: {title_text}\n"
            output += f"📝 Contenu:\n{content[:1000]}..."
            return output
        except Exception as e:
            return f"❌ Erreur lors de l'extraction: {e}"

    @staticmethod
    def search_and_summarize(query, num_results=3):
        try:
            results = []
            for url in search(query, num_results=num_results, lang='fr'):
                results.append(url)

            if not results:
                return "❌ Aucun résultat trouvé"

            output = f"🔍 Recherche: '{query}'\n"

            for i, url in enumerate(results, 1):
                output += f"{'='*60}\n"
                output += f"📌 Résultat {i}: {url}\n"
                output += f"{'='*60}\n"

                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                    }
                    response = requests.get(url, headers=headers, timeout=5)
                    soup = BeautifulSoup(response.content, 'html.parser')

                    paragraphs = soup.find_all('p')
                    text = ' '.join([p.get_text() for p in paragraphs[:3]])
                    output += f"{text[:300]}...\n"
                except Exception:
                    output += "⚠️ Impossible d'extraire le contenu\n"

            return output
        except Exception as e:
            return f"❌ Erreur: {e}"

# ========================================
# GESTIONNAIRE DE RECHERCHE DANS DOCUMENTS
# ========================================

class DocumentSearchManager:
    def __init__(self, documents_folder='documents'):
        self.documents_folder = documents_folder
        os.makedirs(documents_folder, exist_ok=True)

    def read_pdf(self, file_path):
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                text = ""
                for page in pdf_reader.pages:
                    page_text = page.extract_text() or ""
                    text += page_text
                return text
        except Exception as e:
            return f"Erreur PDF: {e}"

    def read_docx(self, file_path):
        try:
            doc = docx.Document(file_path)
            text = "".join([paragraph.text for paragraph in doc.paragraphs])
            return text
        except Exception as e:
            return f"Erreur DOCX: {e}"

    def read_txt(self, file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                return file.read()
        except Exception as e:
            return f"Erreur TXT: {e}"

    def search_in_documents(self, query):
        try:
            results = []
            query_lower = query.lower()

            for filename in os.listdir(self.documents_folder):
                file_path = os.path.join(self.documents_folder, filename)

                if not os.path.isfile(file_path):
                    continue

                content = ""
                if filename.endswith('.pdf'):
                    content = self.read_pdf(file_path)
                elif filename.endswith('.docx'):
                    content = self.read_docx(file_path)
                elif filename.endswith('.txt'):
                    content = self.read_txt(file_path)
                else:
                    continue

                if query_lower in content.lower():
                    matches = []
                    content_lower = content.lower()
                    start = 0

                    while True:
                        pos = content_lower.find(query_lower, start)
                        if pos == -1:
                            break

                        context_start = max(0, pos - 100)
                        context_end = min(len(content), pos + len(query) + 100)
                        context = content[context_start:context_end]

                        matches.append(context)
                        start = pos + 1

                        if len(matches) >= 3:
                            break

                    results.append({
                        'filename': filename,
                        'matches': matches,
                        'count': len(matches)
                    })

            if results:
                output = f"🔍 Résultats de recherche pour '{query}':\n"
                output += f"📊 {len(results)} document(s) trouvé(s)\n"
                for result in results:
                    output += f"{'='*60}\n"
                    output += f"📄 Fichier: {result['filename']}\n"
                    output += f"🔢 {result['count']} occurrence(s)\n"
                    for i, match in enumerate(result['matches'], 1):
                        output += f"  {i}. ...{match}...\n"
                return output
            else:
                return f"❌ Aucun résultat trouvé pour '{query}' dans les documents"
        except Exception as e:
            return f"❌ Erreur de recherche: {e}"

    def list_documents(self):
        try:
            files = os.listdir(self.documents_folder)
            if files:
                output = f"📚 Documents disponibles ({len(files)}):\n"
                for i, file in enumerate(files, 1):
                    file_path = os.path.join(self.documents_folder, file)
                    size = os.path.getsize(file_path)
                    size_kb = size / 1024
                    output += f"{i}. 📄 {file} ({size_kb:.1f} KB)\n"
                return output
            else:
                return "📭 Aucun document dans le dossier"
        except Exception as e:
            return f"❌ Erreur: {e}"

    def read_document(self, filename):
        try:
            file_path = os.path.join(self.documents_folder, filename)

            if not os.path.exists(file_path):
                return f"❌ Fichier '{filename}' non trouvé"

            content = ""
            if filename.endswith('.pdf'):
                content = self.read_pdf(file_path)
            elif filename.endswith('.docx'):
                content = self.read_docx(file_path)
            elif filename.endswith('.txt'):
                content = self.read_txt(file_path)
            else:
                return "❌ Type de fichier non supporté (utilisez .pdf, .docx ou .txt)"

            return f"📄 Contenu de '{filename}':\n{content[:2000]}..."
        except Exception as e:
            return f"❌ Erreur: {e}"

# ========================================
# INTERFACE DE CHAT INTERACTIVE
# ========================================

class BotChat:
    def __init__(self):
        self.gmail = None
        self.whatsapp = WhatsAppManager()
        self.files = FileManager()
        self.web_search = WebSearchManager()
        self.doc_search = DocumentSearchManager()
        self.chatgpt = ChatGPTManager()
        self.history = []
        self.running = True

        if os.path.exists('credentials.json'):
            self.gmail = GmailManager()

    def process_command(self, command):
        cmd = command.lower().strip()

        # RECHERCHE WEB
        if cmd.startswith('recherche web') or cmd.startswith('google'):
            query = cmd.replace('recherche web', '').replace('google', '').strip()
            if not query:
                query = input("  🔍 Que voulez-vous rechercher? ")

            if 'détaillé' in cmd or 'résumé' in cmd:
                return self.web_search.search_and_summarize(query, 3)
            else:
                return self.web_search.search_google(query, 5)

        elif cmd.startswith('extraire') or cmd.startswith('scrape'):
            url = cmd.replace('extraire', '').replace('scrape', '').strip()
            if not url:
                url = input("  🌐 URL à extraire: ")
            return self.web_search.scrape_webpage(url)

        # RECHERCHE DOCUMENTS
        elif cmd.startswith('chercher dans documents') or cmd.startswith('recherche doc'):
            query = cmd.replace('chercher dans documents', '').replace('recherche doc', '').strip()
            if not query:
                query = input("  🔍 Terme à rechercher: ")
            return self.doc_search.search_in_documents(query)

        elif cmd.startswith('lister documents') or cmd == 'documents':
            return self.doc_search.list_documents()

        elif cmd.startswith('lire document'):
            filename = cmd.replace('lire document', '').strip()
            if not filename:
                filename = input("  📄 Nom du fichier: ")
            return self.doc_search.read_document(filename)

        # GMAIL
        elif cmd.startswith('lire emails') or cmd.startswith('emails'):
            if not self.gmail:
                return "❌ Gmail non configuré. Ajoutez credentials.json"

            try:
                count = int(cmd.split()[-1]) if cmd.split()[-1].isdigit() else 5
            except Exception:
                count = 5

            emails = self.gmail.list_emails(count)
            if emails:
                result = f"📬 {len(emails)} derniers e-mails:\n"
                for i, email in enumerate(emails, 1):
                    result += f"{i}. 📧 {email['subject']}\n"
                    result += f"   De: {email['from']}\n"
                    result += f"   Aperçu: {email['snippet'][:100]}...\n"
                return result
            return "📭 Aucun e-mail trouvé"

        elif cmd.startswith('envoyer email'):
            if not self.gmail:
                return "❌ Gmail non configuré"

            print("📧 Envoi d'e-mail:")
            to = input("  Destinataire: ")
            subject = input("  Sujet: ")
            body = input("  Message: ")

            if self.gmail.send_email(to, subject, body):
                return f"✅ E-mail envoyé à {to}"
            return "❌ Échec de l'envoi"

        # WHATSAPP
        elif cmd.startswith('whatsapp'):
            print("💬 Envoi WhatsApp:")
            phone = input("  Numéro (format: +33612345678): ")
            message = input("  Message: ")

            if self.whatsapp.send_message(phone, message):
                return f"✅ Message WhatsApp envoyé à {phone}"
            return "❌ Échec de l'envoi WhatsApp"

        # FICHIERS
        elif cmd.startswith('créer dossier'):
            name = input("  Nom du dossier: ")
            return self.files.create_directory(name)

        elif cmd.startswith('créer fichier'):
            name = input("  Nom du fichier: ")
            content = input("  Contenu: ")
            return self.files.create_file(name, content)

        elif cmd.startswith('lire fichier'):
            name = input("  Nom du fichier: ")
            return self.files.read_file(name)

        elif cmd.startswith('lister fichiers') or cmd == 'ls':
            directory = input("  Répertoire (. pour actuel): ") or '.'
            return self.files.list_files(directory)

        elif cmd.startswith('supprimer fichier'):
            name = input("  Nom du fichier: ")
            return self.files.delete_file(name)

        # SYSTÈME
        elif cmd in ['aide', 'help', '?']:
            return """
🤖 COMMANDES DISPONIBLES:

🔍 RECHERCHE WEB:
  • recherche web [terme]
  • google [terme]
  • recherche web détaillé
  • extraire [url]

📚 RECHERCHE DOCUMENTS:
  • chercher dans documents [terme]
  • recherche doc [terme]
  • lister documents
  • lire document [nom]

📧 GMAIL:
  • lire emails [nombre]
  • envoyer email

💬 WHATSAPP:
  • whatsapp

📁 FICHIERS:
  • créer dossier
  • créer fichier
  • lire fichier
  • lister fichiers / ls
  • supprimer fichier

⚙️ SYSTÈME:
  • aide / help / ?
  • statut
  • quitter / exit / quit
"""

        elif cmd == 'statut':
            gmail_status = "✅ Connecté" if self.gmail and self.gmail.service else "❌ Non configuré"
            docs_count = len(os.listdir(self.doc_search.documents_folder))
            return f"""
📊 STATUT DU BOT:
  • Gmail: {gmail_status}
  • WhatsApp: ⚙️ Configuré
  • Fichiers: ✅ Opérationnel
  • Recherche Web: ✅ Opérationnel
  • Documents: {docs_count} fichier(s) disponible(s)
  • Répertoire: {os.getcwd()}
  • Dossier documents: {self.doc_search.documents_folder}
"""

        elif cmd in ['quitter', 'exit', 'quit']:
            self.running = False
            return "👋 Au revoir!"

        else:
            ia_result = self.chatgpt.chat(command)

            if isinstance(ia_result, dict) and ia_result.get("mode") == "action":
                cmd_action = ia_result.get("command", {})
                return self.execute_local_action(cmd_action)
            elif isinstance(ia_result, dict) and ia_result.get("mode") == "advice":
                return ia_result.get("text", "")
            else:
                return str(ia_result)

    def execute_local_action(self, command):
        if not isinstance(command, dict):
            return f"❌ Commande IA invalide: {command}"

        if "error" in command:
            return f"⚠️ IA: {command['error']}"

        action = command.get("action")
        params = command.get("params", {}) or {}

        base_docs = os.path.expanduser('~/Documents')
        base_downloads = os.path.expanduser('~/Downloads')
        backup_root = os.path.join(base_docs, "MonBot_backups")
        os.makedirs(backup_root, exist_ok=True)

        def make_backup(path):
            """Créer un backup avant une action destructive (delete/move/rename/copy source)."""
            try:
                if not os.path.exists(path):
                    return
                rel = os.path.relpath(
                    path,
                    base_docs if os.path.realpath(path).startswith(os.path.realpath(base_docs)) else base_downloads
                )
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup_path = os.path.join(backup_root, f"{ts}_{rel}")
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                import shutil
                if os.path.isdir(path):
                    shutil.copytree(path, backup_path, dirs_exist_ok=True)
                else:
                    shutil.copy2(path, backup_path)
            except Exception as e:
                print(f"⚠️ Erreur backup pour {path}: {e}")

        def norm_path(p):
            if not p:
                return base_docs
            p = os.path.expanduser(p)
            if not os.path.isabs(p):
                p = os.path.join(base_docs, p)
            base_real_docs = os.path.realpath(base_docs)
            base_real_dl = os.path.realpath(base_downloads)
            target_real = os.path.realpath(p)
            if target_real.startswith(base_real_docs) or target_real.startswith(base_real_dl):
                return target_real
            return base_docs

        if action == "list_dir":
            path = norm_path(params.get("path"))
            return self.files.list_files(path)

        elif action == "tree_dir":
            path = norm_path(params.get("path"))
            if not os.path.exists(path):
                return f"❌ Dossier introuvable: {path}"
            lines = []
            for root, dirs, files in os.walk(path):
                rel = os.path.relpath(root, path)
                level = 0 if rel == '.' else rel.count(os.sep)
                indent = '  ' * level
                name = os.path.basename(root) if rel != '.' else os.path.basename(path)
                lines.append(f"{indent}📁 {name}")
                for f in files:
                    lines.append(f"{indent}  📄 {f}")
            return "\n".join(lines)

        elif action == "read_file":
            path = norm_path(params.get("path"))
            return self.files.read_file(path)

        elif action == "search_files":
            base = norm_path(params.get("path"))
            query = (params.get("query") or "").lower()
            if not query:
                return "❌ search_files: query manquant."
            matches = []
            for root, dirs, files in os.walk(base):
                for f in files:
                    if query in f.lower():
                        rel = os.path.join(root, f)
                        matches.append(rel)
            if not matches:
                return f"📭 Aucun fichier ne contient '{query}' dans son nom sous {base}."
            return "🔍 Fichiers trouvés:\n" + "\n".join([f"📄 {m}" for m in matches])

        elif action == "create_dir":
            path = norm_path(params.get("path"))
            return self.files.create_directory(path)

        elif action == "create_file":
            path = norm_path(params.get("path"))
            content = params.get("content", "")
            return self.files.create_file(path, content)

        elif action == "delete":
            path = norm_path(params.get("path"))
            make_backup(path)
            if os.path.isdir(path):
                try:
                    os.rmdir(path)
                    return f"✅ Dossier supprimé: {path}"
                except Exception as e:
                    return f"❌ Erreur suppression dossier: {e}"
            else:
                return self.files.delete_file(path)

        elif action == "copy":
            src = norm_path(params.get("src"))
            dst = norm_path(params.get("dst"))
            try:
                import shutil
                if os.path.isdir(src):
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                return f"✅ Copie réussie de {src} vers {dst}"
            except Exception as e:
                return f"❌ Erreur copie: {e}"

        elif action == "move":
            src = norm_path(params.get("src"))
            dst = norm_path(params.get("dst"))
            make_backup(src)
            try:
                import shutil
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                return f"✅ Déplacement réussi de {src} vers {dst}"
            except Exception as e:
                return f"❌ Erreur déplacement: {e}"

        elif action == "rename":
            src = norm_path(params.get("src"))
            dst = norm_path(params.get("dst"))
            make_backup(src)
            try:
                os.rename(src, dst)
                return f"✅ Renommage réussi: {src} -> {dst}"
            except Exception as e:
                return f"❌ Erreur renommage: {e}"

        elif action == "create_architecture":
            base = norm_path(params.get("base"))
            try:
                dirs_to_create = [
                    "00_ADMIN/01_Juridique",
                    "00_ADMIN/02_RH",
                    "00_ADMIN/03_Contrats_fournisseurs",
                    "00_ADMIN/04_Assurances",
                    "10_FINANCE_COMPTA/01_Banques",
                    "10_FINANCE_COMPTA/02_Factures_clients",
                    "10_FINANCE_COMPTA/03_Factures_fournisseurs",
                    "10_FINANCE_COMPTA/04_Impots_Taxes",
                    "10_FINANCE_COMPTA/05_Budgets",
                    "20_OPERATIONS/01_Restaurant",
                    "20_OPERATIONS/02_Bar",
                    "20_OPERATIONS/03_Laverie",
                    "20_OPERATIONS/04_Retail",
                    "30_LOGISTIQUE/01_Achats",
                    "30_LOGISTIQUE/02_Stocks",
                    "30_LOGISTIQUE/03_Transport",
                    "40_COMMERCIAL_MARKETING/01_Offres",
                    "40_COMMERCIAL_MARKETING/02_Promotions",
                    "40_COMMERCIAL_MARKETING/03_Communication",
                    "90_ARCHIVES/01_2023",
                    "90_ARCHIVES/02_2024",
                    "90_ARCHIVES/03_2025",
                ]
                for rel in dirs_to_create:
                    os.makedirs(os.path.join(base, rel), exist_ok=True)
                return f"✅ Architecture Mano Verde SA créée sous {base}"
            except Exception as e:
                return f"❌ Erreur create_architecture: {e}"

        else:
            msg = params.get("message") or "Je n'ai pas compris la commande."
            return f"💬 IA: {msg}"

    def start(self):
        print("="*60)
        print("🤖 BOT MULTI-FONCTIONNEL - MODE CHAT")
        print("   Avec Recherche Web & Documents")
        print("="*60)
        print("💡 Tapez 'aide' pour voir les commandes disponibles")

        while self.running:
            try:
                user_input = input("Vous 💬 > ")
                if not user_input.strip():
                    continue
                response = self.process_command(user_input)
                print(f"Bot 🤖 > {response}")
            except KeyboardInterrupt:
                print("👋 Arrêt du bot...")
                break
            except Exception as e:
                print(f"❌ Erreur: {e}")

# ========================================
# WEBHOOK FLASK
# ========================================

@app.route('/webhook', methods=['GET', 'POST'])
def webhook():
    if request.method == 'GET':
        verify_token = request.args.get('hub.verify_token')
        challenge = request.args.get('hub.challenge')

        whatsapp = WhatsAppManager()
        if verify_token == whatsapp.verify_token:
            return challenge
        return 'Token invalide', 403

    elif request.method == 'POST':
        data = request.json
        print(f"📩 Webhook reçu: {data}")
        return jsonify({'status': 'success'}), 200

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'running', 'timestamp': datetime.now().isoformat()})

def run_flask():
    port = int(os.getenv('WEBHOOK_PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)

# ========================================
# POINT D'ENTRÉE PRINCIPAL
# ========================================

if __name__ == '__main__':
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    print("🌐 Serveur webhook démarré sur http://localhost:5000")
    bot = BotChat()
    bot.start()
