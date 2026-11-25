"""BilgiAl — PyMuPDF köprüsü.

Bir PDF'nin her sayfasını PNG'ye çevirir ve sonucu stdout'a JSONL olarak yazar.
Ağır iş Python'da kalır; Electron ana prosesi yalnız dosya yollarını toplar.

Çıktı satırları:
  {"type":"status","message":"..."}
  {"type":"progress","progress":0.4,"page":2,"pages":5}
  {"type":"done","pages":[{"file":"p01.png","page":1,"width":1240,"height":1754,"bytes":123456}],"pageCount":5}
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
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--max-pages", type=int, default=40)
    parser.add_argument("--first-page", type=int, default=1)
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        emit({"type": "error", "code": "no-file", "message": "PDF dosyası yok."})
        return 2

    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "no-engine", "message": "PyMuPDF kurulu değil: %s" % exc})
        return 3

    try:
        doc = fitz.open(args.input)
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "open", "message": "PDF açılamadı: %s" % exc})
        return 4

    total = doc.page_count
    if total <= 0:
        emit({"type": "error", "code": "empty", "message": "PDF hiç sayfa içermiyor."})
        return 5

    emit({"type": "status", "message": "%d sayfa bulundu" % total})
    os.makedirs(args.out_dir, exist_ok=True)

    start = max(1, min(args.first_page, total))
    end = min(total, start + max(1, args.max_pages) - 1)
    pages = []
    zoom = max(1.0, float(args.dpi) / 72.0)
    matrix = fitz.Matrix(zoom, zoom)

    for number in range(start, end + 1):
        page = doc.load_page(number - 1)
        try:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "code": "render", "message": "Sayfa %d çizilemedi: %s" % (number, exc)})
            return 6
        name = "p%02d.png" % number
        target = os.path.join(args.out_dir, name)
        pix.save(target)
        pages.append({
            "file": target,
            "page": number,
            "width": int(pix.width),
            "height": int(pix.height),
            "bytes": os.path.getsize(target),
        })
        emit({
            "type": "progress",
            "progress": round((number - start + 1) / float(end - start + 1), 4),
            "page": number,
            "pages": total,
        })

    doc.close()
    emit({"type": "done", "pages": pages, "pageCount": total, "firstPage": start, "lastPage": end})
    return 0


if __name__ == "__main__":
    sys.exit(main())
