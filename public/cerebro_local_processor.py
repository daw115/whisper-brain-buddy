#!/usr/bin/env python3
"""
Cerebro Local Processor — Skrypt do lokalnego przetwarzania nagrań spotkań.
Działa na Windows 10+ z Python 3.10+.

INSTALACJA:
  pip install openai-whisper torch

OPCJONALNIE (szybsza transkrypcja na GPU NVIDIA):
  pip install torch --index-url https://download.pytorch.org/whl/cu121

UŻYCIE:
  python cerebro_local_processor.py nagranie.webm
  python cerebro_local_processor.py nagranie.mp3 --model medium --language pl
  python cerebro_local_processor.py folder_z_nagraniami/ --batch

Wynik: plik JSON gotowy do wrzucenia do Cerebro (strona Batch Upload).
"""

import argparse
import json
import os
import sys
import re
from datetime import datetime
from pathlib import Path

def check_whisper():
    try:
        import whisper
        return whisper
    except ImportError:
        print("❌ Brak modułu whisper. Zainstaluj:")
        print("   pip install openai-whisper torch")
        sys.exit(1)

def transcribe(file_path: str, model_name: str = "medium", language: str = "pl"):
    """Transkrybuj plik audio/video za pomocą Whisper."""
    whisper = check_whisper()
    
    print(f"📥 Ładowanie modelu Whisper '{model_name}'...")
    model = whisper.load_model(model_name)
    
    print(f"🎤 Transkrybuję: {file_path}")
    result = model.transcribe(
        file_path,
        language=language,
        verbose=False,
        word_timestamps=False,
    )
    
    segments = []
    for seg in result["segments"]:
        start = seg["start"]
        mins = int(start // 60)
        secs = int(start % 60)
        timestamp = f"{mins:02d}:{secs:02d}"
        segments.append({
            "timestamp": timestamp,
            "speaker": "unknown",  # Whisper nie rozpoznaje mówców
            "text": seg["text"].strip(),
        })
    
    return segments, result.get("text", "")

def format_duration(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"

def build_meeting_json(file_path: str, transcript: list, full_text: str) -> dict:
    """Buduje strukturę JSON spotkania z transkryptem."""
    filename = Path(file_path).stem
    file_size = os.path.getsize(file_path)
    
    # Szacuj czas trwania z ostatniego segmentu
    duration = "00:00"
    if transcript:
        last_ts = transcript[-1]["timestamp"]
        duration = last_ts
    
    meeting = {
        "title": f"Spotkanie — {filename}",
        "date": datetime.now().strftime("%Y-%m-%d"),
        "duration": duration,
        "status": "transcribed",
        "tags": [],
        "summary": None,
        "sentiment": None,
        "key_quotes": [],
        "participants": [],
        "transcript": transcript,
        "action_items": [],
        "decisions": [],
        "recording_filename": Path(file_path).name,
        "recording_size_bytes": file_size,
        "_analysis_prompt": generate_analysis_prompt(full_text),
    }
    
    return meeting

def generate_analysis_prompt(full_text: str) -> str:
    """
    Generuje prompt do ręcznej analizy w dowolnym LLM (ChatGPT, Claude, Gemini, LM Studio...).
    Skopiuj ten prompt i wklej do wybranego modelu AI.
    """
    return f"""Przeanalizuj poniższy transkrypt spotkania i zwróć wynik w formacie JSON.

TRANSKRYPT:
---
{full_text[:8000]}
---

Zwróć DOKŁADNIE taki JSON (bez komentarzy, bez markdown):
{{
  "summary": "Zwięzłe podsumowanie spotkania w 2-4 zdaniach",
  "sentiment": "pozytywny | neutralny | negatywny | mieszany",
  "participants": ["Imię Nazwisko uczestnika 1", "Imię Nazwisko uczestnika 2"],
  "key_quotes": [
    "Najważniejszy cytat ze spotkania - Autor"
  ],
  "tags": ["temat1", "temat2"],
  "action_items": [
    {{
      "task": "Opis zadania do wykonania",
      "owner": "Osoba odpowiedzialna",
      "deadline": "YYYY-MM-DD lub null"
    }}
  ],
  "decisions": [
    {{
      "decision": "Podjęta decyzja",
      "rationale": "Uzasadnienie lub null",
      "timestamp": "MM:SS lub null"
    }}
  ]
}}

ZASADY:
1. Zidentyfikuj mówców po kontekście (kto się jak przedstawia, kto do kogo mówi)
2. Action items = konkretne zadania z właścicielem, nie ogólne stwierdzenia  
3. Decisions = wyraźnie podjęte decyzje, nie propozycje
4. Key quotes = najważniejsze/najbardziej wpływowe wypowiedzi
5. Sentiment = ogólny ton spotkania
6. Tags = główne tematy (max 5)
7. Summary = zwięzłe, informacyjne, po polsku"""

def merge_analysis(meeting: dict, analysis: dict) -> dict:
    """Łączy surowe dane spotkania z wynikiem analizy AI."""
    for key in ["summary", "sentiment", "participants", "key_quotes", "tags", 
                 "action_items", "decisions"]:
        if key in analysis and analysis[key]:
            meeting[key] = analysis[key]
    
    # Aktualizuj speakerów w transkrypcie jeśli mamy listę uczestników
    # (ręcznie trzeba to zrobić — Whisper nie diaryzuje)
    
    # Usuń pole _analysis_prompt bo już niepotrzebne
    meeting.pop("_analysis_prompt", None)
    
    return meeting

def main():
    parser = argparse.ArgumentParser(
        description="Cerebro Local Processor — transkrypcja i przygotowanie danych spotkań"
    )
    parser.add_argument("input", help="Plik audio/video lub folder (z --batch)")
    parser.add_argument("--model", default="medium", 
                       choices=["tiny", "base", "small", "medium", "large", "large-v3"],
                       help="Model Whisper (default: medium)")
    parser.add_argument("--language", default="pl", help="Język transkrypcji (default: pl)")
    parser.add_argument("--batch", action="store_true", help="Przetwórz cały folder")
    parser.add_argument("--output", default=None, help="Plik wyjściowy JSON")
    parser.add_argument("--merge", default=None, 
                       help="Plik JSON z wynikiem analizy AI do scalenia")
    
    args = parser.parse_args()
    
    # Tryb scalania — użytkownik ma gotowy wynik z AI
    if args.merge:
        print(f"🔗 Scalanie analizy z: {args.merge}")
        with open(args.input, "r", encoding="utf-8") as f:
            meeting = json.load(f)
        with open(args.merge, "r", encoding="utf-8") as f:
            analysis = json.load(f)
        
        result = merge_analysis(meeting, analysis)
        out_path = args.output or args.input  # nadpisz oryginalny
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"✅ Scalony plik: {out_path}")
        return
    
    # Zbierz pliki do przetworzenia
    audio_exts = {".mp3", ".wav", ".m4a", ".webm", ".mp4", ".ogg", ".flac", ".wma"}
    
    if args.batch:
        folder = Path(args.input)
        files = [f for f in folder.iterdir() if f.suffix.lower() in audio_exts]
        if not files:
            print(f"❌ Brak plików audio w: {folder}")
            sys.exit(1)
        print(f"📂 Znaleziono {len(files)} plików do przetworzenia")
    else:
        files = [Path(args.input)]
    
    all_meetings = []
    
    for file_path in files:
        if not file_path.exists():
            print(f"❌ Plik nie istnieje: {file_path}")
            continue
        
        print(f"\n{'='*60}")
        print(f"📄 Przetwarzam: {file_path.name}")
        print(f"{'='*60}")
        
        transcript, full_text = transcribe(str(file_path), args.model, args.language)
        meeting = build_meeting_json(str(file_path), transcript, full_text)
        all_meetings.append(meeting)
        
        # Zapisz pojedynczy plik
        single_out = file_path.with_suffix(".json")
        with open(single_out, "w", encoding="utf-8") as f:
            json.dump(meeting, f, ensure_ascii=False, indent=2)
        print(f"💾 Zapisano: {single_out}")
        
        # Wyświetl prompt do analizy
        print(f"\n📋 PROMPT DO ANALIZY AI:")
        print(f"   Skopiuj prompt z pliku {single_out}")
        print(f"   Pole '_analysis_prompt' zawiera gotowy prompt.")
        print(f"   Wklej go do ChatGPT/Claude/LM Studio, a wynik zapisz jako *_analysis.json")
        print(f"   Potem uruchom: python {sys.argv[0]} {single_out} --merge {single_out.stem}_analysis.json")
    
    # Batch output
    if args.batch or len(all_meetings) > 1:
        out_path = args.output or "cerebro_batch.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(all_meetings, f, ensure_ascii=False, indent=2)
        print(f"\n📦 Paczka batch: {out_path}")
    
    print(f"\n✅ Gotowe! Wrzuć plik JSON do Cerebro → Batch Upload")

if __name__ == "__main__":
    main()
