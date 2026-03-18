

# Plan: Narzędzia do budowania bazy wiedzy z AI-kategoryzacją

## Cel

Zbudować ekosystem narzędzi, w którym AI uczy się kontekstu Twoich spotkań, automatycznie kategoryzuje zadania, buduje bazę podsumowań i rozpoznaje wzorce w Twoich projektach/tematach.

## Architektura — 5 modułów

```text
┌─────────────────────────────────────────────────────┐
│                    CEREBRO                          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Dashboard │  │ Meeting  │  │  Knowledge Base   │ │
│  │ (istn.)  │  │ Detail   │  │  (NOWA STRONA)    │ │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘ │
│       │              │                 │            │
│  ┌────┴──────────────┴─────────────────┴──────────┐ │
│  │              AI Context Engine                  │ │
│  │  (Edge Function: buduje profil + kategoryzuje)  │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                            │
│  ┌─────────────────────┴──────────────────────────┐ │
│  │  DB: knowledge_summaries + task_patterns +     │ │
│  │      project_contexts                          │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 1. Nowe tabele w bazie

### `knowledge_summaries`
Zbiera przetworzone podsumowania spotkań w ustrukturyzowanej formie:
- `id`, `meeting_id`, `user_id`
- `summary_text` — zwięzłe podsumowanie
- `key_topics` (text[]) — tematy główne (wykryte przez AI)
- `project_context` — nazwa projektu/kontekstu (auto-kategoryzowane)
- `sentiment` — ton spotkania
- `created_at`

### `task_patterns`
AI uczy się wzorców Twoich zadań:
- `id`, `user_id`
- `pattern_name` — np. "Raportowanie", "Code review", "Planowanie sprintu"
- `keywords` (text[]) — słowa kluczowe powiązane
- `suggested_category` — sugerowana kategoria
- `frequency` (int) — ile razy wzorzec się pojawił
- `last_seen` (timestamp)
- `auto_actions` (jsonb) — sugerowane domyślne akcje dla wzorca

### `project_contexts`
Grupowanie spotkań w konteksty projektowe:
- `id`, `user_id`
- `name` — nazwa projektu/kontekstu
- `description`
- `keywords` (text[]) — słowa kluczowe do auto-przypisywania
- `color`
- `meeting_count` (int)
- `last_activity` (timestamp)

## 2. Edge Function: `build-knowledge` 

Wywoływana po każdej analizie spotkania (Gemini/ChatGPT import). Używa AI do:

1. **Wyciągnięcia kluczowych tematów** z podsumowania + transkryptu
2. **Dopasowania do istniejących kontekstów projektowych** (lub utworzenia nowego)
3. **Rozpoznania wzorców zadań** — porównanie action_items z historycznymi
4. **Auto-kategoryzacji** — przypisanie kategorii na podstawie kontekstu
5. **Aktualizacji `task_patterns`** — zwiększenie frequency, dodanie nowych słów kluczowych

Prompt AI otrzymuje kontekst: ostatnie 20 spotkań + istniejące wzorce + konteksty projektowe.

## 3. Nowa strona: Knowledge Base (`/knowledge`)

Widok "bazy wiedzy" z trzema zakładkami:

**Zakładka: Podsumowania**
- Chronologiczna lista podsumowań pogrupowana po kontekstach projektowych
- Filtrowanie po projekcie, dacie, temacie
- Wyszukiwanie semantyczne (przez AI Chat)

**Zakładka: Wzorce zadań**
- Lista rozpoznanych wzorców z częstotliwością
- Edycja wzorców (nazwa, słowa kluczowe, sugerowana kategoria)
- AI sugeruje nowe wzorce

**Zakładka: Projekty/Konteksty**
- Lista kontekstów projektowych z liczbą spotkań
- Auto-przypisywanie nowych spotkań
- Timeline aktywności per projekt

## 4. Rozbudowa istniejących narzędzi

### MeetingDetail — po analizie:
- Przycisk "Dodaj do bazy wiedzy" (wywołuje `build-knowledge`)
- Wyświetla wykryte tematy i sugerowany kontekst projektowy
- Pozwala zatwierdzić/zmienić kategoryzację

### ActionsPage — AI kategoryzacja:
- Grupowanie zadań per wzorzec (nie tylko open/done)
- Podpowiedzi: "Te 3 zadania wyglądają jak Code Review"
- Sugerowane deadline'y na podstawie historycznych wzorców

### AI Chat — kontekst wiedzy:
- Chat ma dostęp do `knowledge_summaries` i `project_contexts`
- Może odpowiadać: "W projekcie X podjęliście 5 decyzji o architekturze w ostatnim miesiącu"

## 5. Automatyczny pipeline

```text
Nagranie → Segmenty → MP3 → Transkrypcja → Analiza AI
                                                  ↓
                                          build-knowledge
                                                  ↓
                                    knowledge_summaries (podsumowanie)
                                    task_patterns (wzorce zadań)
                                    project_contexts (kontekst projektu)
                                    auto-kategoria na meetings
```

## Kolejność implementacji

1. **Tabele** — `knowledge_summaries`, `task_patterns`, `project_contexts` z RLS
2. **Edge Function `build-knowledge`** — AI analizuje spotkanie i buduje wiedzę
3. **Hook po analizie** — automatyczne wywołanie `build-knowledge` po Gemini/ChatGPT import
4. **Strona `/knowledge`** — UI do przeglądania bazy wiedzy
5. **Rozbudowa AI Chat** — kontekst z bazy wiedzy w prompcie
6. **Auto-kategoryzacja Action Items** — wzorce w ActionsPage

## Nowy element w sidebarze

```
{ icon: BookOpen, label: "Knowledge Base", path: "/knowledge" }
```

dodany między "Action Items" a "Batch Upload".

