# Cerebro — Inteligentny System Analizy Spotkań

## Opis projektu

**Cerebro** to kompleksowa aplikacja webowa (PWA) do nagrywania, transkrypcji i wielowarstwowej analizy spotkań biznesowych. Łączy transkrypcję audio, rozpoznawanie slajdów prezentacji (OCR) i analizę AI w jeden zintegrowany system zarządzania wiedzą.

## Architektura

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Lovable Cloud) — PostgreSQL, Auth, Storage, Edge Functions
- **AI**: Gemini 2.5 Pro/Flash via Lovable AI Gateway + opcjonalny ChatGPT (manual fallback)
- **PWA**: Service Worker, manifest, offline-capable

## Główne funkcjonalności

### 1. Nagrywanie spotkań
- Nagrywanie audio bezpośrednio w przeglądarce (`use-recorder.ts`)
- Live speech recognition podczas nagrywania (`use-speech-recognition.ts`)
- Podział długich nagrań na segmenty (`RecordingSplitter`, `RecordingSegments`)
- Upload nagrań do Supabase Storage (bucket: `recordings`)
- HUD z aktywnym statusem nagrywania (`RecordingHUD`)

### 2. Transkrypcja audio
- Edge Function `transcribe-audio` — wysyła base64 audio + opcjonalne klatki do Gemini 2.5 Flash
- Strukturyzowany wynik: linie z timestampami, mówcy, pełny tekst
- Zapis do tabeli `transcript_lines` (meeting_id, speaker, text, timestamp, line_order)

### 3. Ekstrakcja i analiza slajdów (pipeline 6-krokowy)
Edge Function `transcribe-slides` obsługuje 4 tryby:

| Tryb | Opis |
|------|------|
| `crop-split` | Deduplikacja klatek wideo, identyfikacja unikalnych slajdów |
| `ocr-captions` | OCR na kadrach — odczyt tekstu, dialogów, opisów ze slajdów |
| `describe-slides` | Szczegółowy opis zawartości każdego unikalnego slajdu |
| `aggregate` | **Agregacja** — łączy transkrypcję audio z OCR w dwie sekcje: pełna rozmowa z identyfikacją mówców + podsumowania slajdów |

Wyniki zapisywane w `meeting_analyses` z polami source: `crop-split`, `captions-ocr`, `slide-descriptions`, `merged`.

### 4. Analiza AI spotkania
Edge Function `analyze-meeting`:
- Ładuje transkrypt audio + transkrypt wizualny (OCR) + obrazy slajdów
- Wysyła multimodalny request do Gemini 2.5 Pro z tool calling
- Zwraca strukturyzowany JSON:
  - `summary` — podsumowanie 3-6 zdań
  - `integrated_transcript` — chronologiczny zapis dialog + slajdy
  - `sentiment` — pozytywny/neutralny/negatywny/mieszany
  - `participants` — lista uczestników
  - `tags` — tagi tematyczne
  - `key_quotes` — kluczowe cytaty
  - `action_items` — zadania z właścicielem i terminem
  - `decisions` — decyzje z uzasadnieniem i timestampem
  - `slide_insights` — analiza każdego slajdu z kontekstem dyskusji
- Zapisuje do: `meeting_analyses`, `action_items`, `decisions`, `meeting_participants`

### 5. ChatGPT Fallback (manual)
- `AnalysisPromptGenerator` generuje paczkę ZIP z:
  - Promptem instrukcyjnym dla GPT-4o
  - Transkrypcją audio (.txt)
  - Dialogami OCR (.txt)
  - Opisami slajdów (.txt)
  - Obrazami slajdów (.jpg/.png)
- `AnalysisJsonImporter` importuje wynikowy JSON z ChatGPT do systemu

### 6. Chat AI
Edge Function `chat`:
- Streaming SSE (Server-Sent Events)
- Kontekst: dane spotkania + transkrypt + baza wiedzy użytkownika
- Model: Gemini 3 Flash Preview

### 7. Baza wiedzy
Edge Function `build-knowledge`:
- Automatyczna ekstrakcja wzorców zadań (`task_patterns`)
- Konteksty projektowe (`project_contexts`)
- Podsumowania wiedzy (`knowledge_summaries`)

### 8. Porównanie analiz
- `AnalysisComparison` — porównanie wyników z różnych źródeł (Gemini vs ChatGPT)
- `SlideInsightsPanel` — panel z insights per slajd + zintegrowana transkrypcja

## Schemat bazy danych

| Tabela | Opis |
|--------|------|
| `meetings` | Spotkania (title, date, status, summary, tags, recording_filename) |
| `transcript_lines` | Linie transkrypcji (speaker, text, timestamp, line_order) |
| `meeting_analyses` | Wyniki analiz JSON (source: gemini/chatgpt/merged/captions-ocr/...) |
| `action_items` | Zadania do wykonania (task, owner, deadline, completed) |
| `decisions` | Podjęte decyzje (decision, rationale, timestamp) |
| `meeting_participants` | Uczestnicy spotkań |
| `categories` | Kategorie spotkań |
| `knowledge_summaries` | Podsumowania wiedzy z spotkań |
| `project_contexts` | Konteksty projektowe (keywords, meeting_count) |
| `task_patterns` | Wzorce zadań (keywords, frequency) |
| `pin_users` | Użytkownicy PIN (szybki dostęp) |

**Storage bucket**: `recordings` — nagrania audio, klatki wideo (frames), pliki segmentów

## Struktura Edge Functions

| Funkcja | Endpoint | Model AI |
|---------|----------|----------|
| `analyze-meeting` | Pełna analiza multimodalna | Gemini 2.5 Pro |
| `transcribe-audio` | Transkrypcja audio | Gemini 2.5 Flash |
| `transcribe-slides` | Pipeline slajdów (4 tryby) | Gemini 2.5 Flash |
| `chat` | Chat AI ze streamingiem | Gemini 3 Flash Preview |
| `build-knowledge` | Budowanie bazy wiedzy | Gemini 2.5 Flash |
| `compare-analyses` | Porównanie dwóch analiz | Gemini 2.5 Flash |
| `batch-upload` | Batch upload plików | — |
| `manage-pin-user` | Zarządzanie użytkownikami PIN | — |

## Strony aplikacji

| Route | Komponent | Opis |
|-------|-----------|------|
| `/` | `Dashboard` | Lista spotkań, tworzenie nowych |
| `/meeting/:id` | `MeetingDetail` | Szczegóły spotkania, pełny pipeline |
| `/chat` | `ChatPage` | Chat AI |
| `/actions` | `ActionsPage` | Lista zadań ze spotkań |
| `/search` | `SearchPage` | Wyszukiwanie |
| `/knowledge` | `KnowledgePage` | Baza wiedzy |
| `/settings` | `SettingsPage` | Ustawienia |
| `/upload` | `UploadPage` | Upload nagrań |
| `/pin-login` | `PinLoginPage` | Logowanie PIN |

## Autoryzacja
- Supabase Auth (email/password)
- PIN-based quick login (tabela `pin_users`, funkcja `get_auth_email_by_pin`)
- RLS na wszystkich tabelach — dane per user

## Kluczowe komponenty UI

- `RecordingPanel` — panel nagrywania z kontrolkami
- `TranscriptTabs` — zakładki: audio / OCR-captions / agregowana transkrypcja
- `SlideInsightsPanel` — insights per slajd z kontekstem dyskusji
- `FrameGallery` — galeria wyekstrahowanych klatek
- `UniqueSlides` — unikalne slajdy po deduplikacji
- `ActionItemsList` — lista zadań z możliwością oznaczania jako wykonane
- `AIChatPanel` — panel czatu AI w kontekście spotkania
- `GeminiAnalysisButton` — przycisk uruchamiający analizę Gemini
- `SlideTranscriptionButton` — 6-krokowy pipeline transkrypcji slajdów

## Format zagregowanej transkrypcji (source: "merged")

```json
{
  "conversation_transcript": "Pełna transkrypcja rozmowy ~50 min z identyfikacją mówców, poprawiona na podstawie OCR",
  "slides_section": "Sekcja z opisami i podsumowaniami wszystkich slajdów prezentacji",
  "speakers": ["Jan Kowalski", "Anna Nowak"],
  "timeline_markers": [
    { "time": "0:00", "event": "Rozpoczęcie spotkania" }
  ]
}
```

## Wymagania środowiskowe

- `LOVABLE_API_KEY` — klucz do Lovable AI Gateway (edge functions)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — automatyczne
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — frontend (.env)
