"""BilgiAl — faster-whisper köprüsü.

Tek iş: verilen medya dosyasını yazıya çevirmek ve sonucu stdout'a JSONL
olarak yazmak. Ağ erişimi yalnız model ağırlıkları ilk kez indirilirken
kullanılır; ağırlıklar `--model-dir` altında tutulur.

Çıktı satırları:
  {"type":"status","message":"..."}
  {"type":"progress","progress":0.42}
  {"type":"done","text":"...","segments":[...],"language":"tr","durationSec":31.6}
  {"type":"error","code":"...","message":"..."}
"""

import argparse
import json
import os
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--model-dir", default="")
    parser.add_argument("--language", default="")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        emit({"type": "error", "code": "no-file", "message": "Medya dosyası yok."})
        return 2

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "no-engine", "message": "faster-whisper kurulu değil: %s" % exc})
        return 3

    download_root = args.model_dir or None
    if download_root:
        os.makedirs(download_root, exist_ok=True)

    device = args.device
    if device == "auto":
        device = "cuda" if _cuda_available() else "cpu"
    emit({"type": "status", "message": "model yükleniyor (%s/%s)" % (args.model, device)})
    try:
        model = WhisperModel(
            args.model,
            device=device,
            compute_type=args.compute_type if device == "cuda" else "int8",
            download_root=download_root,
        )
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "model-load", "message": "Model yüklenemedi: %s" % exc})
        return 4

    language = args.language or None
    emit({"type": "status", "message": "çözümleme başladı"})
    try:
        segments, info = model.transcribe(
            args.input,
            language=language,
            beam_size=max(1, args.beam_size),
            vad_filter=True,
            condition_on_previous_text=False,
        )
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "transcribe", "message": "Çözümleme başarısız: %s" % exc})
        return 5

    total = float(getattr(info, "duration", 0.0) or 0.0)
    out_segments = []
    for segment in segments:
        text = (segment.text or "").strip()
        if not text:
            continue
        start = float(segment.start or 0.0)
        end = float(segment.end or start)
        out_segments.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
        })
        if total > 0:
            emit({"type": "progress", "progress": min(1.0, round(end / total, 4))})

    emit({
        "type": "done",
        "text": " ".join(item["text"] for item in out_segments).strip(),
        "segments": out_segments,
        "language": getattr(info, "language", language or "") or "",
        "durationSec": round(total, 3),
    })
    return 0


def _cuda_available():
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    sys.exit(main())
